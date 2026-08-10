# InsightForge — M2 (Auto-EDA) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M2 delivered, how it was verified, and decisions made along the way.

**Status: Complete** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Distribution/correlation visualizations. Maps to FR-4.

- FR-4 — generate automated exploratory visualizations: distribution plots for numeric columns, frequency bar charts for categorical columns, and a correlation matrix.

## 2. What was built

| Area | Delivered |
|---|---|
| **EDA engine (FR-4)** | `app/services/eda.py::build_eda_payload` — 10-bin histograms (`numpy.histogram`) per numeric column, top-10 + "Other" frequency counts per categorical/boolean column, and a Pearson correlation matrix (`DataFrame.corr()`) across all numeric columns. Reuses the `data_type` classification already computed and persisted at upload (M1's `columns_profile`) instead of re-deriving types — keeps EDA consistent with the quality report by construction. |
| **API (FR-4)** | `GET /api/datasets/{id}/eda` (`app/routers/datasets.py`) — matches the Design Phase doc's REST spec. Re-parses `raw_csv` (already validated at upload) into a DataFrame and returns the EDA payload as JSON, computed on demand rather than persisted (no `eda_results` table exists in the schema — a deliberate design choice, see Section 5). |
| **Frontend UI** | `EdaView` (`frontend/src/components/EdaView.tsx`) — Recharts bar charts for numeric histograms and categorical frequencies, plus a hand-rolled correlation heatmap (color-intensity grid, green for positive/red for negative correlation, since Recharts has no built-in heatmap primitive). Wired into `UploadPanel`: `report.eda` is embedded directly in the `POST /upload` response and rendered below the quality report — matches the NFR-Usability goal of "upload to first insight without reading instructions". |
| **Tests** | `backend/tests/test_eda.py` (11 cases — histogram binning incl. single-unique-value and missing-value edge cases, category "Other" bucketing, correlation matrix incl. `None` for constant columns and datasets with <2 numeric columns) and `test_eda_api.py` (endpoint-level: 200 with correct payload shape, 404 for a foreign session's dataset ID). All passing; `ruff` clean. |

## 3. Schema change

None. The Design Phase doc's schema has no `eda_results` table — EDA is computed fresh from `datasets.raw_csv` on each request rather than persisted (see Section 5).

## 4. How it was verified (not just "should work")

1. `pytest` (36 tests total, 11 new) + `ruff` clean, covering histogram/frequency/correlation edge cases: single-unique-value numeric column, missing values excluded from bins/counts, long-tail categorical columns bucketed as "Other", constant columns producing a `null` (undefined) correlation cell, datasets with fewer than 2 numeric columns returning `correlation_matrix: null`.
2. Backend run locally against the **real Neon database**: uploaded an 18-row CSV (`age`, `city`, `salary` with one missing value and one outlier, `active` boolean) through a real browser session, confirmed via network inspection that both `/upload` and `/eda` returned 200 with correct payloads — histogram bin counts summed to the non-missing row count, category counts matched hand-tally, correlation matrix matched a manual `age`/`salary` correlation check (0.4484).
3. Confirmed the boolean `active` column correctly appears in `categorical_frequencies` (True/False counts) rather than being silently dropped.
4. Confirmed session isolation still holds: `GET /eda` on another session's dataset ID returns `404 dataset_not_found`, not the data (mirrors the M1 check for `/quality-report`).
5. Frontend rendered all three sections correctly in a real browser (histograms, category bar charts, correlation heatmap) with no console errors; page text/DOM inspection confirmed chart data matched the API response.
6. Test data and the temporary local `datasets` row created during verification were deleted from Neon afterward — production DB is clean.
7. Pushed to `main` (`53e4fcb`); confirmed the deploy on the actual production URLs (`insight-forge-beta.vercel.app` → `insightforge-api-muyx.onrender.com`) — Render auto-redeployed and `GET /api/datasets/{id}/eda` was live within the push-to-deploy window (confirmed via a probe returning `dataset_not_found` for a random ID, i.e. the route exists). Uploaded the same 18-row CSV through the live frontend: quality report and all three EDA sections (histograms, category frequencies, correlation matrix) rendered correctly cross-site. Verification row deleted from Neon afterward.
8. **Regression found and fixed post-deploy**: the user hit it live — after uploading, the EDA section simply didn't appear (no error, no charts), on a fresh Chrome profile with the "third-party cookies blocked" indicator active in the address bar. Root cause: the original implementation fetched `GET /eda` as a *second* request right after `POST /upload`, relying on the session cookie surviving the round trip. That cookie is cross-site (`SameSite=None`, Vercel↔Render are different domains), so a browser blocking third-party cookies by default drops it — the follow-up request then creates a brand-new anonymous session and 404s (`dataset_not_found`) against the dataset it had just uploaded a moment earlier, and the original code silently swallowed that failure. Reproduced directly with `fetch(..., { credentials: "omit" })` against the live backend: `/upload` → 200, `/eda` on the returned ID → 404. **Fix** (`7bec20a`): `POST /upload` now computes and returns the EDA payload inline (the DataFrame is already in memory from profiling — negligible extra cost), so the first view of a dataset needs zero follow-up requests and has no cookie dependency at all. `GET /eda` is kept for re-fetching an existing dataset's EDA later (e.g. a future "reopen a past upload" flow), where the cookie requirement is unavoidable. Re-verified end-to-end on production after Render's redeploy: a `credentials: "omit"` upload against `insightforge-api-muyx.onrender.com` now returns `eda` inline, and a real browser upload through `insight-forge-beta.vercel.app` renders all three EDA sections immediately. Verification rows deleted from Neon afterward.

## 5. Decisions & notes worth remembering

- **EDA is computed on-demand, not persisted** — unlike the quality report (M1, persisted to `columns_profile` at upload), there's no `eda_results` table in the schema. `GET /eda` re-parses `raw_csv` and recomputes on every call. This was a deliberate choice: EDA payloads are cheap to recompute (histogram/value_counts/corr on an in-memory DataFrame, already the pattern used for quality profiling) and don't need the "persist generated results" treatment that quality reports get, since nothing downstream (PDF export, tests, modeling) depends on a stored EDA snapshot the way FR-3's stats do. Revisit if profiling a 100k-row dataset on every `/eda` call proves too slow against the 15s NFR — not yet measured at that scale.
- **`data_type` is reused from `columns_profile`, not re-inferred** — avoids a second heuristic pass (and a second source of truth) for numeric/categorical/boolean/text classification. `boolean` columns are treated as categorical for frequency-chart purposes (True/False counts), since a 2-bar frequency chart is more useful than a meaningless "distribution".
- **Correlation matrix is `null`, not an empty matrix, when fewer than 2 numeric columns exist** — makes "no correlation to show" explicit in the API contract rather than the frontend having to special-case a 1×1 or 0×0 matrix.
- **Heatmap is hand-rolled, not a Recharts component** — Recharts (already a dependency, used for the bar charts) has no heatmap chart type; a small CSS-grid table with `rgba()` background intensity was simpler than pulling in another charting library for one visualization.
- **EDA rides along in the upload response instead of a separate authenticated fetch** — see item 8 in Section 4. Any endpoint the frontend calls *immediately* after upload, before the browser has necessarily accepted the session cookie, should return what it needs inline rather than assume the cookie round-tripped. This is now the pattern for the "first view" of anything computed from a just-uploaded dataset; a later, deliberate re-fetch (e.g. reopening a dataset from history) is a different case where requiring the cookie is fine.

## 6. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end on the deployed URL, not just locally — verified on both localhost and the live Vercel/Render URLs
- [x] Edge cases handled: single-unique-value numeric column, missing values, long-tail categorical columns, constant columns (undefined correlation), fewer than 2 numeric columns, boolean columns
- [x] Code committed with a descriptive message (`53e4fcb`); README updated
- [x] Automated tests cover the new logic (11 new backend tests, all passing)

## 7. Next

**M3 — Statistical Testing**: test-selection engine (t-test/chi-square/ANOVA, auto-selected by dtype) + plain-language interpretation (FR-5, FR-6), per SRS Section 8.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M2 built and locally verified |
| 1.1 | August 10, 2026 | Fixed a production regression: EDA charts didn't render for browsers blocking third-party cookies (found live by the user); EDA now embedded in the upload response instead of a second cross-site request |
