import uuid
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import Dataset, TestResult
from app.models import Session as SessionModel
from app.session import get_current_session

FIXED_SESSION_ID = uuid.uuid4()
DATASET_ID = uuid.uuid4()
TEST_ID = uuid.uuid4()

# Two-group categorical vs. numeric -> t-test; clearly separated so it's significant.
CSV_BYTES = b"group,score\n" + b"".join(f"A,{v}\n".encode() for v in range(1, 11)) + b"".join(
    f"B,{v}\n".encode() for v in range(101, 111)
)


def _fake_dataset(test_results=None):
    return SimpleNamespace(
        id=DATASET_ID,
        session_id=FIXED_SESSION_ID,
        raw_csv=CSV_BYTES,
        columns_profile=[
            SimpleNamespace(column_name="group", data_type="categorical"),
            SimpleNamespace(column_name="score", data_type="numeric"),
        ],
        test_results=test_results or [],
    )


def override_get_current_session():
    return SessionModel(id=FIXED_SESSION_ID)


client = TestClient(app)


def _use_fixed_session():
    # Set per-test, not at module level — dependency_overrides is shared across
    # every test module in the run, and another file's FIXED_SESSION_ID would
    # otherwise win depending on collection order (session_id mismatch -> 404).
    app.dependency_overrides[get_current_session] = override_get_current_session


def _refresh_side_effect(obj):
    # Mimics what a real commit+refresh would assign via server_default.
    if getattr(obj, "id", None) is None:
        obj.id = uuid.uuid4()
    if getattr(obj, "created_at", None) is None:
        obj.created_at = datetime.now(timezone.utc)


def test_run_test_selects_t_test_and_persists():
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset()
    override_db.refresh.side_effect = _refresh_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/tests", json={"column_a": "group", "column_b": "score"})

    assert response.status_code == 200
    body = response.json()
    assert body["test_type"] == "t_test"
    assert body["p_value"] < 0.05
    assert override_db.add.called
    assert override_db.commit.called


def test_run_test_rejects_numeric_numeric_pairing():
    dataset = _fake_dataset()
    dataset.columns_profile = [
        SimpleNamespace(column_name="a", data_type="numeric"),
        SimpleNamespace(column_name="b", data_type="numeric"),
    ]
    dataset.raw_csv = b"a,b\n1,4\n2,3\n3,2\n4,1\n"
    override_db = MagicMock()
    override_db.get.return_value = dataset
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/tests", json={"column_a": "a", "column_b": "b"})

    assert response.status_code == 400
    assert response.json()["error"]["code"] == "unsupported_test_pairing"


def test_run_test_404_for_foreign_session():
    other_dataset = _fake_dataset()
    other_dataset.session_id = uuid.uuid4()
    override_db = MagicMock()
    override_db.get.return_value = other_dataset
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.post(f"/api/datasets/{DATASET_ID}/tests", json={"column_a": "group", "column_b": "score"})

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"


def test_list_tests_returns_persisted_results_newest_first():
    older = TestResult(
        id=uuid.uuid4(),
        dataset_id=DATASET_ID,
        test_type="chi_square",
        column_a="x",
        column_b="y",
        statistic=1.0,
        p_value=0.5,
        conclusion="older",
        created_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    newer = TestResult(
        id=uuid.uuid4(),
        dataset_id=DATASET_ID,
        test_type="t_test",
        column_a="group",
        column_b="score",
        statistic=2.0,
        p_value=0.01,
        conclusion="newer",
        created_at=datetime(2026, 6, 1, tzinfo=timezone.utc),
    )
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset(test_results=[older, newer])
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/tests")

    assert response.status_code == 200
    body = response.json()
    assert [t["conclusion"] for t in body] == ["newer", "older"]


def test_get_single_test_result():
    dataset = _fake_dataset()
    test_result = TestResult(
        id=TEST_ID,
        dataset_id=DATASET_ID,
        test_type="anova",
        column_a="group",
        column_b="score",
        statistic=5.0,
        p_value=0.02,
        conclusion="significant",
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is TestResult:
            return test_result
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/tests/{TEST_ID}")

    assert response.status_code == 200
    assert response.json()["conclusion"] == "significant"


def test_get_single_test_result_404_for_wrong_dataset():
    dataset = _fake_dataset()
    test_result = TestResult(
        id=TEST_ID,
        dataset_id=uuid.uuid4(),  # belongs to a different dataset
        test_type="anova",
        column_a="group",
        column_b="score",
        statistic=5.0,
        p_value=0.02,
        conclusion="significant",
        created_at=datetime.now(timezone.utc),
    )

    def get_side_effect(model, obj_id):
        if model is Dataset:
            return dataset
        if model is TestResult:
            return test_result
        return None

    override_db = MagicMock()
    override_db.get.side_effect = get_side_effect
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/tests/{TEST_ID}")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "test_not_found"
