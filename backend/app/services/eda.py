"""Automated EDA: distributions, category frequencies, correlation matrix (FR-4)."""

import math
from dataclasses import dataclass

import numpy as np
import pandas as pd

NUMERIC_HISTOGRAM_BINS = 10
TOP_CATEGORIES_LIMIT = 10


@dataclass
class HistogramBin:
    bin_start: float
    bin_end: float
    count: int


@dataclass
class NumericDistribution:
    column_name: str
    bins: list[HistogramBin]


@dataclass
class CategoryCount:
    value: str
    count: int


@dataclass
class CategoricalFrequency:
    column_name: str
    categories: list[CategoryCount]


@dataclass
class CorrelationMatrix:
    columns: list[str]
    matrix: list[list[float | None]]


@dataclass
class EdaPayload:
    numeric_distributions: list[NumericDistribution]
    categorical_frequencies: list[CategoricalFrequency]
    correlation_matrix: CorrelationMatrix | None


def _numeric_distribution(column_name: str, series: pd.Series) -> NumericDistribution:
    non_null = pd.to_numeric(series, errors="coerce").dropna()
    if non_null.empty or non_null.nunique() < 2:
        value = float(non_null.iloc[0]) if not non_null.empty else 0.0
        return NumericDistribution(
            column_name=column_name,
            bins=[HistogramBin(bin_start=value, bin_end=value, count=len(non_null))],
        )

    counts, edges = np.histogram(non_null, bins=NUMERIC_HISTOGRAM_BINS)
    bins = [
        HistogramBin(bin_start=round(float(edges[i]), 4), bin_end=round(float(edges[i + 1]), 4), count=int(counts[i]))
        for i in range(len(counts))
    ]
    return NumericDistribution(column_name=column_name, bins=bins)


def _categorical_frequency(column_name: str, series: pd.Series) -> CategoricalFrequency:
    non_null = series.dropna().astype(str)
    counts = non_null.value_counts()
    top = counts.head(TOP_CATEGORIES_LIMIT)
    categories = [CategoryCount(value=str(idx), count=int(cnt)) for idx, cnt in top.items()]

    other_count = int(counts.iloc[TOP_CATEGORIES_LIMIT:].sum())
    if other_count > 0:
        categories.append(CategoryCount(value="Other", count=other_count))

    return CategoricalFrequency(column_name=column_name, categories=categories)


def _correlation_matrix(df: pd.DataFrame, numeric_columns: list[str]) -> CorrelationMatrix | None:
    if len(numeric_columns) < 2:
        return None

    corr = df[numeric_columns].apply(pd.to_numeric, errors="coerce").corr()
    matrix: list[list[float | None]] = []
    for row_col in numeric_columns:
        row: list[float | None] = []
        for col_col in numeric_columns:
            value = corr.loc[row_col, col_col]
            row.append(round(float(value), 4) if not math.isnan(value) else None)
        matrix.append(row)

    return CorrelationMatrix(columns=numeric_columns, matrix=matrix)


def build_eda_payload(df: pd.DataFrame, column_types: dict[str, str]) -> EdaPayload:
    """Build distribution/frequency/correlation data for Recharts (FR-4).

    `column_types` reuses the data-type classification already computed and
    persisted at upload (FR-3), so EDA stays consistent with the quality report
    instead of re-deriving types with a second heuristic pass.
    """
    numeric_columns = [c for c in df.columns if column_types.get(c) == "numeric"]
    categorical_columns = [c for c in df.columns if column_types.get(c) in ("categorical", "boolean")]

    numeric_distributions = [_numeric_distribution(col, df[col]) for col in numeric_columns]
    categorical_frequencies = [_categorical_frequency(col, df[col]) for col in categorical_columns]
    correlation_matrix = _correlation_matrix(df, numeric_columns)

    return EdaPayload(
        numeric_distributions=numeric_distributions,
        categorical_frequencies=categorical_frequencies,
        correlation_matrix=correlation_matrix,
    )
