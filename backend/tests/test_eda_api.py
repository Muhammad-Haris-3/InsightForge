import uuid
from types import SimpleNamespace
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app
from app.models import Session as SessionModel
from app.session import get_current_session

FIXED_SESSION_ID = uuid.uuid4()
DATASET_ID = uuid.uuid4()

CSV_BYTES = b"age,city\n20,A\n21,B\n22,A\n150,C\n"


def _fake_dataset():
    return SimpleNamespace(
        id=DATASET_ID,
        session_id=FIXED_SESSION_ID,
        raw_csv=CSV_BYTES,
        columns_profile=[
            SimpleNamespace(column_name="age", data_type="numeric"),
            SimpleNamespace(column_name="city", data_type="categorical"),
        ],
    )


def override_get_current_session():
    return SessionModel(id=FIXED_SESSION_ID)


client = TestClient(app)


def test_eda_report_returns_distributions_and_correlation():
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset()
    app.dependency_overrides[get_db] = lambda: override_db
    # Set per-test, not at module level — this dict is shared across every test
    # module in the run, and another file's FIXED_SESSION_ID would otherwise win
    # depending on collection order (session_id mismatch -> spurious 404).
    app.dependency_overrides[get_current_session] = override_get_current_session

    response = client.get(f"/api/datasets/{DATASET_ID}/eda")

    assert response.status_code == 200
    body = response.json()
    assert body["numeric_distributions"][0]["column_name"] == "age"
    assert body["categorical_frequencies"][0]["column_name"] == "city"
    assert body["correlation_matrix"] is None  # only one numeric column


def test_eda_report_404_for_foreign_session():
    other_dataset = _fake_dataset()
    other_dataset.session_id = uuid.uuid4()  # belongs to a different session
    override_db = MagicMock()
    override_db.get.return_value = other_dataset
    app.dependency_overrides[get_db] = lambda: override_db
    app.dependency_overrides[get_current_session] = override_get_current_session

    response = client.get(f"/api/datasets/{DATASET_ID}/eda")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"
