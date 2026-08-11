"""Baseline model training, feature importance, and live prediction (FR-8, FR-9, FR-10).

Target column type decides the task, same auto-selection spirit as
stats_tests.py's test selection: numeric target -> regression, categorical or
boolean target -> classification. Datetime/text targets and datetime/text
features are unsupported (excluded from the feature set, or rejected as a
target) — a baseline model isn't the right tool for free text or timestamps
without dedicated feature engineering.

The fitted sklearn model itself is never persisted — only its metrics and
feature_importance (plain JSON) are stored on ModelRun. `predict()` (FR-10)
reconstructs the exact same fitted pipeline on demand rather than
unpickling a stored one: same data, same train/test split, same
random_state, so it's bit-for-bit identical to what train_model() produced.
This sidesteps two real problems a stored pickle would introduce — unpickling
is a known code-execution vector even for data an app wrote itself, and a
sklearn pickle isn't guaranteed to load after a dependency version bump —
at the cost of a full refit per prediction request. That's acceptable at the
scale this project targets (demo-sized CSVs, not production ML serving).
"""

from collections import OrderedDict
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
from sklearn.preprocessing import FunctionTransformer, OneHotEncoder

from app.errors import AppError

USABLE_FEATURE_TYPES = ("numeric", "categorical", "boolean")
CATEGORICAL_FEATURE_TYPES = ("categorical", "boolean")
MIN_ROWS = 10
TEST_SIZE = 0.2
RANDOM_STATE = 42
N_ESTIMATORS = 50  # see MAX_TRAINING_ROWS below — halved for the same reason

# --- Memory ceiling (the API runs in a 512 MB container) ---
#
# A random forest's memory is driven by total node count, not by the size of the
# CSV. Left unbounded, each of the 100 trees splits until its leaves are pure, so
# node count grows with the row count: a 56k-row upload measured at +436 MB peak
# and took 73s, which overran the container. It was killed mid-request, and since
# the proxy's 502 carries no CORS headers the browser reported it as an
# unreachable backend — the whole app appeared to break on large files.
#
# Two bounds fix it, both measured on that same 56k-row dataset:
#
#   all rows,   min_samples_leaf=1   +436 MB   73.1s   test R² 0.8933
#   cap 20k,    min_samples_leaf=2   + 71 MB   17.9s   test R² 0.8949
#
# Accuracy does not suffer — capping trades a negligible amount of signal for a
# 6x memory saving, and requiring 2 samples per leaf regularizes slightly, which
# is why R² edges up rather than down. A baseline model exists to show which
# features matter, and 20k rows is ample for that.
# Render's shared CPU measured ~5.3x slower than a dev machine on this fit, which
# turned a 17s local train into ~90s in production — past the browser client's
# request timeout, so the call still failed for the user even though the container
# now survived it. Time scales with both bounds, and neither costs real accuracy
# (test R² on a signal-bearing 56k dataset, against fitting all rows with 100 trees):
#
#   20k rows, 100 trees   ~90s on Render   R² -0.03 pts
#   10k rows,  50 trees   ~19s on Render   R² -0.32 pts
#
# A third of a percentage point buys a 4.7x speedup and a wide margin against a
# CPU whose speed varies with whatever else is on the box.
MAX_TRAINING_ROWS = 10_000
MIN_SAMPLES_LEAF = 2
# Single-threaded on purpose: n_jobs=-1 would fit trees in parallel worker
# processes, and on a 512 MB container the copies cost more than the speed is
# worth.
N_JOBS = 1


@dataclass
class ModelOutcome:
    model_type: str  # "regression" | "classification"
    algorithm: str
    metrics: dict[str, float]
    feature_importance: dict[str, float]  # column -> share of total importance, sorted desc, sums to ~1
    training_row_count: int  # rows actually fitted on (<= MAX_TRAINING_ROWS)
    available_row_count: int  # rows with a usable target, before any capping


@dataclass
class PredictionOutcome:
    prediction: float | str
    probabilities: dict[str, float] | None  # classification only


def _resolve_model_type(target_column: str, target_type: str | None) -> str:
    if target_type == "numeric":
        return "regression"
    if target_type in CATEGORICAL_FEATURE_TYPES:
        return "classification"
    raise AppError(
        400,
        "unsupported_target_type",
        f"Column type '{target_type}' isn't supported as a model target — use a numeric column "
        "(regression) or a categorical/boolean column (classification).",
    )


def _select_feature_columns(
    df: pd.DataFrame, column_types: dict[str, str], target_column: str
) -> tuple[list[str], list[str], list[str]]:
    feature_columns = [c for c in df.columns if c != target_column and column_types.get(c) in USABLE_FEATURE_TYPES]
    if not feature_columns:
        raise AppError(
            400,
            "insufficient_features",
            "No usable feature columns remain — datetime and text columns are excluded from modeling.",
        )
    numeric_features = [c for c in feature_columns if column_types.get(c) == "numeric"]
    categorical_features = [c for c in feature_columns if column_types.get(c) in CATEGORICAL_FEATURE_TYPES]
    return feature_columns, numeric_features, categorical_features


def _clean_target(df: pd.DataFrame, target_column: str, model_type: str) -> pd.DataFrame:
    working = df.copy()
    if model_type == "regression":
        working[target_column] = pd.to_numeric(working[target_column], errors="coerce")
    else:
        is_missing = working[target_column].isna()
        # Normalized the same way as feature categories below (see
        # _stringify_categorical) — case/whitespace differences between the
        # target's raw CSV text and any downstream comparison shouldn't matter.
        working[target_column] = working[target_column].astype(str).str.strip().str.lower()
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
    return working


def _subsample(working: pd.DataFrame, target_column: str, model_type: str) -> pd.DataFrame:
    """Cap the training set at MAX_TRAINING_ROWS so the forest fits in memory.

    Deterministic (fixed random_state) because predict() re-fits this same
    pipeline on demand rather than unpickling a stored model — an unstable sample
    would hand back predictions from a different model than the one whose metrics
    were reported at training time.
    """
    if len(working) <= MAX_TRAINING_ROWS:
        return working

    sampled = working.sample(n=MAX_TRAINING_ROWS, random_state=RANDOM_STATE)
    # A class rare enough to vanish from the sample would turn a valid classification
    # target into a single-class one. Vanishingly unlikely at this cap, but falling
    # back to the full frame is cheaper than failing a request that used to work.
    if model_type == "classification" and sampled[target_column].nunique() < 2:
        return working
    return sampled


def _stringify_categorical(X: pd.DataFrame) -> pd.DataFrame:
    # Normalizes case/whitespace so a category learned from the CSV's raw text
    # (e.g. "Lahore") reliably matches an equivalent value supplied later at
    # predict time regardless of how the caller formatted it (JSON string,
    # different casing, a JS boolean stringified as "True" vs the CSV's own
    # "true") — otherwise OneHotEncoder(handle_unknown="ignore") would treat
    # anything not byte-identical to the training text as an unseen category.
    return X.astype(str).apply(lambda col: col.str.strip().str.lower())


def _build_pipeline(model_type: str, numeric_features: list[str], categorical_features: list[str]) -> Pipeline:
    transformers = []
    if numeric_features:
        transformers.append(("num", SimpleImputer(strategy="median"), numeric_features))
    if categorical_features:
        transformers.append(
            (
                "cat",
                Pipeline(
                    [
                        ("stringify", FunctionTransformer(_stringify_categorical)),
                        ("impute", SimpleImputer(strategy="most_frequent")),
                        ("onehot", OneHotEncoder(handle_unknown="ignore")),
                    ]
                ),
                categorical_features,
            )
        )
    preprocessor = ColumnTransformer(transformers)

    forest_kwargs = {
        "n_estimators": N_ESTIMATORS,
        "random_state": RANDOM_STATE,
        "min_samples_leaf": MIN_SAMPLES_LEAF,
        "n_jobs": N_JOBS,
    }
    model = (
        RandomForestRegressor(**forest_kwargs)
        if model_type == "regression"
        else RandomForestClassifier(**forest_kwargs)
    )
    return Pipeline([("preprocess", preprocessor), ("model", model)])


@dataclass
class _FittedModel:
    pipeline: Pipeline
    model_type: str
    feature_columns: list[str]
    numeric_features: list[str]
    categorical_features: list[str]
    X_test: pd.DataFrame
    y_test: pd.Series
    training_row_count: int
    available_row_count: int


def _fit(df: pd.DataFrame, column_types: dict[str, str], target_column: str) -> _FittedModel:
    """Core fit shared by train_model() and predict() — same data, same split,
    same random_state, so predict() always reconstructs the identical model
    whose metrics were reported at training time."""
    if target_column not in df.columns:
        raise AppError(400, "column_not_found", f"Column '{target_column}' does not exist on this dataset.")

    model_type = _resolve_model_type(target_column, column_types.get(target_column))
    feature_columns, numeric_features, categorical_features = _select_feature_columns(df, column_types, target_column)

    working = _clean_target(df[[target_column, *feature_columns]], target_column, model_type)
    available_row_count = len(working)
    working = _subsample(working, target_column, model_type)

    X = working[feature_columns]
    y = working[target_column]

    pipeline = _build_pipeline(model_type, numeric_features, categorical_features)
    X_train, X_test, y_train, y_test = train_test_split(X, y, test_size=TEST_SIZE, random_state=RANDOM_STATE)
    if len(X_train) == 0 or len(X_test) == 0:
        raise AppError(400, "insufficient_data", "Not enough rows to create a train/test split.")

    pipeline.fit(X_train, y_train)
    return _FittedModel(
        pipeline=pipeline,
        model_type=model_type,
        feature_columns=feature_columns,
        numeric_features=numeric_features,
        categorical_features=categorical_features,
        X_test=X_test,
        y_test=y_test,
        training_row_count=len(working),
        available_row_count=available_row_count,
    )


# --- Fitted-model cache ---
#
# The what-if simulator (FR-10) fires a prediction on every slider move, and each
# one used to re-fit the entire forest — the full training cost, repeatedly, to
# answer a question about a single row. Caching the fitted pipeline makes every
# prediction after the first one effectively free.
#
# Keyed on (dataset_id, target_column), which is safe because a dataset is
# immutable once uploaded: raw_csv is written at upload time and never updated, so
# the same key can never refer to different data. Bounded at two entries because
# this runs in a 512 MB container — the point is to serve a burst of slider moves
# against one model, not to accumulate every model ever fitted.
CacheKey = tuple[str, str]
_FITTED_CACHE: "OrderedDict[CacheKey, _FittedModel]" = OrderedDict()
_FITTED_CACHE_MAX = 2


def _fit_cached(
    df: pd.DataFrame, column_types: dict[str, str], target_column: str, cache_key: CacheKey | None
) -> "_FittedModel":
    if cache_key is not None and cache_key in _FITTED_CACHE:
        _FITTED_CACHE.move_to_end(cache_key)
        return _FITTED_CACHE[cache_key]

    fitted = _fit(df, column_types, target_column)

    if cache_key is not None:
        _FITTED_CACHE[cache_key] = fitted
        while len(_FITTED_CACHE) > _FITTED_CACHE_MAX:
            _FITTED_CACHE.popitem(last=False)
    return fitted


def clear_fitted_cache() -> None:
    """Drop every cached model. Used by tests to keep them independent."""
    _FITTED_CACHE.clear()


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


def sort_feature_importance(feature_importance: dict[str, float] | None) -> dict[str, float]:
    """Sort by value descending — never trust dict order after a JSONB round-trip.

    Postgres JSONB does not preserve the original key order of a dict once it
    round-trips through the DB, so a `feature_importance` value read back from
    a `ModelRun` may arrive out of order even though `train_model` built it
    sorted. Every place that displays or ranks it (API responses, the PDF
    report, the plain-language summary below) must re-sort at read time.
    """
    if not feature_importance:
        return {}
    return dict(sorted(feature_importance.items(), key=lambda kv: kv[1], reverse=True))


def describe_feature_importance(feature_importance: dict[str, float], target_column: str) -> str:
    """Plain-language summary of the top predictors (FR-9)."""
    sorted_importance = sort_feature_importance(feature_importance)
    if not sorted_importance:
        return f"No feature importance is available for predicting '{target_column}'."

    top = list(sorted_importance.items())[:3]
    parts = [f"'{name}' ({value * 100:.0f}%)" for name, value in top]
    if len(parts) == 1:
        joined = parts[0]
    elif len(parts) == 2:
        joined = f"{parts[0]} and {parts[1]}"
    else:
        joined = f"{', '.join(parts[:-1])}, and {parts[-1]}"
    return f"The strongest predictors of '{target_column}' are {joined}."


def train_model(
    df: pd.DataFrame, column_types: dict[str, str], target_column: str, cache_key: CacheKey | None = None
) -> ModelOutcome:
    # Populates the cache so the simulator's first prediction — which the UI fires
    # as soon as a run renders — doesn't pay to fit the very model just built here.
    fitted = _fit_cached(df, column_types, target_column, cache_key)
    y_pred = fitted.pipeline.predict(fitted.X_test)

    if fitted.model_type == "regression":
        metrics = {
            "r2": round(float(r2_score(fitted.y_test, y_pred)), 4),
            "mae": round(float(mean_absolute_error(fitted.y_test, y_pred)), 4),
            "rmse": round(float(mean_squared_error(fitted.y_test, y_pred) ** 0.5), 4),
        }
    else:
        metrics = {
            "accuracy": round(float(accuracy_score(fitted.y_test, y_pred)), 4),
            "precision": round(float(precision_score(fitted.y_test, y_pred, average="weighted", zero_division=0)), 4),
            "recall": round(float(recall_score(fitted.y_test, y_pred, average="weighted", zero_division=0)), 4),
            "f1": round(float(f1_score(fitted.y_test, y_pred, average="weighted", zero_division=0)), 4),
        }

    feature_importance = _aggregate_feature_importance(fitted.pipeline, fitted.numeric_features, fitted.categorical_features)
    return ModelOutcome(
        model_type=fitted.model_type,
        algorithm="random_forest",
        metrics=metrics,
        feature_importance=feature_importance,
        training_row_count=fitted.training_row_count,
        available_row_count=fitted.available_row_count,
    )


def predict(
    df: pd.DataFrame,
    column_types: dict[str, str],
    target_column: str,
    feature_values: dict[str, object],
    cache_key: CacheKey | None = None,
) -> PredictionOutcome:
    """Live "what-if" prediction (FR-10) — feature_values may be partial;
    any feature not supplied (or not a real column) falls back to the
    training data's median/most-frequent value via the fitted imputer."""
    fitted = _fit_cached(df, column_types, target_column, cache_key)

    row = {col: feature_values.get(col) for col in fitted.feature_columns}
    input_df = pd.DataFrame([row], columns=fitted.feature_columns)
    for col in fitted.numeric_features:
        input_df[col] = pd.to_numeric(input_df[col], errors="coerce")

    prediction = fitted.pipeline.predict(input_df)[0]

    probabilities = None
    if fitted.model_type == "classification":
        proba = fitted.pipeline.predict_proba(input_df)[0]
        classes = fitted.pipeline.named_steps["model"].classes_
        probabilities = dict(
            sorted(
                ((str(cls), round(float(p), 4)) for cls, p in zip(classes, proba, strict=True)),
                key=lambda kv: kv[1],
                reverse=True,
            )
        )

    result = round(float(prediction), 4) if fitted.model_type == "regression" else str(prediction)
    return PredictionOutcome(prediction=result, probabilities=probabilities)
