#!/usr/bin/env python3
"""
长桥证券资产同步插件

每日盘后自动查询长桥港美股账户净资产，折算为 CNY 后提交余额快照到 HomeAccountant。

运行方式:
  # 首次运行: 交互式设置（在插件目录下）
  cd plugins/longport_monitor && python3 plugin.py --setup

  # 持续运行（每日盘后自动同步）
  python3 plugin.py

  # 仅同步一次
  python3 plugin.py --once
"""

import os
import sys
import json
import time
import signal
import logging
import argparse
from datetime import datetime, timedelta
from decimal import Decimal

import requests

logger = logging.getLogger("longport_monitor")

# ============ 插件元信息 ============

PLUGIN_NAME = "longport-monitor"
PLUGIN_DISPLAY_NAME = "长桥证券资产同步"
PLUGIN_DESCRIPTION = "每日盘后自动查询长桥港美股账户净资产，折算为 CNY 后提交余额快照"
PLUGIN_TYPE = "balance"

CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "目标账本",
            "type": "book_select",
            "required": True,
            "multi": True,
            "description": "余额快照关联的账本（支持多账本）",
        },
        {
            "key": "securities_account_id",
            "label": "港美股资产科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",
            "description": "对应长桥证券账户的资产科目",
        },
        {
            "key": "lp_app_key",
            "label": "App Key",
            "type": "string",
            "required": True,
            "description": "LongPort 应用 Key",
        },
        {
            "key": "lp_app_secret",
            "label": "App Secret",
            "type": "secret",
            "required": True,
            "description": "LongPort 应用 Secret",
        },
        {
            "key": "lp_access_token",
            "label": "Access Token",
            "type": "secret",
            "required": True,
            "description": "LongPort 用户访问令牌",
        },
        {
            "key": "adjust_account_id",
            "label": "调账科目",
            "type": "account_select",
            "required": False,
            "depends_on": "target_book",
            "description": "余额差异时使用的调账科目（留空则自动创建）",
        },
        {
            "key": "sync_time",
            "label": "每日同步时间",
            "type": "string",
            "required": False,
            "default": "16:30",
            "description": "格式 HH:MM，默认港股收盘后 16:30",
        },
    ]
}

# ============ 默认汇率 ============

DEFAULT_RATES = {
    "HKD": 0.92,
    "USD": 7.25,
    "CNH": 1.0,
    "CNY": 1.0,
}

# ============ 插件配置管理 ============

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_CONFIG_PATH = os.path.join(PLUGIN_DIR, "config.json")

DEFAULT_PLUGIN_CONFIG = {
    "api_url": "http://127.0.0.1:8000",
    "api_key": "",
    "config_refresh_seconds": 300,
}


def load_plugin_config() -> dict | None:
    if not os.path.exists(PLUGIN_CONFIG_PATH):
        return None
    with open(PLUGIN_CONFIG_PATH) as f:
        return json.load(f)


def save_plugin_config(config: dict):
    os.makedirs(os.path.dirname(PLUGIN_CONFIG_PATH), exist_ok=True)
    with open(PLUGIN_CONFIG_PATH, "w") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


def get_plugin_config() -> dict:
    config = load_plugin_config()
    if config and config.get("api_url") and config.get("api_key"):
        return {**DEFAULT_PLUGIN_CONFIG, **config}

    api_url = os.environ.get("HA_API_URL", "")
    api_key = os.environ.get("HA_API_KEY", "")
    if api_url and api_key:
        return {**DEFAULT_PLUGIN_CONFIG, "api_url": api_url, "api_key": api_key}

    print("[-] 未找到插件配置，请先运行: python3 plugin.py --setup")
    sys.exit(1)


def cmd_setup():
    """交互式设置插件配置"""
    print("=== HomeAccountant 长桥证券资产同步插件配置 ===\n")

    existing = load_plugin_config() or {}
    defaults = {**DEFAULT_PLUGIN_CONFIG, **existing}

    api_url = input(f"API 地址 [{defaults['api_url']}]: ").strip() or defaults["api_url"]

    default_key = defaults.get("api_key", "")
    if default_key:
        masked = default_key[:6] + "..." + default_key[-4:] if len(default_key) > 10 else "***"
        api_key = input(f"API Key [{masked}]: ").strip() or default_key
    else:
        api_key = input("API Key: ").strip()

    if not api_key:
        print("[-] API Key 不能为空")
        sys.exit(1)

    default_refresh = defaults["config_refresh_seconds"]
    refresh_input = input(f"配置刷新间隔/秒 [{default_refresh}]: ").strip()
    config_refresh = int(refresh_input) if refresh_input else default_refresh

    print(f"\n验证连接 {api_url} ...")
    try:
        resp = requests.get(
            f"{api_url.rstrip('/')}/health",
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=5,
        )
        if resp.ok:
            print(f"[+] 连接成功: {resp.json()}")
        else:
            print(f"[!] 服务器返回 {resp.status_code}，仍然保存配置")
    except Exception as e:
        print(f"[!] 连接失败: {e}")
        confirm = input("仍然保存? [y/N]: ").strip().lower()
        if confirm != "y":
            print("已取消")
            sys.exit(0)

    new_config = {
        "api_url": api_url,
        "api_key": api_key,
        "config_refresh_seconds": config_refresh,
    }
    save_plugin_config(new_config)
    print(f"\n[+] 配置已保存到 {PLUGIN_CONFIG_PATH}")
    print("[i] LongPort 三元组、同步时间请在 HomeAccountant App「插件管理」中配置")


# ============ HomeAccountant API 客户端 ============


class HAClient:
    """HomeAccountant API 客户端"""

    def __init__(self, api_url: str, api_key: str):
        self.base_url = api_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.session.headers["Content-Type"] = "application/json"

    def register_plugin(self) -> dict:
        resp = self.session.post(
            f"{self.base_url}/plugins",
            json={
                "name": PLUGIN_NAME,
                "display_name": PLUGIN_DISPLAY_NAME,
                "type": PLUGIN_TYPE,
                "description": PLUGIN_DESCRIPTION,
                "config_schema": CONFIG_SCHEMA,
            },
        )
        resp.raise_for_status()
        return resp.json()

    def get_plugin(self, plugin_id: str) -> dict:
        resp = self.session.get(f"{self.base_url}/plugins/{plugin_id}")
        resp.raise_for_status()
        return resp.json()

    def update_status(self, plugin_id: str, status: str, error_message: str = None):
        body = {"status": status}
        if error_message:
            body["error_message"] = error_message
        resp = self.session.put(
            f"{self.base_url}/plugins/{plugin_id}/status", json=body
        )
        resp.raise_for_status()

    def submit_balance_snapshot(
        self, account_id: str, external_balance: float, snapshot_date: str,
        adjust_account_id: str | None = None,
    ) -> dict:
        body: dict = {
            "external_balance": external_balance,
            "snapshot_date": snapshot_date,
        }
        if adjust_account_id:
            body["adjust_account_id"] = adjust_account_id
        resp = self.session.post(
            f"{self.base_url}/accounts/{account_id}/snapshot",
            json=body,
        )
        resp.raise_for_status()
        return resp.json()


# ============ 汇率获取 ============


def get_exchange_rates() -> dict[str, float]:
    """通过 forex-python 获取实时汇率，失败时返回默认值"""
    rates = dict(DEFAULT_RATES)
    try:
        from forex_python.converter import CurrencyRates
        c = CurrencyRates()
        for currency in ("HKD", "USD"):
            try:
                rate = c.get_rate(currency, "CNY")
                if rate and rate > 0:
                    rates[currency] = round(float(rate), 4)
                    logger.info("实时汇率 %s→CNY = %.4f", currency, rates[currency])
            except Exception:
                logger.warning("获取 %s→CNY 汇率失败，使用默认值 %.4f", currency, rates[currency])
    except ImportError:
        logger.warning("forex-python 未安装，使用默认汇率")
    except Exception:
        logger.warning("汇率 API 异常，使用默认汇率", exc_info=True)
    return rates


# ============ 长桥资产查询 ============


def query_longport_assets(app_key: str, app_secret: str, access_token: str) -> list[dict] | None:
    """
    查询长桥账户各币种净资产。
    返回 [{"currency": "HKD", "net_assets": 12345.67}, ...] 或 None。
    """
    try:
        from longport.openapi import Config, TradeContext

        config = Config(
            app_key=app_key,
            app_secret=app_secret,
            access_token=access_token,
        )
        ctx = TradeContext(config)
        balances = ctx.account_balance()

        if not balances:
            logger.warning("account_balance() 返回空")
            return None

        result = []
        for b in balances:
            currency = str(b.currency) if hasattr(b, "currency") else "HKD"
            # 处理 currency 可能带 Currency. 前缀
            currency = currency.replace("Currency.", "").upper()
            try:
                net_assets = float(str(b.net_assets))
            except (ValueError, TypeError, AttributeError):
                logger.warning("无法解析 net_assets: %s", b)
                continue

            logger.info("长桥账户 %s: 净资产 = %.2f", currency, net_assets)
            result.append({"currency": currency, "net_assets": net_assets})

        return result if result else None

    except Exception:
        logger.exception("查询长桥账户资产失败")
        return None


def calculate_cny_total(assets: list[dict], rates: dict[str, float]) -> float:
    """将各币种净资产折算为 CNY 汇总"""
    total = Decimal("0")
    for item in assets:
        currency = item["currency"]
        net_assets = Decimal(str(item["net_assets"]))
        rate = Decimal(str(rates.get(currency, DEFAULT_RATES.get(currency, 1.0))))
        converted = net_assets * rate
        logger.info(
            "  %s %.2f × %.4f = CNY %.2f",
            currency, net_assets, rate, converted,
        )
        total += converted
    return float(total.quantize(Decimal("0.01")))


# ============ 定时调度 ============


def seconds_until_sync_time(sync_time_str: str) -> int:
    now = datetime.now()
    hour, minute = map(int, sync_time_str.split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return int((target - now).total_seconds())


def _interruptible_sleep(seconds: int, check_running):
    for _ in range(seconds):
        if not check_running():
            break
        time.sleep(1)


# ============ 同步逻辑 ============


def do_sync(client: HAClient, plugin_config: dict) -> bool:
    """执行一次同步：查询长桥净资产 → 汇率折算 → 循环所有账本提交快照。返回是否成功。"""
    app_key = plugin_config["lp_app_key"]
    app_secret = plugin_config["lp_app_secret"]
    access_token = plugin_config["lp_access_token"]

    # 1. 查询长桥各币种净资产
    logger.info("查询长桥账户资产...")
    assets = query_longport_assets(app_key, app_secret, access_token)
    if assets is None:
        logger.error("查询长桥资产失败")
        return False

    # 2. 获取实时汇率
    logger.info("获取汇率...")
    rates = get_exchange_rates()

    # 3. 折算为 CNY 总值
    cny_total = calculate_cny_total(assets, rates)
    logger.info("CNY 总资产: %.2f", cny_total)

    # 4. 提交余额快照（支持多账本循环）
    snapshot_date = datetime.now().strftime("%Y-%m-%d")
    target_book = plugin_config["target_book"]
    account_mapping = plugin_config["securities_account_id"]

    # 兼容：多账本模式 target_book 为 list，account_mapping 为 dict
    #        单账本模式 target_book 为 str，account_mapping 为 str
    if isinstance(target_book, list):
        book_ids = target_book
    else:
        book_ids = [target_book]
        account_mapping = {target_book: account_mapping}

    adjust_mapping = plugin_config.get("adjust_account_id")

    all_ok = True
    for book_id in book_ids:
        securities_account_id = account_mapping.get(book_id) if isinstance(account_mapping, dict) else account_mapping
        if not securities_account_id:
            logger.warning("账本 %s 缺少科目映射，跳过", book_id)
            continue
        adjust_id = adjust_mapping.get(book_id) if isinstance(adjust_mapping, dict) else adjust_mapping if adjust_mapping else None
        try:
            snap_result = client.submit_balance_snapshot(
                securities_account_id, cny_total, snapshot_date,
                adjust_account_id=adjust_id,
            )
            logger.info(
                "余额快照提交成功 [book=%s]: balance=%.2f, book_balance=%s, diff=%s, status=%s",
                book_id, cny_total,
                snap_result.get("book_balance"),
                snap_result.get("difference"),
                snap_result.get("status"),
            )
        except Exception:
            logger.exception("余额快照提交失败 [book=%s]", book_id)
            all_ok = False

    return all_ok


# ============ 主流程 ============


def run_plugin(args):
    pcfg = get_plugin_config()
    client = HAClient(pcfg["api_url"], pcfg["api_key"])

    # 1. 注册插件（幂等）
    logger.info("注册插件到 %s ...", pcfg["api_url"])
    plugin_data = client.register_plugin()
    plugin_id = plugin_data["id"]
    logger.info("插件已注册: id=%s", plugin_id)

    # 2. 读取用户配置
    plugin_detail = client.get_plugin(plugin_id)
    if not plugin_detail.get("is_configured"):
        print("[!] 插件尚未配置，请在 HomeAccountant App 中完成科目映射和 LongPort 三元组配置后再运行")
        print(f"    插件 ID: {plugin_id}")
        sys.exit(0)

    plugin_config = plugin_detail["config"]
    logger.info("用户配置: target_book=%s", plugin_config["target_book"])

    sync_time = plugin_config.get("sync_time", "16:30")
    config_refresh_interval = pcfg["config_refresh_seconds"]
    once = args.once

    # 3. 更新状态为 running
    client.update_status(plugin_id, "running")

    # 优雅退出
    running = True

    def _stop(sig, frame):
        nonlocal running
        running = False
        logger.info("收到信号 %s，准备退出...", sig)

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    # 4. 主循环
    error_msg = None
    last_config_refresh = time.monotonic()
    try:
        while running:
            # 定期刷新用户配置
            now_mono = time.monotonic()
            if now_mono - last_config_refresh >= config_refresh_interval:
                try:
                    refreshed = client.get_plugin(plugin_id)
                    if not refreshed.get("is_configured"):
                        logger.warning("插件配置已被清除，暂停同步，等待用户重新配置")
                        _interruptible_sleep(60, lambda: running)
                        last_config_refresh = time.monotonic()
                        continue
                    new_config = refreshed["config"]
                    if new_config != plugin_config:
                        plugin_config.update(new_config)
                        sync_time = plugin_config.get("sync_time", "16:30")
                        logger.info("用户配置已更新")
                    last_config_refresh = now_mono
                except Exception:
                    logger.exception("刷新插件配置失败 (非致命，沿用旧配置)")

            # 执行同步
            try:
                success = do_sync(client, plugin_config)
                if success:
                    client.update_status(plugin_id, "running")
                else:
                    client.update_status(plugin_id, "running", "上次同步失败，等待下次重试")
            except Exception:
                logger.exception("同步出错")

            if once:
                break

            # 等待到下一个 sync_time
            wait_seconds = seconds_until_sync_time(sync_time)
            logger.info(
                "下次同步时间: %s（约 %.1f 小时后）",
                sync_time,
                wait_seconds / 3600,
            )
            _interruptible_sleep(wait_seconds, lambda: running)

    except Exception as e:
        error_msg = str(e)
        logger.exception("插件异常退出")

    # 5. 更新最终状态
    try:
        if error_msg:
            client.update_status(plugin_id, "failed", error_msg)
        else:
            client.update_status(plugin_id, "success")
    except Exception:
        logger.exception("更新插件状态失败")

    logger.info("已退出")


# ============ CLI ============


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="长桥证券资产同步插件 — 每日盘后自动查询港美股净资产并提交余额快照",
    )
    parser.add_argument(
        "--setup", action="store_true",
        help="交互式设置插件配置",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="仅同步一次，不进入定时循环",
    )
    parser.add_argument(
        "-v", "--verbose", action="store_true",
        help="详细日志输出",
    )
    return parser


def main():
    parser = build_parser()
    args = parser.parse_args()

    log_level = logging.DEBUG if args.verbose else logging.INFO
    logging.basicConfig(
        level=log_level,
        format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
        datefmt="%Y-%m-%d %H:%M:%S",
    )

    if args.setup:
        cmd_setup()
        return

    run_plugin(args)


if __name__ == "__main__":
    main()
