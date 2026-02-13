from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.account import Account
from app.schemas.account import AccountTreeNode, AccountTreeResponse


async def get_accounts_by_book(db: AsyncSession, book_id: str) -> list[Account]:
    """获取账本下所有活跃科目"""
    result = await db.execute(
        select(Account)
        .where(Account.book_id == book_id, Account.is_active == True)
        .order_by(Account.type, Account.sort_order, Account.code)
    )
    return list(result.scalars().all())


def _account_to_node(acc: Account) -> AccountTreeNode:
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
        children=[],
    )


def build_account_tree(accounts: list[Account]) -> AccountTreeResponse:
    """将扁平科目列表构建为按 type 分组的树形结构"""
    node_map: dict[str, AccountTreeNode] = {}
    for acc in accounts:
        node_map[acc.id] = _account_to_node(acc)

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


async def create_custom_account(
    db: AsyncSession,
    book_id: str,
    code: str,
    name: str,
    acc_type: str,
    balance_direction: str,
    parent_id: str | None = None,
    icon: str | None = None,
    sort_order: int = 0,
) -> Account:
    """新增自定义科目"""
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
    return account


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
    """软删除（停用）科目"""
    account.is_active = False
    await db.flush()
    await db.refresh(account)
    return account
