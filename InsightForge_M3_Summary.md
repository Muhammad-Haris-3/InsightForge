# InsightForge — M3 (Statistical Testing) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M3 delivered, how it was verified, and decisions made along the way.

**Status: Complete** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Test selection engine + interpretation. Maps to FR-5, FR-6.

- FR-5 — allow the user to select two columns and run an appropriate statistical test (t-test, chi-square, or ANOVA, auto-selected by data type), returning the test statistic and p-value.
- FR-6 — return a plain-language interpretation of the result, and persist/list/retrieve past test runs.

## 2. What was built

| Area | Delivered |
|---|---|
| **Test-selection engine (FR-5)** | `app/services/stats_tests.py::select_and_run_test` — picks the test from the two columns' persisted `data_type` (reused from `columns_profile`, same pattern as M2's EDA engine): categorical/boolean × categorical/boolean → chi-square (`scipy.stats.chi2_contingency`); categorical/boolean × numeric → Welch's t-test if the grouping column has exactly 2 groups (`scipy.stats.ttest_ind(equal_var=False)`), one-way ANOVA if 3+ groups (`scipy.stats.f_oneway`); numeric × numeric is explicitly rejected (`unsupported_test_pairing`) — that relationship is already covered by the M2 correlation matrix, not by a hypothesis test. Column order in the request doesn't matter; the grouping vs. value role is inferred from type, not position. |
| **Plain-language interpretation (FR-6)** | Every outcome includes a `conclusion` string built from the actual column/group names and the p-value against α=0.05 (e.g. *"There is a statistically significant difference in 'age' across the 4 groups of 'city' (p=0.0012)."*) — not just the raw statistic. |
| **API (FR-5, FR-6)** | `POST /api/datasets/{id}/tests` (body `{column_a, column_b}`, runs and persists a test), `GET /api/datasets/{id}/tests` (list, newest first), `GET /api/datasets/{id}/tests/{test_id}` (single result) — matches the Design Phase doc's REST spec exactly. All three reuse `_get_owned_dataset` for session isolation, consistent with every other dataset-scoped endpoint. |
| **Frontend UI** | `StatsTestPanel` (`frontend/src/components/StatsTestPanel.tsx`) — two column dropdowns (type shown inline, e.g. "city (categorical)"), a "Run Test" button, and a running list of persisted results (test-type badge, statistic, p-value, plain-language conclusion, timestamp), newest first. Wired into `UploadPanel` below the EDA section, only shown when the dataset has ≥2 columns; keyed by `report.id` so a new upload resets it rather than carrying over the previous dataset's test history. |
| **Tests** | `backend/tests/test_stats_tests.py` (13 cases — t-test/ANOVA/chi-square selection by group count, boolean-as-groupable, column-order independence, and every rejection path: numeric×numeric, datetime involved, same column twice, missing column, single group, undersized group, single-category chi-square, zero-variance/NaN-statistic groups) and `test_stats_api.py` (6 cases — endpoint-level: successful run + persistence, unsupported-pairing 400, foreign-session 404, list ordering, single-result fetch, cross-dataset 404 on a test ID). All passing; `ruff` clean. |

## 3. Schema change

None. `test_results` already existed in the live schema from M0 (`schema.sql`, applied at initial setup) — confirmed via `information_schema.columns` against the production Neon database before starting, so this was a pure application-layer milestone.

## 4. How it was verified (not just "should work")

1. `pytest` (55 tests total, 19 new) + `ruff` clean. Edge cases explicitly covered: numeric-numeric pairing rejected, unsupported dtypes (datetime) rejected, same column selected twice, a column name that doesn't exist, a grouping column with only 1 distinct value, a group with fewer than 2 observations, a chi-square pairing where one column has only 1 category, and zero-variance groups (which would otherwise produce a NaN t-statistic and fail the `p_value BETWEEN 0 AND 1` DB constraint on insert — caught explicitly before persistence with a clear `insufficient_data` error instead of a 500).
2. Backend run locally against the **real Neon database**, driven through a real browser: uploaded an 18-row CSV and ran three tests through the actual UI — `age` (numeric) × `city` (categorical, 4 groups) correctly selected ANOVA (statistic 9.42, p=0.0012, correctly flagged significant); `city` × `active` (both categorical/boolean) correctly selected chi-square (p=0.955, correctly flagged not significant); `age` × `salary` (both numeric) was rejected with the `unsupported_test_pairing` message, rendered inline rather than silently failing.
3. Confirmed results persist and stack newest-first in the UI, matching the `GET /tests` ordering.
4. Frontend rendered with no console errors; verified via network inspection that `POST /tests` returned 200 with the exact statistic/p-value/conclusion shown on screen.
5. Test data (and cascaded `test_results` rows) deleted from Neon afterward — production DB is clean.

## 5. Decisions & notes worth remembering

- **Boolean columns are groupable, same as categorical** — a 2-level boolean column (`active`: true/false) is a natural 2-group t-test candidate, so `stats_tests.py` treats `{"categorical", "boolean"}` as one "groupable" bucket, mirroring the same choice already made for EDA frequency charts in M2.
- **Numeric × numeric is a hard rejection, not a fallback to correlation** — the SRS's test-type enum (`t_test`/`chi_square`/`anova`) and the DB's `CHECK` constraint on `test_type` don't include a correlation/regression test, and the EDA correlation matrix (M2) already answers "how related are these two numeric columns" without needing a formal hypothesis test. The 400 error message points the user at that existing feature instead of just saying "no."
- **A NaN statistic/p-value is caught before persistence, not after** — scipy returns `nan` (with a `RuntimeWarning`, doesn't raise) for degenerate inputs like two zero-variance groups, rather than throwing. Inserting that would violate the `p_value BETWEEN 0 AND 1` CHECK constraint at the DB level, i.e. a confusing 500 instead of a clear 400. `_finite_or_raise` checks both values with `math.isfinite` right after computing, before any `TestResult` is constructed.
- **Group selection is order-independent** — the request just takes `column_a`/`column_b`; the service inspects each column's persisted `data_type` to decide which one is the grouping variable and which is the value, so `{a: numeric, b: categorical}` and `{a: categorical, b: numeric}` both run the same test. The persisted `column_a`/`column_b` on `test_results` still reflect exactly what the caller sent, for traceability.
- **`StatsTestPanel` is keyed by `report.id`** in `UploadPanel` — without the `key`, React would keep the same component instance (and its `results` state) across a second upload in the same session, showing a previous dataset's test history alongside a new dataset's quality report. This is the same "reset on new dataset" concern as `UploadPanel`'s own state resets on `upload()`.

## 6. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end locally against the real Neon database, driven through the actual UI — not yet re-verified on the deployed URL (pending push/redeploy)
- [x] Edge cases handled: unsupported dtype pairings, same-column selection, missing columns, insufficient/degenerate data (single group, undersized group, zero variance, single-category chi-square)
- [ ] Code committed with a descriptive message; README updated — pending
- [x] Automated tests cover the new logic (19 new backend tests, all passing)

## 7. Next

**M4 — Reporting**: PDF export of the quality report + EDA highlights + test results (FR-7), per SRS Section 8.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M3 built and locally verified |
