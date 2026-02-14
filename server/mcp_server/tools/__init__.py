from mcp.server.fastmcp import FastMCP
from . import entries, reports, sync, management


def register_all_tools(mcp: FastMCP):
    """注册所有 MCP Tools"""
    entries.register(mcp)
    reports.register(mcp)
    sync.register(mcp)
    management.register(mcp)
