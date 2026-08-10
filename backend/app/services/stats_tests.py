"""Statistical test auto-selection and execution (FR-5, FR-6).

Column-type pairing decides which test runs:
  - categorical/boolean x categorical/boolean -> chi-square test of independence
  - categorical/boolean (2 groups) x numeric   -> independent-samples t-test (Welch's)
  - categorical/boolean (3+ groups) x numeric  -> one-way ANOVA
Any other pairing (numeric x numeric, or anything involving datetime/text) is
rejected as unsupported — numeric-numeric relationships are already covered
by the EDA correlation matrix (M2), not by this test suite.
"""

import math
from dataclasses import dataclass

import pandas as pd
from scipy import stats

from app.errors import AppError

ALPHA = 0.05
GROUPABLE_TYPES = ("categorical", "boolean")
MIN_OBSERVATIONS_PER_GROUP = 2


@dataclass
class TestOutcome:
    test_type: str  # 't_test' | 'chi_square' | 'anova'
    statistic: float
    p_value: float
    conclusion: str


def _significance_phrase(p_value: float) -> str:
    return "a statistically significant" if p_value < ALPHA else "no statistically significant"


def _finite_or_raise(statistic: float, p_value: float) -> None:
    if not (math.isfinite(statistic) and math.isfinite(p_value)):
        raise AppError(
            400,
            "insufficient_data",
            "There isn't enough variation in the selected columns to compute this test.",
        )


def _run_t_test(df: pd.DataFrame, group_col: str, value_col: str, groups: list[str]) -> TestOutcome:
    values = pd.to_numeric(df[value_col], errors="coerce")
    labels = df[group_col].astype(str)
    a = values[labels == groups[0]].dropna()
    b = values[labels == groups[1]].dropna()

    if len(a) < MIN_OBSERVATIONS_PER_GROUP or len(b) < MIN_OBSERVATIONS_PER_GROUP:
        raise AppError(
            400,
            "insufficient_data",
            f"Each group in '{group_col}' needs at least {MIN_OBSERVATIONS_PER_GROUP} "
            f"non-missing '{value_col}' values to run a t-test.",
        )

    result = stats.ttest_ind(a, b, equal_var=False)  # Welch's t-test — doesn't assume equal variances
    statistic, p_value = float(result.statistic), float(result.pvalue)
    _finite_or_raise(statistic, p_value)

    conclusion = (
        f"There is {_significance_phrase(p_value)} difference in '{value_col}' between "
        f"'{groups[0]}' (n={len(a)}, mean={a.mean():.4g}) and '{groups[1]}' (n={len(b)}, mean={b.mean():.4g}) "
        f"(p={p_value:.4f})."
    )
    return TestOutcome("t_test", statistic, p_value, conclusion)


def _run_anova(df: pd.DataFrame, group_col: str, value_col: str, groups: list[str]) -> TestOutcome:
    values = pd.to_numeric(df[value_col], errors="coerce")
    labels = df[group_col].astype(str)

    samples = []
    used_groups = []
    for group in groups:
        sample = values[labels == group].dropna()
        if len(sample) >= MIN_OBSERVATIONS_PER_GROUP:
            samples.append(sample)
            used_groups.append(group)

    if len(samples) < 2:
        raise AppError(
            400,
            "insufficient_data",
            f"At least 2 groups in '{group_col}' need {MIN_OBSERVATIONS_PER_GROUP}+ non-missing "
            f"'{value_col}' values to run an ANOVA.",
        )

    result = stats.f_oneway(*samples)
    statistic, p_value = float(result.statistic), float(result.pvalue)
    _finite_or_raise(statistic, p_value)

    conclusion = (
        f"There is {_significance_phrase(p_value)} difference in '{value_col}' across the "
        f"{len(used_groups)} groups of '{group_col}' (p={p_value:.4f})."
    )
    return TestOutcome("anova", statistic, p_value, conclusion)


def _run_chi_square(df: pd.DataFrame, column_a: str, column_b: str) -> TestOutcome:
    sub = df[[column_a, column_b]].dropna()
    contingency = pd.crosstab(sub[column_a].astype(str), sub[column_b].astype(str))

    if contingency.shape[0] < 2 or contingency.shape[1] < 2:
        raise AppError(
            400,
            "insufficient_data",
            f"'{column_a}' and '{column_b}' each need at least 2 distinct categories to run a chi-square test.",
        )

    statistic, p_value, _dof, _expected = stats.chi2_contingency(contingency)
    statistic, p_value = float(statistic), float(p_value)
    _finite_or_raise(statistic, p_value)

    conclusion = (
        f"There is {_significance_phrase(p_value)} association between '{column_a}' and "
        f"'{column_b}' (p={p_value:.4f})."
    )
    return TestOutcome("chi_square", statistic, p_value, conclusion)


def select_and_run_test(df: pd.DataFrame, column_types: dict[str, str], column_a: str, column_b: str) -> TestOutcome:
    if column_a not in df.columns or column_b not in df.columns:
        raise AppError(400, "column_not_found", "One or both columns don't exist on this dataset.")
    if column_a == column_b:
        raise AppError(400, "same_column", "Choose two different columns to run a test.")

    type_a, type_b = column_types.get(column_a), column_types.get(column_b)

    if type_a in GROUPABLE_TYPES and type_b in GROUPABLE_TYPES:
        return _run_chi_square(df, column_a, column_b)

    if type_a == "numeric" and type_b in GROUPABLE_TYPES:
        group_col, value_col = column_b, column_a
    elif type_b == "numeric" and type_a in GROUPABLE_TYPES:
        group_col, value_col = column_a, column_b
    else:
        raise AppError(
            400,
            "unsupported_test_pairing",
            f"Columns of type '{type_a}' and '{type_b}' aren't supported for statistical testing "
            "— use a categorical/boolean column paired with either a numeric column (t-test/ANOVA) "
            "or another categorical/boolean column (chi-square). Two numeric columns are covered by "
            "the correlation matrix in the EDA report instead.",
        )

    groups = df[group_col].dropna().astype(str).unique().tolist()
    if len(groups) < 2:
        raise AppError(400, "insufficient_data", f"'{group_col}' needs at least 2 distinct groups to run a test.")
    if len(groups) == 2:
        return _run_t_test(df, group_col, value_col, groups)
    return _run_anova(df, group_col, value_col, groups)
