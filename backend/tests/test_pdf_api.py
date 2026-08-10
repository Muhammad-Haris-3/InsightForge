import uuid
from datetime import datetime, timezone
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


def _fake_dataset(**overrides):
    defaults = {
        "id": DATASET_ID,
        "session_id": FIXED_SESSION_ID,
        "raw_csv": CSV_BYTES,
        "original_filename": "sample.csv",
        "upload_time": datetime.now(timezone.utc),
        "row_count": 4,
        "column_count": 2,
        "duplicate_row_count": 0,
        "columns_profile": [
            SimpleNamespace(
                column_name="age",
                data_type="numeric",
                missing_count=0,
                missing_pct=0.0,
                unique_count=4,
                outlier_count=1,
                summary_stats={"mean": 53.25, "median": 21.5, "std": 63.0, "min": 20, "max": 150},
            ),
            SimpleNamespace(
                column_name="city",
                data_type="categorical",
                missing_count=0,
                missing_pct=0.0,
                unique_count=3,
                outlier_count=None,
                summary_stats={"top_value": "A", "top_frequency": 2},
            ),
        ],
        "test_results": [],
        "model_runs": [],
    }
    defaults.update(overrides)
    return SimpleNamespace(**defaults)


def override_get_current_session():
    return SessionModel(id=FIXED_SESSION_ID)


client = TestClient(app)


def _use_fixed_session():
    app.dependency_overrides[get_current_session] = override_get_current_session


def test_report_pdf_returns_pdf_bytes():
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset()
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/report/pdf")

    assert response.status_code == 200
    assert response.headers["content-type"] == "application/pdf"
    assert "attachment" in response.headers["content-disposition"]
    assert response.content.startswith(b"%PDF-")


def test_report_pdf_sanitizes_unsafe_filename_in_header():
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset(original_filename='weird "name"\r\n<b>.csv')
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/report/pdf")

    assert response.status_code == 200
    disposition = response.headers["content-disposition"]
    assert "\r" not in disposition and "\n" not in disposition and '"' not in disposition.split("filename=")[1][1:-1]


def test_report_pdf_includes_model_runs():
    model_run = SimpleNamespace(
        target_column="age",
        model_type="regression",
        algorithm="random_forest",
        metrics={"r2": 0.87, "mae": 1.68, "rmse": 2.11},
        feature_importance={"city": 0.1, "salary": 0.9},
        created_at=datetime.now(timezone.utc),
    )
    override_db = MagicMock()
    override_db.get.return_value = _fake_dataset(model_runs=[model_run])
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/report/pdf")

    assert response.status_code == 200
    assert response.content.startswith(b"%PDF-")


def test_report_pdf_404_for_foreign_session():
    other_dataset = _fake_dataset()
    other_dataset.session_id = uuid.uuid4()
    override_db = MagicMock()
    override_db.get.return_value = other_dataset
    app.dependency_overrides[get_db] = lambda: override_db
    _use_fixed_session()

    response = client.get(f"/api/datasets/{DATASET_ID}/report/pdf")

    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"
