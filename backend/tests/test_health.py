from unittest.mock import MagicMock

from fastapi.testclient import TestClient

from app.database import get_db
from app.main import app


def override_get_db():
    yield MagicMock()


app.dependency_overrides[get_db] = override_get_db
client = TestClient(app)


def test_health_returns_ok():
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"status": "ok"}
