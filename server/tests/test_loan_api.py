"""贷款管理 API — 功能测试

覆盖：创建贷款、查看还款计划、记录还款、提前还款、验证剩余本金。
等额本息和等额本金两种方式都测试。
"""

from datetime import date

import pytest
from httpx import AsyncClient

from app.models.loan import Loan
from app.models.account import Account
from app.models.book import Book


# ═══════════════════════════════════════════
# 计算引擎单元测试
# ═══════════════════════════════════════════


class TestLoanCalculation:

    def test_equal_installment_payment(self):
        """等额本息月供计算"""
        from app.services.loan_service import calc_equal_installment_payment
        # 10 万, 4.9%, 360 期
        payment = calc_equal_installment_payment(100000, 4.9, 360)
        assert 530 <= payment <= 535  # 约 530.33

    def test_equal_installment_zero_rate(self):
        """零利率等额本息"""
        from app.services.loan_service import calc_equal_installment_payment
        payment = calc_equal_installment_payment(12000, 0, 12)
        assert payment == 1000.0

    def test_equal_principal_first_payment(self):
        """等额本金首期月供"""
        from app.services.loan_service import calc_equal_principal_first_payment
        # 12 万, 4.8%, 12 期
        payment = calc_equal_principal_first_payment(120000, 4.8, 12)
        # 本金 10000 + 利息 120000*0.004=480 = 10480
        assert payment == pytest.approx(10480, abs=1)

    def test_schedule_equal_installment(self):
        """等额本息还款计划表"""
        from app.services.loan_service import generate_schedule
        schedule = generate_schedule(12000, 12, 12, "equal_installment", date(2025, 1, 15))
        assert len(schedule) == 12
        # 第一期
        assert schedule[0]["period"] == 1
        assert schedule[0]["payment_date"] == date(2025, 1, 15)
        # 最后一期剩余本金应为 0
        assert schedule[-1]["remaining"] == pytest.approx(0, abs=0.02)
        # 总还款 > 本金
        total_payment = sum(i["payment"] for i in schedule)
        assert total_payment > 12000

    def test_schedule_equal_principal(self):
        """等额本金还款计划表"""
        from app.services.loan_service import generate_schedule
        schedule = generate_schedule(12000, 12, 12, "equal_principal", date(2025, 1, 15))
        assert len(schedule) == 12
        # 每期本金基本相同
        assert schedule[0]["principal"] == 1000.0
        # 利息递减
        assert schedule[0]["interest"] > schedule[-1]["interest"]
        # 最后一期剩余 0
        assert schedule[-1]["remaining"] == pytest.approx(0, abs=0.02)

    def test_total_interest(self):
        """利息总额"""
        from app.services.loan_service import calc_total_interest
        interest = calc_total_interest(100000, 4.9, 360, "equal_installment", date(2025, 1, 1))
        assert interest > 0
        # 30 年房贷利息应该是可观的
        assert interest > 80000


# ═══════════════════════════════════════════
# API 集成测试
# ═══════════════════════════════════════════


class TestLoanCRUD:

    @pytest.mark.asyncio
    async def test_create_loan_equal_installment(
        self, client: AsyncClient, auth_headers, test_book: Book, liability_account: Account
    ):
        """POST /books/{book_id}/loans — 创建等额本息贷款"""
        payload = {
            "name": "房贷",
            "account_id": liability_account.id,
            "principal": 100000,
            "annual_rate": 4.9,
            "total_months": 360,
            "repayment_method": "equal_installment",
            "start_date": "2025-01-15",
        }
        resp = await client.post(f"/books/{test_book.id}/loans", json=payload, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["name"] == "房贷"
        assert data["principal"] == 100000
        assert data["remaining_principal"] == 100000
        assert data["repayment_method"] == "equal_installment"
        assert data["status"] == "active"
        assert data["repaid_months"] == 0
        assert data["monthly_payment"] > 0
        assert data["total_interest"] > 0

    @pytest.mark.asyncio
    async def test_create_loan_equal_principal(
        self, client: AsyncClient, auth_headers, test_book: Book, liability_account: Account
    ):
        """POST /books/{book_id}/loans — 创建等额本金贷款"""
        payload = {
            "name": "车贷",
            "account_id": liability_account.id,
            "principal": 50000,
            "annual_rate": 3.6,
            "total_months": 36,
            "repayment_method": "equal_principal",
            "start_date": "2025-02-01",
        }
        resp = await client.post(f"/books/{test_book.id}/loans", json=payload, headers=auth_headers)
        assert resp.status_code == 201
        data = resp.json()
        assert data["repayment_method"] == "equal_principal"
        assert data["status"] == "active"

    @pytest.mark.asyncio
    async def test_list_loans(
        self, client: AsyncClient, auth_headers, test_book: Book, sample_loan: Loan
    ):
        """GET /books/{book_id}/loans — 贷款列表"""
        resp = await client.get(f"/books/{test_book.id}/loans", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) >= 1
        assert data[0]["name"] == sample_loan.name

    @pytest.mark.asyncio
    async def test_get_loan(
        self, client: AsyncClient, auth_headers, sample_loan: Loan
    ):
        """GET /loans/{loan_id}"""
        resp = await client.get(f"/loans/{sample_loan.id}", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["id"] == sample_loan.id
        assert data["account_name"]  # 应有科目名

    @pytest.mark.asyncio
    async def test_update_loan(
        self, client: AsyncClient, auth_headers, sample_loan: Loan
    ):
        """PUT /loans/{loan_id}"""
        resp = await client.put(
            f"/loans/{sample_loan.id}",
            json={"name": "改名后的贷款"},
            headers=auth_headers,
        )
        assert resp.status_code == 200
        assert resp.json()["name"] == "改名后的贷款"

    @pytest.mark.asyncio
    async def test_delete_loan(
        self, client: AsyncClient, auth_headers, test_book: Book, liability_account: Account
    ):
        """DELETE /loans/{loan_id}"""
        # 先创建
        resp = await client.post(
            f"/books/{test_book.id}/loans",
            json={
                "name": "临时贷款",
                "account_id": liability_account.id,
                "principal": 1000,
                "annual_rate": 5,
                "total_months": 12,
                "start_date": "2025-01-01",
            },
            headers=auth_headers,
        )
        loan_id = resp.json()["id"]
        # 删除
        resp = await client.delete(f"/loans/{loan_id}", headers=auth_headers)
        assert resp.status_code == 204
        # 确认已删
        resp = await client.get(f"/loans/{loan_id}", headers=auth_headers)
        assert resp.status_code == 404


class TestRepaymentSchedule:

    @pytest.mark.asyncio
    async def test_get_schedule(
        self, client: AsyncClient, auth_headers, sample_loan: Loan
    ):
        """GET /loans/{loan_id}/schedule"""
        resp = await client.get(f"/loans/{sample_loan.id}/schedule", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert len(data) == sample_loan.total_months
        assert data[0]["period"] == 1
        assert data[0]["is_paid"] is False
        assert data[-1]["remaining"] == pytest.approx(0, abs=0.02)


class TestRepayment:

    @pytest.mark.asyncio
    async def test_repay_one_period(
        self, client: AsyncClient, auth_headers, sample_loan: Loan,
        bank_account: Account, interest_expense_account: Account,
    ):
        """POST /loans/{loan_id}/repay — 还一期"""
        resp = await client.post(
            f"/loans/{sample_loan.id}/repay",
            json={
                "payment_account_id": bank_account.id,
                "interest_account_id": interest_expense_account.id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        assert data["remaining_principal"] < float(sample_loan.principal)
        assert data["status"] == "active"
        assert "entry_id" in data

    @pytest.mark.asyncio
    async def test_repay_all_periods_paid_off(
        self, client: AsyncClient, auth_headers, test_book: Book,
        liability_account: Account, bank_account: Account, interest_expense_account: Account,
    ):
        """还完所有期数后状态变为 paid_off"""
        # 创建 3 期短贷
        resp = await client.post(
            f"/books/{test_book.id}/loans",
            json={
                "name": "短期借款",
                "account_id": liability_account.id,
                "principal": 3000,
                "annual_rate": 12,
                "total_months": 3,
                "start_date": "2025-06-01",
            },
            headers=auth_headers,
        )
        loan_id = resp.json()["id"]

        # 还 3 期
        for _ in range(3):
            resp = await client.post(
                f"/loans/{loan_id}/repay",
                json={
                    "payment_account_id": bank_account.id,
                    "interest_account_id": interest_expense_account.id,
                },
                headers=auth_headers,
            )
            assert resp.status_code == 201

        # 检查状态
        last = resp.json()
        assert last["status"] == "paid_off"
        assert last["remaining_principal"] == pytest.approx(0, abs=0.02)

    @pytest.mark.asyncio
    async def test_repay_already_paid_off(
        self, client: AsyncClient, auth_headers, test_book: Book,
        liability_account: Account, bank_account: Account, interest_expense_account: Account,
    ):
        """已结清贷款不能再还款"""
        resp = await client.post(
            f"/books/{test_book.id}/loans",
            json={
                "name": "微贷",
                "account_id": liability_account.id,
                "principal": 1000,
                "annual_rate": 0,
                "total_months": 1,
                "start_date": "2025-06-01",
            },
            headers=auth_headers,
        )
        loan_id = resp.json()["id"]
        # 还 1 期
        await client.post(
            f"/loans/{loan_id}/repay",
            json={"payment_account_id": bank_account.id},
            headers=auth_headers,
        )
        # 再还 → 失败
        resp = await client.post(
            f"/loans/{loan_id}/repay",
            json={"payment_account_id": bank_account.id},
            headers=auth_headers,
        )
        assert resp.status_code == 400


class TestPrepayment:

    @pytest.mark.asyncio
    async def test_prepay(
        self, client: AsyncClient, auth_headers, sample_loan: Loan,
        bank_account: Account,
    ):
        """POST /loans/{loan_id}/prepay — 提前还款"""
        resp = await client.post(
            f"/loans/{sample_loan.id}/prepay",
            json={
                "amount": 5000,
                "payment_account_id": bank_account.id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 201
        data = resp.json()
        expected_remaining = float(sample_loan.principal) - 5000
        assert data["remaining_principal"] == pytest.approx(expected_remaining, abs=0.02)

    @pytest.mark.asyncio
    async def test_prepay_full(
        self, client: AsyncClient, auth_headers, test_book: Book,
        liability_account: Account, bank_account: Account,
    ):
        """提前全额还款"""
        resp = await client.post(
            f"/books/{test_book.id}/loans",
            json={
                "name": "全额提前还",
                "account_id": liability_account.id,
                "principal": 10000,
                "annual_rate": 5,
                "total_months": 12,
                "start_date": "2025-06-01",
            },
            headers=auth_headers,
        )
        loan_id = resp.json()["id"]

        resp = await client.post(
            f"/loans/{loan_id}/prepay",
            json={"amount": 10000, "payment_account_id": bank_account.id},
            headers=auth_headers,
        )
        assert resp.status_code == 201
        assert resp.json()["status"] == "paid_off"
        assert resp.json()["remaining_principal"] == 0

    @pytest.mark.asyncio
    async def test_prepay_exceed(
        self, client: AsyncClient, auth_headers, sample_loan: Loan,
        bank_account: Account,
    ):
        """提前还款金额超过剩余本金"""
        resp = await client.post(
            f"/loans/{sample_loan.id}/prepay",
            json={
                "amount": float(sample_loan.principal) + 1000,
                "payment_account_id": bank_account.id,
            },
            headers=auth_headers,
        )
        assert resp.status_code == 400


class TestLoanSummary:

    @pytest.mark.asyncio
    async def test_get_summary(
        self, client: AsyncClient, auth_headers, test_book: Book, sample_loan: Loan
    ):
        """GET /books/{book_id}/loans/summary"""
        resp = await client.get(f"/books/{test_book.id}/loans/summary", headers=auth_headers)
        assert resp.status_code == 200
        data = resp.json()
        assert data["total_principal"] == float(sample_loan.principal)
        assert data["total_remaining"] == float(sample_loan.remaining_principal)
        assert data["loan_count"] == 1
        assert data["active_count"] == 1
