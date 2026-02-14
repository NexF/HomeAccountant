# 家庭记账 - 项目结构文档

> **当前版本：v0.2.1 — 详见 [`docs/v0.2.1/`](./docs/v0.2.1/)**
> **历史版本归档：[`docs/`](./docs/)**

```
home_accountant/
├── client/                          # 前端（React Native + Expo，三端统一）
│   ├── app/                         # Expo Router 文件系统路由
│   │   ├── (tabs)/                  # Tab 导航布局
│   │   │   ├── _layout.tsx          # Tab 布局配置（底部 Tab Bar + 桌面端侧边栏）
│   │   │   ├── index.tsx            # 总览 Dashboard（桌面端左右分栏）
│   │   │   ├── ledger.tsx           # 账本（分录列表，桌面端左列表+右详情）
│   │   │   ├── reports.tsx          # 报表入口（balance/income/trends 内嵌 Tab）
│   │   │   └── profile.tsx          # 我的（桌面端左菜单+右详情面板，移动端菜单列表）
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
│   │   ├── settings/                # 设置（移动端独立页面）
│   │   │   ├── api-keys.tsx         # API Key 管理
│   │   │   ├── budget.tsx           # 预算设置（总预算 + 分类预算列表 + 进度条）
│   │   │   ├── mcp.tsx              # MCP 服务配置（连接配置/JSON 复制/Tools 列表）
│   │   │   └── plugins.tsx          # 插件管理
│   │   ├── profile/                 # 个人中心子页面（移动端路由）
│   │   │   ├── edit.tsx             # 编辑个人信息
│   │   │   └── settings.tsx         # 设置
│   │   ├── _layout.tsx              # 根布局
│   │   ├── +html.tsx                # Web 端 HTML 模板
│   │   └── +not-found.tsx           # 404 页面
│   │
│   ├── features/                    # 业务功能模块（按领域划分）
│   │   ├── entry/                   # 记账
│   │   │   ├── index.ts             # Barrel export
│   │   │   ├── AmountInput.tsx      # 金额输入键盘
│   │   │   ├── AccountPicker.tsx    # 科目选择器
│   │   │   ├── EntryCard.tsx        # 分录卡片（统一复用）
│   │   │   └── EntryTypeTab.tsx     # 记账类型 Tab
│   │   ├── account/                 # 科目管理
│   │   │   ├── index.ts
│   │   │   └── AccountsPane.tsx     # 桌面端科目管理面板
│   │   ├── asset/                   # 固定资产
│   │   │   ├── index.ts
│   │   │   ├── AssetCard.tsx        # 资产卡片（列表用，含净值进度条）
│   │   │   ├── DepreciationChart.tsx # 折旧进度可视化
│   │   │   └── AssetsPane.tsx       # 桌面端固定资产面板
│   │   ├── loan/                    # 贷款
│   │   │   ├── index.ts
│   │   │   ├── LoanOverview.tsx     # 贷款总览（Dashboard 用）
│   │   │   ├── RepaymentSchedule.tsx # 还款计划表
│   │   │   └── LoansPane.tsx        # 桌面端贷款管理面板
│   │   ├── budget/                  # 预算
│   │   │   ├── index.ts
│   │   │   ├── BudgetCard.tsx       # 预算卡片（进度条）
│   │   │   ├── BudgetOverview.tsx   # 预算总览（Dashboard 用）
│   │   │   ├── BudgetAlert.tsx      # 预算提醒 Toast
│   │   │   └── BudgetPane.tsx       # 桌面端预算设置面板
│   │   ├── report/                  # 报表
│   │   │   ├── index.ts
│   │   │   ├── BalanceSheetTable.tsx # 资产负债表 T 型布局
│   │   │   ├── IncomeStatementTable.tsx # 损益表
│   │   │   ├── DatePicker.tsx       # 日期选择器（报表通用）
│   │   │   └── NetWorthBadge.tsx    # 净资产展示
│   │   ├── chart/                   # 图表
│   │   │   ├── index.ts
│   │   │   ├── ChartWebView.tsx     # 原生端 WebView 图表容器
│   │   │   ├── PieChart.tsx         # 饼图（资产构成/费用分类）
│   │   │   ├── LineChart.tsx        # 折线图（净资产趋势）
│   │   │   └── BarChart.tsx         # 柱状图（收入 vs 费用）
│   │   ├── sync/                    # 同步对账
│   │   │   ├── index.ts
│   │   │   ├── ReconcileCard.tsx    # 待处理调节卡片
│   │   │   └── BalanceCompare.tsx   # 账本余额 vs 外部余额
│   │   ├── api-key/                 # API Key
│   │   │   ├── index.ts
│   │   │   └── ApiKeysPane.tsx      # 桌面端 API Key 管理面板
│   │   ├── plugin/                  # 插件
│   │   │   ├── index.ts
│   │   │   └── PluginsPane.tsx      # 桌面端插件管理面板
│   │   ├── mcp/                     # MCP 服务
│   │   │   ├── index.ts
│   │   │   └── MCPPane.tsx          # 桌面端 MCP 服务面板
│   │   └── profile/                 # 个人中心（共享组件 + 桌面端面板）
│   │       ├── index.ts
│   │       ├── types.ts             # DetailPane 类型定义
│   │       ├── styles.ts            # 共享样式（styles + budgetStyles）
│   │       ├── MenuItem.tsx         # 菜单项组件（profile.tsx 复用）
│   │       ├── EditProfilePane.tsx  # 编辑个人信息面板
│   │       └── SettingsPane.tsx     # 设置面板
│   │
│   ├── components/                  # 全局通用组件（非业务相关）
│   │   ├── layout/                  # 布局组件（响应式）
│   │   │   ├── ResponsiveLayout.tsx # 根据断点切换底部 Tab / 侧边栏布局
│   │   │   ├── Sidebar.tsx          # 桌面端左侧边栏导航
│   │   │   ├── TopBar.tsx           # 桌面端顶部栏（面包屑+记账按钮）
│   │   │   └── ContentContainer.tsx # 内容区容器（max-width 1200px 居中）
│   │   ├── __tests__/               # 组件测试
│   │   │   └── StyledText-test.js
│   │   ├── Themed.tsx               # 主题感知的 Text/View 组件
│   │   ├── ExternalLink.tsx         # 外部链接组件
│   │   ├── StyledText.tsx           # 样式化文本组件
│   │   ├── useClientOnlyValue.ts    # 客户端专属值 Hook（原生端）
│   │   ├── useClientOnlyValue.web.ts # 客户端专属值 Hook（Web 端）
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
│   │   ├── budgetService.ts         # 预算 CRUD API
│   │   ├── apiKeyService.ts         # API Key CRUD API
│   │   └── pluginService.ts         # 插件 CRUD API
│   │
│   ├── constants/                   # 常量
│   │   └── Colors.ts                # 色彩（含 A 股红涨绿跌配色）
│   │
│   ├── hooks/                       # 自定义 Hooks
│   │   ├── useBreakpoint.ts         # 响应式断点检测（xs/sm/md/lg）
│   │   └── useKeyboardShortcuts.ts  # 桌面端键盘快捷键
│   │
│   ├── assets/                      # 静态资源
│   │   ├── fonts/
│   │   │   └── SpaceMono-Regular.ttf
│   │   └── images/
│   │       ├── adaptive-icon.png
│   │       ├── favicon.png
│   │       ├── icon.png
│   │       └── splash-icon.png
│   │
│   ├── app.json                     # Expo 配置
│   ├── package.json
│   └── tsconfig.json
│
├── server/                          # 后端（Python FastAPI）
│   ├── app/
│   │   ├── __init__.py
│   │   ├── main.py                  # FastAPI 入口（含 MCP SSE 端点）
│   │   ├── config.py                # 配置（数据库路径、JWT 密钥等）
│   │   ├── database.py              # SQLite 连接 & 初始化（WAL 模式）
│   │   │
│   │   ├── models/                  # SQLAlchemy 数据模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py              # users
│   │   │   ├── book.py              # books, book_members
│   │   │   ├── account.py           # accounts（科目表）
│   │   │   ├── journal.py           # journal_entries, journal_lines
│   │   │   ├── asset.py             # fixed_assets
│   │   │   ├── loan.py              # loans
│   │   │   ├── budget.py            # budgets
│   │   │   ├── sync.py              # data_sources, balance_snapshots, external_transactions
│   │   │   ├── api_key.py           # api_keys
│   │   │   └── plugin.py            # plugins
│   │   │
│   │   ├── schemas/                 # Pydantic 请求/响应模型
│   │   │   ├── __init__.py
│   │   │   ├── auth.py
│   │   │   ├── book.py
│   │   │   ├── account.py
│   │   │   ├── entry.py
│   │   │   ├── asset.py             # AssetCreate/Update/Response/Dispose/Summary/DepreciationRecord
│   │   │   ├── loan.py              # LoanCreate/Update/Response/RepaymentScheduleItem/Repay/Prepay/Summary
│   │   │   ├── budget.py            # BudgetCreate/Update/Response/Overview/CheckResult/Alert
│   │   │   ├── sync.py
│   │   │   ├── report.py            # 报表响应结构
│   │   │   ├── api_key.py           # ApiKeyCreate/Response/ApiKeyCreateResponse
│   │   │   └── plugin.py            # PluginRegister/Update/Response
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
│   │   │   ├── api_keys.py          # API Key CRUD
│   │   │   └── plugins.py           # 插件注册/管理/同步
│   │   │
│   │   ├── services/                # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── auth_service.py      # 注册/登录/JWT
│   │   │   ├── entry_service.py     # 记账核心逻辑（自动生成复式分录）
│   │   │   ├── batch_entry_service.py # 批量记账服务
│   │   │   ├── account_service.py   # 科目管理
│   │   │   ├── book_service.py      # 账本管理
│   │   │   ├── report_service.py    # 资产负债表/损益表计算
│   │   │   ├── depreciation_service.py  # 折旧计算引擎（按月/按日直线法、处置）
│   │   │   ├── loan_service.py      # 贷款计算引擎（等额本息/等额本金、还款计划、提前还款）
│   │   │   ├── budget_service.py    # 预算检查 & 提醒（阈值预警、超支告警）
│   │   │   ├── reconciliation_service.py # 对账引擎（差异计算、调节分录生成）
│   │   │   ├── api_key_service.py   # API Key 业务逻辑
│   │   │   └── plugin_service.py    # 插件业务逻辑
│   │   │
│   │   ├── adapters/                # 外部数据源 Adapter（可插拔）
│   │   │   ├── __init__.py
│   │   │   └── base.py              # DataSourceAdapter 抽象基类
│   │   │
│   │   ├── tasks/                   # 定时任务
│   │   │   ├── __init__.py
│   │   │   └── depreciation.py      # 月度 + 每日折旧自动计算（APScheduler）
│   │   │
│   │   └── utils/                   # 工具
│   │       ├── __init__.py
│   │       ├── security.py          # 密码哈希、JWT 工具
│   │       ├── seed.py              # 初始化预置科目数据
│   │       ├── deps.py              # FastAPI 依赖注入（当前用户、数据库会话）
│   │       └── api_key_auth.py      # API Key 认证中间件
│   │
│   ├── mcp_server/                  # MCP 服务模块（Model Context Protocol）
│   │   ├── __init__.py
│   │   ├── __main__.py              # 入口（python -m mcp_server）
│   │   ├── client.py                # HTTP 客户端（调用后端 API）
│   │   ├── config.py                # MCP 配置（环境变量读取）
│   │   ├── requirements.txt         # MCP 独立依赖
│   │   └── tools/                   # MCP Tools 定义
│   │       ├── __init__.py          # 注册所有 tools
│   │       ├── entries.py           # create_entries / list_entries / get_entry / delete_entry
│   │       ├── reports.py           # get_balance_sheet / get_income_statement / get_dashboard
│   │       ├── sync.py              # sync_balance
│   │       └── management.py        # list_accounts / list_plugins
│   │
│   ├── data/                        # SQLite 数据文件目录
│   │   └── home_accountant.db       # SQLite 数据库文件
│   │
│   ├── tests/                       # 测试
│   │   ├── __init__.py
│   │   ├── conftest.py              # 测试 fixtures（测试数据库、客户端等）
│   │   ├── test_auth.py             # 认证测试
│   │   ├── test_books.py            # 账本测试
│   │   ├── test_accounts.py         # 科目测试
│   │   ├── test_entries.py          # 记账逻辑测试（复式平衡校验）
│   │   ├── test_batch_entries.py    # 批量记账测试
│   │   ├── test_reports.py          # 报表计算测试
│   │   ├── test_sync.py             # 对账逻辑测试
│   │   ├── test_depreciation_service.py # 折旧计算测试（月度/每日、上限、处置）
│   │   ├── test_asset_api.py        # 固定资产 API 测试
│   │   ├── test_loan_api.py         # 贷款 API 测试
│   │   ├── test_budget_api.py       # 预算 API 测试
│   │   ├── test_api_keys.py         # API Key 测试
│   │   ├── test_plugins.py          # 插件测试
│   │   ├── test_e2e_api_key_plugin_flow.py # API Key + 插件端到端流程测试
│   │   ├── test_mcp_e2e.py          # MCP 端到端测试
│   │   └── test_mcp_sse.py          # MCP SSE 连接测试
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
│   ├── v0.2.0/                      # v0.2.0 归档
│   │   ├── PRD.md
│   │   ├── PROJECT_STRUCTURE.md
│   │   └── TECH_SPEC.md
│   └── v0.2.1/                      # v0.2.1 当前版本
│       ├── PRD.md
│       └── TECH_SPEC.md
│
├── API_AUTH.md                      # API 认证说明（JWT + API Key 双模式）
├── DESIGN_GUIDELINES.md             # 前端交互设计规范（9 节）
└── PROJECT_STRUCTURE.md             # 本文件
```
