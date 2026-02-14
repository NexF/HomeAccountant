import json
from mcp.server.fastmcp import FastMCP
from ..client import ha_client
from ..config import config


def register(mcp: FastMCP):

    @mcp.tool()
    async def get_balance_sheet(
        book_id: str = "",
        as_of_date: str = "",
    ) -> str:
        """获取资产负债表。

        展示截至指定日期的资产、负债、净资产分类汇总。
        - book_id: 账本 ID（可省略，使用默认账本）
        - as_of_date: 截止日期 (YYYY-MM-DD)，默认今天
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id"
        result = await ha_client.get_balance_sheet(bid, as_of_date or None)
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def get_income_statement(
        book_id: str = "",
        start_date: str = "",
        end_date: str = "",
    ) -> str:
        """获取损益表（收入/费用明细及损益合计）。

        - book_id: 账本 ID
        - start_date: 开始日期 (YYYY-MM-DD)，默认本月1日
        - end_date: 结束日期 (YYYY-MM-DD)，默认今天
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id"
        result = await ha_client.get_income_statement(
            bid, start_date or None, end_date or None
        )
        return json.dumps(result, ensure_ascii=False, indent=2)

    @mcp.tool()
    async def get_dashboard(book_id: str = "") -> str:
        """获取仪表盘概况：净资产、本月收入、本月费用、本月损益、较上月变化。

        - book_id: 账本 ID
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id"
        result = await ha_client.get_dashboard(bid)
        return json.dumps(result, ensure_ascii=False, indent=2)
