import json
from mcp.server.fastmcp import FastMCP
from ..client import ha_client
from ..config import config


def register(mcp: FastMCP):

    @mcp.tool()
    async def list_accounts(book_id: str = "") -> str:
        """获取科目树（按资产/负债/权益/收入/费用分组）。

        返回所有科目的 ID、名称、类型、余额方向等信息。
        其他 Tool（如 create_entries、sync_balance）需要用到科目 ID，
        请先调用此 Tool 获取科目映射。

        - book_id: 账本 ID
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id"
        result = await ha_client.list_accounts(bid)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def list_plugins() -> str:
        """查看已注册的所有插件列表及其同步状态。

        返回每个插件的名称、类型、同步状态、最后同步时间、累计同步次数等。
        """
        result = await ha_client.list_plugins()
        return json.dumps(result, ensure_ascii=False, indent=2)
