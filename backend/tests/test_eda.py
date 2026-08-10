import pandas as pd
import pytest

from app.services.eda import build_eda_payload

# --- build_eda_payload: FR-4 (distributions, frequencies, correlation matrix) ---


def test_numeric_distribution_bins_all_values():
    df = pd.DataFrame({"score": list(range(1, 101))})
    payload = build_eda_payload(df, {"score": "numeric"})
    dist = payload.numeric_distributions[0]
    assert dist.column_name == "score"
    assert sum(b.count for b in dist.bins) == 100


def test_numeric_distribution_handles_single_unique_value():
    df = pd.DataFrame({"const": [5, 5, 5, 5]})
    payload = build_eda_payload(df, {"const": "numeric"})
    dist = payload.numeric_distributions[0]
    assert len(dist.bins) == 1
    assert dist.bins[0].count == 4


def test_numeric_distribution_excludes_missing_values():
    df = pd.DataFrame({"score": [1, 2, 3, None, None]})
    payload = build_eda_payload(df, {"score": "numeric"})
    dist = payload.numeric_distributions[0]
    assert sum(b.count for b in dist.bins) == 3


def test_categorical_frequency_counts_and_ordering():
    df = pd.DataFrame({"city": ["A", "A", "A", "B", "B", "C"]})
    payload = build_eda_payload(df, {"city": "categorical"})
    freq = payload.categorical_frequencies[0]
    assert freq.column_name == "city"
    assert freq.categories[0].value == "A"
    assert freq.categories[0].count == 3


def test_categorical_frequency_buckets_long_tail_as_other():
    values = [f"cat_{i}" for i in range(15) for _ in range(2)]
    df = pd.DataFrame({"col": values})
    payload = build_eda_payload(df, {"col": "categorical"})
    freq = payload.categorical_frequencies[0]
    assert len(freq.categories) == 11  # top 10 + "Other"
    assert freq.categories[-1].value == "Other"
    assert freq.categories[-1].count == 10  # 5 remaining categories x 2 each


def test_categorical_frequency_excludes_missing_values():
    df = pd.DataFrame({"col": ["A", "A", None, None]})
    payload = build_eda_payload(df, {"col": "categorical"})
    freq = payload.categorical_frequencies[0]
    assert sum(c.count for c in freq.categories) == 2


def test_correlation_matrix_none_when_fewer_than_two_numeric_columns():
    df = pd.DataFrame({"a": [1, 2, 3], "city": ["x", "y", "z"]})
    payload = build_eda_payload(df, {"a": "numeric", "city": "categorical"})
    assert payload.correlation_matrix is None


def test_correlation_matrix_perfect_positive_correlation():
    df = pd.DataFrame({"a": [1, 2, 3, 4], "b": [2, 4, 6, 8]})
    payload = build_eda_payload(df, {"a": "numeric", "b": "numeric"})
    corr = payload.correlation_matrix
    assert corr.columns == ["a", "b"]
    assert corr.matrix[0][1] == pytest.approx(1.0)
    assert corr.matrix[0][0] == pytest.approx(1.0)


def test_correlation_matrix_none_cell_for_constant_column():
    df = pd.DataFrame({"a": [1, 2, 3, 4], "b": [5, 5, 5, 5]})
    payload = build_eda_payload(df, {"a": "numeric", "b": "numeric"})
    corr = payload.correlation_matrix
    assert corr.matrix[0][1] is None


def test_no_categorical_columns_yields_empty_frequency_list():
    df = pd.DataFrame({"a": [1, 2, 3]})
    payload = build_eda_payload(df, {"a": "numeric"})
    assert payload.categorical_frequencies == []


def test_no_numeric_columns_yields_empty_distribution_list():
    df = pd.DataFrame({"city": ["x", "y", "z"]})
    payload = build_eda_payload(df, {"city": "categorical"})
    assert payload.numeric_distributions == []
