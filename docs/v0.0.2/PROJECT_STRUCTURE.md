# 家庭记账 - 项目结构文档

> **版本：v0.0.2**
> **创建日期：2026-02-13**
> **基于版本：v0.0.1 (MVP)**
> **状态：规划中**
> **本版本新增：固定资产折旧管理、贷款管理 & 还款计划、预算管理 & 提醒**

## 变更说明

相比 v0.0.1，v0.0.2 新增以下文件（标注 `[NEW]`），修改的文件标注 `[MOD]`：

- **前端**：新增 3 组页面（assets/loans/settings）、3 组组件、3 个 Service、3 个 Store
- **后端**：新增 3 个 Service（depreciation/loan/budget）、定时任务扩展（每日折旧）
- **后端 Model**：`fixed_assets` 表新增 `depreciation_granularity` 字段、`budgets` 表新增 4 个字段
- **依赖**：后端新增 `APScheduler>=3.10`

```
home_accountant/
├── client/                          # 前端（React Native + Expo，三端统一）
│   ├── app/                         # Expo Router 文件系统路由
│   │   ├── (tabs)/                  # Tab 导航布局
│   │   │   ├── _layout.tsx          # Tab 布局配置
│   │   │   ├── index.tsx            # 总览 Dashboard [MOD] 新增预算进度卡片、贷款概览卡片
│   │   │   ├── ledger.tsx           # 账本（分录列表）
│   │   │   ├── reports.tsx          # 报表入口
│   │   │   └── profile.tsx          # 我的 [MOD] 菜单项从"即将推出"改为可用
│   │   ├── (auth)/                  # 认证相关页面
│   │   │   ├── login.tsx
│   │   │   └── register.tsx
│   │   ├── entry/                   # 记账相关
│   │   │   ├── new.tsx              # 新建记账 [MOD] 购买资产/借入/还款/费用联动
│   │   │   ├── [id].tsx             # 分录详情/编辑
│   │   │   └── manual.tsx           # 高级模式：手动分录
│   │   ├── reports/                 # 报表详情页
│   │   │   ├── balance-sheet.tsx    # 资产负债表
│   │   │   ├── income-statement.tsx # 损益表
│   │   │   └── trends.tsx           # 趋势分析
│   │   ├── accounts/                # 科目管理
│   │   │   ├── index.tsx            # 科目列表
│   │   │   └── [id].tsx             # 科目详情/编辑
│   │   ├── assets/                  # 固定资产管理
│   │   │   ├── index.tsx            # 资产列表（汇总卡片 + 资产卡片列表）
│   │   │   ├── [id].tsx             # 资产详情（折旧信息/折旧历史/处置）
│   │   │   └── new.tsx              # [NEW] 新建固定资产（含折旧粒度选项：按月/按日）
│   │   ├── loans/                   # 贷款管理
│   │   │   ├── index.tsx            # 贷款列表（汇总卡片 + 贷款卡片列表）
│   │   │   ├── [id].tsx             # 贷款详情（还款计划/还款历史/提前还款）
│   │   │   └── new.tsx              # [NEW] 新建贷款（自动计算月供和利息总额）
│   │   ├── sync/                    # 外部账户同步
│   │   │   ├── sources.tsx          # 数据源管理
│   │   │   ├── reconcile.tsx        # 待处理队列（对账调节）
│   │   │   └── history.tsx          # 对账历史
│   │   ├── settings/                # 设置
│   │   │   ├── index.tsx
│   │   │   ├── budget.tsx           # [NEW] 预算设置（总预算 + 分类预算列表 + 进度条）
│   │   │   └── import-export.tsx    # 数据导入/导出
│   │   ├── book/                    # 账本管理
│   │   │   ├── index.tsx            # 账本列表
│   │   │   ├── setup.tsx            # 初始化向导
│   │   │   └── members.tsx          # 成员管理
│   │   └── _layout.tsx              # 根布局 [MOD] 注册 assets/loans/budget 路由
│   │
│   ├── components/                  # 通用组件
│   │   ├── layout/                 # 布局组件（响应式）
│   │   │   ├── ResponsiveLayout.tsx # 根据断点切换底部Tab/侧边栏布局
│   │   │   ├── Sidebar.tsx         # 桌面端左侧边栏导航
│   │   │   ├── TopBar.tsx          # 桌面端顶部栏（面包屑+记账按钮）
│   │   │   ├── MasterDetail.tsx    # 主从布局容器（账本页等）
│   │   │   └── ContentContainer.tsx # 内容区容器（max-width 1200px 居中）
│   │   ├── ui/                      # 基础 UI 组件
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Input.tsx
│   │   │   ├── Modal.tsx
│   │   │   ├── Badge.tsx
│   │   │   └── Toast.tsx
│   │   ├── entry/                   # 记账相关组件
│   │   │   ├── AmountInput.tsx      # 金额输入键盘
│   │   │   ├── AccountPicker.tsx    # 科目选择器
│   │   │   ├── EntryCard.tsx        # 分录卡片
│   │   │   └── EntryTypeTab.tsx     # 记账类型 Tab
│   │   ├── reports/                 # 报表组件
│   │   │   ├── BalanceSheetTable.tsx # 资产负债表 T 型布局
│   │   │   ├── IncomeStatement.tsx  # 损益表
│   │   │   └── NetWorthBadge.tsx    # 净资产展示
│   │   ├── charts/                  # 图表组件（ECharts 封装）
│   │   │   ├── ChartWebView.tsx     # 原生端 WebView 图表容器
│   │   │   ├── PieChart.tsx         # 饼图（资产构成/费用分类）
│   │   │   ├── LineChart.tsx        # 折线图（净资产趋势）
│   │   │   └── BarChart.tsx         # 柱状图（收入 vs 费用）
│   │   ├── assets/                  # [NEW] 固定资产组件
│   │   │   ├── AssetCard.tsx        # 资产卡片（列表用，含净值进度条）
│   │   │   └── DepreciationChart.tsx # 折旧进度可视化
│   │   ├── loans/                   # [NEW] 贷款组件
│   │   │   ├── LoanCard.tsx         # 贷款卡片（列表用）
│   │   │   ├── RepaymentSchedule.tsx # 还款计划表
│   │   │   └── LoanProgress.tsx     # 还款进度可视化
│   │   ├── budget/                  # [NEW] 预算组件
│   │   │   ├── BudgetCard.tsx       # 预算卡片（进度条）
│   │   │   ├── BudgetOverview.tsx   # 预算总览（Dashboard 用）
│   │   │   └── BudgetAlert.tsx      # 预算提醒 Toast
│   │   └── sync/                    # 对账相关组件
│   │       ├── ReconcileCard.tsx    # 待处理调节卡片
│   │       └── BalanceCompare.tsx   # 账本余额 vs 外部余额
│   │
│   ├── stores/                      # Zustand 状态管理
│   │   ├── authStore.ts             # 用户认证状态
│   │   ├── bookStore.ts             # 当前账本
│   │   ├── accountStore.ts          # 科目数据
│   │   ├── entryStore.ts            # 分录数据
│   │   ├── syncStore.ts             # 同步/对账状态
│   │   ├── assetStore.ts            # [NEW] 固定资产状态
│   │   ├── loanStore.ts             # [NEW] 贷款状态
│   │   └── budgetStore.ts           # [NEW] 预算状态
│   │
│   ├── services/                    # API 请求层
│   │   ├── api.ts                   # Axios/Fetch 基础配置
│   │   ├── authService.ts
│   │   ├── bookService.ts
│   │   ├── accountService.ts
│   │   ├── entryService.ts
│   │   ├── reportService.ts
│   │   ├── syncService.ts
│   │   ├── assetService.ts          # [NEW] 固定资产 CRUD API
│   │   ├── loanService.ts           # [NEW] 贷款 CRUD API
│   │   └── budgetService.ts         # [NEW] 预算 CRUD API
│   │
│   ├── utils/                       # 工具函数
│   │   ├── accounting.ts            # 会计计算（余额汇总、损益等）
│   │   ├── format.ts                # 金额/日期格式化
│   │   ├── constants.ts             # 常量（默认科目、颜色等）
│   │   └── validators.ts            # 表单校验
│   │
│   ├── hooks/                       # 自定义 Hooks
│   │   ├── useBreakpoint.ts        # 响应式断点检测（xs/sm/md/lg）
│   │   ├── useKeyboardShortcuts.ts # 桌面端键盘快捷键
│   │   ├── useBalanceSheet.ts       # 资产负债表数据
│   │   ├── useIncomeStatement.ts    # 损益表数据
│   │   └── useReconciliation.ts     # 对账逻辑
│   │
│   ├── theme/                       # 主题配置
│   │   ├── colors.ts                # 色彩（A 股红涨绿跌）
│   │   ├── dark.ts                  # 深色模式
│   │   └── fonts.ts                 # 字体
│   │
│   ├── assets/                      # 静态资源
│   │   ├── icons/                   # 科目图标
│   │   └── images/
│   │
│   ├── app.json                     # Expo 配置
│   ├── eas.json                     # EAS Build 配置
│   ├── package.json
│   └── tsconfig.json
│
├── server/                          # 后端（Python FastAPI）
│   ├── app/
│   │   ├── main.py                  # FastAPI 入口 [MOD] 注册 APScheduler 定时任务
│   │   ├── config.py                # 配置（数据库路径、JWT 密钥等）
│   │   ├── database.py              # SQLite 连接 & 初始化（WAL 模式）
│   │   │
│   │   ├── models/                  # SQLAlchemy 数据模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py              # users
│   │   │   ├── book.py              # books, book_members
│   │   │   ├── account.py           # accounts（科目表）
│   │   │   ├── journal.py           # journal_entries, journal_lines
│   │   │   ├── asset.py             # fixed_assets [MOD] 新增 depreciation_granularity 字段
│   │   │   ├── loan.py              # loans
│   │   │   ├── budget.py            # budgets [MOD] 新增 alert_threshold/is_active/created_at/updated_at
│   │   │   └── sync.py              # data_sources, balance_snapshots, external_transactions
│   │   │
│   │   ├── schemas/                 # Pydantic 请求/响应模型
│   │   │   ├── __init__.py
│   │   │   ├── user.py
│   │   │   ├── book.py
│   │   │   ├── account.py
│   │   │   ├── journal.py
│   │   │   ├── asset.py             # [NEW] AssetCreate/Update/Response/Dispose/Summary/DepreciationRecord
│   │   │   ├── loan.py              # [NEW] LoanCreate/Update/Response/RepaymentScheduleItem/Repay/Prepay/Summary
│   │   │   ├── budget.py            # [NEW] BudgetCreate/Update/Response/Overview/CheckResult/Alert
│   │   │   ├── sync.py
│   │   │   └── report.py            # 报表响应结构
│   │   │
│   │   ├── routers/                 # API 路由
│   │   │   ├── __init__.py
│   │   │   ├── auth.py              # POST /auth/register, /auth/login
│   │   │   ├── books.py             # CRUD /books
│   │   │   ├── accounts.py          # CRUD /books/{id}/accounts
│   │   │   ├── entries.py           # CRUD /books/{id}/entries
│   │   │   ├── assets.py            # [NEW] 固定资产 API（8个端点）
│   │   │   ├── loans.py             # [NEW] 贷款 API（9个端点）
│   │   │   ├── budgets.py           # [NEW] 预算 API（7个端点）
│   │   │   ├── reports.py           # GET /books/{id}/balance-sheet, /income-statement
│   │   │   └── sync.py              # 同步 & 对账 API
│   │   │
│   │   ├── services/                # 业务逻辑层
│   │   │   ├── __init__.py
│   │   │   ├── auth_service.py      # 注册/登录/JWT
│   │   │   ├── entry_service.py     # 记账核心逻辑（自动生成复式分录）
│   │   │   ├── report_service.py    # 资产负债表/损益表计算
│   │   │   ├── depreciation_service.py  # [NEW] 折旧计算引擎（按月/按日直线法、处置）
│   │   │   ├── loan_service.py      # [NEW] 贷款计算引擎（等额本息/等额本金、还款计划、提前还款）
│   │   │   ├── budget_service.py    # [NEW] 预算检查 & 提醒（阈值预警、超支告警）
│   │   │   └── reconciliation_service.py # 对账引擎（差异计算、调节分录生成）
│   │   │
│   │   ├── adapters/                # 外部数据源 Adapter（可插拔）
│   │   │   ├── __init__.py
│   │   │   ├── base.py              # DataSourceAdapter 抽象基类
│   │   │   ├── manual_input.py      # ManualInputAdapter（手动输入余额）
│   │   │   └── csv_import.py        # CsvImportAdapter（CSV 账单解析）
│   │   │
│   │   ├── tasks/                   # 定时任务
│   │   │   ├── __init__.py
│   │   │   ├── depreciation.py      # [MOD] 月度 + 每日折旧自动计算（APScheduler）
│   │   │   ├── period_close.py      # 期末损益结转
│   │   │   └── sync_scheduler.py    # 外部账户定时同步
│   │   │
│   │   └── utils/                   # 工具
│   │       ├── __init__.py
│   │       ├── security.py          # 密码哈希、JWT 工具
│   │       └── seed.py              # 初始化预置科目数据
│   │
│   ├── data/                        # SQLite 数据文件目录
│   │   └── home_accountant.db       # SQLite 数据库文件
│   │
│   ├── tests/                       # 测试
│   │   ├── test_entries.py          # 记账逻辑测试（复式平衡校验）
│   │   ├── test_reports.py          # 报表计算测试
│   │   ├── test_reconciliation.py   # 对账逻辑测试
│   │   ├── test_depreciation.py     # [NEW] 折旧计算测试（月度/每日、上限、处置）
│   │   ├── test_loans.py            # [NEW] 贷款计算测试（等额本息/本金、提前还款）
│   │   └── test_budgets.py          # [NEW] 预算检查测试（阈值预警、超支）
│   │
│   ├── requirements.txt             # Python 依赖 [MOD] 新增 APScheduler>=3.10
│   └── pyproject.toml
│
├── docs/                            # 版本文档归档
│   ├── v0.0.1/                      # v0.0.1 MVP 归档
│   │   ├── PRD.md
│   │   ├── TECH_SPEC.md
│   │   └── PROJECT_STRUCTURE.md
│   └── v0.0.2/                      # v0.0.2 当前版本
│       ├── PRD.md
│       ├── TECH_SPEC.md
│       └── PROJECT_STRUCTURE.md     # 本文件
│
├── PRD.md                           # 产品需求文档（指向当前版本）
├── TECH_SPEC.md                     # 技术方案文档（指向当前版本）
└── PROJECT_STRUCTURE.md             # 项目结构文档（指向当前版本）
```
