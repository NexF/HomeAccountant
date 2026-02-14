# 家庭记账 - 项目结构文档

> **当前版本：v0.2.0 — 详见 [`docs/v0.2.0/`](./docs/v0.2.0/)**
> **v0.1.1 归档：[`docs/v0.1.1/`](./docs/v0.1.1/)**
> **v0.0.3 归档：[`docs/v0.0.3/`](./docs/v0.0.3/)**
> **v0.0.2 归档：[`docs/v0.0.2/`](./docs/v0.0.2/)**
> **v0.0.1 归档：[`docs/v0.0.1/`](./docs/v0.0.1/)**

```
home_accountant/
├── client/                          # 前端（React Native + Expo，三端统一）— 本版本无变更
│   ├── app/                         # Expo Router 文件系统路由
│   │   ├── (tabs)/                  # Tab 导航布局
│   │   │   ├── _layout.tsx          # Tab 布局配置（底部 Tab Bar + 桌面端侧边栏）
│   │   │   ├── index.tsx            # 总览 Dashboard（桌面端左右分栏）
│   │   │   ├── ledger.tsx           # 账本（分录列表，桌面端左列表+右详情）
│   │   │   ├── reports.tsx          # 报表入口（balance/income/trends 内嵌 Tab）
│   │   │   └── profile.tsx          # 我的（桌面端左菜单+右详情面板，内嵌 6 个子面板）
│   │   ├── (auth)/                  # 认证相关页面
│   │   │   ├── _layout.tsx          # 认证布局
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── entry/                   # 记账相关
│   │   │   ├── new.tsx              # 新建记账（6种操作类型）
│   │   │   └── [id].tsx             # 分录详情/编辑
│   │   ├── reports/                 # 报表详情页（全屏展开）
│   │   │   ├── balance-sheet.tsx    # 资产负债表
│   │   │   ├── income-statement.tsx # 损益表
│   │   │   └── trends.tsx           # 趋势分析
│   │   ├── accounts/                # 科目管理
│   │   │   ├── index.tsx            # 科目列表
│   │   │   └── [id].tsx             # 科目详情/编辑
│   │   ├── assets/                  # 固定资产管理
│   │   │   ├── index.tsx            # 资产列表（汇总卡片 + 资产卡片列表）
│   │   │   ├── [id].tsx             # 资产详情（折旧信息/折旧历史/处置）
│   │   │   └── new.tsx              # 新建固定资产（含折旧粒度选项：按月/按日）
│   │   ├── loans/                   # 贷款管理
│   │   │   ├── index.tsx            # 贷款列表（汇总卡片 + 贷款卡片列表）
│   │   │   ├── [id].tsx             # 贷款详情（还款计划/还款历史/提前还款）
│   │   │   └── new.tsx              # 新建贷款（自动计算月供和利息总额）
│   │   ├── sync/                    # 外部账户同步
│   │   │   └── reconcile.tsx        # 待处理队列（对账调节）
│   │   ├── settings/                # 设置
│   │   │   └── budget.tsx           # 预算设置（总预算 + 分类预算列表 + 进度条）
│   │   ├── profile/                 # 个人中心子页面（移动端路由）
│   │   │   ├── edit.tsx             # 编辑个人信息
│   │   │   └── settings.tsx         # 设置
│   │   ├── _layout.tsx              # 根布局
│   │   ├── +html.tsx                # Web 端 HTML 模板
│   │   └── +not-found.tsx           # 404 页面
│   │
│   ├── components/                  # 通用组件
│   │   ├── layout/                  # 布局组件（响应式）
│   │   │   ├── ResponsiveLayout.tsx # 根据断点切换底部 Tab / 侧边栏布局
│   │   │   ├── Sidebar.tsx          # 桌面端左侧边栏导航
│   │   │   ├── TopBar.tsx           # 桌面端顶部栏（面包屑+记账按钮）
│   │   │   └── ContentContainer.tsx # 内容区容器（max-width 1200px 居中）
│   │   ├── entry/                   # 记账相关组件
│   │   │   ├── AmountInput.tsx      # 金额输入键盘
│   │   │   ├── AccountPicker.tsx    # 科目选择器
│   │   │   ├── EntryCard.tsx        # 分录卡片（统一复用，见设计规范第6节）
│   │   │   └── EntryTypeTab.tsx     # 记账类型 Tab
│   │   ├── reports/                 # 报表组件
│   │   │   ├── BalanceSheetTable.tsx # 资产负债表 T 型布局
│   │   │   ├── IncomeStatementTable.tsx # 损益表
│   │   │   ├── DatePicker.tsx       # 日期选择器（报表通用）
│   │   │   └── NetWorthBadge.tsx    # 净资产展示
│   │   ├── charts/                  # 图表组件
│   │   │   ├── ChartWebView.tsx     # 原生端 WebView 图表容器
│   │   │   ├── PieChart.tsx         # 饼图（资产构成/费用分类）
│   │   │   ├── LineChart.tsx        # 折线图（净资产趋势）
│   │   │   └── BarChart.tsx         # 柱状图（收入 vs 费用）
│   │   ├── assets/                  # 固定资产组件
│   │   │   ├── AssetCard.tsx        # 资产卡片（列表用，含净值进度条）
│   │   │   └── DepreciationChart.tsx # 折旧进度可视化
│   │   ├── loans/                   # 贷款组件
│   │   │   ├── LoanOverview.tsx     # 贷款总览（Dashboard 用）
│   │   │   └── RepaymentSchedule.tsx # 还款计划表
│   │   ├── budget/                  # 预算组件
│   │   │   ├── BudgetCard.tsx       # 预算卡片（进度条）
│   │   │   ├── BudgetOverview.tsx   # 预算总览（Dashboard 用）
│   │   │   └── BudgetAlert.tsx      # 预算提醒 Toast
│   │   ├── sync/                    # 对账相关组件
│   │   │   ├── ReconcileCard.tsx    # 待处理调节卡片
│   │   │   └── BalanceCompare.tsx   # 账本余额 vs 外部余额
│   │   ├── Themed.tsx               # 主题感知的 Text/View 组件
│   │   ├── useColorScheme.ts        # 颜色方案 Hook（原生端）
│   │   └── useColorScheme.web.ts    # 颜色方案 Hook（Web 端）
│   │
│   ├── stores/                      # Zustand 状态管理
│   │   ├── authStore.ts             # 用户认证状态
│   │   ├── bookStore.ts             # 当前账本
│   │   ├── accountStore.ts          # 科目数据
│   │   ├── entryStore.ts            # 分录数据
│   │   ├── assetStore.ts            # 固定资产状态
│   │   ├── loanStore.ts             # 贷款状态
│   │   ├── budgetStore.ts           # 预算状态
│   │   └── profileNavStore.ts       # 跨 Tab 面板导航（桌面端 Tab 切换时重置）
│   │
│   ├── services/                    # API 请求层
│   │   ├── api.ts                   # Axios/Fetch 基础配置
│   │   ├── authService.ts
│   │   ├── bookService.ts
│   │   ├── accountService.ts
│   │   ├── entryService.ts
│   │   ├── reportService.ts
│   │   ├── syncService.ts
│   │   ├── assetService.ts          # 固定资产 CRUD API
│   │   ├── loanService.ts           # 贷款 CRUD API
│   │   └── budgetService.ts         # 预算 CRUD API
│   │
│   ├── constants/                   # 常量
│   │   └── Colors.ts                # 色彩（含 A 股红涨绿跌配色）
│   │
│   ├── hooks/                       # 自定义 Hooks
│   │   ├── useBreakpoint.ts         # 响应式断点检测（xs/sm/md/lg）
│   │   └── useKeyboardShortcuts.ts  # 桌面端键盘快捷键
│   │
│   ├── assets/                      # 静态资源（图片/字体等）
│   ├── app.json                     # Expo 配置
│   ├── package.json
│   └── tsconfig.json
│
├── server/                          # 后端（Python FastAPI）
│   ├── app/
│   │   ├── main.py                  # FastAPI 入口（v0.2.0: 注册 api_keys、plugins 路由）
│   │   ├── config.py                # 配置（数据库路径、JWT 密钥等）
│   │   ├── database.py              # SQLite 连接 & 初始化（WAL 模式）
│   │   │
│   │   ├── models/                  # SQLAlchemy 数据模型
│   │   │   ├── __init__.py          # （v0.2.0: 导入 ApiKey、Plugin）
│   │   │   ├── user.py              # users
│   │   │   ├── book.py              # books, book_members
│   │   │   ├── account.py           # accounts（科目表）
│   │   │   ├── journal.py           # journal_entries, journal_lines（v0.2.0: 新增 external_id 字段）
│   │   │   ├── asset.py             # fixed_assets
│   │   │   ├── loan.py              # loans
│   │   │   ├── budget.py            # budgets
│   │   │   ├── sync.py              # data_sources, balance_snapshots, external_transactions
│   │   │   ├── api_key.py           # 🆕 api_keys（API Key 管理，bcrypt 哈希存储）
│   │   │   └── plugin.py            # 🆕 plugins（插件注册与状态追踪）
│   │   │
│   │   ├── schemas/                 # Pydantic 请求/响应模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── book.py
│   │   │   ├── account.py
│   │   │   ├── journal.py
│   │   │   ├── entry.py             # （v0.2.0: EntryCreateRequest 新增 external_id 可选字段）
│   │   │   ├── asset.py             # AssetCreate/Update/Response/Dispose/Summary/DepreciationRecord
│   │   │   ├── loan.py              # LoanCreate/Update/Response/RepaymentScheduleItem/Repay/Prepay/Summary
│   │   │   ├── budget.py            # BudgetCreate/Update/Response/Overview/CheckResult/Alert
│   │   │   ├── sync.py
│   │   │   ├── report.py            # 报表响应结构
│   │   │   ├── api_key.py           # 🆕 ApiKeyCreate/Update/Response
│   │   │   └── plugin.py            # 🆕 PluginCreate/Response/StatusUpdate/BatchEntry/BalanceSync
│   │   │
│   │   ├── routers/                 # API 路由
│   │   │   ├── __init__.py
│   │   │   ├── auth.py              # POST /auth/register, /auth/login
│   │   │   ├── books.py             # CRUD /books
│   │   │   ├── accounts.py          # CRUD /books/{id}/accounts
│   │   │   ├── entries.py           # CRUD /books/{id}/entries
│   │   │   ├── assets.py            # 固定资产 API（8个端点）
│   │   │   ├── loans.py             # 贷款 API（9个端点）
│   │   │   ├── budgets.py           # 预算 API（7个端点）
│   │   │   ├── reports.py           # GET /books/{id}/balance-sheet, /income-statement
│   │   │   ├── sync.py              # 同步 & 对账 API
│   │   │   ├── api_keys.py          # 🆕 CRUD /api-keys（JWT 认证，创建/列出/停用/删除）
│   │   │   └── plugins.py           # 🆕 /plugins（注册/状态上报/批量记账/余额同步）
│   │   │
│   │   ├── services/                # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── auth_service.py      # 注册/登录/JWT
│   │   │   ├── entry_service.py     # 记账核心逻辑（自动生成复式分录）
│   │   │   ├── report_service.py    # 资产负债表/损益表计算
│   │   │   ├── depreciation_service.py  # 折旧计算引擎（按月/按日直线法、处置）
│   │   │   ├── loan_service.py      # 贷款计算引擎（等额本息/等额本金、还款计划、提前还款）
│   │   │   ├── budget_service.py    # 预算检查 & 提醒（阈值预警、超支告警）
│   │   │   ├── reconciliation_service.py # 对账引擎（差异计算、调节分录生成）
│   │   │   ├── api_key_service.py   # 🆕 API Key 生成/验证/CRUD
│   │   │   ├── plugin_service.py    # 🆕 插件注册/状态管理
│   │   │   └── batch_entry_service.py # 🆕 批量记账（事务性去重）& 余额同步
│   │   │
│   │   ├── utils/                   # 工具
│   │   │   ├── __init__.py
│   │   │   ├── security.py          # 密码哈希、JWT 工具
│   │   │   ├── seed.py              # 初始化预置科目数据
│   │   │   └── api_key_auth.py      # 🆕 API Key 认证依赖注入（与 JWT 并行）
│   │   │
│   │   ├── adapters/                # 外部数据源 Adapter（可插拔）
│   │   │   ├── __init__.py
│   │   │   ├── base.py              # DataSourceAdapter 抽象基类
│   │   │   ├── manual_input.py      # ManualInputAdapter（手动输入余额）
│   │   │   └── csv_import.py        # CsvImportAdapter（CSV 账单解析）
│   │   │
│   │   └── tasks/                   # 定时任务
│   │       ├── __init__.py
│   │       ├── depreciation.py      # 月度 + 每日折旧自动计算（APScheduler）
│   │       ├── period_close.py      # 期末损益结转
│   │       └── sync_scheduler.py    # 外部账户定时同步
│   │
│   ├── scripts/                     # 脚本
│   │   └── migrate_v0_2_0.py        # 🆕 v0.2.0 数据库迁移（新增表 + external_id 字段）
│   │
│   ├── data/                        # SQLite 数据文件目录
│   │   └── home_accountant.db       # SQLite 数据库文件
│   │
│   ├── tests/                       # 测试
│   │   ├── test_entries.py          # 记账逻辑测试（复式平衡校验）
│   │   ├── test_reports.py          # 报表计算测试
│   │   ├── test_reconciliation.py   # 对账逻辑测试
│   │   ├── test_depreciation.py     # 折旧计算测试（月度/每日、上限、处置）
│   │   ├── test_loans.py            # 贷款计算测试（等额本息/本金、提前还款）
│   │   ├── test_budgets.py          # 预算检查测试（阈值预警、超支）
│   │   ├── test_api_keys.py         # 🆕 API Key 创建/验证/停用/过期/删除
│   │   ├── test_plugins.py          # 🆕 插件注册/状态上报/CRUD
│   │   ├── test_batch_entries.py    # 🆕 批量记账（事务回滚/去重/多类型）
│   │   └── test_balance_sync.py     # 🆕 余额同步（差额计算/调节分录/快照）
│   │
│   ├── requirements.txt             # Python 依赖
│   └── pyproject.toml
│
├── docs/                            # 版本文档归档
│   ├── v0.0.1/                      # v0.0.1 MVP 归档
│   │   ├── PRD.md
│   │   ├── TECH_SPEC.md
│   │   └── PROJECT_STRUCTURE.md
│   ├── v0.0.2/                      # v0.0.2 归档
│   │   ├── PRD.md
│   │   ├── TECH_SPEC.md
│   │   └── PROJECT_STRUCTURE.md
│   ├── v0.0.3/                      # v0.0.3 归档
│   │   ├── PRD.md
│   │   └── TECH_SPEC.md
│   ├── v0.1.1/                      # v0.1.1 归档
│   │   ├── PRD.md
│   │   └── TECH_SPEC.md
│   └── v0.2.0/                      # v0.2.0 当前版本
│       ├── PRD.md
│       ├── TECH_SPEC.md
│       └── PROJECT_STRUCTURE.md     # 本文件
│
├── DESIGN_GUIDELINES.md             # 前端交互设计规范（9 节）
└── PROJECT_STRUCTURE.md             # 根项目结构文档
```

## v0.2.0 变更摘要

### 新增文件（🆕 共 12 个）

| 文件 | 说明 |
|------|------|
| `server/app/models/api_key.py` | `api_keys` 表模型（Key 哈希存储、前缀索引） |
| `server/app/models/plugin.py` | `plugins` 表模型（状态追踪、同步计数） |
| `server/app/schemas/api_key.py` | API Key 请求/响应 Schema |
| `server/app/schemas/plugin.py` | 插件 + 批量记账 + 余额同步 Schema |
| `server/app/routers/api_keys.py` | API Key 管理端点（CRUD，JWT 认证） |
| `server/app/routers/plugins.py` | 插件管理 + 批量记账 + 余额同步端点（API Key 认证） |
| `server/app/services/api_key_service.py` | API Key 生成/验证/CRUD 逻辑 |
| `server/app/services/plugin_service.py` | 插件注册/状态管理逻辑 |
| `server/app/services/batch_entry_service.py` | 批量记账（事务去重）& 余额同步逻辑 |
| `server/app/utils/api_key_auth.py` | API Key 认证依赖注入（与 JWT 并行） |
| `server/scripts/migrate_v0_2_0.py` | 数据库迁移脚本 |
| `server/tests/test_api_keys.py` | API Key 测试 |
| `server/tests/test_plugins.py` | 插件管理测试 |
| `server/tests/test_batch_entries.py` | 批量记账测试 |
| `server/tests/test_balance_sync.py` | 余额同步测试 |

### 修改文件（共 4 个）

| 文件 | 变更 |
|------|------|
| `server/app/models/journal.py` | `JournalEntry` 新增 `external_id` 字段（可选，联合唯一索引） |
| `server/app/models/__init__.py` | 导入 `ApiKey`、`Plugin` 模型 |
| `server/app/schemas/entry.py` | `EntryCreateRequest` 新增 `external_id` 可选字段 |
| `server/app/main.py` | 注册 `api_keys`、`plugins` 路由 |

### 新增数据库表

| 表名 | 说明 |
|------|------|
| `api_keys` | API Key 管理（`hak_` 前缀、bcrypt 哈希、过期控制） |
| `plugins` | 插件注册与状态追踪（类型 entry/balance/both、同步状态、错误记录） |

### 新增 API 端点

| 方法 | 路径 | 认证方式 | 说明 |
|------|------|---------|------|
| POST | `/api-keys` | JWT | 创建 API Key |
| GET | `/api-keys` | JWT | 列出所有 Key |
| PATCH | `/api-keys/{id}` | JWT | 更新 Key（停用/重命名） |
| DELETE | `/api-keys/{id}` | JWT | 删除 Key（级联删除关联插件） |
| POST | `/plugins` | API Key | 注册插件 |
| GET | `/plugins` | JWT / API Key | 列出所有插件 |
| GET | `/plugins/{id}` | JWT / API Key | 查询插件详情 |
| PUT | `/plugins/{id}/status` | API Key | 更新插件状态 |
| DELETE | `/plugins/{id}` | JWT | 删除插件 |
| POST | `/plugins/{id}/entries/batch` | API Key | 批量记账（事务性、去重） |
| POST | `/plugins/{id}/balance/sync` | API Key | 余额同步（自动差额计算） |
