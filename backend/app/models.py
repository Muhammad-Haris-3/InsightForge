import uuid
from datetime import datetime

from sqlalchemy import CheckConstraint, ForeignKey, LargeBinary, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Session(Base):
    __tablename__ = "sessions"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    last_active_at: Mapped[datetime] = mapped_column(server_default=func.now())

    datasets: Mapped[list["Dataset"]] = relationship(back_populates="session", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    session_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("sessions.id", ondelete="CASCADE"), nullable=False)
    original_filename: Mapped[str] = mapped_column(nullable=False)
    row_count: Mapped[int] = mapped_column(nullable=False)
    column_count: Mapped[int] = mapped_column(nullable=False)
    file_size_bytes: Mapped[int] = mapped_column(nullable=False)
    raw_csv: Mapped[bytes] = mapped_column(LargeBinary, nullable=False)
    upload_time: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("row_count >= 0", name="ck_datasets_row_count"),
        CheckConstraint("column_count >= 0", name="ck_datasets_column_count"),
        CheckConstraint("file_size_bytes > 0 AND file_size_bytes <= 10485760", name="ck_datasets_file_size"),
    )

    session: Mapped["Session"] = relationship(back_populates="datasets")
    columns_profile: Mapped[list["ColumnProfile"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")
    test_results: Mapped[list["TestResult"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")
    model_runs: Mapped[list["ModelRun"]] = relationship(back_populates="dataset", cascade="all, delete-orphan")


class ColumnProfile(Base):
    __tablename__ = "columns_profile"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    column_name: Mapped[str] = mapped_column(nullable=False)
    data_type: Mapped[str] = mapped_column(nullable=False)
    missing_count: Mapped[int] = mapped_column(default=0)
    missing_pct: Mapped[float] = mapped_column(default=0)
    unique_count: Mapped[int] = mapped_column(default=0)
    outlier_count: Mapped[int | None] = mapped_column(default=None)
    summary_stats: Mapped[dict | None] = mapped_column(JSONB, default=None)

    __table_args__ = (
        UniqueConstraint("dataset_id", "column_name", name="uq_columns_profile_dataset_column"),
        CheckConstraint(
            "data_type IN ('numeric', 'categorical', 'datetime', 'boolean', 'text')",
            name="ck_columns_profile_data_type",
        ),
    )

    dataset: Mapped["Dataset"] = relationship(back_populates="columns_profile")


class TestResult(Base):
    __tablename__ = "test_results"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    test_type: Mapped[str] = mapped_column(nullable=False)
    column_a: Mapped[str] = mapped_column(nullable=False)
    column_b: Mapped[str] = mapped_column(nullable=False)
    statistic: Mapped[float] = mapped_column(nullable=False)
    p_value: Mapped[float] = mapped_column(nullable=False)
    conclusion: Mapped[str] = mapped_column(nullable=False)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("test_type IN ('t_test', 'chi_square', 'anova')", name="ck_test_results_test_type"),
        CheckConstraint("p_value BETWEEN 0 AND 1", name="ck_test_results_p_value"),
    )

    dataset: Mapped["Dataset"] = relationship(back_populates="test_results")


class ModelRun(Base):
    __tablename__ = "model_runs"

    id: Mapped[uuid.UUID] = mapped_column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid())
    dataset_id: Mapped[uuid.UUID] = mapped_column(ForeignKey("datasets.id", ondelete="CASCADE"), nullable=False)
    target_column: Mapped[str] = mapped_column(nullable=False)
    model_type: Mapped[str] = mapped_column(nullable=False)
    algorithm: Mapped[str] = mapped_column(nullable=False)
    metrics: Mapped[dict] = mapped_column(JSONB, nullable=False)
    feature_importance: Mapped[dict | None] = mapped_column(JSONB, default=None)
    created_at: Mapped[datetime] = mapped_column(server_default=func.now())

    __table_args__ = (
        CheckConstraint("model_type IN ('regression', 'classification')", name="ck_model_runs_model_type"),
    )

    dataset: Mapped["Dataset"] = relationship(back_populates="model_runs")
