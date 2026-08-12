"""CSV validation and data-quality profiling (FR-1, FR-2, FR-3)."""

import io
from dataclasses import dataclass

import pandas as pd

from app.errors import AppError

MAX_UPLOAD_BYTES = 10 * 1024 * 1024  # 10MB, NFR — matches datasets.file_size_bytes CHECK
ALLOWED_EXTENSIONS = (".csv",)

# Fixed so a column's inferred type is stable across re-profiling (see the
# datetime probe below).
RANDOM_STATE = 0

# Heuristic thresholds for classifying an object-dtype column as categorical vs.
# free text, since pandas itself only distinguishes numeric/bool from "object".
DATETIME_PARSE_SUCCESS_THRESHOLD = 0.9
CATEGORICAL_UNIQUE_RATIO_THRESHOLD = 0.5
CATEGORICAL_UNIQUE_COUNT_THRESHOLD = 50

# The datetime probe below is by far the most expensive thing in profiling —
# measured at 98.3% of all type-inference time on a text-heavy upload, because
# format="mixed" infers a format per element in Python rather than vectorising.
# A 10MB file with 20 free-text columns spent 12.8s here locally, which is ~69s
# on the deployed shared CPU, and it scales with rows x text columns.
#
# Deciding "do these values look like dates?" is a proportion estimate, and a
# sample answers it as well as the full column: at n=2000 the standard error on a
# proportion near the 0.9 threshold is ~0.7%, far tighter than the gap between a
# real date column (~1.0) and anything else (~0.0). Only a column that is almost
# exactly 90% parseable could land differently, which is pathological.
#
# Sampling is deterministic (fixed random_state) because the inferred type is
# persisted per column, and a column must not change type when re-profiled.
# Columns at or under this size are probed in full, so small files — including
# every fixture in the test suite — behave exactly as they did before.
DATETIME_PROBE_SAMPLE_SIZE = 2_000


@dataclass
class ColumnProfileData:
    column_name: str
    data_type: str
    missing_count: int
    missing_pct: float
    unique_count: int
    outlier_count: int | None
    summary_stats: dict | None


@dataclass
class QualityProfile:
    columns: list[ColumnProfileData]
    duplicate_row_count: int


def validate_and_parse_csv(filename: str, raw: bytes) -> pd.DataFrame:
    """Validate type/size/encoding (FR-2) and parse into a DataFrame, or raise AppError."""
    if not filename or not filename.lower().endswith(ALLOWED_EXTENSIONS):
        raise AppError(400, "invalid_file_type", "Only .csv files are accepted.")

    if len(raw) == 0:
        raise AppError(400, "empty_file", "The uploaded file is empty.")

    if len(raw) > MAX_UPLOAD_BYTES:
        raise AppError(400, "file_too_large", "File exceeds the 10MB upload limit.")

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AppError(400, "invalid_encoding", "File must be UTF-8 encoded.") from exc

    try:
        df = pd.read_csv(io.StringIO(text))
    except pd.errors.EmptyDataError as exc:
        raise AppError(400, "empty_file", "The uploaded file has no data.") from exc
    except pd.errors.ParserError as exc:
        raise AppError(400, "malformed_csv", "The file could not be parsed as CSV.") from exc

    if df.shape[1] == 0:
        raise AppError(400, "empty_file", "The uploaded file has no columns.")
    if df.shape[0] == 0:
        raise AppError(400, "empty_file", "The uploaded file has no rows.")

    return df


def infer_data_type(series: pd.Series) -> str:
    non_null = series.dropna()
    if non_null.empty:
        return "text"

    if pd.api.types.is_bool_dtype(series):
        return "boolean"

    if pd.api.types.is_numeric_dtype(series):
        return "numeric"

    lowered = non_null.astype(str).str.strip().str.lower()
    if set(lowered.unique()) <= {"true", "false"}:
        return "boolean"

    probe = (
        non_null
        if len(non_null) <= DATETIME_PROBE_SAMPLE_SIZE
        else non_null.sample(n=DATETIME_PROBE_SAMPLE_SIZE, random_state=RANDOM_STATE)
    )
    parsed = pd.to_datetime(probe, errors="coerce", format="mixed")
    if parsed.notna().mean() >= DATETIME_PARSE_SUCCESS_THRESHOLD:
        return "datetime"

    unique_ratio = non_null.nunique() / len(non_null)
    # The absolute-count fallback only kicks in on a large-enough sample — on a
    # handful of rows almost every column has <= 50 distinct values, which would
    # otherwise call every small text column "categorical".
    large_low_cardinality_sample = len(non_null) >= 50 and non_null.nunique() <= CATEGORICAL_UNIQUE_COUNT_THRESHOLD
    if unique_ratio <= CATEGORICAL_UNIQUE_RATIO_THRESHOLD or large_low_cardinality_sample:
        return "categorical"

    return "text"


def _numeric_summary(series: pd.Series) -> dict:
    non_null = pd.to_numeric(series, errors="coerce").dropna()
    if non_null.empty:
        return {"mean": None, "median": None, "std": None, "min": None, "max": None}
    return {
        "mean": round(float(non_null.mean()), 4),
        "median": round(float(non_null.median()), 4),
        "std": round(float(non_null.std()), 4) if len(non_null) > 1 else 0.0,
        "min": float(non_null.min()),
        "max": float(non_null.max()),
    }


def _iqr_outlier_count(series: pd.Series) -> int:
    non_null = pd.to_numeric(series, errors="coerce").dropna()
    if len(non_null) < 4:
        return 0
    q1, q3 = non_null.quantile(0.25), non_null.quantile(0.75)
    iqr = q3 - q1
    if iqr == 0:
        return 0
    lower, upper = q1 - 1.5 * iqr, q3 + 1.5 * iqr
    return int(((non_null < lower) | (non_null > upper)).sum())


def _categorical_summary(series: pd.Series) -> dict:
    non_null = series.dropna()
    if non_null.empty:
        return {"top_value": None, "top_frequency": 0}
    counts = non_null.astype(str).value_counts()
    return {"top_value": str(counts.index[0]), "top_frequency": int(counts.iloc[0])}


def profile_column(series: pd.Series) -> ColumnProfileData:
    total = len(series)
    missing_count = int(series.isna().sum())
    missing_pct = round((missing_count / total) * 100, 2) if total else 0.0
    unique_count = int(series.dropna().nunique())
    data_type = infer_data_type(series)

    outlier_count = None
    summary_stats = None
    if data_type == "numeric":
        outlier_count = _iqr_outlier_count(series)
        summary_stats = _numeric_summary(series)
    else:
        summary_stats = _categorical_summary(series)

    return ColumnProfileData(
        column_name=str(series.name),
        data_type=data_type,
        missing_count=missing_count,
        missing_pct=missing_pct,
        unique_count=unique_count,
        outlier_count=outlier_count,
        summary_stats=summary_stats,
    )


def profile_dataframe(df: pd.DataFrame) -> QualityProfile:
    columns = [profile_column(df[col]) for col in df.columns]
    duplicate_row_count = int(df.duplicated().sum())
    return QualityProfile(columns=columns, duplicate_row_count=duplicate_row_count)
