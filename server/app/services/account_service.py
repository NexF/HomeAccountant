from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.models.journal import JournalLine
from app.schemas.account import AccountTreeNode, AccountTreeResponse, MigrationInfo


class AccountError(Exception):
    def __init__(self, detail: str, status_code: int = 400):
        self.detail = detail
        self.status_code = status_code


async def get_accounts_by_book(db: AsyncSession, book_id: str) -> list[Account]:
    """获取账本下所有活跃科目"""
    result = await db.execute(
        select(Account)
        .where(Account.book_id == book_id, Account.is_active == True)
        .order_by(Account.type, Account.sort_order, Account.code)
    )
    return list(result.scalars().all())


async def _check_is_leaf(db: AsyncSession, account_id: str) -> bool:
    """检查科目是否为叶子节点（无活跃子科目）"""
    child_count_result = await db.execute(
        select(func.count()).select_from(Account).where(
            Account.parent_id == account_id,
            Account.is_active == True,
        )
    )
    return child_count_result.scalar() == 0


def _account_to_node(acc: Account, is_leaf: bool) -> AccountTreeNode:
    """将 ORM 对象手动转为 Pydantic 模型（跳过 ORM children 关系）"""
    return AccountTreeNode(
        id=acc.id,
        book_id=acc.book_id,
        code=acc.code,
        name=acc.name,
        type=acc.type,
        parent_id=acc.parent_id,
        balance_direction=acc.balance_direction,
        icon=acc.icon,
        is_system=acc.is_system,
        sort_order=acc.sort_order,
        is_active=acc.is_active,
        created_at=acc.created_at,
        is_leaf=is_leaf,
        children=[],
    )


def build_account_tree(accounts: list[Account]) -> AccountTreeResponse:
    """将扁平科目列表构建为按 type 分组的树形结构"""
    # 先收集所有有子科目的 parent_id
    parent_ids: set[str] = set()
    for acc in accounts:
        if acc.parent_id:
            parent_ids.add(acc.parent_id)

    node_map: dict[str, AccountTreeNode] = {}
    for acc in accounts:
        is_leaf = acc.id not in parent_ids
        node_map[acc.id] = _account_to_node(acc, is_leaf)

    roots: dict[str, list[AccountTreeNode]] = {
        "asset": [],
        "liability": [],
        "equity": [],
        "income": [],
        "expense": [],
    }

    for acc in accounts:
        node = node_map[acc.id]
        if acc.parent_id and acc.parent_id in node_map:
            node_map[acc.parent_id].children.append(node)
        else:
            roots[acc.type].append(node)

    return AccountTreeResponse(**roots)


async def get_account_by_id(db: AsyncSession, account_id: str) -> Account | None:
    result = await db.execute(select(Account).where(Account.id == account_id))
    return result.scalar_one_or_none()


# ─────────────────── 自动迁移 ───────────────────


async def _migrate_lines_to_fallback(
    db: AsyncSession,
    parent_account: Account,
) -> MigrationInfo:
    """当父科目变为非叶子时，将其关联的分录行迁移到「待分类」子科目"""
    # 1. 检查父科目是否有关联的 journal_lines
    line_count_result = await db.execute(
        select(func.count()).select_from(JournalLine).where(
            JournalLine.account_id == parent_account.id
        )
    )
    line_count = line_count_result.scalar()

    if line_count == 0:
        return MigrationInfo(triggered=False)

    # 2. 查找或创建待分类子科目
    fallback_code = f"{parent_account.code}-99"
    fallback_name = f"待分类{parent_account.name}"

    existing = await db.execute(
        select(Account).where(
            Account.book_id == parent_account.book_id,
            Account.code == fallback_code,
            Account.is_active == True,
        )
    )
    fallback = existing.scalar_one_or_none()

    if not fallback:
        fallback = Account(
            book_id=parent_account.book_id,
            code=fallback_code,
            name=fallback_name,
            type=parent_account.type,
            parent_id=parent_account.id,
            balance_direction=parent_account.balance_direction,
            icon="question-circle",
            is_system=True,
            sort_order=990,
        )
        db.add(fallback)
        await db.flush()

    # 3. 批量迁移 journal_lines
    await db.execute(
        update(JournalLine)
        .where(JournalLine.account_id == parent_account.id)
        .values(account_id=fallback.id)
    )

    return MigrationInfo(
        triggered=True,
        fallback_account={
            "id": fallback.id,
            "code": fallback.code,
            "name": fallback.name,
        },
        migrated_lines_count=line_count,
        message=f"已将 {line_count} 条分录从「{parent_account.name}」迁移至「{fallback_name}」",
    )


TYPE_CODE_PREFIX: dict[str, int] = {
    "asset": 1000,
    "liability": 2000,
    "equity": 3000,
    "income": 4000,
    "expense": 5000,
}


async def _generate_code(
    db: AsyncSession,
    book_id: str,
    acc_type: str,
    parent_id: str | None,
    parent_code: str | None,
) -> str:
    """自动生成科目编码。

    一级科目: 在 type 对应的千位段内自增（如 asset → 1001, 1002, ...）
    子科目: 在 parent_code 下用 "-XX" 后缀自增（如 1001-01, 1001-02）
    三级子科目: parent_code 已含 "-"，继续追加 "XX"（如 1001-0201, 1001-0202）
    """
    if parent_id and parent_code:
        # 子科目
        if "-" in parent_code:
            # 三级或更深: 追加两位数字（去掉 "-" 分隔符来拼接）
            prefix = parent_code  # e.g. "1001-02"
            like_pattern = f"{prefix}%"
            result = await db.execute(
                select(Account.code)
                .where(
                    Account.book_id == book_id,
                    Account.parent_id == parent_id,
                    Account.code.like(like_pattern),
                )
                .order_by(Account.code.desc())
            )
            existing_codes = [r[0] for r in result.all()]
            max_seq = 0
            for c in existing_codes:
                suffix = c[len(prefix):]
                if suffix.isdigit():
                    max_seq = max(max_seq, int(suffix))
            return f"{prefix}{max_seq + 1:02d}"
        else:
            # 二级: parent_code-XX
            prefix = f"{parent_code}-"
            result = await db.execute(
                select(Account.code)
                .where(
                    Account.book_id == book_id,
                    Account.parent_id == parent_id,
                    Account.code.like(f"{prefix}%"),
                )
                .order_by(Account.code.desc())
            )
            existing_codes = [r[0] for r in result.all()]
            max_seq = 0
            for c in existing_codes:
                suffix = c[len(prefix):]
                if suffix.isdigit():
                    max_seq = max(max_seq, int(suffix))
            return f"{prefix}{max_seq + 1:02d}"
    else:
        # 一级科目
        base = TYPE_CODE_PREFIX.get(acc_type, 1000)
        result = await db.execute(
            select(Account.code)
            .where(
                Account.book_id == book_id,
                Account.type == acc_type,
                Account.parent_id.is_(None),
            )
            .order_by(Account.code.desc())
        )
        existing_codes = [r[0] for r in result.all()]
        max_code = base
        for c in existing_codes:
            if c.isdigit():
                max_code = max(max_code, int(c))
        return str(max_code + 1)


async def create_custom_account(
    db: AsyncSession,
    book_id: str,
    name: str,
    acc_type: str,
    balance_direction: str,
    parent_id: str | None = None,
    icon: str | None = None,
    sort_order: int = 0,
) -> tuple[Account, MigrationInfo]:
    """新增自定义科目，编码由系统自动生成。如果父科目从叶子变为非叶子则触发自动迁移"""
    migration_info = MigrationInfo(triggered=False)
    parent_code: str | None = None

    if parent_id:
        parent = await get_account_by_id(db, parent_id)
        if parent:
            parent_code = parent.code
            is_currently_leaf = await _check_is_leaf(db, parent_id)
            if is_currently_leaf:
                migration_info = await _migrate_lines_to_fallback(db, parent)

    code = await _generate_code(db, book_id, acc_type, parent_id, parent_code)

    account = Account(
        book_id=book_id,
        code=code,
        name=name,
        type=acc_type,
        parent_id=parent_id,
        balance_direction=balance_direction,
        icon=icon,
        is_system=False,
        sort_order=sort_order,
    )
    db.add(account)
    await db.flush()
    await db.refresh(account)
    return account, migration_info


# ─────────────────── 删除/停用保护 ───────────────────


async def _check_account_deletable(db: AsyncSession, account: Account) -> None:
    """检查科目是否可以删除/停用"""
    # 检查 1: 是否有分录行引用
    line_count_result = await db.execute(
        select(func.count()).select_from(JournalLine).where(
            JournalLine.account_id == account.id
        )
    )
    line_count = line_count_result.scalar()
    if line_count > 0:
        raise AccountError(
            f"科目「{account.name}」（{account.code}）下有 {line_count} 条分录引用，"
            f"请先将这些分录迁移到其他科目后再删除"
        )

    # 检查 2: 是否有活跃子科目
    child_count_result = await db.execute(
        select(func.count()).select_from(Account).where(
            Account.parent_id == account.id,
            Account.is_active == True,
        )
    )
    child_count = child_count_result.scalar()
    if child_count > 0:
        raise AccountError(
            f"科目「{account.name}」（{account.code}）下有 {child_count} 个子科目，"
            f"请先删除或迁移子科目后再删除"
        )


async def update_account(
    db: AsyncSession,
    account: Account,
    name: str | None = None,
    icon: str | None = None,
    sort_order: int | None = None,
) -> Account:
    if name is not None:
        account.name = name
    if icon is not None:
        account.icon = icon
    if sort_order is not None:
        account.sort_order = sort_order
    await db.flush()
    await db.refresh(account)
    return account


async def deactivate_account(db: AsyncSession, account: Account) -> Account:
    """软删除（停用）科目，需通过删除保护校验"""
    await _check_account_deletable(db, account)
    account.is_active = False
    await db.flush()
    await db.refresh(account)
    return account
