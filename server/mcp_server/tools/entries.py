import json
from mcp.server.fastmcp import FastMCP
from ..client import ha_client
from ..config import config


def register(mcp: FastMCP):

    @mcp.tool()
    async def create_entries(
        entries: str,
        book_id: str = "",
    ) -> str:
        """创建一条或多条分录（智能记账）。

        entries 参数是一个 JSON 数组字符串，每个元素包含：
        - entry_type: 分录类型 (expense/income/transfer/asset_purchase/borrow/repay)
        - entry_date: 日期 (YYYY-MM-DD)
        - description: 摘要描述
        - amount: 金额 (正数)
        - category_account_id: 分类科目 ID（费用类/收入类科目）
        - payment_account_id: 支付科目 ID（资产类/负债类科目）
        - external_id: (可选) 外部去重标识
        - note: (可选) 备注

        使用前请先调用 list_accounts 获取科目 ID。
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id，且未配置默认账本 HA_DEFAULT_BOOK_ID"

        try:
            entry_list = json.loads(entries)
        except json.JSONDecodeError as e:
            return f"错误：entries 参数 JSON 解析失败: {e}"

        plugin_id = await _ensure_mcp_plugin()

        result = await ha_client.batch_create_entries(plugin_id, bid, entry_list)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def list_entries(
        book_id: str = "",
        start_date: str = "",
        end_date: str = "",
        entry_type: str = "",
        page: int = 1,
        page_size: int = 20,
    ) -> str:
        """查询分录列表。

        支持按日期范围、分录类型筛选。
        - book_id: 账本 ID（可省略，使用默认账本）
        - start_date: 开始日期 (YYYY-MM-DD)
        - end_date: 结束日期 (YYYY-MM-DD)
        - entry_type: 筛选类型 (expense/income/transfer/asset_purchase/borrow/repay)
        - page: 页码，默认 1
        - page_size: 每页条数，默认 20
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id，且未配置默认账本"

        params = {"page": page, "page_size": page_size}
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        if entry_type:
            params["entry_type"] = entry_type

        result = await ha_client.list_entries(bid, **params)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def get_entry(entry_id: str) -> str:
        """获取单条分录的详细信息，包含借贷明细行。

        - entry_id: 分录 ID
        """
        result = await ha_client.get_entry(entry_id)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def delete_entry(entry_id: str) -> str:
        """删除一条分录。⚠️ 此操作不可撤销，请确认后再执行。

        - entry_id: 分录 ID
        """
        await ha_client.delete_entry(entry_id)
        return "分录已删除"


async def _ensure_mcp_plugin() -> str:
    """确保 MCP Agent 对应的插件已注册，返回 plugin_id。

    使用幂等注册 API，插件名固定为 'mcp-agent'。
    """
    plugins = await ha_client.list_plugins()
    for p in plugins:
        if p.get("name") == "mcp-agent":
            return p["id"]

    result = await ha_client.register_plugin(
        name="mcp-agent",
        plugin_type="both",
        description="MCP Agent 自动注册的虚拟插件",
    )
    return result["id"]
