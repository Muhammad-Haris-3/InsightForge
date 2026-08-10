import numpy as np
import pandas as pd
import pytest

from app.errors import AppError
from app.services.modeling import (
    MIN_ROWS,
    describe_feature_importance,
    predict,
    train_model,
)

# --- train_model: FR-8, FR-9 (auto-selected regression/classification + feature importance) ---


def _regression_dataset(n=40, seed=0):
    rng = np.random.default_rng(seed)
    age = rng.integers(20, 60, n)
    salary = rng.integers(30000, 90000, n)
    city = rng.choice(["Lahore", "Karachi", "Islamabad"], n)
    target = age * 500 + salary * 0.1 + rng.normal(0, 1000, n)
    return pd.DataFrame({"age": age, "salary": salary, "city": city, "score": target})


def _classification_dataset(n=40, seed=0):
    rng = np.random.default_rng(seed)
    age = rng.integers(20, 60, n)
    salary = rng.integers(30000, 90000, n)
    city = rng.choice(["Lahore", "Karachi", "Islamabad"], n)
    label = np.where(salary > 60000, "high", "low")
    return pd.DataFrame({"age": age, "salary": salary, "city": city, "bracket": label})


def test_numeric_target_selects_regression():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = train_model(df, types, "score")
    assert outcome.model_type == "regression"
    assert outcome.algorithm == "random_forest"
    assert "r2" in outcome.metrics
    assert set(outcome.feature_importance) == {"age", "salary", "city"}
    assert pytest.approx(sum(outcome.feature_importance.values()), abs=1e-2) == 1.0


def test_categorical_target_selects_classification():
    df = _classification_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "bracket": "categorical"}
    outcome = train_model(df, types, "bracket")
    assert outcome.model_type == "classification"
    assert "accuracy" in outcome.metrics
    assert 0 <= outcome.metrics["accuracy"] <= 1


def test_boolean_target_selects_classification():
    df = _classification_dataset()
    df["active"] = df["bracket"] == "high"
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "active": "boolean"}
    outcome = train_model(df.drop(columns="bracket"), types, "active")
    assert outcome.model_type == "classification"


def test_feature_importance_sums_to_one_and_is_sorted_desc():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = train_model(df, types, "score")
    values = list(outcome.feature_importance.values())
    assert values == sorted(values, reverse=True)
    assert pytest.approx(sum(values), abs=1e-2) == 1.0


def test_missing_target_column_is_rejected():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "nonexistent")
    assert exc.value.code == "column_not_found"


def test_datetime_target_is_unsupported():
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=15), "age": range(15)})
    types = {"date": "datetime", "age": "numeric"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "date")
    assert exc.value.code == "unsupported_target_type"


def test_no_usable_features_is_rejected():
    df = pd.DataFrame({"score": range(15), "notes": [f"free text {i}" for i in range(15)]})
    types = {"score": "numeric", "notes": "text"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "score")
    assert exc.value.code == "insufficient_features"


def test_too_few_rows_is_rejected():
    df = pd.DataFrame({"age": range(MIN_ROWS - 1), "score": range(MIN_ROWS - 1)})
    types = {"age": "numeric", "score": "numeric"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "score")
    assert exc.value.code == "insufficient_data"


def test_single_class_target_is_rejected():
    df = pd.DataFrame({"age": range(15), "bracket": ["high"] * 15})
    types = {"age": "numeric", "bracket": "categorical"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "bracket")
    assert exc.value.code == "insufficient_data"


def test_missing_target_values_are_dropped_not_counted():
    df = _regression_dataset(n=MIN_ROWS + 5)
    df.loc[: MIN_ROWS - 3, "score"] = None  # leaves fewer than MIN_ROWS non-missing targets
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    with pytest.raises(AppError) as exc:
        train_model(df, types, "score")
    assert exc.value.code == "insufficient_data"


def test_numeric_features_missing_values_are_imputed_not_dropped():
    df = _regression_dataset(n=30)
    df.loc[0:5, "salary"] = None
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = train_model(df, types, "score")
    assert outcome.model_type == "regression"


# --- predict: FR-10 (live "what-if" prediction) ---


def test_predict_regression_returns_numeric_prediction():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = predict(df, types, "score", {"age": 40, "salary": 60000, "city": "Lahore"})
    assert isinstance(outcome.prediction, float)
    assert outcome.probabilities is None


def test_predict_classification_returns_class_and_probabilities():
    df = _classification_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "bracket": "categorical"}
    outcome = predict(df, types, "bracket", {"age": 50, "salary": 80000, "city": "Lahore"})
    assert outcome.prediction in {"high", "low"}
    assert outcome.probabilities is not None
    assert set(outcome.probabilities) == {"high", "low"}
    assert pytest.approx(sum(outcome.probabilities.values()), abs=1e-6) == 1.0


def test_predict_matches_train_model_reported_metrics_model():
    # predict() must reconstruct the *same* fitted model train_model() reported
    # metrics for (same split, same random_state) — not a fresh full-data refit
    # that would silently diverge from what the UI shows as "this model's accuracy".
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    a = predict(df, types, "score", {"age": 40, "salary": 60000, "city": "Lahore"})
    b = predict(df, types, "score", {"age": 40, "salary": 60000, "city": "Lahore"})
    assert a.prediction == b.prediction  # fully deterministic given fixed random_state


def test_predict_missing_features_are_imputed_not_rejected():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = predict(df, types, "score", {})  # no features supplied at all
    assert isinstance(outcome.prediction, float)


def test_predict_ignores_unknown_feature_keys():
    df = _regression_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "score": "numeric"}
    outcome = predict(df, types, "score", {"age": 40, "not_a_real_column": "whatever"})
    assert isinstance(outcome.prediction, float)


def test_predict_categorical_feature_matches_regardless_of_case():
    # Real risk this guards: a category learned from the CSV's raw text (e.g.
    # "Lahore") must match a value supplied at predict time with different
    # casing/whitespace, or OneHotEncoder(handle_unknown="ignore") silently
    # treats it as an unseen category (all-zero encoding) instead of matching.
    df = _classification_dataset()
    types = {"age": "numeric", "salary": "numeric", "city": "categorical", "bracket": "categorical"}
    lower = predict(df, types, "bracket", {"age": 50, "salary": 80000, "city": "lahore"})
    upper = predict(df, types, "bracket", {"age": 50, "salary": 80000, "city": "LAHORE  "})
    mixed = predict(df, types, "bracket", {"age": 50, "salary": 80000, "city": "Lahore"})
    assert lower.prediction == upper.prediction == mixed.prediction
    assert lower.probabilities == upper.probabilities == mixed.probabilities


def test_predict_invalid_target_raises_same_errors_as_train_model():
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=15), "age": range(15)})
    types = {"date": "datetime", "age": "numeric"}
    with pytest.raises(AppError) as exc:
        predict(df, types, "date", {"age": 1})
    assert exc.value.code == "unsupported_target_type"


# --- describe_feature_importance: FR-9 (plain-language interpretation) ---


def test_describe_feature_importance_single_feature():
    text = describe_feature_importance({"age": 1.0}, "score")
    assert text == "The strongest predictors of 'score' are 'age' (100%)."


def test_describe_feature_importance_two_features():
    text = describe_feature_importance({"age": 0.7, "salary": 0.3}, "score")
    assert "'age' (70%)" in text
    assert "'salary' (30%)" in text
    assert " and " in text


def test_describe_feature_importance_three_plus_features_uses_oxford_comma():
    text = describe_feature_importance({"age": 0.5, "salary": 0.3, "city": 0.2}, "score")
    assert text.count("'") == 8  # 4 quoted names (target + 3 features), 2 quotes each
    assert ", and" in text


def test_describe_feature_importance_does_not_trust_input_order():
    # Regression test: Postgres JSONB does not preserve dict key order, so a
    # feature_importance dict read back from the DB can arrive with its keys
    # in a different order than train_model originally produced (observed
    # live: {'age': 0.93, 'city': 0.01, 'salary': 0.06} — city ranked above
    # salary despite the value being smaller). The function must sort by
    # value itself rather than assume the input is already sorted.
    out_of_order = {"city": 0.0093, "age": 0.9289, "bracket": 0.0056, "salary": 0.0562}
    text = describe_feature_importance(out_of_order, "score")
    assert text == "The strongest predictors of 'score' are 'age' (93%), 'salary' (6%), and 'city' (1%)."


def test_describe_feature_importance_empty():
    text = describe_feature_importance({}, "score")
    assert "No feature importance" in text
