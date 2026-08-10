"""Baseline model training + feature importance (FR-8, FR-9).

Target column type decides the task, same auto-selection spirit as
stats_tests.py's test selection: numeric target -> regression, categorical or
boolean target -> classification. Datetime/text targets and datetime/text
features are unsupported (excluded from the feature set, or rejected as a
target) — a baseline model isn't the right tool for free text or timestamps
without dedicated feature engineering.
"""

from dataclasses import dataclass

import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    precision_score,
    r2_score,
    recall_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

from app.errors import AppError

USABLE_FEATURE_TYPES = ("numeric", "categorical", "boolean")
CATEGORICAL_FEATURE_TYPES = ("categorical", "boolean")
MIN_ROWS = 10
TEST_SIZE = 0.2
RANDOM_STATE = 42
N_ESTIMATORS = 100


@dataclass
class ModelOutcome:
    model_type: str  # "regression" | "classification"
    algorithm: str
    metrics: dict[str, float]
    feature_importance: dict[str, float]  # column -> share of total importance, sorted desc, sums to ~1


def _aggregate_feature_importance(
    pipeline: Pipeline, numeric_features: list[str], categorical_features: list[str]
) -> dict[str, float]:
    importances = pipeline.named_steps["model"].feature_importances_
    preprocessor: ColumnTransformer = pipeline.named_steps["preprocess"]

    raw: dict[str, float] = dict.fromkeys((*numeric_features, *categorical_features), 0.0)
    idx = 0
    for name, _transformer, columns in preprocessor.transformers_:
        if name == "num":
            for col in columns:
                raw[col] += float(importances[idx])
                idx += 1
        elif name == "cat":
            onehot: OneHotEncoder = preprocessor.named_transformers_["cat"].named_steps["onehot"]
            for col, categories in zip(columns, onehot.categories_, strict=True):
                n_levels = len(categories)
                raw[col] += float(importances[idx : idx + n_levels].sum())
                idx += n_levels

    total = sum(raw.values())
    normalized = {k: round(v / total, 4) for k, v in raw.items()} if total > 0 else raw
    return dict(sorted(normalized.items(), key=lambda kv: kv[1], reverse=True))


def describe_feature_importance(feature_importance: dict[str, float], target_column: str) -> str:
    """Plain-language summary of the top predictors (FR-9).

    Sorts explicitly rather than trusting insertion order — Postgres JSONB
    does not preserve the original key order of a dict once it round-trips
    through the DB, so `feature_importance` here may arrive out of order even
    though `train_model` built it sorted.
    """
    if not feature_importance:
        return f"No feature importance is available for predicting '{target_column}'."

    top = sorted(feature_importance.items(), key=lambda kv: kv[1], reverse=True)[:3]
    parts = [f"'{name}' ({value * 100:.0f}%)" for name, value in top]
    if len(parts) == 1:
        joined = parts[0]
    elif len(parts) == 2:
        joined = f"{parts[0]} and {parts[1]}"
    else:
        joined = f"{', '.join(parts[:-1])}, and {parts[-1]}"
    return f"The strongest predictors of '{target_column}' are {joined}."


def train_model(df: pd.DataFrame, column_types: dict[str, str], target_column: str) -> ModelOutcome:
    if target_column not in df.columns:
        raise AppError(400, "column_not_found", f"Column '{target_column}' does not exist on this dataset.")

    target_type = column_types.get(target_column)
    if target_type == "numeric":
        model_type = "regression"
    elif target_type in CATEGORICAL_FEATURE_TYPES:
        model_type = "classification"
    else:
        raise AppError(
            400,
            "unsupported_target_type",
            f"Column type '{target_type}' isn't supported as a model target — use a numeric column "
            "(regression) or a categorical/boolean column (classification).",
        )

    feature_columns = [
        c for c in df.columns if c != target_column and column_types.get(c) in USABLE_FEATURE_TYPES
    ]
    if not feature_columns:
        raise AppError(
            400,
            "insufficient_features",
            "No usable feature columns remain — datetime and text columns are excluded from modeling.",
        )

    working = df[[target_column, *feature_columns]].copy()
    if model_type == "regression":
        working[target_column] = pd.to_numeric(working[target_column], errors="coerce")
    else:
        is_missing = working[target_column].isna()
        working[target_column] = working[target_column].astype(str)
        working.loc[is_missing, target_column] = np.nan

    working = working.dropna(subset=[target_column])
    if len(working) < MIN_ROWS:
        raise AppError(
            400,
            "insufficient_data",
            f"At least {MIN_ROWS} rows with a non-missing '{target_column}' value are needed to train a model.",
        )
    if model_type == "classification" and working[target_column].nunique() < 2:
        raise AppError(
            400, "insufficient_data", f"'{target_column}' needs at least 2 distinct classes to train a classifier."
        )

    X = working[feature_columns]
    y = working[target_column]

    numeric_features = [c for c in feature_columns if column_types.get(c) == "numeric"]
    categorical_features = [c for c in feature_columns if column_types.get(c) in CATEGORICAL_FEATURE_TYPES]

    transformers = []
    if numeric_features:
        transformers.append(("num", SimpleImputer(strategy="median"), numeric_features))
    if categorical_features:
        transformers.append(
            (
                "cat",
                Pipeline(
                    [("impute", SimpleImputer(strategy="most_frequent")), ("onehot", OneHotEncoder(handle_unknown="ignore"))]
                ),
                categorical_features,
            )
        )
    preprocessor = ColumnTransformer(transformers)

    model = (
        RandomForestRegressor(n_estimators=N_ESTIMATORS, random_state=RANDOM_STATE)
        if model_type == "regression"
        else RandomForestClassifier(n_estimators=N_ESTIMATORS, random_state=RANDOM_STATE)
    )
    pipeline = Pipeline([("preprocess", preprocessor), ("model", model)])

    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    if len(X_train) == 0 or len(X_test) == 0:
        raise AppError(400, "insufficient_data", "Not enough rows to create a train/test split.")

    pipeline.fit(X_train, y_train)
    y_pred = pipeline.predict(X_test)

    if model_type == "regression":
        metrics = {
            "r2": round(float(r2_score(y_test, y_pred)), 4),
            "mae": round(float(mean_absolute_error(y_test, y_pred)), 4),
            "rmse": round(float(mean_squared_error(y_test, y_pred) ** 0.5), 4),
        }
    else:
        metrics = {
            "accuracy": round(float(accuracy_score(y_test, y_pred)), 4),
            "precision": round(float(precision_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
            "recall": round(float(recall_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
            "f1": round(float(f1_score(y_test, y_pred, average="weighted", zero_division=0)), 4),
        }

    feature_importance = _aggregate_feature_importance(pipeline, numeric_features, categorical_features)

    return ModelOutcome(model_type=model_type, algorithm="random_forest", metrics=metrics, feature_importance=feature_importance)
