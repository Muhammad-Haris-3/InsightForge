import uuid

from fastapi import APIRouter, Depends, File, UploadFile
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.errors import AppError
from app.models import ColumnProfile, Dataset
from app.models import Session as SessionModel
from app.schemas import ColumnProfileOut, DatasetOut, QualityReportOut
from app.services.profiling import profile_dataframe, validate_and_parse_csv
from app.session import get_current_session

router = APIRouter(prefix="/datasets", tags=["datasets"])


def _get_owned_dataset(dataset_id: uuid.UUID, session: SessionModel, db: DbSession) -> Dataset:
    dataset = db.get(Dataset, dataset_id)
    if dataset is None or dataset.session_id != session.id:
        # 404, not 403 — don't reveal whether the ID belongs to someone else (NFR: session isolation)
        raise AppError(404, "dataset_not_found", "No dataset found with that ID.")
    return dataset


def _build_quality_report(dataset: Dataset) -> QualityReportOut:
    return QualityReportOut(
        id=dataset.id,
        original_filename=dataset.original_filename,
        row_count=dataset.row_count,
        column_count=dataset.column_count,
        file_size_bytes=dataset.file_size_bytes,
        duplicate_row_count=dataset.duplicate_row_count,
        upload_time=dataset.upload_time,
        columns=[ColumnProfileOut.model_validate(c) for c in dataset.columns_profile],
    )


@router.post("/upload", response_model=QualityReportOut)
async def upload_dataset(
    file: UploadFile = File(...),
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> QualityReportOut:
    raw = await file.read()
    df = validate_and_parse_csv(file.filename or "", raw)
    profile = profile_dataframe(df)

    dataset = Dataset(
        session_id=session.id,
        original_filename=file.filename,
        row_count=df.shape[0],
        column_count=df.shape[1],
        file_size_bytes=len(raw),
        raw_csv=raw,
        duplicate_row_count=profile.duplicate_row_count,
    )
    db.add(dataset)
    db.flush()  # assigns dataset.id for the columns_profile FK below

    for col in profile.columns:
        db.add(
            ColumnProfile(
                dataset_id=dataset.id,
                column_name=col.column_name,
                data_type=col.data_type,
                missing_count=col.missing_count,
                missing_pct=col.missing_pct,
                unique_count=col.unique_count,
                outlier_count=col.outlier_count,
                summary_stats=col.summary_stats,
            )
        )

    db.commit()
    db.refresh(dataset)
    return _build_quality_report(dataset)


@router.get("/{dataset_id}", response_model=DatasetOut)
def get_dataset(
    dataset_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> Dataset:
    return _get_owned_dataset(dataset_id, session, db)


@router.get("/{dataset_id}/quality-report", response_model=QualityReportOut)
def get_quality_report(
    dataset_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> QualityReportOut:
    dataset = _get_owned_dataset(dataset_id, session, db)
    return _build_quality_report(dataset)
