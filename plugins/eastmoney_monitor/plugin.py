#!/usr/bin/env python3
"""
东方财富证券资产同步插件

每日盘后自动登录东方财富证券 Web 系统，查询总资产并提交余额快照到 HomeAccountant。

运行方式:
  # 首次运行: 交互式设置（在插件目录下）
  cd plugins/eastmoney_monitor && python3 plugin.py --setup

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

import requests

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from eastmoney_login import login as em_login

logger = logging.getLogger("eastmoney_monitor")

# ============ 常量 ============

BASE_URL = "https://jywg.eastmoneysec.com"

# ============ 插件元信息 ============

PLUGIN_NAME = "eastmoney-monitor"
PLUGIN_DISPLAY_NAME = "东财证券资产同步"
PLUGIN_DESCRIPTION = "每日盘后自动登录东方财富证券，查询总资产并提交余额快照"
PLUGIN_TYPE = "balance"

CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "目标账本",
            "type": "book_select",
            "required": True,
            "description": "余额快照关联的账本",
        },
        {
            "key": "securities_account_id",
            "label": "证券资产科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",
            "description": "对应证券账户的资产科目",
        },
        {
            "key": "em_account",
            "label": "东财资金账号",
            "type": "string",
            "required": True,
            "description": "东方财富资金账号",
        },
        {
            "key": "em_password",
            "label": "东财登录密码",
            "type": "secret",
            "required": True,
            "description": "东方财富登录密码",
        },
        {
            "key": "sync_time",
            "label": "每日同步时间",
            "type": "string",
            "required": False,
            "default": "15:30",
            "description": "格式 HH:MM，默认收盘后 15:30",
        },
    ]
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

    # 兼容纯环境变量模式
    api_url = os.environ.get("HA_API_URL", "")
    api_key = os.environ.get("HA_API_KEY", "")
    if api_url and api_key:
        return {**DEFAULT_PLUGIN_CONFIG, "api_url": api_url, "api_key": api_key}

    print("[-] 未找到插件配置，请先运行: python -m eastmoney_monitor --setup")
    sys.exit(1)


def cmd_setup():
    """交互式设置插件配置"""
    print("=== HomeAccountant 东财证券资产同步插件配置 ===\n")

    existing = load_plugin_config() or {}
    defaults = {**DEFAULT_PLUGIN_CONFIG, **existing}

    # API URL
    api_url = input(f"API 地址 [{defaults['api_url']}]: ").strip() or defaults["api_url"]

    # API Key
    default_key = defaults.get("api_key", "")
    if default_key:
        masked = default_key[:6] + "..." + default_key[-4:] if len(default_key) > 10 else "***"
        api_key = input(f"API Key [{masked}]: ").strip() or default_key
    else:
        api_key = input("API Key: ").strip()

    if not api_key:
        print("[-] API Key 不能为空")
        sys.exit(1)

    # 配置刷新间隔
    default_refresh = defaults["config_refresh_seconds"]
    refresh_input = input(f"配置刷新间隔/秒 [{default_refresh}]: ").strip()
    config_refresh = int(refresh_input) if refresh_input else default_refresh

    # 验证连接
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
    print("[i] 东财账号、密码、同步时间请在 HomeAccountant App「插件管理」中配置")


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
        self, account_id: str, external_balance: float, snapshot_date: str
    ) -> dict:
        resp = self.session.post(
            f"{self.base_url}/accounts/{account_id}/snapshot",
            json={
                "external_balance": external_balance,
                "snapshot_date": snapshot_date,
            },
        )
        resp.raise_for_status()
        return resp.json()


# ============ 东财资产查询 ============


def query_total_assets(session: requests.Session) -> float | None:
    """查询东财证券总资产，返回总资产金额"""
    session.headers.update({
        "X-Requested-With": "XMLHttpRequest",
        "Accept": "application/json, text/javascript, */*; q=0.01",
    })

    try:
        resp = session.post(f"{BASE_URL}/Com/queryAssetAndPositionV1")
        if resp.status_code != 200:
            logger.error("查询资产接口返回 %d", resp.status_code)
            return None

        result = resp.json()
        status = result.get("Status")
        if status not in (0, "0"):
            logger.error("查询资产失败: %s", json.dumps(result, ensure_ascii=False)[:500])
            return None

        data = result.get("Data", [])
        if not data:
            logger.error("查询资产返回空 Data")
            return None

        asset_info = data[0] if isinstance(data, list) else data

        # 尝试多个可能的总资产字段名
        total_asset = None
        for key in ("Zzc", "zzc", "TotalAsset", "totalAsset", "total_asset"):
            val = asset_info.get(key)
            if val is not None:
                try:
                    total_asset = float(str(val).replace(",", ""))
                    break
                except (ValueError, TypeError):
                    continue

        if total_asset is None:
            logger.error(
                "未找到总资产字段，响应字段: %s",
                list(asset_info.keys()) if isinstance(asset_info, dict) else "非dict",
            )
            logger.error("完整响应: %s", json.dumps(result, ensure_ascii=False)[:1000])
            return None

        logger.info("查询到总资产: %.2f", total_asset)
        return total_asset

    except Exception:
        logger.exception("查询资产异常")
        return None


# ============ 定时调度 ============


def seconds_until_sync_time(sync_time_str: str) -> int:
    """计算距离下一个 sync_time 的秒数"""
    now = datetime.now()
    hour, minute = map(int, sync_time_str.split(":"))
    target = now.replace(hour=hour, minute=minute, second=0, microsecond=0)
    if target <= now:
        target += timedelta(days=1)
    return int((target - now).total_seconds())


def _interruptible_sleep(seconds: int, check_running):
    """可中断的 sleep"""
    for _ in range(seconds):
        if not check_running():
            break
        time.sleep(1)


# ============ 同步逻辑 ============


def do_sync(client: HAClient, plugin_config: dict) -> bool:
    """执行一次同步：登录 → 查询总资产 → 提交快照。返回是否成功。"""
    account = plugin_config["em_account"]
    password = plugin_config["em_password"]

    # 1. 登录东财
    logger.info("开始登录东方财富...")
    session = em_login(account=account, password=password)
    if session is None:
        logger.error("登录东方财富失败")
        return False

    logger.info("登录成功")

    # 2. 查询总资产
    total_asset = query_total_assets(session)
    if total_asset is None:
        logger.error("查询总资产失败")
        return False

    # 3. 提交余额快照
    securities_account_id = plugin_config["securities_account_id"]
    snapshot_date = datetime.now().strftime("%Y-%m-%d")

    try:
        snap_result = client.submit_balance_snapshot(
            securities_account_id, total_asset, snapshot_date
        )
        logger.info(
            "余额快照提交成功: balance=%.2f, book_balance=%s, diff=%s, status=%s",
            total_asset,
            snap_result.get("book_balance"),
            snap_result.get("difference"),
            snap_result.get("status"),
        )
        return True
    except Exception:
        logger.exception("余额快照提交失败")
        return False


# ============ 主流程 ============


def run_plugin(args):
    """插件主流程"""
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
        print("[!] 插件尚未配置，请在 HomeAccountant App 中完成科目映射配置后再运行")
        print(f"    插件 ID: {plugin_id}")
        sys.exit(0)

    plugin_config = plugin_detail["config"]
    logger.info("用户配置: securities_account_id=%s", plugin_config["securities_account_id"])

    sync_time = plugin_config.get("sync_time", "15:30")
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
                        sync_time = plugin_config.get("sync_time", "15:30")
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
        description="东方财富证券资产同步插件 — 每日盘后自动查询总资产并提交余额快照",
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
