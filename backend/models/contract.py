import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, Text, Enum
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from .base import Base


class Contract(Base):
    __tablename__ = "contracts"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    payer_name: Mapped[str] = mapped_column(String(255), nullable=False)
    cms_contract_id: Mapped[str | None] = mapped_column(String(50))
    cms_star_rating: Mapped[float | None] = mapped_column(Float)
    payment_model: Mapped[str | None] = mapped_column(
        Enum("quality_bonus", "quality_withhold", "shared_savings", name="payment_model_enum")
    )
    payment_model_params: Mapped[dict | None] = mapped_column(JSONB)
    upload_date: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    blob_url: Mapped[str | None] = mapped_column(Text)
    extraction_status: Mapped[str] = mapped_column(
        Enum("queued", "extracting", "review_required", "complete", "failed", name="extraction_status_enum"),
        default="queued",
    )
    extraction_confidence_avg: Mapped[float | None] = mapped_column(Float)
