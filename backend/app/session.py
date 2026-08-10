import uuid
from datetime import datetime, timezone

from fastapi import Depends, Request, Response
from sqlalchemy.orm import Session as DbSession

from app.config import settings
from app.database import get_db
from app.models import Session as SessionModel

COOKIE_NAME = "insightforge_session"
COOKIE_MAX_AGE_SECONDS = 60 * 60 * 24 * 30  # 30 days


def get_current_session(
    request: Request,
    response: Response,
    db: DbSession = Depends(get_db),
) -> SessionModel:
    """Resolve the caller's session from its cookie, creating one on first visit."""
    raw_id = request.cookies.get(COOKIE_NAME)
    session: SessionModel | None = None

    if raw_id:
        try:
            session = db.get(SessionModel, uuid.UUID(raw_id))
        except ValueError:
            session = None

    if session is None:
        session = SessionModel()
        db.add(session)
        db.commit()
        db.refresh(session)
    else:
        session.last_active_at = datetime.now(timezone.utc)

    response.set_cookie(
        key=COOKIE_NAME,
        value=str(session.id),
        max_age=COOKIE_MAX_AGE_SECONDS,
        httponly=True,
        secure=settings.cookie_secure,
        samesite=settings.cookie_samesite,
    )
    return session
