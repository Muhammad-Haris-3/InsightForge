import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict


class ColumnProfileOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    column_name: str
    data_type: str
    missing_count: int
    missing_pct: float
    unique_count: int
    outlier_count: int | None
    summary_stats: dict | None


class DatasetOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    original_filename: str
    row_count: int
    column_count: int
    file_size_bytes: int
    duplicate_row_count: int
    upload_time: datetime


class QualityReportOut(DatasetOut):
    columns: list[ColumnProfileOut]
