import os
from dataclasses import dataclass


@dataclass
class MCPConfig:
    server_url: str = os.getenv("HA_SERVER_URL", "http://localhost:8000")
    auth_type: str = os.getenv("HA_AUTH_TYPE", "api_key")  # api_key | jwt_token
    api_key: str = os.getenv("HA_API_KEY", "")
    jwt_token: str = os.getenv("HA_JWT_TOKEN", "")
    default_book_id: str = os.getenv("HA_DEFAULT_BOOK_ID", "")
    transport: str = os.getenv("HA_TRANSPORT", "stdio")  # stdio | sse
    sse_port: int = int(os.getenv("HA_SSE_PORT", "3000"))

    @property
    def auth_header(self) -> dict[str, str]:
        if self.auth_type == "api_key" and self.api_key:
            return {"Authorization": f"Bearer {self.api_key}"}
        elif self.auth_type == "jwt_token" and self.jwt_token:
            return {"Authorization": f"Bearer {self.jwt_token}"}
        raise ValueError("未配置有效的认证信息，请设置 HA_API_KEY 或 HA_JWT_TOKEN")


config = MCPConfig()
