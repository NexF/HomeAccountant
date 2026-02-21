"""预置五大类科目数据 - 新建账本时调用，灌入默认科目体系"""

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account


# 预置科目定义: (code, name, type, balance_direction, icon, sort_order)
PRESET_ACCOUNTS: list[tuple[str, str, str, str, str, int]] = [
    # ===== 一、资产类 =====
    ("1001", "货币资金", "asset", "debit", "cash", 100),
    ("1002", "现金等价物", "asset", "debit", "money-market", 200),
    ("1101", "应收款项", "asset", "debit", "receivable", 400),
    ("1201", "短期投资", "asset", "debit", "stock", 500),
    ("1301", "预付款项", "asset", "debit", "prepaid", 600),
    ("1501", "固定资产", "asset", "debit", "building", 700),
    ("1502", "累计折旧", "asset", "credit", "depreciation", 710),
    ("1503", "资产减值准备", "asset", "credit", "impairment", 720),
    ("1601", "长期投资", "asset", "debit", "investment", 800),

    # ===== 二、负债类 =====
    ("2001", "信用卡", "liability", "credit", "credit-card", 100),
    ("2101", "短期借款", "liability", "credit", "loan-short", 200),
    ("2201", "长期借款", "liability", "credit", "loan-long", 300),
    ("2301", "应付款项", "liability", "credit", "payable", 400),

    # ===== 三、净资产/权益类 =====
    ("3001", "期初净资产", "equity", "credit", "equity", 100),
    ("3002", "本期损益", "equity", "credit", "profit", 200),

    # ===== 四、收入类 =====
    ("4001", "工资薪金", "income", "credit", "salary", 100),
    ("4002", "兼职副业", "income", "credit", "side-job", 200),
    ("4003", "投资收益", "income", "credit", "investment-income", 300),
    ("4004", "经营收入", "income", "credit", "business", 400),
    ("4005", "其他收入", "income", "credit", "other-income", 500),
    ("4100", "待分类收入", "income", "credit", "unclassified-income", 900),

    # ===== 五、费用类 =====
    ("5001", "餐饮饮食", "expense", "debit", "food", 100),
    ("5002", "交通出行", "expense", "debit", "transport", 200),
    ("5003", "居住物业", "expense", "debit", "housing", 300),
    ("5004", "日用百货", "expense", "debit", "daily", 400),
    ("5005", "服饰美容", "expense", "debit", "clothing", 500),
    ("5006", "医疗健康", "expense", "debit", "medical", 600),
    ("5007", "教育学习", "expense", "debit", "education", 700),
    ("5008", "娱乐休闲", "expense", "debit", "entertainment", 800),
    ("5009", "人情社交", "expense", "debit", "social", 900),
    ("5010", "育儿教育", "expense", "debit", "childcare", 1000),
    ("5011", "通讯网络", "expense", "debit", "telecom", 1100),
    ("5012", "保险支出", "expense", "debit", "insurance", 1200),
    ("5013", "利息支出", "expense", "debit", "interest", 1300),
    ("5014", "折旧费用", "expense", "debit", "depreciation-expense", 1400),
    ("5015", "资产减值损失", "expense", "debit", "impairment-loss", 1500),
    ("5099", "其他费用", "expense", "debit", "other-expense", 1800),
    ("5100", "待分类费用", "expense", "debit", "unclassified-expense", 1900),
]

# 货币资金子科目 (1001 下)
CASH_SUB_ACCOUNTS: list[tuple[str, str, str]] = [
    ("1001-01", "现金", "cash"),
    ("1001-02", "存款", "bank"),
]

# 存款的三级子科目 (1001-02 下)
DEPOSIT_SUB_ACCOUNTS: list[tuple[str, str, str]] = [
    ("1001-0201", "支付宝", "alipay"),
    ("1001-0202", "微信钱包", "wechat-pay"),
]

# 现金等价物子科目 (1002 下)
CASH_EQUIV_SUB_ACCOUNTS: list[tuple[str, str, str]] = [
    ("1002-01", "货币基金", "money-fund"),
    ("1002-02", "短期国债", "treasury-bond"),
]

# 信用卡子科目
CREDIT_CARD_SUB_ACCOUNTS: list[tuple[str, str, str]] = [
]


async def seed_accounts_for_book(db: AsyncSession, book_id: str) -> list[Account]:
    """为指定账本灌入预置科目体系，返回创建的科目列表"""
    created_accounts: list[Account] = []
    parent_map: dict[str, str] = {}  # code -> account.id

    # 1. 创建所有一级科目
    for code, name, acc_type, direction, icon, sort in PRESET_ACCOUNTS:
        account = Account(
            book_id=book_id,
            code=code,
            name=name,
            type=acc_type,
            balance_direction=direction,
            icon=icon,
            is_system=True,
            sort_order=sort,
        )
        db.add(account)
        created_accounts.append(account)

    # flush 使 id 写入数据库
    await db.flush()

    # flush 后建立 code -> id 映射
    for acc in created_accounts:
        parent_map[acc.code] = acc.id

    # 2. 创建二级子科目
    sub_account_groups = [
        ("1001", CASH_SUB_ACCOUNTS, "asset", "debit"),
        ("1002", CASH_EQUIV_SUB_ACCOUNTS, "asset", "debit"),
        ("2001", CREDIT_CARD_SUB_ACCOUNTS, "liability", "credit"),
    ]

    for parent_code, sub_accounts, acc_type, direction in sub_account_groups:
        parent_id = parent_map.get(parent_code)
        for idx, (code, name, icon) in enumerate(sub_accounts):
            sub = Account(
                book_id=book_id,
                code=code,
                name=name,
                type=acc_type,
                parent_id=parent_id,
                balance_direction=direction,
                icon=icon,
                is_system=True,
                sort_order=(idx + 1) * 10,
            )
            db.add(sub)
            created_accounts.append(sub)

    await db.flush()

    # 更新 parent_map（二级科目的 id 也需要记录，用于创建三级科目）
    for acc in created_accounts:
        parent_map[acc.code] = acc.id

    # 3. 创建三级子科目（存款下的银行/支付账户）
    deposit_parent_id = parent_map.get("1001-02")
    for idx, (code, name, icon) in enumerate(DEPOSIT_SUB_ACCOUNTS):
        sub = Account(
            book_id=book_id,
            code=code,
            name=name,
            type="asset",
            parent_id=deposit_parent_id,
            balance_direction="debit",
            icon=icon,
            is_system=True,
            sort_order=(idx + 1) * 10,
        )
        db.add(sub)
        created_accounts.append(sub)

    await db.flush()
    return created_accounts
