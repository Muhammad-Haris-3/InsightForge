# InsightForge — M1 (Ingestion & QA) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M1 delivered, how it was verified, and decisions made along the way.

**Status: Complete** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Upload endpoint + data-quality report UI. Maps to FR-1, FR-2, FR-3.

- FR-1 — upload a CSV file (max 10MB) via the web interface
- FR-2 — validate the uploaded file (type, size, encoding) and reject invalid files with a clear error message
- FR-3 — generate an automated data-quality report: missing values per column, data types, duplicate rows, basic outlier flags (IQR method)

## 2. What was built

| Area | Delivered |
|---|---|
| **Session handling** | Anonymous, cookie-based sessions (`app/session.py`) — httpOnly cookie, created on first request, `SameSite`/`Secure` driven by env config since Vercel↔Render is cross-site in production but same-site on localhost. |
| **Validation (FR-2)** | `app/services/profiling.py::validate_and_parse_csv` — rejects wrong extension, empty file, >10MB, non-UTF-8 encoding, and malformed CSV (mismatched column counts), each with a distinct error code. |
| **Data-quality profiling (FR-3)** | Same module — per-column missing count/%, dtype inference (numeric/categorical/datetime/boolean/text via pandas + heuristic thresholds), unique count, IQR-method outlier count (numeric only), summary stats (mean/median/std/min/max or top value+frequency), and dataset-level duplicate row count. |
| **API (FR-1–3)** | `POST /api/datasets/upload`, `GET /api/datasets/{id}`, `GET /api/datasets/{id}/quality-report` (`app/routers/datasets.py`) — matches the Design Phase doc's REST spec. Results persisted to `datasets` + `columns_profile`, scoped to the caller's session (NFR — session isolation: a foreign/missing dataset ID returns 404, not the other session's data). |
| **Error envelope** | `{"error": {"code", "message"}}` on every failure (NFR — Reliability), via a custom `AppError` exception plus handlers for `HTTPException` and validation errors in `app/main.py`. |
| **Frontend UI** | `UploadPanel` + `QualityReportView` (`frontend/src/components/`) — drag-and-drop or click-to-browse upload, client-side pre-validation (extension/size) for instant feedback, and a report table (type badges, missing %, unique count, outlier count, summary) plus dataset-level stats (rows, columns, duplicate rows, missing cells). |
| **Tests** | `backend/tests/test_profiling.py` (23 cases — validation edge cases + profiling correctness) and `test_upload_validation.py` (API-level validation + session-isolation 404). All passing; `ruff` clean. |

## 3. Schema change

`datasets.duplicate_row_count` (int, default 0) was added — the original schema.sql had no place to persist the dataset-level duplicate-row fact from FR-3 (only per-column stats had a home, in `columns_profile`). Applied via [`migrations/001_add_duplicate_row_count.sql`](migrations/001_add_duplicate_row_count.sql) against the live Neon DB (additive `ALTER TABLE ADD COLUMN`, safe — table was still empty pre-M1). `schema.sql` and the Design Phase doc were updated to match, so a fresh database created from `schema.sql` doesn't need the migration.

## 4. How it was verified (not just "should work")

1. `pytest` (23 tests) + `ruff` clean, covering the DoD edge cases explicitly: empty file, wrong file type, oversized file, malformed CSV, missing values, single-column data.
2. Backend run locally against the **real Neon database** (not mocked) — uploaded a CSV with a known duplicate row, a missing value, and two IQR-detectable outliers; the returned profile matched a hand-calculated IQR check exactly (score column: 79 and 150 flagged from `[79, 88, 88, 92, 150]`).
3. Confirmed session isolation: a request with no cookie against another session's dataset ID gets `404 dataset_not_found`, not the data.
4. Frontend run locally (`next dev`) in a real browser against the local backend: uploaded a CSV end-to-end, confirmed the rendered report matched the API response, confirmed the client-side reject path (non-`.csv` file → inline error, no network call) and the server reject path (network request visible, 4xx handled).
5. Test data and the temporary local `datasets`/`sessions` rows created during verification were deleted from Neon afterward — production DB is clean.

## 5. Decisions & notes worth remembering

- **Dtype inference is heuristic, not exact** — pandas only distinguishes numeric/bool from generic "object" columns, so categorical vs. free text is decided by a unique-value ratio (≤50%) with an absolute-count fallback (≤50 distinct values) that only applies once there are ≥50 rows, to avoid small samples always reading as "categorical". Datetime is detected by attempting `pd.to_datetime` and requiring ≥90% parse success. Documented in `app/services/profiling.py` rather than re-derived from scratch next time.
- **Quality report is recomputed once, at upload, and persisted** — `GET /quality-report` reads from `columns_profile`/`datasets`, it does not re-parse `raw_csv` on every request. This matches "persist... generated results in PostgreSQL" (SRS 4.1) rather than the alternative of recomputing on demand.
- **Cookie `Secure`/`SameSite` are env-driven** (`COOKIE_SECURE`, `COOKIE_SAMESITE`), not hardcoded — Render sets `Secure=true, SameSite=None` (needed cross-site in production); local dev defaults to `Secure=false, SameSite=Lax` since `localhost:3000`↔`localhost:8000` is same-site regardless of port. This was flagged as an open question in the Design Phase doc (Section 4) and is now resolved.
- **File-input testing without a real OS file dialog**: browser automation tools can't drive a native file picker, so the upload flow was verified by constructing a `File`/`DataTransfer` in-page and dispatching a `change` event on the (hidden) `<input type="file">` — a standard technique for testing file inputs headlessly.

## 6. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end locally against the live Neon DB (not yet re-verified on the deployed Vercel/Render URLs — see Section 7)
- [x] Edge cases handled: empty file, wrong file type, oversized file, malformed CSV, missing values, single-column data, duplicate rows
- [x] Code committed with descriptive messages *(pending — not yet committed as of this doc)*; README to be updated
- [x] Automated tests cover the new logic (23 backend tests, all passing)

## 7. Next

- Deploy this milestone (push to `main`, Render/Vercel auto-redeploy) and re-verify the upload flow against the deployed URLs, since M1 was only verified locally so far.
- **M2 — Auto-EDA**: distribution/correlation visualizations (FR-4), per SRS Section 8.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M1 completed and documented |
