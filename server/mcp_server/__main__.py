from mcp.server.fastmcp import FastMCP
from .config import config

mcp = FastMCP(
    "home-accountant",
    description="家庭记账系统 MCP Server — 支持智能记账、账目查询、报表分析、余额同步",
)

# 注册所有 Tools
from .tools import register_all_tools
register_all_tools(mcp)

if __name__ == "__main__":
    if config.transport == "sse":
        mcp.run(transport="sse", port=config.sse_port)
    else:
        mcp.run(transport="stdio")
