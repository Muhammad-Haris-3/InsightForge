import numpy as np
import pandas as pd
import pytest

from app.errors import AppError
from app.services.profiling import (
    DATETIME_PROBE_SAMPLE_SIZE,
    MAX_UPLOAD_BYTES,
    infer_data_type,
    profile_dataframe,
    validate_and_parse_csv,
)

# --- validate_and_parse_csv: FR-2 (type / size / encoding / malformed-input rejection) ---


def test_rejects_non_csv_extension():
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.txt", b"a,b\n1,2\n")
    assert exc.value.code == "invalid_file_type"


def test_rejects_empty_file():
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.csv", b"")
    assert exc.value.code == "empty_file"


def test_rejects_header_only_file():
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.csv", b"col_a,col_b\n")
    assert exc.value.code == "empty_file"


def test_rejects_oversized_file():
    raw = b"a,b\n" + b"1,2\n" * ((MAX_UPLOAD_BYTES // 4) + 1)
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.csv", raw)
    assert exc.value.code == "file_too_large"


def test_rejects_invalid_encoding():
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.csv", b"a,b\n1,\xff\n")
    assert exc.value.code == "invalid_encoding"


def test_rejects_malformed_csv():
    with pytest.raises(AppError) as exc:
        validate_and_parse_csv("data.csv", b"a,b\n1,2\n3,4,5\n")
    assert exc.value.code == "malformed_csv"


def test_accepts_single_column_data():
    df = validate_and_parse_csv("data.csv", b"col_a\n1\n2\n3\n")
    assert df.shape == (3, 1)


# --- profile_dataframe: FR-3 (missing values, dtypes, duplicates, IQR outliers) ---


def test_profile_counts_missing_values():
    df = pd.DataFrame({"a": [1, 2, None, 4]})
    profile = profile_dataframe(df)
    col = profile.columns[0]
    assert col.missing_count == 1
    assert col.missing_pct == 25.0


def test_profile_counts_duplicate_rows():
    df = pd.DataFrame({"a": [1, 1, 2], "b": ["x", "x", "y"]})
    profile = profile_dataframe(df)
    assert profile.duplicate_row_count == 1


def test_profile_flags_iqr_outliers():
    df = pd.DataFrame({"a": [1, 2, 3, 4, 5, 6, 7, 8, 9, 1000]})
    profile = profile_dataframe(df)
    col = profile.columns[0]
    assert col.data_type == "numeric"
    assert col.outlier_count == 1


def test_profile_categorical_has_no_outlier_count():
    df = pd.DataFrame({"a": ["red", "green", "red", "blue"] * 10})
    profile = profile_dataframe(df)
    col = profile.columns[0]
    assert col.data_type == "categorical"
    assert col.outlier_count is None


# --- infer_data_type ---


def test_infers_numeric():
    assert infer_data_type(pd.Series([1, 2, 3, np.nan])) == "numeric"


def test_infers_boolean_from_actual_bools():
    assert infer_data_type(pd.Series([True, False, True])) == "boolean"


def test_infers_boolean_from_text():
    assert infer_data_type(pd.Series(["true", "false", "TRUE"])) == "boolean"


def test_infers_categorical_from_low_cardinality_text():
    series = pd.Series(["north", "south", "north", "east"] * 10)
    assert infer_data_type(series) == "categorical"


def test_infers_text_from_high_cardinality_strings():
    series = pd.Series([f"free text entry number {i} with unique content" for i in range(20)])
    assert infer_data_type(series) == "text"


def test_infers_datetime():
    series = pd.Series(["2024-01-01", "2024-02-15", "2024-03-30"])
    assert infer_data_type(series) == "datetime"


# --- Sampled datetime probe (keeps profiling tractable on text-heavy uploads) ---
#
# Parsing every row of every text column dominated upload time — 98% of type
# inference — so past DATETIME_PROBE_SAMPLE_SIZE the probe runs on a sample.
# Classification must not change because of it.


def _big(values: list[str]) -> pd.Series:
    """A column comfortably larger than the probe sample, so sampling kicks in."""
    n = DATETIME_PROBE_SAMPLE_SIZE * 3
    return pd.Series([values[i % len(values)] for i in range(n)])


def test_large_datetime_column_is_still_detected():
    series = pd.Series(pd.date_range("2020-01-01", periods=DATETIME_PROBE_SAMPLE_SIZE * 3, freq="h").astype(str))
    assert infer_data_type(series) == "datetime"


def test_large_text_column_is_not_mistaken_for_datetime():
    series = pd.Series([f"free text entry number {i} with unique content" for i in range(DATETIME_PROBE_SAMPLE_SIZE * 3)])
    assert infer_data_type(series) == "text"


def test_large_categorical_column_is_still_categorical():
    assert infer_data_type(_big(["Lahore", "Karachi", "Islamabad"])) == "categorical"


def test_large_boolean_column_is_still_boolean():
    assert infer_data_type(_big(["true", "false"])) == "boolean"


def test_large_numeric_column_skips_the_probe_entirely():
    # Numeric columns return before the datetime probe; guard against a refactor
    # accidentally routing them through it.
    series = pd.Series(range(DATETIME_PROBE_SAMPLE_SIZE * 3))
    assert infer_data_type(series) == "numeric"


def test_sampled_inference_is_stable_across_calls():
    # The inferred type is persisted per column, so re-profiling identical data
    # must not produce a different answer.
    series = _big(["2024-01-01", "not a date at all", "2024-03-30", "2024-04-01"])
    assert infer_data_type(series) == infer_data_type(series) == infer_data_type(series)
