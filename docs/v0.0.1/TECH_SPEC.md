# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.0.1 (MVP)**
> **归档日期：2026-02-13**
> **状态：已完成（阶段 1-8 全部实现）**
> **说明：此文档为 MVP v0.0.1 版本归档，后续版本升级请参见对应版本目录下的新文档。**

## 1. 技术方案

### 1.1 客户端（三端统一）
- **框架**：React Native + Expo SDK + TypeScript
- **路由**：Expo Router（基于文件系统路由，三端统一）
- **UI 组件**：Tamagui / Gluestack UI（三端兼容的组件库）
- **状态管理**：Zustand
- **图表**：原生端通过 react-native-webview + ECharts 6.0 渲染，Web 端使用 echarts-for-react
- **响应式布局**：
  - 自定义 `useBreakpoint` Hook 检测屏幕宽度，返回当前断点（xs/sm/md/lg）
  - 断点阈值：xs < 640px / sm 640-1023px / md 1024-1439px / lg ≥ 1440px
  - `< 1024px`：底部 Tab 导航（移动端）
  - `≥ 1024px`：左侧边栏导航（桌面端），1024-1439px 默认收起（64px），≥ 1440px 默认展开（220px）
  - 页面内容区最大宽度 1200px（报表可扩至 1400px），水平居中
  - 使用 `Platform.OS` + `Dimensions` / `useWindowDimensions` 实现跨平台适配
- **目标平台**：
  - Android 原生应用（Google Play 上架）
  - iOS 原生应用（App Store 上架）
  - Web SPA（浏览器访问，通过 react-native-web 输出，桌面端体验优先）
- **离线支持**：本地 SQLite 缓存 + 联网后同步

### 1.2 后端
- **框架**：Python (FastAPI)
- **数据库**：SQLite（WAL 模式，单文件部署，备份即复制文件；后续用户量增长时可迁移至 PostgreSQL）
- **认证**：JWT Token
- **文件存储**：对象存储（图片上传）
- **定时任务**：月度折旧自动计算、期末损益结转、外部账户定时同步
- **外部数据对接层**：统一 DataSourceAdapter 接口，可插拔 Adapter 架构
  - MVP：ManualInputAdapter + CsvImportAdapter
  - 后续按需实现 OpenBankingAdapter、BrokerApiAdapter 等
- **对账引擎**：余额比对 + 流水匹配算法

### 1.3 部署
- Web 端：Vercel / EdgeOne Pages
- Android：Google Play（通过 EAS Build 打包）
- iOS：App Store（通过 EAS Build 打包）
- 后端：云服务器 / Serverless（SQLite 文件随服务部署）

---

## 2. MVP 开发实施计划

共分 8 个阶段，每个阶段产出可运行、可验证的成果。前后端交替推进，每完成一个后端模块立即对接前端页面。

### 阶段 1：项目初始化 & 基础设施（预计 2 天）

**目标：** 两端项目能跑起来，数据库能建表，前后端能通信。

**后端：**
1. 初始化 FastAPI 项目，配置 `pyproject.toml` / `requirements.txt`
2. 实现 `database.py`：SQLite 连接（WAL 模式）、SQLAlchemy 引擎
3. 实现 `config.py`：环境变量管理（数据库路径、JWT 密钥、Token 有效期等）
4. 创建全部数据模型（`models/` 下所有文件），运行 `create_all()` 建表
5. 实现 `utils/security.py`：密码哈希（bcrypt）、JWT 生成/验证
6. 实现 `utils/seed.py`：预置五大类科目数据（资产/负债/净资产/收入/费用共 30+ 个默认科目）
7. 启动 `uvicorn`，验证 `/docs` Swagger UI 可访问

**前端：**
1. `npx create-expo-app client --template tabs`
2. 配置 Expo Router、TypeScript、Tamagui/Gluestack UI
3. 搭建 `(tabs)/_layout.tsx`（底部 4 个 Tab：总览/账本/报表/我的）
4. 实现 `hooks/useBreakpoint.ts`：响应式断点检测（xs/sm/md/lg）
5. 实现 `components/layout/ResponsiveLayout.tsx`：根据断点切换底部 Tab（移动端）/ 左侧边栏（桌面端）
6. 实现 `services/api.ts`：Axios 基础配置（baseURL 指向后端）
7. 验证：`npx expo start --web` 能显示 Tab 导航骨架，桌面端宽度下自动切换为侧边栏布局

**验证标准：** 后端 Swagger UI 可访问，前端 Tab 页面骨架可见，Axios 能请求后端健康检查接口。桌面端（≥1024px）显示左侧边栏导航，移动端显示底部 Tab。

---

### 阶段 2：用户认证（预计 2 天）

**目标：** 用户能注册、登录，Token 鉴权跑通。

**后端：**
1. `routers/auth.py`：
   - `POST /auth/register` — 邮箱+密码注册，返回用户信息
   - `POST /auth/login` — 登录，返回 JWT Token
   - `GET /auth/me` — 根据 Token 返回当前用户
2. `services/auth_service.py`：注册查重、密码哈希校验、Token 生成
3. 中间件：JWT 鉴权依赖注入（`get_current_user`），后续所有 API 复用
4. Swagger UI 测试：注册 → 登录 → 拿 Token → 请求 `/auth/me`

**前端：**
1. `stores/authStore.ts`：Token 存储（SecureStore）、登录/登出状态
2. `app/(auth)/login.tsx`：邮箱+密码表单 → 调用登录 API → 存 Token → 跳转首页
3. `app/(auth)/register.tsx`：注册表单 → 调用注册 API → 自动登录
4. `app/_layout.tsx`：根据登录状态决定跳转 `(auth)` 还是 `(tabs)`
5. `services/authService.ts`：封装 register / login / getMe 请求

**验证标准：** 注册新用户 → 登录 → 进入首页 → 退出 → 回到登录页。Token 过期后自动跳登录。

---

### 阶段 3：科目体系 & 账本（预计 2 天）

**目标：** 用户登录后自动创建默认账本和预置科目，能查看和管理科目。

**后端：**
1. `routers/books.py`：
   - `POST /books` — 创建账本（注册后自动创建一个"个人账本"）
   - `GET /books` — 获取用户的账本列表
2. `routers/accounts.py`：
   - `GET /books/{id}/accounts` — 获取该账本下所有科目（树形结构）
   - `POST /books/{id}/accounts` — 新增自定义科目
   - `PUT /accounts/{id}` — 编辑科目
   - `DELETE /accounts/{id}` — 停用科目（软删除）
3. `services/account_service.py`：注册时自动执行 seed 脚本，为新账本灌入预置科目
4. 返回科目时按 `type` 分组（asset / liability / equity / income / expense），支持树形层级

**前端：**
1. `stores/bookStore.ts`：当前账本状态
2. `stores/accountStore.ts`：科目列表，按五大类分组
3. `app/accounts/index.tsx`：科目列表页（按类型分组展示，图标+名称+余额方向）
4. `app/accounts/[id].tsx`：科目详情/编辑页
5. `components/entry/AccountPicker.tsx`：科目选择器组件（记账时复用）

**验证标准：** 注册后自动有 30+ 预置科目，能查看五大类科目树，能新增自定义子科目。

---

### 阶段 4：记账核心（预计 4 天）⭐ 最关键阶段

**目标：** 6 种记账操作全部可用，每笔自动生成复式分录且借贷平衡。

**后端：**
1. `services/entry_service.py` — 核心记账逻辑：
   - `create_expense()` — 记费用：借费用科目，贷资产/负债科目
   - `create_income()` — 记收入：借资产科目，贷收入科目
   - `create_asset_purchase()` — 购买资产：借资产科目，贷资产/负债科目
   - `create_borrow()` — 借入/贷款：借资产科目，贷负债科目
   - `create_repayment()` — 还款：借负债+利息费用，贷资产科目
   - `create_transfer()` — 账户互转：借目标资产，贷来源资产
2. **平衡校验**：每笔分录入库前校验 `SUM(debit) == SUM(credit)`，不平衡则拒绝
3. `routers/entries.py`：
   - `POST /books/{id}/entries` — 创建分录（传入 entry_type + 表单字段，自动生成 journal_lines）
   - `GET /books/{id}/entries` — 分录列表（支持分页、按日期/类型/科目筛选）
   - `GET /entries/{id}` — 分录详情（含 lines 明细）
   - `PUT /entries/{id}` — 编辑分录
   - `DELETE /entries/{id}` — 删除分录
4. Swagger 测试所有 9 个典型场景（PRD 2.3 节），验证分录正确性

**前端：**
1. `app/entry/new.tsx`：记账主页面
   - 顶部 Tab 切换 6 种类型（费用/收入/购买资产/借入/还款/转账）
   - 每种类型显示对应表单字段
2. `components/entry/AmountInput.tsx`：大数字金额输入键盘
3. `components/entry/AccountPicker.tsx`：科目选择弹窗（按类型过滤）
4. `components/entry/EntryTypeTab.tsx`：6 种记账类型 Tab
5. `app/(tabs)/ledger.tsx`：分录列表页（按日期分组、筛选 Tab）
6. `components/entry/EntryCard.tsx`：分录卡片（图标+摘要+金额+净资产影响标识）
7. `app/entry/[id].tsx`：分录详情/编辑页

**验证标准：** 能完成 PRD 中全部 9 个典型场景的记账操作，每笔分录借贷平衡，列表展示正确。

---

### 阶段 5：资产负债表 & 损益表（预计 3 天）

**目标：** 两张核心报表可用，数据从分录实时汇算。

**后端：**
1. `services/report_service.py`：
   - `get_balance_sheet(book_id, date)` — 资产负债表：
     - 遍历所有资产/负债/净资产类科目
     - 汇总每个科目截至指定日期的余额（`SUM(debit) - SUM(credit)` 或反向）
     - 计算本期损益 = 收入合计 - 费用合计
     - 校验：资产合计 == 负债合计 + 净资产合计
   - `get_income_statement(book_id, start_date, end_date)` — 损益表：
     - 汇总时间段内所有收入科目贷方合计
     - 汇总时间段内所有费用科目借方合计
     - 本期损益 = 收入 - 费用
2. `routers/reports.py`：
   - `GET /books/{id}/balance-sheet?date=` — 资产负债表
   - `GET /books/{id}/income-statement?start=&end=` — 损益表

**前端：**
1. `app/reports/balance-sheet.tsx`：资产负债表页面
2. `components/reports/BalanceSheetTable.tsx`：T 型布局组件（左资产、右负债+净资产）
3. `app/reports/income-statement.tsx`：损益表页面
4. `components/reports/IncomeStatement.tsx`：收入/费用分项展示
5. `app/(tabs)/reports.tsx`：报表入口页（Tab 切换资产负债表/损益表/趋势）
6. 日期选择器：支持查看任意历史时点

**验证标准：** 记几笔账后，资产负债表左右平衡（资产 = 负债 + 净资产），损益表收入-费用=本期损益与资产负债表一致。

---

### 阶段 6：总览仪表盘 & 统计图表（预计 3 天）

**目标：** 首页 Dashboard 展示净资产、本月损益、图表。

**后端：**
1. `routers/reports.py` 补充：
   - `GET /books/{id}/dashboard` — 返回净资产、本月收入/费用/损益、较上月变化
   - `GET /books/{id}/net-worth-trend?months=12` — 近 N 个月净资产趋势数据
   - `GET /books/{id}/expense-breakdown?start=&end=` — 费用分类占比
   - `GET /books/{id}/asset-allocation` — 资产配置占比

**前端：**
1. `app/(tabs)/index.tsx`：Dashboard 首页
   - 净资产大字 + 涨跌标识
   - 迷你资产负债表卡片
   - 本月损益卡片
   - 费用预算进度条（预留，后续填充）
   - 近期 5 条分录
2. `components/reports/NetWorthBadge.tsx`：净资产大数字展示组件
3. `components/charts/LineChart.tsx`：净资产趋势折线图
4. `components/charts/PieChart.tsx`：费用分类饼图 / 资产配置饼图
5. `components/charts/BarChart.tsx`：收入 vs 费用柱状图
6. `components/charts/ChartWebView.tsx`：原生端 ECharts WebView 容器
7. `app/reports/trends.tsx`：趋势分析详情页

**验证标准：** 首页展示正确的净资产和本月损益数据，图表可交互，数据与报表一致。

---

### 阶段 7：手动对账 & 待处理队列（预计 3 天）

**目标：** 用户能手动输入外部余额，系统自动生成调节分录，用户能分类确认。

**后端：**
1. `adapters/base.py`：DataSourceAdapter 抽象基类
2. `adapters/manual_input.py`：ManualInputAdapter — 接收用户输入的余额快照
3. `services/reconciliation_service.py`：
   - `create_snapshot(account_id, external_balance)` — 记录外部余额快照
   - `calculate_difference()` — 差异 = 外部余额 - 账本余额
   - `generate_reconciliation_entry()` — 差异 ≠ 0 时自动生成调节分录（待分类费用/收入）
   - `confirm_reconciliation(entry_id, target_account_id)` — 用户确认分类
   - `split_reconciliation(entry_id, splits)` — 拆分调节分录
4. `routers/sync.py`：
   - `POST /accounts/{id}/snapshot` — 提交余额快照
   - `GET /books/{id}/pending-reconciliations` — 获取待处理队列
   - `PUT /entries/{id}/confirm` — 确认调节分录分类
   - `POST /entries/{id}/split` — 拆分调节分录

**前端：**
1. `app/sync/reconcile.tsx`：待处理队列页面
2. `components/sync/ReconcileCard.tsx`：调节卡片（日期、科目、差异金额、建议分类、操作按钮）
3. `components/sync/BalanceCompare.tsx`：账本余额 vs 外部余额对比展示
4. 科目详情页增加"更新真实余额"入口
5. Dashboard 增加待处理角标

**验证标准：** 手工记 100 元费用 → 输入银行真实余额（差 200）→ 系统生成 100 元待分类费用 → 用户确认分类为"交通出行"→ 资产负债表平衡。

---

### 阶段 8：深色模式 & 响应式适配 & 我的页面 & 收尾（预计 3 天）

**目标：** 完善用户体验，桌面端布局优化，MVP 全部功能可用。

**前端：**
1. `theme/colors.ts` + `theme/dark.ts`：浅色/深色主题切换
2. 桌面端布局优化：
   - Dashboard 网格布局（净资产+损益卡片 / 趋势图+饼图 / 近期分录+待处理）
   - 账本主从布局（左侧分录列表 + 右侧分录详情）
   - 报表资产负债表左右对照式、损益表右侧并排饼图
   - 我的页面分栏布局（左侧菜单 + 右侧详情区）
   - 记账弹窗：移动端全屏 → 桌面端居中 Modal（max-width 560px）
3. 桌面端交互增强：
   - 键盘快捷键：`N` 新建记账、`/` 聚焦搜索、`Esc` 关闭弹窗
   - 表格右键菜单（编辑/删除/复制）
   - 图表 hover 提示 + 点击钻取
   - 多选分录批量删除/分类
4. `app/(tabs)/profile.tsx`：我的页面
   - 个人信息展示/编辑
   - 科目管理入口
   - 外部账户管理入口
   - 固定资产管理入口（预留）
   - 贷款管理入口（预留）
   - 预算设置入口（预留）
   - 数据导入/导出入口（预留）
   - 设置（货币、深色模式开关、通知）
5. 全局样式统一：金额数字等宽字体、正向红色/负向绿色（A 股配色）
6. 空状态页面处理（无分录、无科目时的引导）
7. 加载状态、错误提示统一处理

**后端：**
1. `PUT /auth/profile` — 更新个人信息
2. API 错误响应格式统一
3. 数据库索引优化（常用查询：按 book_id + entry_date 查分录等）

**验证标准：** 深色模式正常切换，我的页面功能入口完整，全流程无明显 bug。

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 项目初始化 & 基础设施 | 2 天 | 2 天 |
| 2 | 用户认证 | 2 天 | 4 天 |
| 3 | 科目体系 & 账本 | 2 天 | 6 天 |
| 4 | 记账核心（6 种操作）⭐ | 4 天 | 10 天 |
| 5 | 资产负债表 & 损益表 | 3 天 | 13 天 |
| 6 | 总览仪表盘 & 统计图表 | 3 天 | 16 天 |
| 7 | 手动对账 & 待处理队列 | 3 天 | 19 天 |
| 8 | 深色模式 & 响应式适配 & 收尾 | 3 天 | 22 天 |

> MVP 总计约 **22 个工作日（约 4.5 周）**。以上为一人全栈开发的估算，实际节奏可根据个人情况调整。

---

## 3. 数据模型

### 用户表 (users)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| email | VARCHAR | 邮箱 |
| password_hash | VARCHAR | 密码哈希 |
| nickname | VARCHAR | 昵称 |
| avatar_url | VARCHAR | 头像 |
| currency | VARCHAR | 默认货币（CNY） |
| created_at | TIMESTAMP | 创建时间 |

### 账本表 (books)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| name | VARCHAR | 账本名称 |
| type | ENUM | personal / family |
| owner_id | UUID | 创建者 |
| created_at | TIMESTAMP | 创建时间 |

### 账本成员表 (book_members)
| 字段 | 类型 | 说明 |
|------|------|------|
| book_id | UUID | 账本ID |
| user_id | UUID | 用户ID |
| role | ENUM | admin / member |

### 科目表 (accounts)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| code | VARCHAR | 科目代码（如 1001） |
| name | VARCHAR | 科目名称 |
| type | ENUM | asset / liability / equity / income / expense |
| parent_id | UUID | 父科目（用于子科目层级） |
| balance_direction | ENUM | debit / credit（余额方向） |
| icon | VARCHAR | 图标标识 |
| is_system | BOOLEAN | 是否系统预置科目 |
| sort_order | INT | 排序 |
| is_active | BOOLEAN | 是否启用 |
| has_external_source | BOOLEAN | 是否关联了外部数据源 |
| created_at | TIMESTAMP | 创建时间 |

### 分录主表 (journal_entries)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| user_id | UUID | 记账人 |
| entry_date | DATE | 分录日期 |
| entry_type | ENUM | expense / income / asset_purchase / borrow / repay / transfer / depreciation / reconciliation / manual |
| description | VARCHAR | 摘要描述 |
| note | VARCHAR | 备注 |
| image_urls | JSON | 图片列表 |
| is_balanced | BOOLEAN | 是否平衡（校验字段） |
| reconciliation_status | ENUM | none / pending / confirmed | 对账状态（none=手工分录，pending=待确认调节，confirmed=已确认调节） |
| source | ENUM | manual / sync / reconciliation | 来源（手工/同步/对账调节） |
| created_at | TIMESTAMP | 创建时间 |
| updated_at | TIMESTAMP | 更新时间 |

### 分录明细表 (journal_lines)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| entry_id | UUID | 所属分录 |
| account_id | UUID | 科目 |
| debit_amount | DECIMAL(15,2) | 借方金额 |
| credit_amount | DECIMAL(15,2) | 贷方金额 |
| description | VARCHAR | 行描述 |

> **约束**：每条 journal_entry 的所有 lines 的 `SUM(debit_amount)` 必须等于 `SUM(credit_amount)`

### 固定资产表 (fixed_assets)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| account_id | UUID | 关联资产科目 |
| name | VARCHAR | 资产名称（如"iPhone 16"） |
| purchase_date | DATE | 购入日期 |
| original_cost | DECIMAL(15,2) | 原值 |
| residual_rate | DECIMAL(5,2) | 残值率（如 5%） |
| useful_life_months | INT | 折旧月数 |
| depreciation_method | ENUM | straight_line / none | 折旧方式 |
| accumulated_depreciation | DECIMAL(15,2) | 累计折旧 |
| status | ENUM | active / disposed | 状态 |
| created_at | TIMESTAMP | 创建时间 |

### 贷款表 (loans)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| account_id | UUID | 关联负债科目 |
| name | VARCHAR | 贷款名称（如"房贷"） |
| principal | DECIMAL(15,2) | 贷款本金 |
| remaining_principal | DECIMAL(15,2) | 剩余本金 |
| annual_rate | DECIMAL(6,4) | 年利率 |
| total_months | INT | 贷款总期数 |
| repaid_months | INT | 已还期数 |
| monthly_payment | DECIMAL(15,2) | 月供金额 |
| repayment_method | ENUM | equal_installment / equal_principal | 等额本息/等额本金 |
| start_date | DATE | 起始日期 |
| status | ENUM | active / paid_off | 状态 |
| created_at | TIMESTAMP | 创建时间 |

### 预算表 (budgets)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| account_id | UUID | 费用科目（NULL为总预算） |
| amount | DECIMAL(15,2) | 预算金额 |
| period | VARCHAR | 周期（monthly） |

### 外部数据源表 (data_sources)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| book_id | UUID | 所属账本 |
| account_id | UUID | 关联的科目（资产/负债类） |
| source_type | ENUM | manual / csv_import / open_banking / broker_api / exchange_api |
| provider_name | VARCHAR | 提供商名称（如"招商银行"、"中信证券"） |
| config | JSON | 连接配置（API key、账号等，加密存储） |
| sync_frequency | ENUM | manual / daily / realtime |
| last_sync_at | TIMESTAMP | 上次同步时间 |
| status | ENUM | active / disconnected / error |
| created_at | TIMESTAMP | 创建时间 |

### 余额快照表 (balance_snapshots)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| data_source_id | UUID | 关联数据源 |
| account_id | UUID | 关联科目 |
| snapshot_date | DATE | 快照日期 |
| external_balance | DECIMAL(15,2) | 外部真实余额 |
| book_balance | DECIMAL(15,2) | 当时的账本余额 |
| difference | DECIMAL(15,2) | 差异（外部 - 账本） |
| status | ENUM | balanced / pending / reconciled | 状态 |
| reconciliation_entry_id | UUID | 关联的调节分录（如已生成） |
| created_at | TIMESTAMP | 创建时间 |

### 外部交易流水表 (external_transactions)
| 字段 | 类型 | 说明 |
|------|------|------|
| id | UUID | 主键 |
| data_source_id | UUID | 关联数据源 |
| account_id | UUID | 关联科目 |
| transaction_date | DATE | 交易日期 |
| amount | DECIMAL(15,2) | 交易金额（正=收入，负=支出） |
| description | VARCHAR | 交易描述/摘要（银行原始摘要） |
| counterparty | VARCHAR | 对方名称 |
| matched_entry_id | UUID | 匹配的手工分录ID（NULL=未匹配） |
| match_status | ENUM | unmatched / matched / reconciled | 匹配状态 |
| created_at | TIMESTAMP | 创建时间 |

---

## 4. 设计规范

### 4.1 色彩
- 主色：`#4F46E5`（靛蓝色，沉稳专业）
- 资产色/正向：`#EF4444`（红色，资产增长、收入，与 A 股涨色一致）
- 负债色/负向：`#10B981`（绿色，负债、费用，与 A 股跌色一致）
- 中性/转换：`#6B7280`（灰色，资产互转等）
- 背景色：`#F9FAFB`（浅灰）
- 深色模式背景：`#111827`

### 4.2 字体
- 金额数字：DIN / Roboto Mono（等宽字体）
- 正文：系统默认字体（-apple-system, PingFang SC）

### 4.3 交互原则
- 简单模式优先：用户无需理解借/贷概念即可记账
- 净资产影响可视化：每笔记录标注对净资产的影响（+/-/不变）
- 金额输入使用自定义数字键盘
- 资产负债表支持点击下钻查看科目明细
- 删除操作需确认
- 重要数据变更有 Toast 反馈
- **响应式适配**：移动端底部 Tab + 浮动记账按钮，桌面端左侧边栏 + 顶栏记账按钮
- **桌面端增强**：键盘快捷键（N=记账, /=搜索, Esc=关闭）、右键菜单、hover 提示、批量操作
- **内容密度**：移动端卡片式大字体，桌面端表格式紧凑布局

### 4.4 设计亮点
- 首页突出**净资产**数字，让用户一眼看到"家底"
- 费用 vs 资产支出用不同色彩区分，强化"买资产≠花钱"的认知
- 资产负债表采用经典 T 型布局，简洁专业
- 支持一键在"简单模式"和"专业模式"间切换
