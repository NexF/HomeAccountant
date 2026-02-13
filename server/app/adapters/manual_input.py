"""ManualInputAdapter — 接收用户手动输入的余额快照"""

from datetime import date
from decimal import Decimal

from .base import DataSourceAdapter


class ManualInputAdapter(DataSourceAdapter):
    """
    手动输入适配器。
    用户在前端输入某个科目的真实余额，系统据此计算差异并生成调节分录。
    """

    def __init__(self, external_balance: Decimal):
        self._balance = external_balance

    async def fetch_balance(self, account_id: str, as_of_date: date) -> Decimal:
        """直接返回用户输入的余额"""
        return self._balance

    async def fetch_transactions(
        self, account_id: str, start_date: date, end_date: date
    ) -> list[dict]:
        """手动输入模式不提供交易明细"""
        return []

    async def validate_connection(self) -> bool:
        """手动输入始终有效"""
        return True
