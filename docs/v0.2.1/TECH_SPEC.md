# 咕咕记账 - 技术方案文档 (Tech Spec)

> **版本：v0.2.1**
> **创建日期：2026-02-14**
> **基于版本：v0.2.0**
> **状态：规划中**
> **本版本变更：MCP（Model Context Protocol）接口层 + 前端 MCP 服务入口 + 分录类型转换**

---

## 1. 技术架构概述

v0.2.1 新增独立的 MCP Server 模块，通过 HTTP 调用已有 FastAPI 后端；同时在后端新增分录类型转换端点。

- **MCP Server**：Python `mcp` SDK（`FastMCP`），独立进程，支持 stdio / SSE 传输
- **后端**：Python FastAPI + SQLAlchemy + SQLite（新增 1 个 router 端点）
- **前端**：React Native + Expo + TypeScript（新增分录转换 UI）

### 1.1 变更范围

| 层 | 文件 | 变更类型 | 说明 |
|----|------|---------|------|
| **MCP Server** | `server/mcp_server/` | 新增 | MCP Server 模块（独立目录） |
| **MCP Server** | `server/mcp_server/__init__.py` | 新增 | 模块入口 |
| **MCP Server** | `server/mcp_server/__main__.py` | 新增 | `python -m mcp_server` 启动入口 |
| **MCP Server** | `server/mcp_server/config.py` | 新增 | 环境变量配置 |
| **MCP Server** | `server/mcp_server/client.py` | 新增 | HTTP 客户端（调用 FastAPI REST API） |
| **MCP Server** | `server/mcp_server/tools/` | 新增 | MCP Tool 定义目录 |
| **MCP Server** | `server/mcp_server/tools/entries.py` | 新增 | 记账相关 Tools |
| **MCP Server** | `server/mcp_server/tools/reports.py` | 新增 | 报表查询 Tools |
| **MCP Server** | `server/mcp_server/tools/sync.py` | 新增 | 余额同步 Tool |
| **MCP Server** | `server/mcp_server/tools/management.py` | 新增 | 科目 & 插件管理 Tools |
| **Router** | `server/app/routers/entries.py` | 修改 | 新增 `POST /entries/{id}/convert` 端点 + 认证升级为 flexible |
| **Router** | `server/app/routers/reports.py` | 修改 | 认证升级为 `get_current_user_flexible` |
| **Router** | `server/app/routers/accounts.py` | 修改 | `get_book_accounts` 认证升级为 flexible |
| **Router** | `server/app/routers/books.py` | 修改 | `list_books` 认证升级为 flexible |
| **Router** | `server/app/routers/sync.py` | 修改 | `submit_snapshot` 认证升级为 flexible |
| **Service** | `server/app/services/entry_service.py` | 修改 | 新增 `convert_entry_type()` 方法 |
| **Schema** | `server/app/schemas/entry.py` | 修改 | 新增 `EntryConvertRequest` schema |
| **前端页面** | `client/app/settings/mcp.tsx` | 新增 | 移动端 MCP 服务页面 |
| **前端组件** | `client/app/(tabs)/profile.tsx` | 修改 | 菜单新增「MCP 服务」入口，桌面端 DetailPane 扩展 |
| **前端页面** | `client/app/entry/[id].tsx` | 修改 | 新增「转换类型」按钮 + Modal |
| **前端 Service** | `client/services/entryService.ts` | 修改 | 新增 `convertEntryType()` 方法 |
| **测试** | `server/tests/test_mcp_tools.py` | 新增 | MCP Tools 集成测试 |
| **测试** | `server/tests/test_entry_convert.py` | 新增 | 分录类型转换测试 |

---

## 2. MCP Server 实现

### 2.1 目录结构

```
server/
├── mcp_server/                    # MCP Server 模块（独立于 FastAPI app）
│   ├── __init__.py
│   ├── __main__.py                # 启动入口：python -m mcp_server
│   ├── config.py                  # 环境变量配置
│   ├── client.py                  # HTTP 客户端（调用 REST API）
│   └── tools/                     # MCP Tool 定义
│       ├── __init__.py            # 注册所有 Tools
│       ├── entries.py             # create_entries, list_entries, get_entry, delete_entry
│       ├── reports.py             # get_balance_sheet, get_income_statement, get_dashboard
│       ├── sync.py                # sync_balance
│       └── management.py          # list_accounts, list_plugins
```

### 2.2 配置模块

**文件：`server/mcp_server/config.py`**

```python
import os
from dataclasses import dataclass

@dataclass
class MCPConfig:
    server_url: str = os.getenv("HA_SERVER_URL", "http://localhost:8000")
    auth_type: str = os.getenv("HA_AUTH_TYPE", "api_key")  # api_key | jwt_token
    api_key: str = os.getenv("HA_API_KEY", "")
    jwt_token: str = os.getenv("HA_JWT_TOKEN", "")
    default_book_id: str = os.getenv("HA_DEFAULT_BOOK_ID", "")
    transport: str = os.getenv("HA_TRANSPORT", "stdio")  # stdio | sse
    sse_port: int = int(os.getenv("HA_SSE_PORT", "3000"))

    @property
    def auth_header(self) -> dict[str, str]:
        if self.auth_type == "api_key" and self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        elif self.auth_type == "jwt_token" and self.jwt_token:
            return {"Authorization": f"Bearer {self.jwt_token}"}
        raise ValueError("未配置有效的认证信息，请设置 HA_API_KEY 或 HA_JWT_TOKEN")

config = MCPConfig()
```

### 2.3 HTTP 客户端

**文件：`server/mcp_server/client.py`**

封装所有对咕咕记账 REST API 的 HTTP 调用：

```python
import httpx
from .config import config

class HAClient:
    """咕咕记账 REST API 客户端"""

    def __init__(self):
        self.base_url = config.server_url.rstrip("/")
        self.headers = config.auth_header

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url, headers=self.headers) as client:
            response = await client.request(method, path, **kwargs)
            if response.status_code == 204:
                return {"success": True}
            if response.status_code >= 400:
                detail = response.json().get("detail", response.text)
                raise Exception(f"API 错误 ({response.status_code}): {detail}")
            return response.json()

    # ─── 记账 ──────────────────────────────
    async def batch_create_entries(self, plugin_id: str, book_id: str, entries: list[dict]) -> dict:
        return await self._request("POST", f"/plugins/{plugin_id}/entries/batch", json={
            "book_id": book_id,
            "entries": entries,
        })

    async def list_entries(self, book_id: str, **params) -> dict:
        return await self._request("GET", f"/books/{book_id}/entries", params=params)

    async def get_entry(self, entry_id: str) -> dict:
        return await self._request("GET", f"/entries/{entry_id}")

    async def delete_entry(self, entry_id: str) -> dict:
        return await self._request("DELETE", f"/entries/{entry_id}")

    # ─── 报表 ──────────────────────────────
    async def get_balance_sheet(self, book_id: str, as_of_date: str | None = None) -> dict:
        params = {}
        if as_of_date:
            params["as_of_date"] = as_of_date
        return await self._request("GET", f"/books/{book_id}/balance-sheet", params=params)

    async def get_income_statement(self, book_id: str, start_date: str | None = None, end_date: str | None = None) -> dict:
        params = {}
        if start_date:
            params["start_date"] = start_date
        if end_date:
            params["end_date"] = end_date
        return await self._request("GET", f"/books/{book_id}/income-statement", params=params)

    async def get_dashboard(self, book_id: str) -> dict:
        return await self._request("GET", f"/books/{book_id}/dashboard")

    # ─── 同步 ──────────────────────────────
    async def sync_balance(self, plugin_id: str, book_id: str, snapshots: list[dict]) -> dict:
        return await self._request("POST", f"/plugins/{plugin_id}/balance/sync", json={
            "book_id": book_id,
            "snapshots": snapshots,
        })

    # ─── 管理 ──────────────────────────────
    async def list_accounts(self, book_id: str) -> dict:
        return await self._request("GET", f"/books/{book_id}/accounts")

    async def list_plugins(self) -> dict:
        return await self._request("GET", "/plugins")

    async def list_books(self) -> dict:
        return await self._request("GET", "/books")

ha_client = HAClient()
```

### 2.4 MCP Server 启动入口

**文件：`server/mcp_server/__main__.py`**

```python
from mcp.server.fastmcp import FastMCP
from .config import config

mcp = FastMCP(
    "home-accountant",
    description="咕咕记账系统 MCP Server — 支持智能记账、账目查询、报表分析、余额同步",
)

# 注册所有 Tools
from .tools import register_all_tools
register_all_tools(mcp)

if __name__ == "__main__":
    if config.transport == "sse":
        mcp.run(transport="sse", port=config.sse_port)
    else:
        mcp.run(transport="stdio")
```

### 2.5 Tool 实现

#### 2.5.1 记账 Tools

**文件：`server/mcp_server/tools/entries.py`**

```python
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

        # 需要一个 plugin_id 来调用批量记账 API
        # 使用 "mcp-agent" 作为默认插件名，自动注册
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
        """删除一条分录。

        - entry_id: 分录 ID
        """
        await ha_client.delete_entry(entry_id)
        return "分录已删除"


async def _ensure_mcp_plugin() -> str:
    """确保 MCP Agent 对应的插件已注册，返回 plugin_id。

    使用幂等注册 API，插件名固定为 'mcp-agent'。
    """
    # 先查找是否已存在
    plugins = await ha_client.list_plugins()
    for p in plugins:
        if p.get("name") == "mcp-agent":
            return p["id"]

    # 不存在则注册（需要通过 REST API 注册）
    # 注意：POST /plugins 需要 API Key 认证
    import httpx
    async with httpx.AsyncClient(
        base_url=ha_client.base_url,
        headers=ha_client.headers,
    ) as client:
        resp = await client.post("/plugins", json={
            "name": "mcp-agent",
            "type": "both",
            "description": "MCP Agent 自动注册的虚拟插件",
        })
        return resp.json()["id"]
```

#### 2.5.2 报表 Tools

**文件：`server/mcp_server/tools/reports.py`**

```python
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
```

#### 2.5.3 同步 Tool

**文件：`server/mcp_server/tools/sync.py`**

```python
import json
from mcp.server.fastmcp import FastMCP
from ..client import ha_client
from ..config import config
from .entries import _ensure_mcp_plugin


def register(mcp: FastMCP):

    @mcp.tool()
    async def sync_balance(
        snapshots: str,
        book_id: str = "",
    ) -> str:
        """提交科目余额快照，系统自动计算差额并生成调节分录。

        snapshots 参数是一个 JSON 数组字符串，每个元素包含：
        - account_id: 科目 ID
        - balance: 外部真实余额（数字）
        - snapshot_date: 快照日期 (YYYY-MM-DD)

        使用前请先调用 list_accounts 获取科目 ID。
        """
        bid = book_id or config.default_book_id
        if not bid:
            return "错误：未指定 book_id"

        try:
            snapshot_list = json.loads(snapshots)
        except json.JSONDecodeError as e:
            return f"错误：snapshots 参数 JSON 解析失败: {e}"

        plugin_id = await _ensure_mcp_plugin()
        result = await ha_client.sync_balance(plugin_id, bid, snapshot_list)
        return json.dumps(result, ensure_ascii=False, indent=2)
```

#### 2.5.4 管理 Tools

**文件：`server/mcp_server/tools/management.py`**

```python
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
```

#### 2.5.5 Tool 注册汇总

**文件：`server/mcp_server/tools/__init__.py`**

```python
from mcp.server.fastmcp import FastMCP
from . import entries, reports, sync, management


def register_all_tools(mcp: FastMCP):
    """注册所有 MCP Tools"""
    entries.register(mcp)
    reports.register(mcp)
    sync.register(mcp)
    management.register(mcp)
```

---

## 3. 认证升级：API Key 双模式支持

### 3.1 问题

现有端点大部分使用 `get_current_user`（仅 JWT），MCP Server 使用 API Key 认证将无法调用这些端点。需要将 MCP 依赖的端点升级为 `get_current_user_flexible`（同时支持 JWT + API Key）。

### 3.2 已有认证依赖

| 依赖函数 | 支持方式 | 所在文件 |
|----------|---------|---------|
| `get_current_user` | 仅 JWT | `server/app/utils/deps.py` |
| `get_api_user` | 仅 API Key（返回 `tuple[User, ApiKey]`） | `server/app/utils/api_key_auth.py` |
| `get_current_user_flexible` | JWT 或 API Key（返回 `User`） | `server/app/utils/api_key_auth.py` |

`get_current_user_flexible` 已在 v0.2.0 中实现，逻辑为：检测 `Authorization` header 的 token 前缀，`hak_` 走 API Key 验证，否则走 JWT 验证。

### 3.3 需要变更的端点

以下端点需将 `Depends(get_current_user)` 改为 `Depends(get_current_user_flexible)`：

| 文件 | 端点 | MCP Tool 依赖 |
|------|------|--------------|
| `entries.py` | `GET /books/{id}/entries` | `list_entries` |
| `entries.py` | `GET /entries/{id}` | `get_entry` |
| `entries.py` | `DELETE /entries/{id}` | `delete_entry` |
| `reports.py` | `GET /books/{id}/balance-sheet` | `get_balance_sheet` |
| `reports.py` | `GET /books/{id}/income-statement` | `get_income_statement` |
| `reports.py` | `GET /books/{id}/dashboard` | `get_dashboard` |
| `accounts.py` | `GET /books/{id}/accounts` | `list_accounts` |
| `books.py` | `GET /books` | MCP 内部获取默认账本 |
| `sync.py` | `POST /accounts/{id}/snapshot` | `sync_balance` |

> 注意：`entries.py` 中新增的 `POST /entries/{id}/convert` 也应使用 `get_current_user_flexible`。

### 3.4 不需要变更的端点

以下端点保持 `get_current_user`（仅 JWT），MCP 不需要调用：

- `auth.py` — 登录/注册/个人信息（用户直接操作）
- `api_keys.py` — API Key 管理（用户直接操作）
- `assets.py` — 固定资产管理（暂不暴露给 MCP）
- `loans.py` — 贷款管理（暂不暴露给 MCP）
- `budgets.py` — 预算管理（暂不暴露给 MCP）
- `entries.py` 中的 `POST /books/{id}/entries`、`PUT /entries/{id}`（MCP 走批量记账 API）

### 3.5 变更示例

```python
# Before (entries.py)
from app.utils.deps import get_current_user

@router.get("/books/{book_id}/entries")
async def list_entries(
    current_user: User = Depends(get_current_user),  # 仅 JWT
    ...
):

# After
from app.utils.api_key_auth import get_current_user_flexible

@router.get("/books/{book_id}/entries")
async def list_entries(
    current_user: User = Depends(get_current_user_flexible),  # JWT + API Key
    ...
):
```

> 由于 `get_current_user_flexible` 返回的也是 `User` 对象，下游业务代码无需任何改动。

---

## 4. 分录类型转换实现

### 3.1 Schema

**文件：`server/app/schemas/entry.py`** — 新增

```python
from typing import Literal

class EntryConvertRequest(BaseModel):
    """分录类型转换请求"""
    target_type: Literal["expense", "income", "transfer", "asset_purchase", "borrow", "repay"]
    category_account_id: str | None = None  # 新类型需要的分类科目
    payment_account_id: str | None = None   # 新类型需要的支付科目
```

### 3.2 Service

**文件：`server/app/services/entry_service.py`** — 新增方法

```python
# 支持的转换路径白名单
ALLOWED_CONVERSIONS: dict[str, set[str]] = {
    "expense": {"asset_purchase", "transfer"},
    "asset_purchase": {"expense"},
    "income": {"repay"},
    "transfer": {"expense", "income"},
}

async def convert_entry_type(
    db: AsyncSession,
    entry_id: str,
    user: User,
    body: EntryConvertRequest,
) -> JournalEntry:
    """转换分录类型。

    1. 校验权限和转换路径合法性
    2. 删除原借贷明细行
    3. 根据新类型重建借贷明细行
    4. 更新 entry_type
    """
    # 1. 获取分录 + 权限校验
    entry = await _get_entry_with_access(db, entry_id, user)

    # 2. 校验转换路径
    allowed = ALLOWED_CONVERSIONS.get(entry.entry_type, set())
    if body.target_type not in allowed:
        raise HTTPException(
            400,
            f"不支持从 {entry.entry_type} 转换为 {body.target_type}。"
            f"允许的目标类型: {', '.join(allowed) if allowed else '无'}"
        )

    # 3. 删除原借贷明细行
    await db.execute(
        delete(JournalLine).where(JournalLine.entry_id == entry_id)
    )

    # 4. 获取科目信息
    book = await _get_book(db, entry.book_id)
    category_id = body.category_account_id or entry.category_account_id
    payment_id = body.payment_account_id or entry.payment_account_id

    # 5. 根据新类型重建借贷明细
    match body.target_type:
        case "expense":
            lines = _build_expense_lines(entry, category_id, payment_id)
        case "income":
            lines = _build_income_lines(entry, category_id, payment_id)
        case "transfer":
            lines = _build_transfer_lines(entry, category_id, payment_id)
        case "asset_purchase":
            lines = _build_asset_purchase_lines(entry, category_id, payment_id)
        case "borrow":
            lines = _build_borrow_lines(entry, category_id, payment_id)
        case "repay":
            lines = _build_repay_lines(entry, category_id, payment_id)

    for line in lines:
        db.add(line)

    # 6. 更新 entry_type
    entry.entry_type = body.target_type
    if body.category_account_id:
        entry.category_account_id = body.category_account_id
    if body.payment_account_id:
        entry.payment_account_id = body.payment_account_id

    await db.flush()
    await db.refresh(entry)
    return entry
```

> `_build_*_lines()` 方法复用现有 `entry_service.py` 中各类型的借贷行生成逻辑，抽取为公共函数。

### 3.3 Router

**文件：`server/app/routers/entries.py`** — 新增端点

```python
@router.post("/entries/{entry_id}/convert")
async def convert_entry(
    entry_id: str,
    body: EntryConvertRequest,
    user: User = Depends(get_current_user),
    db: AsyncSession = Depends(get_db),
):
    """转换分录类型"""
    entry = await entry_service.convert_entry_type(db, entry_id, user, body)
    await db.commit()
    return await _to_detail(db, entry)
```

### 3.4 前端实现

**文件：`client/services/entryService.ts`** — 新增

```typescript
export async function convertEntryType(
  entryId: string,
  data: { target_type: string; category_account_id?: string; payment_account_id?: string }
) {
  return api.post(`/entries/${entryId}/convert`, data);
}
```

**文件：`client/app/entry/[id].tsx`** — 修改

在分录详情页的操作区域添加「转换类型」按钮，点击弹出 Modal：

- 展示当前类型
- 展示可转换的目标类型列表（根据 `ALLOWED_CONVERSIONS` 过滤）
- 选择目标类型后，若需要新科目则展示 AccountPicker
- 确认后调用 `convertEntryType()`

---

## 5. 前端 MCP 服务入口实现

### 5.1 新增文件

**文件：`client/app/settings/mcp.tsx`** — 移动端 MCP 服务页面

核心逻辑（无需后端新接口，纯前端展示 + 剪贴板操作）：

```typescript
// 静态 MCP Tools 列表
const MCP_TOOLS = [
  { name: 'create_entries', icon: '📝', desc: '智能记账' },
  { name: 'list_entries', icon: '📋', desc: '查询分录' },
  { name: 'get_entry', icon: '🔍', desc: '分录详情' },
  { name: 'delete_entry', icon: '🗑', desc: '删除分录' },
  { name: 'get_balance_sheet', icon: '📊', desc: '资产负债表' },
  { name: 'get_income_statement', icon: '📈', desc: '损益表' },
  { name: 'get_dashboard', icon: '🏠', desc: '仪表盘概况' },
  { name: 'sync_balance', icon: '🔄', desc: '余额同步' },
  { name: 'list_accounts', icon: '🏦', desc: '科目树' },
  { name: 'list_plugins', icon: '🔌', desc: '插件列表' },
];

// 生成 Claude Desktop 配置 JSON
function buildClaudeDesktopConfig(serverUrl: string, apiKey: string, bookId: string): string {
  return JSON.stringify({
    mcpServers: {
      "home-accountant": {
        command: "python",
        args: ["-m", "mcp_server"],
        cwd: "/path/to/home_accountant/server",
        env: {
          HA_SERVER_URL: serverUrl,
          HA_API_KEY: apiKey,
          HA_DEFAULT_BOOK_ID: bookId,
        },
      },
    },
  }, null, 2);
}

// 生成 Cursor 配置 JSON
function buildCursorConfig(serverUrl: string, apiKey: string, bookId: string): string {
  return JSON.stringify({
    mcpServers: {
      "home-accountant": {
        command: "python",
        args: ["-m", "mcp_server"],
        cwd: "./server",
        env: {
          HA_SERVER_URL: serverUrl,
          HA_API_KEY: apiKey,
          HA_DEFAULT_BOOK_ID: bookId,
        },
      },
    },
  }, null, 2);
}
```

**数据来源**：

| 数据 | 来源 | 说明 |
|------|------|------|
| 服务器地址 | 复用 `client/services/api.ts` 中的 `BASE_URL` | 当前连接的后端地址 |
| API Key | 调用 `apiKeyService.listApiKeys()` | 选取第一个 `is_active=true` 的 Key |
| 默认账本 ID | 调用 `bookService.getBooks()` | 选取用户第一个账本的 ID |

### 5.2 修改文件

**文件：`client/app/(tabs)/profile.tsx`**

1. 菜单区新增 `MenuItem`：

```tsx
<MenuItem
  icon="cpu"
  label="MCP 服务"
  hint="AI 工具连接"
  onPress={() => {
    // 移动端：router.push('/settings/mcp')
    // 桌面端：setSelectedDetail('mcp')
  }}
/>
```

2. 桌面端 DetailPane 新增 `mcp` case，渲染 MCP 服务面板内容（与移动端共享核心组件）。

---

## 6. 依赖变更

### 6.1 MCP Server 依赖

| 包 | 版本 | 用途 |
|----|------|------|
| `mcp` | `>=1.5.0` | MCP Python SDK（`FastMCP`） |
| `httpx` | `>=0.27.0` | 异步 HTTP 客户端（调用 REST API） |

> MCP Server 的依赖独立于 FastAPI Server。可以在 `server/mcp_server/requirements.txt` 中单独管理，也可以合并到 `server/requirements.txt`。

### 6.2 后端依赖

无新增。分录类型转换使用已有依赖。

### 6.3 前端依赖

无新增。分录类型转换 UI 使用已有组件。

---

## 7. 开发实施计划

### 阶段 1：认证升级 + MCP Server 基础框架（预计 0.5 天）

1. 将 MCP 依赖的 9 个端点认证从 `get_current_user` 改为 `get_current_user_flexible`
2. 补充认证升级的单元测试（API Key 调用原 JWT-only 端点）
3. 创建 `server/mcp_server/` 目录结构
4. 实现 `config.py`（环境变量配置）
5. 实现 `client.py`（HTTP 客户端）
6. 实现 `__main__.py`（FastMCP 启动入口）
7. 验证 stdio 模式可启动

### 阶段 2：MCP Tools — 查询类（预计 1 天）

1. 实现 `list_accounts` Tool
2. 实现 `get_balance_sheet` Tool
3. 实现 `get_income_statement` Tool
4. 实现 `get_dashboard` Tool
5. 实现 `list_plugins` Tool
6. 实现 `list_entries` Tool
7. 实现 `get_entry` Tool
8. 用 Claude Desktop 端到端测试查询类 Tools

### 阶段 3：MCP Tools — 写入类（预计 1 天）

1. 实现 `create_entries` Tool（含 `_ensure_mcp_plugin` 自动注册）
2. 实现 `delete_entry` Tool
3. 实现 `sync_balance` Tool
4. 端到端测试：自然语言 → LLM 调用 Tool → 分录创建成功
5. SSE 模式测试

### 阶段 4：前端 MCP 服务入口（预计 0.5 天）

1. 创建 `client/app/settings/mcp.tsx` 移动端页面
2. `profile.tsx` 菜单新增「MCP 服务」入口（icon: `cpu`，位于插件管理下方）
3. `profile.tsx` 桌面端 DetailPane 新增 MCP 服务面板
4. 实现连接配置展示（服务器地址、API Key、账本 ID）
5. 实现一键复制 Claude Desktop / Cursor 配置 JSON
6. 实现可用 Tools 列表展示（静态数据，10 个 Tool）
7. 无可用 API Key 时展示「去创建」链接（复用 `apiKeyService`）

### 阶段 5：分录类型转换 — 后端（预计 1 天）

1. 新增 `EntryConvertRequest` schema
2. 实现 `convert_entry_type()` service 方法
3. 新增 `POST /entries/{id}/convert` router 端点
4. 单元测试：
   - 费用 → 资产购置（成功）
   - 资产购置 → 费用（成功）
   - 费用 → 转账（成功）
   - 不允许的转换路径 → 400 错误
   - sync 来源分录 → 400 错误
   - 转换后借贷平衡校验
   - 原分录 ID 保留不变

### 阶段 6：分录类型转换 — 前端（预计 0.5 天）

1. `entryService.ts` 新增 `convertEntryType()`
2. `entry/[id].tsx` 新增「转换类型」按钮 + Modal
3. 目标类型选择列表（根据当前类型过滤）
4. 需要时展示科目选择器
5. 联调测试

### 阶段 7：测试 & 文档（预计 0.5 天）

1. MCP Tools 集成测试（`test_mcp_tools.py`）
2. 分录类型转换测试（`test_entry_convert.py`）
3. Claude Desktop 端到端验收
4. 更新 Swagger 文档

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 认证升级 + MCP Server 基础框架 | 0.5 天 | 0.5 天 |
| 2 | MCP Tools — 查询类 | 1 天 | 1.5 天 |
| 3 | MCP Tools — 写入类 | 1 天 | 2.5 天 |
| 4 | 前端 MCP 服务入口 | 0.5 天 | 3 天 |
| 5 | 分录类型转换 — 后端 | 1 天 | 4 天 |
| 6 | 分录类型转换 — 前端 | 0.5 天 | 4.5 天 |
| 7 | 测试 & 文档 | 0.5 天 | 5 天 |

> v0.2.1 总计约 **5 个工作日**。

---

## 8. 测试要点

### 8.1 MCP Tools 测试

| 测试用例 | 预期结果 |
|---------|---------|
| `list_accounts` 返回科目树 | 按 type 分组，含 ID/名称/类型 |
| `create_entries` 单条费用 | 创建成功，返回 entry_id |
| `create_entries` 多条混合类型 | 全部创建成功 |
| `create_entries` 带 external_id 去重 | 重复的标记为 skipped |
| `list_entries` 按日期筛选 | 返回匹配的分录 |
| `get_balance_sheet` | 返回资产负债表，借贷平衡 |
| `get_income_statement` | 返回损益表 |
| `get_dashboard` | 返回净资产、本月收支 |
| `sync_balance` 差额不为零 | 生成调节分录 |
| `list_plugins` | 含 mcp-agent 虚拟插件 |
| 未配置 API Key 启动 | 报错提示配置缺失 |
| 无效 API Key | 返回认证失败信息 |
| 不存在的 book_id | 返回友好错误信息 |

### 8.2 分录类型转换测试

| 测试用例 | 预期结果 |
|---------|---------|
| expense → asset_purchase | entry_type 变更，借贷行重建，借贷平衡 |
| asset_purchase → expense | 同上 |
| expense → transfer | 借贷行调整为两个资产科目间划转 |
| transfer → expense | 借贷行调整为费用 + 资产减少 |
| transfer → income | 借贷行调整为资产增加 + 收入 |
| income → repay | 借贷行调整为资产增加 + 负债减少 |
| expense → income（不允许） | 400 错误 |
| borrow → expense（不允许） | 400 错误 |
| source=sync 的分录 | 400 错误：仅支持手动分录 |
| 转换后分录 ID 不变 | entry.id 保持原值 |
| 转换后 created_at 不变 | 创建时间保持原值 |
| 数据库事务回滚 | 科目不存在时全部回滚 |

---

## 9. 安全考量

| 风险 | 缓解措施 |
|------|---------|
| MCP Server 暴露所有能力 | Tool 列表固定，不自动暴露未声明的 API |
| API Key 在 MCP 配置中明文 | 遵循 Claude Desktop / Cursor 的环境变量安全机制；建议用户创建专用 Key |
| LLM 误操作删除分录 | `delete_entry` 的 Tool 描述中加入警告；可考虑后续加入「确认」机制 |
| MCP Server 与 REST API 不同步 | MCP Server 不引入业务逻辑，纯粹转发请求，不会出现逻辑分叉 |
| 分录类型转换数据一致性 | 转换在单一事务内完成，失败全量回滚 |

---

## 10. MCP Server 使用指南

### 10.1 安装

```bash
cd server
pip install mcp httpx
```

### 10.2 配置 Claude Desktop

编辑 `~/Library/Application Support/Claude/claude_desktop_config.json`（macOS）：

```json
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "/path/to/home_accountant/server",
      "env": {
        "HA_SERVER_URL": "http://localhost:8000",
        "HA_API_KEY": "hak_your_api_key_here",
        "HA_DEFAULT_BOOK_ID": "your-book-uuid"
      }
    }
  }
}
```

### 10.3 配置 Cursor

编辑项目根目录 `.cursor/mcp.json`：

```json
{
  "mcpServers": {
    "home-accountant": {
      "command": "python",
      "args": ["-m", "mcp_server"],
      "cwd": "./server",
      "env": {
        "HA_SERVER_URL": "http://localhost:8000",
        "HA_API_KEY": "hak_your_api_key_here",
        "HA_DEFAULT_BOOK_ID": "your-book-uuid"
      }
    }
  }
}
```

### 10.4 典型对话示例

```
用户：帮我记一笔，今天午饭花了 45 块
Claude：我来帮你记录这笔费用。先查看科目列表...
  → 调用 list_accounts(book_id="xxx")
  → 找到餐饮费科目 ID 和默认支付科目 ID
  → 调用 create_entries(entries=[{entry_type: "expense", ...}])
Claude：已记录：2026-02-14 午餐费用 ¥45.00（餐饮 → 银行卡）

用户：这个月我花了多少钱？
Claude：
  → 调用 get_income_statement(book_id="xxx", start_date="2026-02-01", end_date="2026-02-14")
Claude：本月费用合计 ¥3,280.50，其中餐饮 ¥1,200、交通 ¥580...

用户：我的净资产是多少？
Claude：
  → 调用 get_balance_sheet(book_id="xxx")
Claude：截至今日您的净资产为 ¥285,320.00（资产 ¥350,000 - 负债 ¥64,680）
```
