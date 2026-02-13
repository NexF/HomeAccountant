"""DataSourceAdapter 抽象基类 — 定义数据源适配器接口"""

from abc import ABC, abstractmethod
from datetime import date
from decimal import Decimal


class DataSourceAdapter(ABC):
    """
    数据源适配器抽象基类。
    每种外部数据源（手工输入、CSV 导入、银行 API 等）需实现此接口。
    """

    @abstractmethod
    async def fetch_balance(self, account_id: str, as_of_date: date) -> Decimal:
        """获取指定科目在指定日期的外部余额"""
        ...

    @abstractmethod
    async def fetch_transactions(
        self, account_id: str, start_date: date, end_date: date
    ) -> list[dict]:
        """
        获取指定科目在时间段内的外部交易列表。
        返回格式：[{date, amount, description, counterparty}, ...]
        """
        ...

    @abstractmethod
    async def validate_connection(self) -> bool:
        """验证数据源连接是否有效"""
        ...
