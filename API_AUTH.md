# API 认证方式一览

> 最后更新：2026-02-14（v0.2.1 规划）

## 认证方式说明

| 认证方式 | Header 格式 | 说明 |
|----------|------------|------|
| **JWT** | `Authorization: Bearer <jwt_token>` | 用户登录后获取，前端使用 |
| **API Key** | `Authorization: Bearer hak_<key>` | 在「API Key 管理」中创建，外部插件 / MCP 使用 |
| **Flexible** | 以上两种均可 | 自动判断：`hak_` 前缀走 API Key，否则走 JWT |

---

## 端点认证详情

### auth.py — 认证（JWT）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/auth/register` | 无 | 用户注册 |
| `POST` | `/auth/login` | 无 | 用户登录 |
| `GET` | `/auth/me` | JWT | 获取当前用户 |
| `PUT` | `/auth/profile` | JWT | 更新个人信息 |

### books.py — 账本管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/books` | JWT | 创建账本 |
| `GET` | `/books` | **Flexible** ⚡ | 获取账本列表 |

> ⚡ v0.2.1 从 JWT 升级为 Flexible

### entries.py — 分录管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/books/{book_id}/entries` | JWT | 创建分录（前端单条记账） |
| `GET` | `/books/{book_id}/entries` | **Flexible** ⚡ | 分录列表 |
| `GET` | `/entries/{entry_id}` | **Flexible** ⚡ | 分录详情 |
| `PUT` | `/entries/{entry_id}` | JWT | 编辑分录 |
| `DELETE` | `/entries/{entry_id}` | **Flexible** ⚡ | 删除分录 |
| `POST` | `/entries/{entry_id}/convert` | **Flexible** 🆕 | 分录类型转换（v0.2.1 新增） |

### accounts.py — 科目管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/accounts` | **Flexible** ⚡ | 获取科目树 |
| `POST` | `/books/{book_id}/accounts` | JWT | 新增科目 |
| `PUT` | `/accounts/{account_id}` | JWT | 编辑科目 |
| `DELETE` | `/accounts/{account_id}` | JWT | 停用科目 |

### reports.py — 报表

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/balance-sheet` | **Flexible** ⚡ | 资产负债表 |
| `GET` | `/books/{book_id}/income-statement` | **Flexible** ⚡ | 损益表 |
| `GET` | `/books/{book_id}/dashboard` | **Flexible** ⚡ | 仪表盘 |
| `GET` | `/books/{book_id}/net-worth-trend` | JWT | 净资产趋势 |
| `GET` | `/books/{book_id}/expense-breakdown` | JWT | 费用分类占比 |
| `GET` | `/books/{book_id}/asset-allocation` | JWT | 资产配置占比 |

### plugins.py — 插件管理

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/plugins` | API Key | 注册插件（幂等） |
| `GET` | `/plugins` | Flexible | 列出所有插件 |
| `GET` | `/plugins/{plugin_id}` | Flexible | 获取插件详情 |
| `PUT` | `/plugins/{plugin_id}/status` | API Key | 更新插件同步状态 |
| `DELETE` | `/plugins/{plugin_id}` | JWT | 删除插件 |
| `POST` | `/plugins/{plugin_id}/entries/batch` | API Key | 批量创建分录 |

### sync.py — 对账同步

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/accounts/{account_id}/snapshot` | **Flexible** ⚡ | 提交余额快照 |
| `GET` | `/books/{book_id}/pending-reconciliations` | JWT | 待处理对账队列 |
| `GET` | `/books/{book_id}/pending-count` | JWT | 待处理数量 |
| `PUT` | `/entries/{entry_id}/confirm` | JWT | 确认调节分录 |
| `POST` | `/entries/{entry_id}/split` | JWT | 拆分调节分录 |

### api_keys.py — API Key 管理（JWT）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `POST` | `/api-keys` | JWT | 创建 API Key |
| `GET` | `/api-keys` | JWT | 列出所有 Key |
| `PATCH` | `/api-keys/{key_id}` | JWT | 更新 Key（停用/启用） |
| `DELETE` | `/api-keys/{key_id}` | JWT | 删除 Key |

### assets.py — 固定资产管理（JWT）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/assets` | JWT | 固定资产列表 |
| `GET` | `/assets/{asset_id}` | JWT | 固定资产详情 |
| `POST` | `/books/{book_id}/assets` | JWT | 新建固定资产 |
| `PUT` | `/assets/{asset_id}` | JWT | 更新固定资产 |
| `DELETE` | `/assets/{asset_id}` | JWT | 删除固定资产 |
| `POST` | `/assets/{asset_id}/depreciate` | JWT | 手动触发折旧 |
| `POST` | `/assets/{asset_id}/dispose` | JWT | 处置资产 |
| `GET` | `/assets/{asset_id}/depreciation-history` | JWT | 折旧历史 |
| `GET` | `/books/{book_id}/assets/summary` | JWT | 资产汇总 |

### loans.py — 贷款管理（JWT）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/loans` | JWT | 贷款列表 |
| `GET` | `/loans/{loan_id}` | JWT | 贷款详情 |
| `POST` | `/books/{book_id}/loans` | JWT | 新建贷款 |
| `PUT` | `/loans/{loan_id}` | JWT | 更新贷款 |
| `DELETE` | `/loans/{loan_id}` | JWT | 删除贷款 |
| `GET` | `/loans/{loan_id}/schedule` | JWT | 还款计划 |
| `POST` | `/loans/{loan_id}/repay` | JWT | 记录还款 |
| `POST` | `/loans/{loan_id}/prepay` | JWT | 提前还款 |
| `GET` | `/books/{book_id}/loans/summary` | JWT | 贷款汇总 |

### budgets.py — 预算管理（JWT）

| 方法 | 路径 | 认证 | 说明 |
|------|------|------|------|
| `GET` | `/books/{book_id}/budgets` | JWT | 预算列表 |
| `GET` | `/budgets/{budget_id}` | JWT | 预算详情 |
| `POST` | `/books/{book_id}/budgets` | JWT | 新建预算 |
| `PUT` | `/budgets/{budget_id}` | JWT | 更新预算 |
| `DELETE` | `/budgets/{budget_id}` | JWT | 删除预算 |
| `GET` | `/books/{book_id}/budgets/overview` | JWT | 预算总览 |
| `POST` | `/books/{book_id}/budgets/check` | JWT | 预算检查 |

---

## 统计

| 认证方式 | 端点数 | 说明 |
|----------|-------|------|
| 无认证 | 2 | 注册、登录 |
| JWT only | 36 | 前端用户直接操作 |
| API Key only | 3 | 插件注册、状态上报、批量记账 |
| Flexible (JWT + API Key) | 12 | MCP Server + 前端均可访问 |
| **合计** | **53** | |

> ⚡ = v0.2.1 从 JWT 升级为 Flexible
> 🆕 = v0.2.1 新增端点
