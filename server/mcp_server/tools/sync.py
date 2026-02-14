import json
from mcp.server.fastmcp import FastMCP
from ..client import ha_client
from ..config import config


def register(mcp: FastMCP):

    @mcp.tool()
    async def sync_balance(
        account_id: str,
        external_balance: float,
        snapshot_date: str = "",
    ) -> str:
        """提交科目余额快照，系统自动计算差额并生成调节分录。

        - account_id: 科目 ID（使用 list_accounts 获取）
        - external_balance: 外部真实余额（数字）
        - snapshot_date: 快照日期 (YYYY-MM-DD)，默认今天

        使用前请先调用 list_accounts 获取科目 ID。
        """
        if not snapshot_date:
            from datetime import date
            snapshot_date = date.today().isoformat()

        result = await ha_client.submit_snapshot(account_id, external_balance, snapshot_date)
        return json.dumps(result, ensure_ascii=False, indent=2)
