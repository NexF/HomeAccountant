#!/usr/bin/env python3
"""
银行动账自动记账插件

将 wx_monitor.bank_monitor 检测到的银行交易自动推送到 HomeAccountant 记账系统。

运行方式:
  # 首次运行: 交互式设置（在插件目录下）
  cd plugins/bank_monitor && python3 plugin.py --setup

  # 持续轮询
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

import requests

from bank_monitor import (
    WechatBizDB,
    load_config,
    load_state,
    save_state,
    load_keys,
    resolve_bank_gh_ids,
    process_one_bank,
)

logger = logging.getLogger("bank_monitor_plugin")

# ============ 插件元信息 ============

PLUGIN_NAME = "bank-monitor"
PLUGIN_DESCRIPTION = "监听微信银行公众号推送，自动检测动账并记账"
PLUGIN_TYPE = "both"

CONFIG_SCHEMA = {
    "fields": [
        {
            "key": "target_book",
            "label": "目标账本",
            "type": "book_select",
            "required": True,
            "description": "选择要记账的目标账本",
        },
        {
            "key": "deposit_account_id",
            "label": "储蓄卡科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",
            "description": "对应银行卡的资产科目",
        },
        {
            "key": "default_expense_id",
            "label": "默认支出科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",
            "description": "支出时的默认费用科目",
        },
        {
            "key": "default_income_id",
            "label": "默认收入科目",
            "type": "account_select",
            "required": True,
            "depends_on": "target_book",
            "description": "收入时的默认收入科目",
        },
        {
            "key": "sync_balance",
            "label": "同步余额",
            "type": "boolean",
            "required": False,
            "default": True,
            "description": "是否在每笔交易后提交余额快照",
        },
    ]
}


# ============ 插件配置管理 ============

PLUGIN_DIR = os.path.dirname(os.path.abspath(__file__))
PLUGIN_CONFIG_PATH = os.path.join(PLUGIN_DIR, "config.json")

DEFAULT_PLUGIN_CONFIG = {
    "plugin_name": "银行动账记账",
    "api_url": "http://127.0.0.1:8000",
    "api_key": "",
    "poll_interval_seconds": 60,
    "config_refresh_seconds": 300,
    "wx_monitor_config": "",
    "wx_monitor_keys": "",
}

# 状态文件默认放在插件目录下
DEFAULT_STATE_PATH = os.path.join(PLUGIN_DIR, "state.json")


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

    # 兼容环境变量
    api_url = os.environ.get("HA_API_URL", "")
    api_key = os.environ.get("HA_API_KEY", "")
    if api_url and api_key:
        return {**DEFAULT_PLUGIN_CONFIG, "api_url": api_url, "api_key": api_key}

    print("[-] 未找到插件配置，请先运行: python3 plugin.py --setup")
    sys.exit(1)


def cmd_setup():
    """交互式设置插件配置"""
    print("=== HomeAccountant 银行动账插件配置 ===\n")

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

    # 轮询间隔
    default_poll = defaults["poll_interval_seconds"]
    poll_input = input(f"轮询间隔/秒 [{default_poll}]: ").strip()
    poll_interval = int(poll_input) if poll_input else default_poll

    # 配置刷新间隔
    default_refresh = defaults["config_refresh_seconds"]
    refresh_input = input(f"配置刷新间隔/秒 [{default_refresh}]: ").strip()
    config_refresh = int(refresh_input) if refresh_input else default_refresh

    # wx_monitor 相关路径
    print("\n--- wx_monitor 路径配置 ---")
    default_bm_config = defaults.get("wx_monitor_config", "")
    bm_config = input(f"bank_monitor 配置文件{f' [{default_bm_config}]' if default_bm_config else ''}: ").strip() or default_bm_config
    if not bm_config:
        print("[-] bank_monitor 配置文件路径不能为空")
        sys.exit(1)

    default_keys = defaults.get("wx_monitor_keys", "")
    bm_keys = input(f"密钥文件{f' [{default_keys}]' if default_keys else ''}: ").strip() or default_keys

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
        "poll_interval_seconds": poll_interval,
        "config_refresh_seconds": config_refresh,
        "wx_monitor_config": bm_config,
        "wx_monitor_keys": bm_keys,
    }
    save_plugin_config(new_config)
    print(f"\n[+] 配置已保存到 {PLUGIN_CONFIG_PATH}")


# ============ HomeAccountant API 客户端 ============


class HAClient:
    """HomeAccountant API 客户端"""

    def __init__(self, api_url: str, api_key: str):
        self.base_url = api_url.rstrip("/")
        self.session = requests.Session()
        self.session.headers["Authorization"] = f"Bearer {api_key}"
        self.session.headers["Content-Type"] = "application/json"

    def register_plugin(self, display_name: str = None) -> dict:
        resp = self.session.post(
            f"{self.base_url}/plugins",
            json={
                "name": PLUGIN_NAME,
                "display_name": display_name or PLUGIN_NAME,
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

    def batch_create_entries(self, plugin_id: str, book_id: str, entries: list) -> dict:
        resp = self.session.post(
            f"{self.base_url}/plugins/{plugin_id}/entries/batch",
            json={"book_id": book_id, "entries": entries},
        )
        resp.raise_for_status()
        return resp.json()

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


# ============ record → entry 映射 ============


def parse_amount(raw: str | None) -> float | None:
    if not raw:
        return None
    try:
        return float(raw.replace(",", "").replace("，", ""))
    except (ValueError, TypeError):
        return None


def record_to_entry(record: dict, plugin_config: dict) -> dict | None:
    """将 bank_monitor 的 record 转换为 HomeAccountant 分录格式。"""
    direction = record.get("direction")
    if direction not in ("in", "out"):
        logger.warning(
            "跳过 direction=%s 的记录: %s %s",
            direction, record.get("bank"), record.get("msg_time"),
        )
        return None

    fields = record.get("fields", {})
    amount = parse_amount(fields.get("amount"))
    if amount is None or amount <= 0:
        logger.warning(
            "跳过金额无效的记录: amount=%s, %s %s",
            fields.get("amount"), record.get("bank"), record.get("msg_time"),
        )
        return None

    entry_date = record.get("msg_time", "")[:10]

    bank = record.get("bank", "")
    tx_type = fields.get("transaction_type", "")
    description = f"{bank} {tx_type}".strip() if tx_type else bank

    external_id = f"bm-{record.get('gh_id', '')}-{record.get('msg_id', '')}"

    if direction == "out":
        return {
            "entry_type": "expense",
            "entry_date": entry_date,
            "amount": amount,
            "category_account_id": plugin_config["default_expense_id"],
            "payment_account_id": plugin_config["deposit_account_id"],
            "description": description,
            "external_id": external_id,
        }
    else:
        return {
            "entry_type": "income",
            "entry_date": entry_date,
            "amount": amount,
            "category_account_id": plugin_config["default_income_id"],
            "payment_account_id": plugin_config["deposit_account_id"],
            "description": description,
            "external_id": external_id,
        }


# ============ 主逻辑 ============


def _interruptible_sleep(seconds: int, check_running):
    for _ in range(seconds):
        if not check_running():
            break
        time.sleep(1)


def run_plugin(args):
    """插件主流程"""
    pcfg = get_plugin_config()
    api_url = pcfg["api_url"]
    api_key = pcfg["api_key"]

    client = HAClient(api_url, api_key)

    # 1. 注册插件（幂等）
    display_name = pcfg.get("plugin_name", PLUGIN_NAME)
    logger.info("注册插件到 %s (显示名: %s) ...", api_url, display_name)
    plugin_data = client.register_plugin(display_name=display_name)
    plugin_id = plugin_data["id"]
    logger.info("插件已注册: id=%s", plugin_id)

    # 2. 读取用户配置
    plugin_detail = client.get_plugin(plugin_id)
    if not plugin_detail.get("is_configured"):
        print("[!] 插件尚未配置，请在 HomeAccountant App 中完成科目映射配置后再运行")
        print(f"    插件 ID: {plugin_id}")
        sys.exit(0)

    plugin_config = plugin_detail["config"]
    book_id = plugin_config["target_book"]
    sync_balance = plugin_config.get("sync_balance", True)

    logger.info("用户配置: book_id=%s, sync_balance=%s", book_id, sync_balance)

    # 3. 加载 wx_monitor / bank_monitor 配置
    bm_config_path = pcfg.get("wx_monitor_config")
    bm_keys_path = pcfg.get("wx_monitor_keys") or None

    if not bm_config_path:
        print("[-] wx_monitor_config 未配置，请先运行: python3 plugin.py --setup")
        sys.exit(1)

    bm_config = load_config(bm_config_path)
    state = load_state(DEFAULT_STATE_PATH)

    keys = load_keys(bm_keys_path)
    db = WechatBizDB(keys)
    banks = resolve_bank_gh_ids(bm_config, db)
    if not banks:
        print("[-] 无有效的银行配置")
        sys.exit(1)

    poll_interval = pcfg["poll_interval_seconds"]
    config_refresh_interval = pcfg["config_refresh_seconds"]
    once = args.once

    logger.info(
        "监控 %d 个银行, 轮询间隔 %ds, 配置刷新间隔 %ds",
        len(banks), poll_interval, config_refresh_interval,
    )
    for b in banks:
        logger.info("  %s (%s)", b["name"], b["gh_id"])

    # 4. 更新状态为 running
    client.update_status(plugin_id, "running")

    # 优雅退出
    running = True

    def _stop(sig, frame):
        nonlocal running
        running = False
        logger.info("收到信号 %s，准备退出...", sig)

    signal.signal(signal.SIGINT, _stop)
    signal.signal(signal.SIGTERM, _stop)

    # 5. 轮询循环
    error_msg = None
    last_config_refresh = time.monotonic()
    try:
        while running:
            try:
                # 定期刷新用户配置
                now = time.monotonic()
                if now - last_config_refresh >= config_refresh_interval:
                    try:
                        refreshed = client.get_plugin(plugin_id)
                        if not refreshed.get("is_configured"):
                            logger.warning("插件配置已被清除，暂停记账，等待用户重新配置")
                            _interruptible_sleep(poll_interval, lambda: running)
                            last_config_refresh = time.monotonic()
                            continue
                        new_config = refreshed["config"]
                        if new_config != plugin_config:
                            plugin_config = new_config
                            book_id = plugin_config["target_book"]
                            sync_balance = plugin_config.get("sync_balance", True)
                            logger.info(
                                "用户配置已更新: book_id=%s, sync_balance=%s",
                                book_id, sync_balance,
                            )
                        last_config_refresh = now
                    except Exception:
                        logger.exception("刷新插件配置失败 (非致命，沿用旧配置)")

                all_entries = []
                balance_tasks = []

                for bank in banks:
                    old_cursor = state.get(bank["gh_id"], 0)
                    records = process_one_bank(bank, db, state)

                    for rec in records:
                        entry = record_to_entry(rec, plugin_config)
                        if entry:
                            all_entries.append(entry)

                        if sync_balance:
                            fields = rec.get("fields", {})
                            balance = parse_amount(fields.get("balance"))
                            if balance is not None:
                                entry_date = rec.get("msg_time", "")[:10]
                                balance_tasks.append((balance, entry_date))

                # 批量记账
                if all_entries:
                    try:
                        result = client.batch_create_entries(
                            plugin_id, book_id, all_entries
                        )
                        logger.info(
                            "批量记账: total=%d, created=%d, skipped=%d",
                            result.get("total", 0),
                            result.get("created", 0),
                            result.get("skipped", 0),
                        )
                    except Exception:
                        logger.exception("批量记账 API 失败，本轮不更新游标")
                        if once:
                            break
                        _interruptible_sleep(poll_interval, lambda: running)
                        continue

                # 余额同步
                if balance_tasks:
                    deposit_account_id = plugin_config["deposit_account_id"]
                    for balance, snap_date in balance_tasks:
                        try:
                            snap_result = client.submit_balance_snapshot(
                                deposit_account_id, balance, snap_date
                            )
                            logger.info(
                                "余额快照: balance=%.2f, status=%s, diff=%s",
                                balance,
                                snap_result.get("status"),
                                snap_result.get("difference"),
                            )
                        except Exception:
                            logger.exception("余额快照提交失败 (非致命)")

                # 成功后保存游标
                save_state(state, bm_state_path)

            except Exception:
                logger.exception("轮询出错")

            if once:
                break

            _interruptible_sleep(poll_interval, lambda: running)

    except Exception as e:
        error_msg = str(e)
        logger.exception("插件异常退出")

    # 6. 更新最终状态
    try:
        if error_msg:
            client.update_status(plugin_id, "failed", error_msg)
        else:
            client.update_status(plugin_id, "success")
    except Exception:
        logger.exception("更新插件状态失败")

    save_state(state, DEFAULT_STATE_PATH)
    logger.info("已退出")


# ============ CLI ============


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="银行动账自动记账插件 — 将 wx_monitor 检测到的交易推送到 HomeAccountant",
    )
    parser.add_argument(
        "--setup", action="store_true",
        help="交互式设置插件配置",
    )
    parser.add_argument(
        "--once", action="store_true",
        help="仅同步一次，不进入轮询",
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
