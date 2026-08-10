import io
import uuid
from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


def override_get_db():
    yield MagicMock()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def test_upload_rejects_non_csv_file():
    response = client.post(
        "/api/datasets/upload",
        files={"file": ("data.txt", io.BytesIO(b"a,b\n1,2\n"), "text/plain")},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "invalid_file_type"


def test_upload_rejects_empty_file():
    response = client.post(
        "/api/datasets/upload",
        files={"file": ("data.csv", io.BytesIO(b""), "text/csv")},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "empty_file"


def test_upload_rejects_oversized_file():
    big = b"a,b\n" + b"1,2\n" * 3_000_000  # well over 10MB
    response = client.post(
        "/api/datasets/upload",
        files={"file": ("data.csv", io.BytesIO(big), "text/csv")},
    )
    assert response.status_code == 400
    assert response.json()["error"]["code"] == "file_too_large"


def test_upload_missing_file_returns_validation_error():
    response = client.post("/api/datasets/upload")
    assert response.status_code == 422
    assert response.json()["error"]["code"] == "validation_error"


def test_get_dataset_not_found_returns_404():
    override_db = MagicMock()
    override_db.get.return_value = None
    app.dependency_overrides[get_db] = lambda: override_db
    try:
        response = client.get(f"/api/datasets/{uuid.uuid4()}")
    finally:
        app.dependency_overrides[get_db] = override_get_db
    assert response.status_code == 404
    assert response.json()["error"]["code"] == "dataset_not_found"
