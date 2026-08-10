import io
import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import numpy as np
import pandas as pd
from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import Dataset, ModelRun
from app.models import Session as SessionModel
from app.session import get_current_session

FIXED_SESSION_ID = uuid.uuid4()
DATASET_ID = uuid.uuid4()
RUN_ID = uuid.uuid4()


def _build_csv_bytes() -> bytes:
    rng = np.random.default_rng(0)
    n = 40
    age = rng.integers(20, 60, n)
    salary = rng.integers(30000, 90000, n)
    city = rng.choice(["Lahore", "Karachi", "Islamabad"], n)
    score = age * 500 + salary * 0.1 + rng.normal(0, 1000, n)
    df = pd.DataFrame({"age": age, "salary": salary, "city": city, "score": score})
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    return buf.getvalue().encode()


CSV_BYTES = _build_csv_bytes()


def _fake_dataset(model_runs=None):
    return SimpleNamespace(
        id=DATASET_ID,
        session_id=FIXED_SESSION_ID,
        raw_csv=CSV_BYTES,
        columns_profile=[
            SimpleNamespace(column_name="age", data_type="numeric"),
            SimpleNamespace(column_name="salary", data_type="numeric"),
            SimpleNamespace(column_name="city", data_type="categorical"),
            SimpleNamespace(column_name="score", data_type="numeric"),
        ],
        model_runs=model_runs or [],
    )


def override_get_current_session():
    return SessionModel(id=FIXED_SESSION_ID)


client = TestClient(app)


def _use_fixed_session():
    app.dependency_overrides[get_current_session] = override_get_current_session


def _refresh_side_effect(obj):
    # Mimics what a real commit+refresh would assign via server_default.
    if getattr(obj, "id", None) is None:
        obj.id = uuid.uuid4()
    if getattr(obj, "created_at", None) is None:
        obj.created_at = datetime.now(timezone.utc)


def test_train_model_selects_regression_and_persists():
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset()
    override_db.refresh.side_effect = _refresh_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/model", json={"target_column": "score"})

    assert response.status_code == 200
    body = response.json()
    assert body["model_type"] == "regression"
    assert body["algorithm"] == "random_forest"
    assert "r2" in body["metrics"]
    assert set(body["feature_importance"]) == {"age", "salary", "city"}
    assert "score" in body["feature_importance_summary"]
    assert override_db.add.called
    assert override_db.commit.called


def test_train_model_rejects_datetime_target():
    dataset = _fake_dataset()
    df = pd.DataFrame({"date": pd.date_range("2024-01-01", periods=15), "age": range(15)})
    buf = io.StringIO()
    df.to_csv(buf, index=False)
    dataset.raw_csv = buf.getvalue().encode()
    dataset.columns_profile = [
        SimpleNamespace(column_name="date", data_type="datetime"),
        SimpleNamespace(column_name="age", data_type="numeric"),
    ]
    override_db = MagicMock()
    override_db.get.return_value = dataset
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/model", json={"target_column": "date"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsupported_target_type"


def test_train_model_404_for_foreign_session():
    other_dataset = _fake_dataset()
    other_dataset.session_id = uuid.uuid4()
    override_db = MagicMock()
    override_db.get.return_value = other_dataset
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/model", json={"target_column": "score"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"


def test_list_model_runs_returns_persisted_runs_newest_first():
    older = ModelRun(
        id=uuid.uuid4(),
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.5},
        feature_importance={"age": 1.0},
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    newer = ModelRun(
        id=uuid.uuid4(),
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"salary": 1.0},
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset(model_runs=[older, newer])
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/model")

    assert response.status_code == 200
    body = response.json()
    assert [r["metrics"]["r2"] for r in body] == [0.9, 0.5]


def test_get_single_model_run():
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 0.6, "salary": 0.4},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/model/{RUN_ID}")

    assert response.status_code == 200
    body = response.json()
    assert body["metrics"]["r2"] == 0.9
    assert "'age' (60%)" in body["feature_importance_summary"]


def test_get_single_model_run_sorts_feature_importance_regardless_of_storage_order():
    # Regression test: Postgres JSONB does not preserve dict key order, so
    # simulate what a real round-trip produced in practice — a
    # feature_importance dict whose keys are NOT in descending-value order.
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.87},
        feature_importance={"city": 0.0093, "age": 0.9289, "bracket": 0.0056, "salary": 0.0562},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/model/{RUN_ID}")

    assert response.status_code == 200
    body = response.json()
    assert list(body["feature_importance"].keys()) == ["age", "salary", "city", "bracket"]
    assert body["feature_importance_summary"] == (
        "The strongest predictors of 'score' are 'age' (93%), 'salary' (6%), and 'city' (1%)."
    )


def test_predict_returns_numeric_prediction_for_regression_run():
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 0.6, "salary": 0.3, "city": 0.1},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(
        f"/api/datasets/{DATASET_ID}/model/{RUN_ID}/predict",
        json={"features": {"age": 40, "salary": 60000, "city": "Lahore"}},
    )

    assert response.status_code == 200
    body = response.json()
    assert isinstance(body["prediction"], (int, float))
    assert body["probabilities"] is None


def test_predict_with_partial_features_still_succeeds():
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 1.0},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    # no "features" key at all — should still succeed via imputation
    response = client.post(f"/api/datasets/{DATASET_ID}/model/{RUN_ID}/predict", json={})

    assert response.status_code == 200
    assert isinstance(response.json()["prediction"], (int, float))


def test_predict_404_for_wrong_dataset():
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=uuid.uuid4(),  # belongs to a different dataset
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 1.0},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(
        f"/api/datasets/{DATASET_ID}/model/{RUN_ID}/predict", json={"features": {"age": 40}}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_run_not_found"


def test_predict_404_for_foreign_session():
    other_dataset = _fake_dataset()
    other_dataset.session_id = uuid.uuid4()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=DATASET_ID,
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 1.0},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return other_dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(
        f"/api/datasets/{DATASET_ID}/model/{RUN_ID}/predict", json={"features": {"age": 40}}
    )

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"


def test_get_single_model_run_404_for_wrong_dataset():
    dataset = _fake_dataset()
    model_run = ModelRun(
        id=RUN_ID,
        dataset_id=uuid.uuid4(),  # belongs to a different dataset
        target_column="score",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.9},
        feature_importance={"age": 1.0},
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is ModelRun:
            return model_run
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/model/{RUN_ID}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "model_run_not_found"
