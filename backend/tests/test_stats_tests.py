import pandas as pd
import pytest

from app.errors import AppError
from app.services.stats_tests import select_and_run_test

# --- select_and_run_test: FR-5, FR-6 (auto-selected t-test/chi-square/ANOVA) ---


def test_two_group_categorical_vs_numeric_runs_t_test():
    df = pd.DataFrame(
        {
            "group": ["A"] * 10 + ["B"] * 10,
            "score": [10, 11, 9, 10, 12, 11, 10, 9, 10, 11] + [20, 21, 19, 20, 22, 21, 20, 19, 20, 21],
        }
    )
    outcome = select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "group", "score")
    assert outcome.test_type == "t_test"
    assert outcome.p_value < 0.05  # groups are clearly different
    assert "'A'" in outcome.conclusion and "'B'" in outcome.conclusion


def test_column_order_does_not_matter_for_t_test():
    df = pd.DataFrame({"group": ["A"] * 5 + ["B"] * 5, "score": [1, 2, 3, 4, 5, 10, 11, 12, 13, 14]})
    outcome = select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "score", "group")
    assert outcome.test_type == "t_test"


def test_three_group_categorical_vs_numeric_runs_anova():
    df = pd.DataFrame(
        {
            "group": ["A"] * 5 + ["B"] * 5 + ["C"] * 5,
            "score": [1, 2, 3, 2, 1] + [10, 11, 9, 10, 11] + [20, 21, 19, 20, 22],
        }
    )
    outcome = select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "group", "score")
    assert outcome.test_type == "anova"
    assert outcome.p_value < 0.05


def test_boolean_treated_as_groupable_for_t_test():
    df = pd.DataFrame({"flag": [True] * 5 + [False] * 5, "score": [1, 2, 3, 2, 1, 10, 11, 9, 10, 11]})
    outcome = select_and_run_test(df, {"flag": "boolean", "score": "numeric"}, "flag", "score")
    assert outcome.test_type == "t_test"


def test_two_categorical_columns_run_chi_square():
    df = pd.DataFrame(
        {
            "city": ["A", "A", "A", "B", "B", "B"] * 5,
            "purchased": ["yes", "yes", "no", "no", "no", "yes"] * 5,
        }
    )
    outcome = select_and_run_test(df, {"city": "categorical", "purchased": "categorical"}, "city", "purchased")
    assert outcome.test_type == "chi_square"
    assert 0 <= outcome.p_value <= 1


def test_numeric_vs_numeric_is_unsupported():
    df = pd.DataFrame({"a": [1, 2, 3, 4], "b": [4, 3, 2, 1]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"a": "numeric", "b": "numeric"}, "a", "b")
    assert exc.value.code == "unsupported_test_pairing"


def test_datetime_column_is_unsupported():
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=4), "group": ["A", "B", "A", "B"]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"date": "datetime", "group": "categorical"}, "date", "group")
    assert exc.value.code == "unsupported_test_pairing"


def test_same_column_twice_is_rejected():
    df = pd.DataFrame({"a": [1, 2, 3]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"a": "numeric"}, "a", "a")
    assert exc.value.code == "same_column"


def test_missing_column_is_rejected():
    df = pd.DataFrame({"a": [1, 2, 3]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"a": "numeric"}, "a", "nonexistent")
    assert exc.value.code == "column_not_found"


def test_single_group_is_insufficient_data():
    df = pd.DataFrame({"group": ["A"] * 5, "score": [1, 2, 3, 4, 5]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "group", "score")
    assert exc.value.code == "insufficient_data"


def test_group_with_too_few_observations_is_insufficient_data():
    df = pd.DataFrame({"group": ["A", "B"] + ["B"] * 4, "score": [1, 2, 3, 4, 5, 6]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "group", "score")
    assert exc.value.code == "insufficient_data"


def test_chi_square_with_single_category_is_insufficient_data():
    df = pd.DataFrame({"a": ["x"] * 6, "b": ["y", "z", "y", "z", "y", "z"]})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"a": "categorical", "b": "categorical"}, "a", "b")
    assert exc.value.code == "insufficient_data"


def test_constant_values_within_groups_is_insufficient_data():
    # zero variance in both groups -> t-statistic is NaN, must be caught rather than persisted
    df = pd.DataFrame({"group": ["A"] * 5 + ["B"] * 5, "score": [5] * 5 + [5] * 5})
    with pytest.raises(AppError) as exc:
        select_and_run_test(df, {"group": "categorical", "score": "numeric"}, "group", "score")
    assert exc.value.code == "insufficient_data"
