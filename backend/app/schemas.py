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


class HistogramBinOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    bin_start: float
    bin_end: float
    count: int


class NumericDistributionOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    column_name: str
    bins: list[HistogramBinOut]


class CategoryCountOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    value: str
    count: int


class CategoricalFrequencyOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    column_name: str
    categories: list[CategoryCountOut]


class CorrelationMatrixOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    columns: list[str]
    matrix: list[list[float | None]]


class EdaReportOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    numeric_distributions: list[NumericDistributionOut]
    categorical_frequencies: list[CategoricalFrequencyOut]
    correlation_matrix: CorrelationMatrixOut | None


class QualityReportOut(DatasetOut):
    columns: list[ColumnProfileOut]
    # Populated only by POST /upload — embedding it here avoids a second
    # cross-site request (and its cookie dependency) for the first view of a
    # freshly uploaded dataset. GET /quality-report leaves this null; use
    # GET /{id}/eda to (re)fetch it for an existing dataset.
    eda: EdaReportOut | None = None


class TestRequestIn(BaseModel):
    column_a: str
    column_b: str


class TestResultOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    dataset_id: uuid.UUID
    test_type: str
    column_a: str
    column_b: str
    statistic: float
    p_value: float
    conclusion: str
    created_at: datetime
