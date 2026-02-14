"""MCP Server SSE 模式测试

覆盖场景：
1. SSE Starlette App 路由正确（/sse, /messages）
2. 通过 MCP 官方 sse_client 完成 initialize + list_tools（端到端协议级）
3. POST /messages 无有效 session → 错误响应
4. 配置验证：transport/port/auth
"""

import asyncio
import socket

import pytest
import httpx
import uvicorn

from mcp_server.__main__ import mcp
from mcp_server.config import MCPConfig


def _find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s:
        s.bind(('127.0.0.1', 0))
        return s.getsockname()[1]


async def _wait_for_server(port: int, max_retries: int = 50):
    """通过 TCP 连接检测服务器是否就绪"""
    for _ in range(max_retries):
        try:
            _, writer = await asyncio.wait_for(
                asyncio.open_connection('127.0.0.1', port), timeout=0.2
            )
            writer.close()
            await writer.wait_closed()
            return
        except (ConnectionRefusedError, asyncio.TimeoutError, OSError):
            await asyncio.sleep(0.1)
    raise RuntimeError(f"Server on port {port} did not start")


# ──────────── 1. SSE App 路由与结构 ────────────


class TestSSEAppStructure:

    def test_sse_app_has_routes(self):
        """SSE app 包含 /sse 和 /messages 路由"""
        app = mcp.sse_app()
        paths = [r.path for r in app.routes]
        assert "/sse" in paths
        assert "/messages" in paths

    def test_sse_app_is_starlette(self):
        """SSE app 是 Starlette 实例"""
        from starlette.applications import Starlette
        app = mcp.sse_app()
        assert isinstance(app, Starlette)

    def test_mcp_server_name(self):
        """MCP Server 名称正确"""
        assert mcp.name == "home-accountant"

    @pytest.mark.asyncio
    async def test_all_tools_available(self):
        """10 个 Tools 全部注册"""
        tools = await mcp.list_tools()
        assert len(tools) == 10
        tool_names = {t.name for t in tools}
        expected = {
            "create_entries", "list_entries", "get_entry", "delete_entry",
            "get_balance_sheet", "get_income_statement", "get_dashboard",
            "sync_balance", "list_accounts", "list_plugins",
        }
        assert expected == tool_names


# ──────────── 2. SSE 端点测试（真实 uvicorn 服务器） ────────────


class TestSSEEndpoints:

    @pytest.mark.asyncio
    async def test_messages_rejects_invalid_session(self):
        """POST /messages/?session_id=invalid → 非 200 响应"""
        app = mcp.sse_app()
        port = _find_free_port()
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())

        async def _test():
            await _wait_for_server(port)

            async with httpx.AsyncClient(follow_redirects=True) as ac:
                resp = await ac.post(
                    f"http://127.0.0.1:{port}/messages/?session_id=nonexistent",
                    json={"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {}},
                    headers={"Content-Type": "application/json"},
                )
                # 无效 session 不应该返回成功
                assert resp.status_code != 200

        try:
            await asyncio.wait_for(_test(), timeout=10.0)
        finally:
            server.should_exit = True
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass


# ──────────── 3. MCP 协议级 SSE 测试（端到端） ────────────


class TestSSEProtocol:

    @pytest.mark.asyncio
    async def test_sse_initialize_and_list_tools(self):
        """通过 MCP 官方 sse_client 完成 initialize → list_tools（完整 SSE 端到端）"""
        from mcp.client.session import ClientSession
        from mcp.client.sse import sse_client

        app = mcp.sse_app()
        port = _find_free_port()
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())

        async def _test():
            await _wait_for_server(port)

            async with sse_client(f"http://127.0.0.1:{port}/sse") as (read, write):
                async with ClientSession(read, write) as session:
                    await session.initialize()

                    # list_tools
                    tools_result = await session.list_tools()
                    tool_names = {t.name for t in tools_result.tools}
                    expected = {
                        "create_entries", "list_entries", "get_entry", "delete_entry",
                        "get_balance_sheet", "get_income_statement", "get_dashboard",
                        "sync_balance", "list_accounts", "list_plugins",
                    }
                    assert expected == tool_names
                    assert len(tools_result.tools) == 10

                    # 验证每个 tool 都有 description
                    for tool in tools_result.tools:
                        assert tool.description, f"Tool {tool.name} 缺少 description"

                    # 验证 tool input schema 存在
                    for tool in tools_result.tools:
                        assert tool.inputSchema is not None

        try:
            await asyncio.wait_for(_test(), timeout=15.0)
        finally:
            server.should_exit = True
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass

    @pytest.mark.asyncio
    async def test_sse_server_info(self):
        """通过 SSE 协议验证 server info"""
        from mcp.client.session import ClientSession
        from mcp.client.sse import sse_client

        app = mcp.sse_app()
        port = _find_free_port()
        config = uvicorn.Config(app, host="127.0.0.1", port=port, log_level="error")
        server = uvicorn.Server(config)
        server_task = asyncio.create_task(server.serve())

        async def _test():
            await _wait_for_server(port)

            async with sse_client(f"http://127.0.0.1:{port}/sse") as (read, write):
                async with ClientSession(read, write) as session:
                    result = await session.initialize()
                    assert result.serverInfo.name == "home-accountant"

        try:
            await asyncio.wait_for(_test(), timeout=15.0)
        finally:
            server.should_exit = True
            server_task.cancel()
            try:
                await server_task
            except asyncio.CancelledError:
                pass


# ──────────── 4. Config 验证 ────────────


class TestSSEConfig:

    def test_default_transport_is_stdio(self):
        """默认 transport 为 stdio"""
        cfg = MCPConfig()
        assert cfg.transport == "stdio"

    def test_sse_transport_config(self):
        """transport=sse, port=4000 时配置正确"""
        cfg = MCPConfig(transport="sse", sse_port=4000)
        assert cfg.transport == "sse"
        assert cfg.sse_port == 4000

    def test_default_sse_port_is_3000(self):
        """默认 SSE 端口为 3000"""
        cfg = MCPConfig()
        assert cfg.sse_port == 3000

    def test_auth_header_api_key(self):
        """API Key 认证头格式正确"""
        cfg = MCPConfig(auth_type="api_key", api_key="hak_test123456")
        assert cfg.auth_header == {"Authorization": "Bearer hak_test123456"}

    def test_auth_header_jwt(self):
        """JWT 认证头格式正确"""
        cfg = MCPConfig(auth_type="jwt_token", jwt_token="eyJhbGciOiJ...")
        assert cfg.auth_header == {"Authorization": "Bearer eyJhbGciOiJ..."}

    def test_auth_header_missing_raises(self):
        """未配置认证信息 → 抛出 ValueError"""
        cfg = MCPConfig(auth_type="api_key", api_key="")
        with pytest.raises(ValueError, match="未配置有效的认证信息"):
            _ = cfg.auth_header
