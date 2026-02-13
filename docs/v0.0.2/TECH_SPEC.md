# 家庭记账 - 技术方案文档 (Tech Spec)

> **版本：v0.0.2**
> **创建日期：2026-02-13**
> **基于版本：v0.0.1 (MVP)**
> **状态：阶段1、2已完成，阶段3规划中**
> **本版本新增功能：固定资产折旧管理、贷款管理 & 还款计划、预算管理 & 提醒**

---

## 1. 技术架构概述

v0.0.2 在 v0.0.1 的技术栈基础上进行增量开发，无架构层面的变更：

- **前端**：React Native + Expo + TypeScript + Zustand
- **后端**：Python FastAPI + SQLAlchemy + SQLite
- **部署**：与 v0.0.1 一致

### 1.1 v0.0.1 已有基础

以下模块在 v0.0.1 中**已实现**，v0.0.2 直接复用：

| 层 | 模块 | 说明 |
|----|------|------|
| Model | `models/asset.py` | `FixedAsset` ORM 模型（表结构已定义） |
| Model | `models/loan.py` | `Loan` ORM 模型（表结构已定义） |
| Model | `models/budget.py` | `Budget` ORM 模型（表结构已定义，需扩展） |
| 前端 | `profile.tsx` 菜单 | 固定资产/贷款管理/预算设置已有占位菜单项（标注"即将推出"） |

以下模块在 v0.0.1 中**未实现**，需要在 v0.0.2 新建：

| 层 | 模块 | 需要新建 |
|----|------|---------|
| Schema | `schemas/asset.py` | Pydantic 请求/响应模型 |
| Schema | `schemas/loan.py` | Pydantic 请求/响应模型 |
| Schema | `schemas/budget.py` | Pydantic 请求/响应模型 |
| Router | `routers/assets.py` | 固定资产 CRUD API |
| Router | `routers/loans.py` | 贷款 CRUD API |
| Router | `routers/budgets.py` | 预算 CRUD API |
| Service | `services/depreciation_service.py` | 折旧计算引擎 |
| Service | `services/loan_service.py` | 贷款计算引擎（还款计划生成） |
| Service | `services/budget_service.py` | 预算检查 & 提醒 |
| Task | `tasks/depreciation.py` | 月度自动折旧定时任务 |
| 前端页面 | `app/assets/` | 固定资产列表/详情/新建 |
| 前端页面 | `app/loans/` | 贷款列表/详情/新建 |
| 前端页面 | `app/settings/budget.tsx` | 预算设置 |
| 前端服务 | `services/assetService.ts` | 固定资产 API 调用层 |
| 前端服务 | `services/loanService.ts` | 贷款 API 调用层 |
| 前端服务 | `services/budgetService.ts` | 预算 API 调用层 |
| 前端 Store | `stores/assetStore.ts` | 固定资产状态管理 |
| 前端 Store | `stores/loanStore.ts` | 贷款状态管理 |
| 前端 Store | `stores/budgetStore.ts` | 预算状态管理 |

---

## 2. 数据模型变更

### 2.1 `fixed_assets` 表 — 需新增字段

v0.0.1 定义的表结构需新增折旧粒度字段：

```python
class FixedAsset(Base):
    __tablename__ = "fixed_assets"
    id: str                          # UUID 主键
    book_id: str                     # FK → books.id
    account_id: str                  # FK → accounts.id（关联固定资产科目）
    name: str                        # 资产名称
    purchase_date: date              # 购入日期
    original_cost: Decimal(15,2)     # 原值
    residual_rate: Decimal(5,2)      # 残值率（默认 5%）
    useful_life_months: int          # 使用寿命（月）
    depreciation_method: Enum        # straight_line / none
    depreciation_granularity: Enum   # monthly / daily（v0.0.2 新增，默认 monthly）
    accumulated_depreciation: Decimal # 累计折旧
    status: Enum                     # active / disposed
    created_at: datetime
```

**数据库迁移：**
```sql
ALTER TABLE fixed_assets ADD COLUMN depreciation_granularity VARCHAR(10) DEFAULT 'monthly';
```

### 2.2 `loans` 表 — 无变更

v0.0.1 定义的表结构完全满足需求，无需修改。

```python
class Loan(Base):
    __tablename__ = "loans"
    id: str                          # UUID 主键
    book_id: str                     # FK → books.id
    account_id: str                  # FK → accounts.id（关联负债科目）
    name: str                        # 贷款名称
    principal: Decimal(15,2)         # 贷款本金
    remaining_principal: Decimal     # 剩余本金
    annual_rate: Decimal(6,4)        # 年利率
    total_months: int                # 贷款总期数
    repaid_months: int               # 已还期数
    monthly_payment: Decimal         # 月供金额
    repayment_method: Enum           # equal_installment / equal_principal
    start_date: date                 # 起始日期
    status: Enum                     # active / paid_off
    created_at: datetime
```

### 2.3 `budgets` 表 — 需扩展

v0.0.1 的表结构较简单，需新增字段：

```python
class Budget(Base):
    __tablename__ = "budgets"
    # 已有字段
    id: str                          # UUID 主键
    book_id: str                     # FK → books.id
    account_id: str | None           # FK → accounts.id（NULL=总预算）
    amount: Decimal(15,2)            # 预算金额
    period: str                      # 'monthly'

    # v0.0.2 新增字段
    alert_threshold: Decimal(3,2)    # 提醒阈值（默认 0.80，即 80%）
    is_active: bool                  # 是否启用（默认 True）
    created_at: datetime             # 创建时间
    updated_at: datetime             # 更新时间
```

**数据库迁移方案：**

直接通过 SQLAlchemy 的 `ALTER TABLE` 添加新列，或在应用启动时检测并自动迁移：

```sql
ALTER TABLE budgets ADD COLUMN alert_threshold DECIMAL(3,2) DEFAULT 0.80;
ALTER TABLE budgets ADD COLUMN is_active BOOLEAN DEFAULT 1;
ALTER TABLE budgets ADD COLUMN created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE budgets ADD COLUMN updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP;
```

---

## 3. 后端 API 设计

### 3.1 固定资产 API (`routers/assets.py`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/books/{book_id}/assets` | 获取固定资产列表（支持 `?status=active` 筛选） |
| `GET` | `/assets/{id}` | 获取固定资产详情（含折旧历史） |
| `POST` | `/books/{book_id}/assets` | 新建固定资产 |
| `PUT` | `/assets/{id}` | 更新固定资产信息 |
| `POST` | `/assets/{id}/depreciate` | 手动触发折旧（计提一个月） |
| `POST` | `/assets/{id}/dispose` | 处置资产（传入处置收入金额） |
| `GET` | `/assets/{id}/depreciation-history` | 获取折旧历史列表 |
| `GET` | `/books/{book_id}/assets/summary` | 获取资产汇总（总原值、总累计折旧、总净值） |

#### 3.1.1 Schema 定义 (`schemas/asset.py`)

```python
class AssetCreate(BaseModel):
    name: str
    account_id: str
    purchase_date: date
    original_cost: float            # > 0
    residual_rate: float = 5.0      # 0-100
    useful_life_months: int         # > 0
    depreciation_method: str = "straight_line"  # straight_line / none
    depreciation_granularity: str = "monthly"   # monthly / daily

class AssetUpdate(BaseModel):
    name: str | None = None
    residual_rate: float | None = None
    useful_life_months: int | None = None
    depreciation_method: str | None = None
    depreciation_granularity: str | None = None

class AssetResponse(BaseModel):
    id: str
    book_id: str
    account_id: str
    account_name: str               # 关联科目名称
    name: str
    purchase_date: date
    original_cost: float
    residual_rate: float
    useful_life_months: int
    depreciation_method: str
    depreciation_granularity: str
    accumulated_depreciation: float
    net_book_value: float           # 计算字段：原值 - 累计折旧
    period_depreciation: float      # 计算字段：每期折旧额（月或日）
    remaining_months: int           # 计算字段：剩余寿命月数
    depreciation_percentage: float  # 计算字段：折旧进度百分比
    status: str
    created_at: datetime

class AssetDispose(BaseModel):
    disposal_income: float          # 处置收入（可为 0）
    disposal_date: date
    income_account_id: str          # 收款科目（如银行存款）

class AssetSummary(BaseModel):
    total_original_cost: float
    total_accumulated_depreciation: float
    total_net_book_value: float
    asset_count: int
    active_count: int

class DepreciationRecord(BaseModel):
    period: str                     # "2026-02"（月度）或 "2026-02-13"（每日）
    amount: float                   # 当期折旧额
    accumulated: float              # 截至当期累计折旧
    net_value: float                # 截至当期净值
    entry_id: str | None            # 关联的分录ID
```

### 3.2 贷款 API (`routers/loans.py`) — ✅ 已实现

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/books/{book_id}/loans` | 获取贷款列表（支持 `?status=active` 筛选） |
| `GET` | `/loans/{id}` | 获取贷款详情 |
| `POST` | `/books/{book_id}/loans` | 新建贷款（可选 `deposit_account_id` 自动生成入账分录） |
| `PUT` | `/loans/{id}` | 更新贷款信息 |
| `DELETE` | `/loans/{id}` | 删除贷款 |
| `GET` | `/loans/{id}/schedule` | 获取完整还款计划表 |
| `POST` | `/loans/{id}/repay` | 记录一期还款（自动拆分本金/利息，生成分录） |
| `POST` | `/loans/{id}/prepay` | 提前还款（传入金额，直接冲减本金） |
| `GET` | `/books/{book_id}/loans/summary` | 获取贷款汇总（总贷款额、总剩余本金、已付利息等） |

#### 3.2.1 Schema 定义 (`schemas/loan.py`)

```python
class LoanCreate(BaseModel):
    name: str
    account_id: str                 # 关联负债科目
    principal: float                # > 0
    annual_rate: float              # >= 0，百分比
    total_months: int               # > 0
    repayment_method: str = "equal_installment"  # equal_installment / equal_principal
    start_date: date
    deposit_account_id: str | None = None  # 放款到资产账户 ID（可选，提供则自动生成借款入账分录）

class LoanUpdate(BaseModel):
    name: str | None = None
    annual_rate: float | None = None

class LoanResponse(BaseModel):
    id: str
    book_id: str
    account_id: str
    account_name: str               # 关联科目名称
    name: str
    principal: float
    remaining_principal: float
    annual_rate: float
    total_months: int
    repaid_months: int
    monthly_payment: float
    repayment_method: str
    start_date: date
    status: str
    total_interest: float           # 计算字段：利息总额
    created_at: datetime

class RepaymentScheduleItem(BaseModel):
    period: int                     # 期数
    payment_date: date              # 还款日
    payment: float                  # 月供
    principal: float                # 本金部分
    interest: float                 # 利息部分
    remaining: float                # 剩余本金
    is_paid: bool                   # 是否已还

class LoanRepayRequest(BaseModel):
    payment_account_id: str         # 还款资产账户 ID
    interest_account_id: str | None = None  # 利息费用科目 ID
    repay_date: date | None = None  # 还款日期（默认今天）

class LoanPrepayRequest(BaseModel):
    amount: float                   # > 0，提前还款金额
    payment_account_id: str         # 还款资产账户 ID
    interest_account_id: str | None = None
    prepay_date: date | None = None

class LoanSummary(BaseModel):
    total_principal: float
    total_remaining: float
    total_paid_principal: float
    total_interest_paid: float
    loan_count: int
    active_count: int
```

### 3.3 预算 API (`routers/budgets.py`)

| 方法 | 路径 | 说明 |
|------|------|------|
| `GET` | `/books/{book_id}/budgets` | 获取预算列表（含当月使用情况） |
| `GET` | `/budgets/{id}` | 获取单条预算详情 |
| `POST` | `/books/{book_id}/budgets` | 新建预算 |
| `PUT` | `/budgets/{id}` | 更新预算（金额/阈值） |
| `DELETE` | `/budgets/{id}` | 删除预算 |
| `GET` | `/books/{book_id}/budgets/overview` | 获取预算总览（总预算使用率 + 各分类使用率） |
| `POST` | `/books/{book_id}/budgets/check` | 检查某笔费用是否触发预算提醒（记账时调用） |

#### 3.3.1 Schema 定义 (`schemas/budget.py`)

```python
class BudgetCreate(BaseModel):
    account_id: str | None = None   # NULL=总预算
    amount: float                   # > 0
    alert_threshold: float = 0.80   # 0-1.0

class BudgetUpdate(BaseModel):
    amount: float | None = None
    alert_threshold: float | None = None
    is_active: bool | None = None

class BudgetResponse(BaseModel):
    id: str
    book_id: str
    account_id: str | None
    account_name: str | None        # 关联科目名称（总预算为 None）
    amount: float
    period: str
    alert_threshold: float
    is_active: bool
    # 当月使用情况（实时计算）
    used_amount: float              # 当月已用
    usage_rate: float               # 使用率（0-1+，可超 1）
    remaining: float                # 剩余额度（可为负）
    status: str                     # "normal" / "warning" / "exceeded"

class BudgetOverview(BaseModel):
    total_budget: float | None      # 总预算金额（如果设了）
    total_used: float               # 当月费用总额
    total_usage_rate: float | None  # 总使用率
    total_status: str               # "normal" / "warning" / "exceeded" / "not_set"
    category_budgets: list[BudgetResponse]  # 各分类预算

class BudgetCheckResult(BaseModel):
    triggered: bool                 # 是否触发提醒
    alerts: list[BudgetAlert]       # 触发的提醒列表

class BudgetAlert(BaseModel):
    budget_id: str
    account_name: str | None
    budget_amount: float
    used_amount: float
    usage_rate: float
    alert_type: str                 # "warning" / "exceeded"
    message: str                    # 提醒文案
```

---

## 4. 核心业务逻辑

### 4.1 折旧计算服务 (`services/depreciation_service.py`)

```python
class DepreciationService:

    def calculate_period_depreciation(asset: FixedAsset) -> float:
        """
        计算每期折旧额（直线法）
        - monthly: (原值 × (1 - 残值率)) / 使用寿命月数
        - daily:   (原值 × (1 - 残值率)) / (使用寿命月数 × 30)
        """
        if asset.depreciation_method == "none":
            return 0
        depreciable_amount = asset.original_cost * (1 - asset.residual_rate / 100)
        if asset.depreciation_granularity == "daily":
            return round(depreciable_amount / (asset.useful_life_months * 30), 2)
        return round(depreciable_amount / asset.useful_life_months, 2)

    def can_depreciate(asset: FixedAsset) -> bool:
        """判断资产是否可以继续折旧"""
        if asset.status != "active":
            return False
        if asset.depreciation_method == "none":
            return False
        max_depreciation = asset.original_cost * (1 - asset.residual_rate / 100)
        return asset.accumulated_depreciation < max_depreciation

    def depreciate_one_period(asset_id: str, period: str) -> JournalEntry:
        """
        为指定资产计提一期折旧（一个月或一天，取决于 depreciation_granularity）
        1. 校验资产可折旧
        2. 计算每期折旧额
        3. 创建分录：借：折旧费用(5014) / 贷：累计折旧(1502)
        4. 更新 accumulated_depreciation
        5. 如累计折旧已达上限，不再折旧
        """

    def depreciate_all_active_monthly(book_id: str, month: str) -> list[JournalEntry]:
        """
        为账本下所有 granularity=monthly 的活跃资产批量计提折旧
        月度定时任务调用
        """

    def depreciate_all_active_daily(book_id: str, date: str) -> list[JournalEntry]:
        """
        为账本下所有 granularity=daily 的活跃资产批量计提折旧
        每日定时任务调用
        """

    def dispose_asset(
        asset_id: str,
        disposal_income: float,
        disposal_date: date,
        income_account_id: str
    ) -> JournalEntry:
        """
        处置资产
        1. 计算处置损益 = 处置收入 - (原值 - 累计折旧)
        2. 生成处置分录
        3. 更新资产状态为 disposed
        """

    def get_depreciation_history(asset_id: str) -> list[DepreciationRecord]:
        """获取折旧历史（从分录表中查询 entry_type=depreciation 的记录）"""
```

### 4.2 贷款计算服务 (`services/loan_service.py`) — ✅ 已实现

```python
# ─── 计算引擎 ───

def calc_equal_installment_payment(principal, annual_rate, total_months) -> float:
    """等额本息月供 = P × r × (1+r)^n / ((1+r)^n - 1)，零利率时 = P/n"""

def calc_equal_principal_first_payment(principal, annual_rate, total_months) -> float:
    """等额本金首月月供 = P/n + P×r"""

def generate_schedule(principal, annual_rate, total_months, repayment_method, start_date, repaid_months=0) -> list[dict]:
    """生成完整还款计划表，每期包含：期数、还款日、月供、本金、利息、剩余本金、是否已还"""

def calc_total_interest(principal, annual_rate, total_months, repayment_method, start_date) -> float:
    """计算利息总额"""

# ─── CRUD ───

async def create_loan(
    db, book_id, account_id, name, principal, annual_rate,
    total_months, repayment_method, start_date,
    deposit_account_id=None, user_id=None
) -> Loan:
    """
    创建贷款
    1. 校验负债科目存在且为 liability 类型
    2. 校验放款资产账户（若提供）存在且为 asset 类型
    3. 计算月供
    4. 创建 Loan 记录
    5. 若提供 deposit_account_id + user_id，自动生成借款入账分录：
       借：资产账户（deposit_account_id）  本金
         贷：负债账户（account_id）        本金
       entry_type = 'borrow'
    """

# ─── 记录还款 ───

async def record_repayment(db, loan, payment_account_id, interest_account_id, user_id, repay_date) -> JournalEntry:
    """
    记录一期还款（按还款计划自动计算本金和利息）
    1. 根据还款计划获取当期本金/利息
    2. 生成分录：借：负债科目(本金) + 利息支出 / 贷：资产账户
    3. 更新 remaining_principal, repaid_months
    4. 若还清则 status = 'paid_off'
    """

async def record_prepayment(db, loan, amount, payment_account_id, interest_account_id, user_id, prepay_date) -> JournalEntry:
    """
    提前还款（直接偿还本金）
    1. 校验金额不超过剩余本金
    2. 生成分录：借：负债科目(本金) / 贷：资产账户
    3. 更新 remaining_principal
    4. 若还清则 status = 'paid_off'
    """
```

### 4.3 预算检查服务 (`services/budget_service.py`)

```python
class BudgetService:

    def get_month_expense(
        book_id: str,
        account_id: str | None,
        year_month: str
    ) -> float:
        """
        获取某月某科目（或全部费用）的实际支出
        查询 journal_lines 中关联费用科目的借方合计
        """

    def get_budget_status(budget: Budget) -> BudgetResponse:
        """
        获取预算当前状态（使用额、使用率、剩余、状态标识）
        status: "normal"（< 阈值）/ "warning"（≥ 阈值且 < 100%）/ "exceeded"（≥ 100%）
        """

    def get_overview(book_id: str) -> BudgetOverview:
        """获取预算总览（总预算 + 各分类预算使用情况）"""

    def check_budget_after_expense(
        book_id: str,
        account_id: str,
        amount: float
    ) -> BudgetCheckResult:
        """
        记账后预算检查
        1. 查找该科目相关的预算（分类预算 + 总预算）
        2. 计算加入本笔费用后的使用率
        3. 如果使用率跨越阈值或超 100%，触发提醒
        返回 BudgetCheckResult，前端据此弹 Toast
        """
```

---

## 5. 定时任务

### 5.1 月度自动折旧 (`tasks/depreciation.py`)

```python
async def run_monthly_depreciation():
    """
    每月 1 日凌晨 00:05 执行
    为所有活跃账本中 status=active 且 depreciation_method=straight_line
    且 depreciation_granularity=monthly 的固定资产自动生成上月的折旧分录

    流程：
    1. 查询所有 granularity=monthly 的活跃固定资产
    2. 对每个资产检查是否可折旧（未达上限、未处置）
    3. 检查是否已生成过该月折旧（防重复）
    4. 调用 depreciation_service.depreciate_one_period()
    5. 记录执行日志
    """

async def run_daily_depreciation():
    """
    每日凌晨 00:05 执行
    为所有活跃账本中 status=active 且 depreciation_method=straight_line
    且 depreciation_granularity=daily 的固定资产自动生成前一日的折旧分录

    流程：
    1. 查询所有 granularity=daily 的活跃固定资产
    2. 对每个资产检查是否可折旧（未达上限、未处置）
    3. 检查是否已生成过该日折旧（防重复）
    4. 调用 depreciation_service.depreciate_one_period()
    5. 记录执行日志
    """
```

**定时任务实现方案：**

使用 `APScheduler` 库集成到 FastAPI：

```python
# main.py
from apscheduler.schedulers.asyncio import AsyncIOScheduler

scheduler = AsyncIOScheduler()

@app.on_event("startup")
async def start_scheduler():
    # 月度折旧：每月1日
    scheduler.add_job(
        run_monthly_depreciation,
        "cron",
        day=1, hour=0, minute=5,
        id="monthly_depreciation"
    )
    # 每日折旧：每天执行
    scheduler.add_job(
        run_daily_depreciation,
        "cron",
        hour=0, minute=5,
        id="daily_depreciation"
    )
    scheduler.start()
```

依赖新增：`requirements.txt` 添加 `APScheduler>=3.10`

---

## 6. 前端实现

### 6.1 新增文件清单

```
client/
├── app/
│   ├── assets/
│   │   ├── index.tsx              # 固定资产列表
│   │   ├── [id].tsx               # 固定资产详情（折旧历史、处置）
│   │   └── new.tsx                # 新建固定资产
│   ├── loans/
│   │   ├── index.tsx              # 贷款列表
│   │   ├── [id].tsx               # 贷款详情（还款计划、还款历史）
│   │   └── new.tsx                # 新建贷款
│   └── settings/
│       └── budget.tsx             # 预算设置
├── components/
│   ├── assets/
│   │   ├── AssetCard.tsx          # 资产卡片（列表用）
│   │   └── DepreciationChart.tsx  # 折旧进度可视化
│   ├── loans/
│   │   ├── LoanCard.tsx           # 贷款卡片（列表用）
│   │   ├── RepaymentSchedule.tsx  # 还款计划表
│   │   └── LoanProgress.tsx       # 还款进度可视化
│   └── budget/
│       ├── BudgetCard.tsx         # 预算卡片（进度条）
│       ├── BudgetOverview.tsx     # 预算总览（Dashboard 用）
│       └── BudgetAlert.tsx        # 预算提醒 Toast
├── services/
│   ├── assetService.ts            # 固定资产 API
│   ├── loanService.ts             # 贷款 API
│   └── budgetService.ts           # 预算 API
└── stores/
    ├── assetStore.ts              # 固定资产状态
    ├── loanStore.ts               # 贷款状态
    └── budgetStore.ts             # 预算状态
```

### 6.2 路由注册

在 `app/_layout.tsx` 中注册新路由：

```typescript
<Stack.Screen name="assets/index" options={{ headerShown: false, title: '固定资产' }} />
<Stack.Screen name="assets/[id]" options={{ headerShown: false, title: '资产详情' }} />
<Stack.Screen name="assets/new" options={{ headerShown: false, title: '新建固定资产' }} />
<Stack.Screen name="loans/index" options={{ headerShown: false, title: '贷款管理' }} />
<Stack.Screen name="loans/[id]" options={{ headerShown: false, title: '贷款详情' }} />
<Stack.Screen name="loans/new" options={{ headerShown: false, title: '新建贷款' }} />
<Stack.Screen name="settings/budget" options={{ headerShown: false, title: '预算设置' }} />
```

### 6.3 profile.tsx 菜单更新

将三个"即将推出"菜单改为可用：

```typescript
// 桌面模式 → 右侧子面板
// 手机模式 → router.push 跳转
<MenuItem icon="building"    label="固定资产" onPress={() => handleMenuPress('assets', '/assets')} />
<MenuItem icon="credit-card" label="贷款管理" onPress={() => handleMenuPress('loans', '/loans')} />
<MenuItem icon="pie-chart"   label="预算设置" onPress={() => handleMenuPress('budget', '/settings/budget')} />
```

profile.tsx 的 `DetailPane` 类型扩展：
```typescript
type DetailPane = 'none' | 'edit-profile' | 'settings' | 'accounts' | 'assets' | 'loans' | 'budget';
```

### 6.4 Dashboard 联动

在 `app/(tabs)/index.tsx` 中新增：

**预算进度卡片：**
```typescript
// 调用 GET /books/{id}/budgets/overview
// 展示总预算进度条 + 预警分类列表
<BudgetOverview bookId={currentBookId} />
```

**贷款概览卡片：**
```typescript
// 调用 GET /books/{id}/loans/summary
// 展示本月应还总额、活跃贷款数
<LoanSummaryCard bookId={currentBookId} />
```

### 6.5 记账联动

**购买资产 → 固定资产联动（表单内联，科目驱动）：**

`app/entry/new.tsx` 中，当 `entryType === 'asset_purchase'` 时：
1. 用户选择资产科目后，前端判断所选科目的 `code` 是否为 `1501`（固定资产）
2. **若为固定资产科目**：自动展开「折旧设置」区域，资产名称为必填，其余有默认值
3. **若为其他资产科目**（如短期投资 `1201`）：隐藏折旧设置区域
4. 保存时，前端将基础字段 + 折旧设置字段（如有）一起提交到 `POST /books/{id}/entries`
5. 后端根据是否携带折旧设置字段决定是否创建 `FixedAsset` 记录

**后端变更：**

`EntryCreateRequest` schema 新增可选字段（仅 `asset_purchase` 类型且资产科目为固定资产时使用）：
```python
# 折旧设置（仅 asset_purchase + 固定资产科目时必填）
asset_name: str | None = None              # 资产名称
useful_life_months: int | None = None      # 使用寿命（月）
residual_rate: float | None = 5.0          # 残值率（默认 5%）
depreciation_method: str | None = "straight_line"  # straight_line / none
depreciation_granularity: str | None = "monthly"    # monthly / daily
```

`create_asset_purchase()` 逻辑扩展：
1. 创建分录（原有逻辑不变）
2. 后端检查 `asset_account_id` 对应的科目 code 是否为 `1501`（固定资产）：
   - **是**：校验 `asset_name` 必填，自动创建 `FixedAsset` 记录：
     - `name` = `asset_name`
     - `account_id` = `asset_account_id`
     - `purchase_date` = `entry_date`
     - `original_cost` = `amount`
     - 其余字段取请求中的折旧设置值（有默认值兜底）
   - **否**：不创建 `FixedAsset` 记录
3. 返回的 `EntryResponse` 中附带 `asset_id`（如果创建了资产记录，否则为 null）

**借入/贷款 → 贷款联动（双入口实现）：**

**入口一：记一笔 → 借入（`app/entry/new.tsx`）**
1. 用户选择"借入"类型，填写金额、负债科目、收款账户
2. 可选开启「贷款设置」面板，填写：贷款名称、年利率、还款期数、还款方式、首次还款日期
3. 开启后页面实时显示还款预估（月供、利息总额、还款总额）
4. 后端 `create_borrow()` 生成 borrow 分录后，若携带贷款参数则调用 `create_loan()` 创建贷款记录（`deposit_account_id=None` 避免重复生成分录）
5. 不开启贷款设置 = 简单借入，适用于亲友借款等无利息场景

`EntryCreateRequest` schema 新增贷款可选字段（仅 `borrow` 类型时使用）：
```python
loan_name: str | None = None              # 贷款名称
annual_rate: float | None = None          # 年利率(%)
total_months: int | None = None           # 还款总期数(月)
repayment_method: str | None = None       # equal_installment / equal_principal
start_date: date | None = None            # 首次还款日期
```

**入口二：贷款管理 → 新建贷款（`app/loans/new.tsx`）**
1. 用户填写完整贷款信息
2. 可选择"放款到账户"（资产账户），系统自动生成 `borrow` 类型分录
3. 一步完成贷款创建 + 入账

**还款 → 贷款联动（已通过贷款详情页实现）：**

`app/loans/[id].tsx` 贷款详情页中：
1. 用户点击"本期还款"，系统根据还款计划自动计算本期本金/利息
2. 用户选择还款账户和利息科目
3. 系统生成 `repay` 类型分录并更新贷款状态

**费用记账 → 预算检查：**

`app/entry/new.tsx` 中，当 `entryType === 'expense'` 时：
1. 记账成功后，调用 `POST /books/{id}/budgets/check`
2. 如果返回 `triggered=true`，弹出 Toast 提醒用户预算状态

---

## 7. 开发实施计划

共分 4 个阶段，每个阶段独立可测试。

### 阶段 1：固定资产折旧管理（预计 5 天）— ✅ 已完成

**后端（2.5 天）：**
1. `schemas/asset.py` — Pydantic 模型
2. `services/depreciation_service.py` — 折旧计算引擎
3. `routers/assets.py` — 全部 API 端点（列表/详情/独立新建/更新/手动折旧/处置/折旧历史/汇总）
4. `schemas/entry.py` — `EntryCreateRequest` 新增折旧设置可选字段（`asset_name`、`useful_life_months`、`residual_rate`、`depreciation_method`、`depreciation_granularity`）
5. `services/entry_service.py` — `create_asset_purchase()` 扩展：检查 `asset_account_id` 对应科目 code 是否为 `1501`，若是则校验 `asset_name` 必填并自动创建 `FixedAsset` 记录
6. `tasks/depreciation.py` — 月度/每日自动折旧定时任务
7. Swagger 测试：通过记账接口创建分录+资产 → 计提折旧 → 查看历史 → 处置资产

**前端（2.5 天）：**
1. `services/assetService.ts` + `stores/assetStore.ts`
2. `app/assets/index.tsx` — 资产列表（汇总卡片 + 资产卡片列表）
3. `app/assets/[id].tsx` — 资产详情（折旧信息 + 折旧历史 + 处置按钮）
4. `app/assets/new.tsx` — 新建固定资产表单（独立入口，用于从"我的→固定资产"手动添加）
5. `profile.tsx` 菜单项更新 + 桌面端 `AssetsPane` 面板
6. `entry/new.tsx` 购买资产表单科目驱动折旧设置：
   - 选择资产科目后判断 `code === '1501'`
   - 若为固定资产科目：自动展开折旧设置区域（资产名称必填，使用寿命/残值率/折旧方式/折旧粒度有默认值）
   - 若为其他资产科目：隐藏折旧设置区域
   - 保存时一次性提交，后端同时创建分录 + `FixedAsset` 记录

**验证标准：**
1. 记一笔 → 购买资产 → 选择固定资产科目 → 折旧设置自动展开 → 填写后保存 → 分录和 `FixedAsset` 记录同时创建
2. 记一笔 → 购买资产 → 选择短期投资科目 → 折旧设置不展示 → 保存 → 只创建分录，无 `FixedAsset` 记录
3. 手动计提折旧 → 资产净值正确减少 → 累计折旧达上限后停止
4. 处置资产 → 生成处置分录 → 资产状态变为 `disposed`
5. 资产负债表正确反映折旧和处置影响

---

### 阶段 2：贷款管理 & 还款计划（预计 4 天）— ✅ 已完成

**后端（已完成）：**
1. `schemas/loan.py` — Pydantic 模型（含 `deposit_account_id` 可选放款账户字段）
2. `services/loan_service.py` — 贷款计算引擎（等额本息/等额本金公式、还款计划表生成、创建贷款自动入账）
3. `routers/loans.py` — 全部 API 端点（CRUD + 还款计划 + 还款/提前还款 + 汇总）
4. `tests/test_loan_api.py` — 20 个测试全部通过（计算引擎 6 + CRUD 6 + 还款计划 1 + 还款 3 + 提前还款 3 + 汇总 1）

**前端（已完成）：**
1. `services/loanService.ts` + `stores/loanStore.ts`
2. `app/loans/index.tsx` — 贷款列表（汇总卡片 + 筛选标签 + 贷款卡片列表）
3. `app/loans/[id].tsx` — 贷款详情（基本信息 + 还款进度 + 一键还款/提前还款 + 还款计划表）
4. `app/loans/new.tsx` — 新建贷款表单（负债科目 + 放款账户 + 自动计算月供和利息总额）
5. `components/loans/RepaymentSchedule.tsx` — 还款计划表组件（横向滚动，已还/待还标识）
6. `profile.tsx` 菜单项更新 + 桌面端 `LoansPane` 面板
7. `_layout.tsx` 注册 3 个 Stack.Screen（loans/index, loans/[id], loans/new）

**已验证：** 新建贷款（含自动入账分录）→ 查看完整还款计划表 → 记录还款 → 剩余本金正确更新 → 还完后状态变为已结清。等额本息和等额本金两种方式均正确。零利率贷款支持。

---

### 阶段 3：预算管理 & 提醒（预计 3 天）

**后端（1.5 天）：**
1. `budgets` 表迁移（新增字段）
2. `models/budget.py` — 更新模型
3. `schemas/budget.py` — Pydantic 模型
4. `services/budget_service.py` — 预算检查引擎
5. `routers/budgets.py` — 全部 API 端点
6. Swagger 测试：设置总预算 → 设置分类预算 → 记费用 → 检查是否触发提醒

**前端（1.5 天）：**
1. `services/budgetService.ts` + `stores/budgetStore.ts`
2. `app/settings/budget.tsx` — 预算设置页（总预算 + 分类预算列表 + 进度条）
3. `components/budget/BudgetCard.tsx` + `BudgetOverview.tsx` + `BudgetAlert.tsx`
4. `profile.tsx` 菜单项更新
5. `entry/new.tsx` 费用记账 → 预算检查 Toast 提醒

**验证标准：** 设置餐饮预算 3000 → 记餐饮费用至 2400 → 触发 80% 预警 → 继续记到 3100 → 触发超支告警。

---

### 阶段 4：Dashboard 联动 & 收尾（预计 2 天） ✅ 已完成

**前端：**
1. ✅ Dashboard 新增预算进度卡片（`BudgetOverview` 组件）
2. ✅ Dashboard 新增贷款概览卡片（`LoanOverview` 组件：剩余本金、本月应还、还款中笔数、还款进度条、已付利息）
3. ✅ Dashboard 净资产数字反映折旧后净值（后端 `get_balance_sheet` 中资产合计使用 `debit - credit`，累计折旧科目自动为负数，净资产天然包含折旧影响）
4. ✅ 深色模式适配新增页面（所有新增组件均通过 `useColorScheme` + `Colors[colorScheme]` 动态取色）
5. ✅ 桌面端/手机端响应式布局（Dashboard 桌面端双列布局：左列趋势图+预算，右列饼图+贷款+对账；移动端单列堆叠）
6. ✅ 全流程联调测试

**验证标准：** Dashboard 正确展示预算和贷款信息，全部新增页面在桌面端和手机端均正常显示，深色模式无异常。

---

### 总体时间估算

| 阶段 | 内容 | 预计工时 | 累计 |
|------|------|---------|------|
| 1 | 固定资产折旧管理（含记账联动） | 5 天 | 5 天 |
| 2 | 贷款管理 & 还款计划 | 4 天 | 9 天 |
| 3 | 预算管理 & 提醒 | 3 天 | 12 天 |
| 4 | Dashboard 联动 & 收尾 | 2 天 | 14 天 |

> v0.0.2 总计约 **14 个工作日（约 3 周）**。

---

## 8. 依赖变更

### 8.1 后端新增依赖

```
# requirements.txt 新增
APScheduler>=3.10
python-dateutil>=2.8       # 贷款还款计划月份计算（relativedelta）
```

### 8.2 前端无新增依赖

所有 UI 组件基于现有 React Native 基础组件 + FontAwesome 图标实现，无需引入新库。

---

## 9. 测试要点

### 9.1 折旧计算测试

| 测试用例 | 预期结果 |
|---------|---------|
| 月度直线法折旧：原值 8000，残值率 5%，36 月 | 月折旧 ≈ 211.11 |
| 每日直线法折旧：原值 8000，残值率 5%，36 月 | 日折旧 ≈ 7.04（按 1080 天） |
| 折旧达上限后不再折旧 | 累计折旧 = 8000 × 0.95 = 7600 后停止 |
| 折旧方式为 none 的资产 | 不生成折旧分录 |
| 处置资产有收益 | 差额计入收入科目 |
| 处置资产有损失 | 差额计入费用科目 |
| 同一期不重复折旧 | 检测已有分录则跳过（月度按月、每日按日） |
| 月度定时任务不处理 daily 资产 | granularity=daily 的资产跳过 |
| 每日定时任务不处理 monthly 资产 | granularity=monthly 的资产跳过 |

### 9.2 贷款计算测试 — ✅ 已通过（20/20）

| 测试用例 | 预期结果 |
|---------|---------|
| 等额本息：12000，12%，12月 | 月供 ≈ 1066.19 |
| 等额本息零利率：12000，0%，12月 | 月供 = 1000.00 |
| 等额本金：12000，12%，12月 | 首月 ≈ 1120.00 |
| 还款计划表最后一期 | 剩余本金 = 0 |
| 利息总额计算 | 等额本息利息 ≈ 794.25 |
| 创建贷款 + 自动入账分录 | 负债科目余额正确增加 |
| 记录还款后 | remaining_principal 正确减少 |
| 提前还款 | remaining_principal 直接冲减 |
| 提前还款超额 | 返回 400 错误 |
| 全部还完 | status = paid_off |
| 已结清贷款继续还款 | 返回 400 错误 |

### 9.3 预算检查测试

| 测试用例 | 预期结果 |
|---------|---------|
| 费用未达阈值 | status = normal，不触发提醒 |
| 费用达到 80% 阈值 | status = warning，触发预警 |
| 费用超过 100% | status = exceeded，触发超支告警 |
| 无预算时记账 | 不触发任何提醒 |
| 总预算 + 分类预算同时触发 | 两条提醒都返回 |
| 购买资产不算费用预算 | asset_purchase 类型不触发预算检查 |
