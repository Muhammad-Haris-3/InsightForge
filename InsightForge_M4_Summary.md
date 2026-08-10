# InsightForge — M4 (Reporting) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M4 delivered, how it was verified, and decisions made along the way.

**Status: Complete, verified locally** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> PDF export. Maps to FR-7.

- FR-7 — allow the user to export a summary report as PDF.

## 2. What was built

| Area | Delivered |
|---|---|
| **PDF generation (FR-7)** | `app/services/pdf_report.py::generate_report_pdf` — builds a PDF (via `reportlab`) with four sections: dataset overview (rows/columns/duplicates/missing cells), the FR-3 data-quality table, an FR-4 "EDA Highlights" correlation matrix (or a note when there are fewer than 2 numeric columns), and an FR-5/FR-6 statistical test results table (or a note when none have been run yet). |
| **API (FR-7)** | `GET /api/datasets/{id}/report/pdf` (`app/routers/datasets.py`) — matches the Design Phase doc's REST spec. Re-parses `raw_csv` and rebuilds the EDA payload fresh (same on-demand pattern as `GET /eda`, M2), and reads `dataset.test_results` live, so the PDF always reflects whatever tests have been run *up to the moment of download* — no staleness. Returns `application/pdf` with a `Content-Disposition: attachment` header. |
| **Frontend UI** | `ReportExportButton` (`frontend/src/components/ReportExportButton.tsx`) — fetches the PDF via `fetch(..., { credentials: "include" })` rather than a plain `<a href>`/`window.open`, specifically so a non-2xx response can be caught and shown as a real error message instead of the download silently doing nothing (the M2 cookie-blocking incident is the reason this matters — see Section 5). On success, builds an object URL and triggers a client-side download named `<sanitized-filename>_insightforge_report.pdf`. Wired into `UploadPanel` below `StatsTestPanel`. |
| **Tests** | `backend/tests/test_pdf_report.py` (8 cases — valid PDF bytes, no-correlation-matrix, no-test-results, with-test-results, missing summary stats, and two dedicated regression cases for the header-injection/XML-crash bug below) and `test_pdf_api.py` (3 cases — 200 with correct headers/content-type, sanitized filename header, foreign-session 404). All passing; `ruff` clean. |

## 3. Schema change

None. The PDF is generated from data that's already persisted (`datasets`, `columns_profile`, `test_results`) plus a fresh EDA computation — nothing new to store.

## 4. Bug found and fixed during development: `reportlab.Paragraph` crashes on user-controlled text

`reportlab`'s `Paragraph` class parses a small XML-like markup language (`<b>`, `<i>`, etc.) rather than treating its input as literal text. Two places in the report embed genuinely user-controlled strings inside a `Paragraph`: the dataset's `original_filename`, and each test's `conclusion` (which interpolates the CSV's own column names — see `stats_tests.py`). A column or filename containing an unbalanced `<` — a very plausible real input, e.g. a column literally named `a<b` — raised an unhandled `ValueError` and crashed PDF generation entirely (a 500, not a clean error).

Found this by deliberately testing `Paragraph("a<b", ...)` in isolation, then confirming it reproduced through the full `generate_report_pdf` call with a realistic dataset. Table *cells* using plain strings (not wrapped in `Paragraph`) were separately confirmed safe — `Table` does not run its cell values through the markup parser, only `Paragraph` does, so the fix is narrowly `xml.sax.saxutils.escape()` on exactly the two `Paragraph(...)` call sites that carry user text, not a blanket sanitization pass over every string in the report. Two regression tests (`test_unbalanced_angle_bracket_in_filename_does_not_crash`, `test_unbalanced_angle_bracket_in_conclusion_does_not_crash`) pin this.

## 5. How it was verified (not just "should work")

1. `pytest` (66 tests total, 14 new) + `ruff` clean, including the two crash-regression cases above plus edge cases: no correlation matrix (single numeric column), no test results yet, missing/null `summary_stats` (an all-missing numeric column).
2. Backend run locally against the **real Neon database**, driven through a real browser: uploaded an 18-row CSV, ran an ANOVA test through the UI, then clicked "Download PDF Report" — network inspection confirmed a `200 application/pdf` response; the browser correctly triggered a file download via the blob/object-URL path.
3. **Real bug caught during this session's own verification, not just written up in hindsight**: while re-testing the flow, the browser console logged a React "two children with the same key" warning — `StatsTestPanel` and `ReportExportButton`, both siblings in `UploadPanel`, were keyed with the identical `report.id`. Fixed by prefixing each (`tests-${report.id}`, `export-${report.id}`); re-verified with a fresh upload and an instrumented `console.error` capture that confirmed no key warning fires anymore.
4. Test data deleted from Neon afterward — production DB is clean. **Not yet pushed/redeployed** — production still runs M3 as of this writing.

## 6. Decisions & notes worth remembering

- **PDF content is computed fresh per request, not persisted** — same rationale as M2's `GET /eda`: cheap to recompute from data already in Postgres, and a stored PDF blob would go stale the moment a new test is run. `dataset.test_results` is read live via the ORM relationship, so the exported PDF always matches "everything done on this dataset so far" at download time.
- **`escape()` only where `Paragraph` is used, not everywhere** — over-escaping plain `Table` cell strings would have been wasted defensive work; verifying reportlab's actual parsing behavior (`Table` cells: literal; `Paragraph` text: markup-parsed) before fixing kept the change minimal and the reasoning traceable in a comment at both call sites.
- **The PDF download goes through `fetch` + blob, not a bare link/`window.open`** — this is a direct lesson carried over from the M2 third-party-cookie incident: a plain navigation to a cross-site URL gives no way to detect or surface a failure (e.g. a blocked-cookie 404) to the user. Fetching explicitly means a non-2xx response shows a real error message instead of "nothing happens when I click the button."
- **React `key` collisions across *different* sibling component types are still collisions** — `key={report.id}` isn't automatically namespaced per component type; two different components at the same level with the same key value is exactly the kind of subtle bug that's silent in normal use (both components still rendered! since the collision happens to not have visibly broken anything with only two siblings) but shows up the moment sibling order/count changes. Worth a quick console check after adding any new keyed sibling, not just a visual glance.

## 7. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end locally against the real Neon database, driven through the actual UI — not yet re-verified on the deployed URL (pending push/redeploy)
- [x] Edge cases handled: no correlation matrix, no test results yet, missing summary stats, user-controlled text that would otherwise crash PDF generation (filename, conclusion text)
- [ ] Code committed with a descriptive message; README updated — pending
- [x] Automated tests cover the new logic (14 new backend tests, all passing)

## 8. Next

**M5 — Modeling (Phase 2)**: baseline regression/classification model + feature importance (FR-8, FR-9), per SRS Section 8.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M4 built and locally verified |
