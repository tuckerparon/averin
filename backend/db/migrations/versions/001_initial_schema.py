"""initial schema

Revision ID: 001
Revises:
Create Date: 2026-06-03
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import UUID, JSONB
import uuid

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")

    op.create_table(
        "contracts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("payer_name", sa.String(255), nullable=False),
        sa.Column("cms_contract_id", sa.String(50)),
        sa.Column("cms_star_rating", sa.Float),
        sa.Column("payment_model", sa.Enum("quality_bonus", "quality_withhold", "shared_savings", name="payment_model_enum")),
        sa.Column("payment_model_params", JSONB),
        sa.Column("upload_date", sa.DateTime, server_default=sa.func.now()),
        sa.Column("blob_url", sa.Text),
        sa.Column("extraction_status", sa.Enum("queued", "extracting", "review_required", "complete", "failed", name="extraction_status_enum"), server_default="queued"),
        sa.Column("extraction_confidence_avg", sa.Float),
    )

    op.create_table(
        "metrics",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("measure_name", sa.String(255), nullable=False),
        sa.Column("measure_code", sa.String(50)),
        sa.Column("standard_code", sa.String(50)),
        sa.Column("target_value", sa.Float),
        sa.Column("target_operator", sa.String(5)),
        sa.Column("target_unit", sa.String(50)),
        sa.Column("measurement_period", sa.String(50)),
        sa.Column("denominator_definition", sa.Text),
        sa.Column("numerator_definition", sa.Text),
        sa.Column("exclusion_criteria", JSONB),
        sa.Column("icd10_codes", JSONB),
        sa.Column("loinc_codes", JSONB),
        sa.Column("contract_source_text", sa.Text),
        sa.Column("financial_weight_pp", sa.Float),
        sa.Column("extraction_confidence", sa.Float),
    )

    op.create_table(
        "contract_chunks",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("contract_id", UUID(as_uuid=True), sa.ForeignKey("contracts.id", ondelete="CASCADE"), nullable=False),
        sa.Column("metric_id", UUID(as_uuid=True), sa.ForeignKey("metrics.id", ondelete="SET NULL")),
        sa.Column("chunk_text", sa.Text, nullable=False),
        sa.Column("chunk_metadata", JSONB),
        sa.Column("embedding", sa.Text),  # placeholder until pgvector column type wired
    )

    op.create_table(
        "performance_gaps",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("metric_id", UUID(as_uuid=True), sa.ForeignKey("metrics.id", ondelete="CASCADE"), nullable=False),
        sa.Column("numerator_count", sa.Integer),
        sa.Column("denominator_count", sa.Integer),
        sa.Column("rate", sa.Float),
        sa.Column("gap_pp", sa.Float),
        sa.Column("status", sa.String(20)),
        sa.Column("opportunity_flag", sa.String(10)),
        sa.Column("opportunity_dollars", sa.Float),
        sa.Column("cms_star_impact", sa.Float),
        sa.Column("clinical_actions", JSONB),
        sa.Column("computed_at", sa.DateTime, server_default=sa.func.now()),
        sa.Column("measurement_period_start", sa.DateTime),
        sa.Column("measurement_period_end", sa.DateTime),
    )

    op.create_table(
        "chat_sessions",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("user_id", sa.String(255)),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )

    op.create_table(
        "chat_messages",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
        sa.Column("session_id", UUID(as_uuid=True), sa.ForeignKey("chat_sessions.id", ondelete="CASCADE"), nullable=False),
        sa.Column("role", sa.String(20), nullable=False),
        sa.Column("content", sa.Text, nullable=False),
        sa.Column("created_at", sa.DateTime, server_default=sa.func.now()),
    )


def downgrade():
    op.drop_table("chat_messages")
    op.drop_table("chat_sessions")
    op.drop_table("performance_gaps")
    op.drop_table("contract_chunks")
    op.drop_table("metrics")
    op.drop_table("contracts")
    op.execute("DROP TYPE IF EXISTS payment_model_enum")
    op.execute("DROP TYPE IF EXISTS extraction_status_enum")
