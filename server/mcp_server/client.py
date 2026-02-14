import httpx
from .config import config


class HAClient:
    """家庭记账 REST API 客户端"""

    def __init__(self):
        self._base_url: str | None = None
        self._headers: dict[str, str] | None = None

    @property
    def base_url(self) -> str:
        if self._base_url is None:
            self._base_url = config.server_url.rstrip("/")
        return self._base_url

    @property
    def headers(self) -> dict[str, str]:
        if self._headers is None:
            self._headers = config.auth_header
        return self._headers

    async def _request(self, method: str, path: str, **kwargs) -> dict:
        async with httpx.AsyncClient(base_url=self.base_url, headers=self.headers) as client:
            response = await client.request(method, path, **kwargs)
            if response.status_code == 204:
                return {"success": True}
            if response.status_code >= 400:
                detail = response.json().get("detail", response.text)
                raise Exception(f"API 错误 ({response.status_code}): {detail}")
            return response.json()

    # ─── 记账 ──────────────────────────────

    async def batch_create_entries(self, plugin_id: str, book_id: str, entries: list[dict]) -> dict:
        return await self._request("POST", f"/plugins/{plugin_id}/entries/batch", json={
            "book_id": book_id,
            "entries": entries,
        })

    async def list_entries(self, book_id: str, **params) -> dict:
        return await self._request("GET", f"/books/{book_id}/entries", params=params)

    async def get_entry(self, entry_id: str) -> dict:
        return await self._request("GET", f"/entries/{entry_id}")

    async def delete_entry(self, entry_id: str) -> dict:
        return await self._request("DELETE", f"/entries/{entry_id}")

    # ─── 报表 ──────────────────────────────

    async def get_balance_sheet(self, book_id: str, as_of_date: str | None = None) -> dict:
        params = {}
        if as_of_date:
            params["date"] = as_of_date
        return await self._request("GET", f"/books/{book_id}/balance-sheet", params=params)

    async def get_income_statement(self, book_id: str, start_date: str | None = None, end_date: str | None = None) -> dict:
        params = {}
        if start_date:
            params["start"] = start_date
        if end_date:
            params["end"] = end_date
        return await self._request("GET", f"/books/{book_id}/income-statement", params=params)

    async def get_dashboard(self, book_id: str) -> dict:
        return await self._request("GET", f"/books/{book_id}/dashboard")

    # ─── 同步 ──────────────────────────────

    async def submit_snapshot(self, account_id: str, external_balance: float, snapshot_date: str) -> dict:
        return await self._request("POST", f"/accounts/{account_id}/snapshot", json={
            "external_balance": external_balance,
            "snapshot_date": snapshot_date,
        })

    # ─── 管理 ──────────────────────────────

    async def list_accounts(self, book_id: str) -> dict:
        return await self._request("GET", f"/books/{book_id}/accounts")

    async def list_plugins(self) -> list:
        return await self._request("GET", "/plugins")

    async def register_plugin(self, name: str, plugin_type: str, description: str) -> dict:
        return await self._request("POST", "/plugins", json={
            "name": name,
            "type": plugin_type,
            "description": description,
        })

    async def list_books(self) -> list:
        return await self._request("GET", "/books")


ha_client = HAClient()
