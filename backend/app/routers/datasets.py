import io
import re
import uuid

import pandas as pd
from fastapi import APIRouter, Depends, File, UploadFile
from fastapi.responses import Response
from sqlalchemy.orm import Session as DbSession

from app.database import get_db
from app.errors import AppError
from app.models import ColumnProfile, Dataset, TestResult
from app.models import Session as SessionModel
from app.schemas import (
    ColumnProfileOut,
    DatasetOut,
    EdaReportOut,
    QualityReportOut,
    TestRequestIn,
    TestResultOut,
)
from app.services.eda import build_eda_payload
from app.services.pdf_report import generate_report_pdf
from app.services.profiling import profile_dataframe, validate_and_parse_csv
from app.services.stats_tests import select_and_run_test
from app.session import get_current_session

_UNSAFE_FILENAME_CHARS = re.compile(r"[^A-Za-z0-9._ -]")

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


def _build_eda_report(df: pd.DataFrame, dataset: Dataset) -> EdaReportOut:
    column_types = {c.column_name: c.data_type for c in dataset.columns_profile}
    payload = build_eda_payload(df, column_types)
    return EdaReportOut(
        numeric_distributions=payload.numeric_distributions,
        categorical_frequencies=payload.categorical_frequencies,
        correlation_matrix=payload.correlation_matrix,
    )


def _load_dataframe(dataset: Dataset) -> pd.DataFrame:
    # raw_csv was already validated (type/encoding) at upload time (FR-2), so a
    # plain parse is safe here — no need to re-run validate_and_parse_csv.
    return pd.read_csv(io.StringIO(dataset.raw_csv.decode("utf-8")))


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
    result = _build_quality_report(dataset)
    # Embed the EDA payload directly in the upload response (rather than making
    # the frontend do a separate GET /eda round trip) — the session cookie is
    # cross-site (Vercel <-> Render) and some browsers block it by default, which
    # would otherwise 404 the follow-up call on a visitor's very first upload.
    result.eda = _build_eda_report(df, dataset)
    return result


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


@router.get("/{dataset_id}/eda", response_model=EdaReportOut)
def get_eda_report(
    dataset_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> EdaReportOut:
    dataset = _get_owned_dataset(dataset_id, session, db)
    return _build_eda_report(_load_dataframe(dataset), dataset)


@router.post("/{dataset_id}/tests", response_model=TestResultOut)
def run_test(
    dataset_id: uuid.UUID,
    body: TestRequestIn,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> TestResult:
    dataset = _get_owned_dataset(dataset_id, session, db)
    df = _load_dataframe(dataset)
    column_types = {c.column_name: c.data_type for c in dataset.columns_profile}
    outcome = select_and_run_test(df, column_types, body.column_a, body.column_b)

    test_result = TestResult(
        dataset_id=dataset.id,
        test_type=outcome.test_type,
        column_a=body.column_a,
        column_b=body.column_b,
        statistic=outcome.statistic,
        p_value=outcome.p_value,
        conclusion=outcome.conclusion,
    )
    db.add(test_result)
    db.commit()
    db.refresh(test_result)
    return test_result


@router.get("/{dataset_id}/tests", response_model=list[TestResultOut])
def list_tests(
    dataset_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> list[TestResult]:
    dataset = _get_owned_dataset(dataset_id, session, db)
    return sorted(dataset.test_results, key=lambda t: t.created_at, reverse=True)


@router.get("/{dataset_id}/tests/{test_id}", response_model=TestResultOut)
def get_test(
    dataset_id: uuid.UUID,
    test_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> TestResult:
    dataset = _get_owned_dataset(dataset_id, session, db)
    test_result = db.get(TestResult, test_id)
    if test_result is None or test_result.dataset_id != dataset.id:
        raise AppError(404, "test_not_found", "No test result found with that ID.")
    return test_result


@router.get("/{dataset_id}/report/pdf")
def get_report_pdf(
    dataset_id: uuid.UUID,
    session: SessionModel = Depends(get_current_session),
    db: DbSession = Depends(get_db),
) -> Response:
    dataset = _get_owned_dataset(dataset_id, session, db)
    column_types = {c.column_name: c.data_type for c in dataset.columns_profile}
    eda_payload = build_eda_payload(_load_dataframe(dataset), column_types)
    pdf_bytes = generate_report_pdf(dataset, dataset.columns_profile, eda_payload, dataset.test_results)

    stem = dataset.original_filename.rsplit(".", 1)[0]
    # original_filename is user-supplied — strip anything but a safe character
    # set before it goes into a response header (avoid header-injection / a
    # malformed Content-Disposition from stray quotes, CR/LF, etc.).
    safe_stem = _UNSAFE_FILENAME_CHARS.sub("_", stem)[:100] or "dataset"
    filename = f"{safe_stem}_insightforge_report.pdf"

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
