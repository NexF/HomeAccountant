import uuid
from datetime import datetime

from sqlalchemy import (
    String, DateTime, Boolean, ForeignKey, Text, Integer,
    UniqueConstraint, func,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Plugin(Base):
    __tablename__ = "plugins"
    __table_args__ = (
        UniqueConstraint("user_id", "name", name="uq_plugins_user_name"),
    )

    id: Mapped[str] = mapped_column(
        String(36), primary_key=True, default=lambda: str(uuid.uuid4())
    )
    user_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("users.id"), nullable=False, index=True
    )
    api_key_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("api_keys.id"), nullable=False
    )
    name: Mapped[str] = mapped_column(String(100), nullable=False)
    type: Mapped[str] = mapped_column(String(10), nullable=False)  # entry / balance / both
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    last_sync_at: Mapped[datetime | None] = mapped_column(DateTime, nullable=True)
    last_sync_status: Mapped[str] = mapped_column(String(10), default="idle")
    last_error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    sync_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime, server_default=func.now(), onupdate=datetime.utcnow, nullable=False
    )

    # 关系
    user = relationship("User", backref="plugins")
    api_key = relationship("ApiKey", back_populates="plugins")
