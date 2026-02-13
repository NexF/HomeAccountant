"""测试公共 Fixtures —— 内存 SQLite + 独立 TestClient"""

import asyncio
import uuid
from datetime import date

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker, AsyncSession

from app.database import Base, get_db
from app.models.user import User
from app.models.book import Book, BookMember
from app.models.account import Account
from app.models.asset import FixedAsset
from app.models.loan import Loan
from app.models.journal import JournalEntry, JournalLine  # noqa: F401
from app.utils.security import hash_password, create_access_token
from app.utils.seed import seed_accounts_for_book


# ──────────── 事件循环 ────────────

@pytest.fixture(scope="session")
def event_loop():
    loop = asyncio.new_event_loop()
    yield loop
    loop.close()


# ──────────── 内存数据库引擎 ────────────

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"

test_engine = create_async_engine(TEST_DB_URL, echo=False)
TestSessionLocal = async_sessionmaker(
    test_engine, class_=AsyncSession, expire_on_commit=False
)


@pytest_asyncio.fixture(autouse=True)
async def setup_db():
    """每个测试前建表，测试后清表"""
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    yield
    async with test_engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)


async def _override_get_db():
    async with TestSessionLocal() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise


# ──────────── FastAPI TestClient ────────────

@pytest_asyncio.fixture
async def client():
    from app.main import app

    app.dependency_overrides[get_db] = _override_get_db
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    app.dependency_overrides.clear()


# ──────────── 测试用户 ────────────

@pytest_asyncio.fixture
async def test_user() -> User:
    async with TestSessionLocal() as db:
        user = User(
            id=str(uuid.uuid4()),
            email="test@example.com",
            password_hash=hash_password("password123"),
            nickname="测试用户",
        )
        db.add(user)
        await db.commit()
        await db.refresh(user)
        return user


@pytest_asyncio.fixture
async def auth_headers(test_user: User) -> dict:
    token = create_access_token(test_user.id)
    return {"Authorization": f"Bearer {token}"}


# ──────────── 测试账本 + 预置科目 ────────────

@pytest_asyncio.fixture
async def test_book(test_user: User) -> Book:
    async with TestSessionLocal() as db:
        book = Book(
            id=str(uuid.uuid4()),
            name="测试账本",
            type="personal",
            owner_id=test_user.id,
        )
        db.add(book)
        await db.flush()

        member = BookMember(
            book_id=book.id, user_id=test_user.id, role="admin"
        )
        db.add(member)

        # 灌入预置科目
        await seed_accounts_for_book(db, book.id)
        await db.commit()
        await db.refresh(book)
        return book


@pytest_asyncio.fixture
async def fixed_asset_account(test_book: Book) -> Account:
    """获取固定资产科目 (1501)"""
    async with TestSessionLocal() as db:
        from sqlalchemy import select

        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "1501",
            )
        )
        return result.scalar_one()


@pytest_asyncio.fixture
async def income_account(test_book: Book) -> Account:
    """获取其他收入科目 (4005)"""
    async with TestSessionLocal() as db:
        from sqlalchemy import select

        result = await db.execute(
            select(Account).where(
                Account.book_id == test_book.id,
                Account.code == "4005",
            )
        )
        return result.scalar_one()


# ──────────── 预创建资产 fixture ────────────

@pytest_asyncio.fixture
async def sample_asset(test_book: Book, fixed_asset_account: Account) -> FixedAsset:
    """预创建一个月度折旧资产：原值 8000，残值率 5%，36 个月"""
    async with TestSessionLocal() as db:
        asset = FixedAsset(
            id=str(uuid.uuid4()),
            book_id=test_book.id,
            account_id=fixed_asset_account.id,
            name="测试笔记本电脑",
            purchase_date=date(2025, 1, 1),
            original_cost=8000.0,
            residual_rate=5.0,
            useful_life_months=36,
            depreciation_method="straight_line",
            depreciation_granularity="monthly",
            accumulated_depreciation=0,
            status="active",
        )
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
        return asset


@pytest_asyncio.fixture
async def daily_asset(test_book: Book, fixed_asset_account: Account) -> FixedAsset:
    """预创建一个每日折旧资产：原值 8000，残值率 5%，36 个月"""
    async with TestSessionLocal() as db:
        asset = FixedAsset(
            id=str(uuid.uuid4()),
            book_id=test_book.id,
            account_id=fixed_asset_account.id,
            name="每日折旧打印机",
            purchase_date=date(2025, 1, 1),
            original_cost=8000.0,
            residual_rate=5.0,
            useful_life_months=36,
            depreciation_method="straight_line",
            depreciation_granularity="daily",
            accumulated_depreciation=0,
            status="active",
        )
        db.add(asset)
        await db.commit()
        await db.refresh(asset)
        return asset


# ──────────── 贷款相关 fixture ────────────

@pytest_asyncio.fixture
async def liability_account(test_book: Book) -> Account:
    """获取短期借款科目 (2101)"""
    async with TestSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(Account).where(Account.book_id == test_book.id, Account.code == "2101")
        )
        return result.scalar_one()


@pytest_asyncio.fixture
async def bank_account(test_book: Book) -> Account:
    """获取工商银行科目 (1002)"""
    async with TestSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(Account).where(Account.book_id == test_book.id, Account.code == "1002")
        )
        return result.scalar_one()


@pytest_asyncio.fixture
async def interest_expense_account(test_book: Book) -> Account:
    """获取利息支出科目 (5013)"""
    async with TestSessionLocal() as db:
        from sqlalchemy import select
        result = await db.execute(
            select(Account).where(Account.book_id == test_book.id, Account.code == "5013")
        )
        return result.scalar_one()


@pytest_asyncio.fixture
async def sample_loan(test_book: Book, liability_account: Account) -> Loan:
    """预创建一个等额本息贷款：12000, 12%, 12 期"""
    async with TestSessionLocal() as db:
        from app.services.loan_service import calc_equal_installment_payment
        monthly_payment = calc_equal_installment_payment(12000, 12, 12)
        loan = Loan(
            id=str(uuid.uuid4()),
            book_id=test_book.id,
            account_id=liability_account.id,
            name="测试贷款",
            principal=12000,
            remaining_principal=12000,
            annual_rate=12,
            total_months=12,
            repaid_months=0,
            monthly_payment=monthly_payment,
            repayment_method="equal_installment",
            start_date=date(2025, 1, 15),
            status="active",
        )
        db.add(loan)
        await db.commit()
        await db.refresh(loan)
        return loan
