import uuid
from datetime import datetime
from sqlalchemy import String, Float, DateTime, Text, ForeignKey
from sqlalchemy.orm import Mapped, mapped_column
from sqlalchemy.dialects.postgresql import UUID, JSONB
from .base import Base


class PerformanceGap(Base):
    __tablename__ = "performance_gaps"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    metric_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("metrics.id", ondelete="CASCADE"))
    numerator_count: Mapped[int | None]
    denominator_count: Mapped[int | None]
    rate: Mapped[float | None] = mapped_column(Float)
    gap_pp: Mapped[float | None] = mapped_column(Float)
    status: Mapped[str | None] = mapped_column(
        String(20)  # failing | at_risk | on_track
    )
    opportunity_flag: Mapped[str | None] = mapped_column(String(10))  # CLOSEABLE | NEGOTIATE
    opportunity_dollars: Mapped[float | None] = mapped_column(Float)
    cms_star_impact: Mapped[float | None] = mapped_column(Float)
    clinical_actions: Mapped[list | None] = mapped_column(JSONB)
    computed_at: Mapped[datetime] = mapped_column(DateTime, default=datetime.utcnow)
    measurement_period_start: Mapped[datetime | None] = mapped_column(DateTime)
    measurement_period_end: Mapped[datetime | None] = mapped_column(DateTime)
