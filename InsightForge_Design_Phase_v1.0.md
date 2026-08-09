# InsightForge — Design Phase Document v1.0

Companion to InsightForge_SRS_v1.0.docx. Covers architecture, database schema, and REST API specification, per SDLC Phase 3.2 (Design → Architecture & Database Design).

---

## 1. Architecture Overview

Three-tier architecture, matching SRS Section 6.1:

- **Frontend** — Next.js / React / Recharts, deployed on Vercel. Handles upload UI, renders charts from JSON the backend returns (not images), and the Phase-2 "what-if" slider UI.
- **Backend** — FastAPI (Python), deployed on Render or Railway. Split into two logical layers within the same service:
  - REST API layer: request validation, routing, session handling.
  - Analytics engine: pandas / scipy.stats / statsmodels / scikit-learn, invoked by the API layer, never exposed directly.
- **Database** — PostgreSQL via Neon. Stores session, dataset metadata, the raw uploaded CSV, and every generated result (quality profile, test results, model runs).

Data flow: user uploads CSV → frontend → backend REST layer validates → analytics engine processes → results persisted to Postgres → JSON returned to frontend → charts rendered client-side. PDF export and "what-if" predictions follow the same round-trip.

### 1.1 Key design decision: where does the CSV actually live?

The SRS says "persist uploaded dataset metadata and generated results in PostgreSQL" but doesn't fix where the raw file sits. This matters because Render/Railway free-tier disks are **ephemeral** — anything written to local disk disappears on redeploy or restart, and EDA / re-running a test needs the original data, not just the profile summary.

Decision: **store the raw CSV as a `bytea` column directly in the `datasets` table**, not on disk and not in a separate object store (no free, no-signup object storage fits the zero-budget constraint as cleanly as Postgres does). Given the 10MB upload cap (NFR), this stays well inside Neon's free-tier storage limit. If storage pressure ever becomes real, the mitigation already defined in the SRS feasibility section applies: prune older sessions rather than upgrade.

Trade-off: querying/aggregating won't be as fast as a normalized data table, but InsightForge always re-reads the full CSV into a pandas DataFrame in memory to do analysis anyway, so this doesn't cost anything extra — it's just the storage mechanism.

---

## 2. Database Schema

Five tables, matching SRS Section 7's conceptual entities, now with full columns and types. Runnable DDL: [`schema.sql`](schema.sql).

### 2.1 `sessions`

Anonymous session tracking (no user accounts in MVP, per SRS Section 4.3 stretch goal).

| Column         | Type      | Notes                                                  |
| -------------- | --------- | ------------------------------------------------------ |
| id             | uuid, PK  | generated on first visit, stored in an httpOnly cookie |
| created_at     | timestamp | default now()                                          |
| last_active_at | timestamp | updated on each request; used for pruning old sessions |

### 2.2 `datasets`

One row per uploaded file.

| Column            | Type                   | Notes                             |
| ----------------- | ---------------------- | --------------------------------- |
| id                | uuid, PK               |                                   |
| session_id        | uuid, FK → sessions.id |                                   |
| original_filename | varchar                | as uploaded                       |
| row_count         | int                    |                                   |
| column_count      | int                    |                                   |
| file_size_bytes   | int                    | enforced ≤ 10MB at upload         |
| raw_csv           | bytea                  | the actual file content — see 1.1 |
| upload_time       | timestamp              | default now()                     |

### 2.3 `columns_profile`

One row per column per dataset — the data-quality report (FR-3).

| Column        | Type                   | Notes                                                                                                                      |
| ------------- | ---------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| id            | uuid, PK               |                                                                                                                            |
| dataset_id    | uuid, FK → datasets.id |                                                                                                                            |
| column_name   | varchar                |                                                                                                                            |
| data_type     | varchar                | numeric / categorical / datetime / boolean / text                                                                          |
| missing_count | int                    |                                                                                                                            |
| missing_pct   | float                  |                                                                                                                            |
| unique_count  | int                    |                                                                                                                            |
| outlier_count | int                    | IQR method, numeric columns only                                                                                           |
| summary_stats | jsonb                  | mean/median/std/min/max for numeric; top value + frequency for categorical — kept flexible since the shape differs by type |

### 2.4 `test_results`

One row per statistical test run (FR-5, FR-6).

| Column     | Type                   | Notes                                       |
| ---------- | ---------------------- | ------------------------------------------- |
| id         | uuid, PK               |                                             |
| dataset_id | uuid, FK → datasets.id |                                             |
| test_type  | varchar                | t_test / chi_square / anova — auto-selected |
| column_a   | varchar                |                                             |
| column_b   | varchar                |                                             |
| statistic  | float                  |                                             |
| p_value    | float                  |                                             |
| conclusion | text                   | plain-language interpretation               |
| created_at | timestamp              |                                             |

### 2.5 `model_runs`

One row per baseline model training run (FR-8, FR-9 — Phase 2).

| Column             | Type                   | Notes                                                       |
| ------------------ | ---------------------- | ----------------------------------------------------------- |
| id                 | uuid, PK               |                                                             |
| dataset_id         | uuid, FK → datasets.id |                                                             |
| target_column      | varchar                |                                                             |
| model_type         | varchar                | regression / classification — auto-selected by target dtype |
| algorithm          | varchar                | e.g. linear_regression, random_forest                       |
| metrics            | jsonb                  | accuracy / R² / precision / recall depending on model_type  |
| feature_importance | jsonb                  | column → importance score pairs                             |
| created_at         | timestamp              |                                                             |

Relationships: 1 session → many datasets. 1 dataset → many columns_profile, many test_results, many model_runs. All child tables cascade-delete on dataset deletion (relevant once session pruning is implemented).

---

## 3. REST API Specification

Base path: `/api`. All responses JSON. Session identified via httpOnly cookie set on first request — no session ID in URLs.

| Method | Endpoint                                        | Purpose                                                                                                                                                   | Maps to                     |
| ------ | ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- |
| GET    | `/health`                                       | Liveness check, used to pre-warm the backend before a live demo                                                                                           | NFR — cold start mitigation |
| POST   | `/datasets/upload`                              | Multipart upload of a CSV. Validates type/size/encoding, stores raw_csv, runs the data-quality profile synchronously, returns dataset_id + quality report | FR-1, FR-2, FR-3            |
| GET    | `/datasets/{dataset_id}`                        | Dataset metadata (filename, row/col count, upload time)                                                                                                   | FR-3                        |
| GET    | `/datasets/{dataset_id}/quality-report`         | Full data-quality report (missing values, dtypes, duplicates, outliers)                                                                                   | FR-3                        |
| GET    | `/datasets/{dataset_id}/eda`                    | EDA payload: distribution data per numeric column, frequency counts per categorical column, correlation matrix — as JSON for Recharts, not images         | FR-4                        |
| POST   | `/datasets/{dataset_id}/tests`                  | Body: `{column_a, column_b}`. Auto-selects t-test/chi-square/ANOVA by dtype, runs it, persists and returns the result                                     | FR-5, FR-6                  |
| GET    | `/datasets/{dataset_id}/tests`                  | List all test results run against this dataset                                                                                                            | FR-6                        |
| GET    | `/datasets/{dataset_id}/tests/{test_id}`        | Retrieve one specific test result                                                                                                                         | FR-6                        |
| GET    | `/datasets/{dataset_id}/report/pdf`             | Generate and stream a PDF summary (quality report + EDA highlights + test results)                                                                        | FR-7                        |
| POST   | `/datasets/{dataset_id}/model`                  | Body: `{target_column}`. Auto-selects regression/classification, trains, persists a model_run, returns metrics + feature importance                       | FR-8, FR-9                  |
| GET    | `/datasets/{dataset_id}/model`                  | List model runs for this dataset                                                                                                                          | FR-8                        |
| GET    | `/datasets/{dataset_id}/model/{run_id}`         | Retrieve one model run's metrics and feature importance                                                                                                   | FR-8, FR-9                  |
| POST   | `/datasets/{dataset_id}/model/{run_id}/predict` | Body: feature values from the sliders. Returns a live prediction from the trained model — no persistence, this is transient                               | FR-10                       |

Error handling convention (NFR — Reliability): every endpoint returns `{error: {code, message}}` with an appropriate 4xx/5xx status on failure — malformed CSV, unsupported dtype pairing for a test, empty dataset, etc. Nothing fails silently.

Auto-generated OpenAPI docs come free from FastAPI at `/docs` — satisfies the documentation point from SRS Section 3.3 without extra work.

---

## 4. Open Questions for Implementation (M0–M1)

- Session cookie: SameSite/Secure settings need to work across the Vercel (frontend) and Render/Railway (backend) domains — cross-origin cookie behavior should be verified early in M0, not discovered during M1.
- Synchronous vs background processing for the quality report on upload: spec above assumes synchronous (fits the 15-second NFR for a 100k-row file), revisit if profiling proves slower in practice.
- Session pruning job (for the storage-cap contingency in the SRS feasibility section) is not yet scheduled to a milestone — worth a small addition to M7 (Polish & Docs) or its own line item.

---

## 5. Document Control

| Version | Date            | Change                                                                 |
| ------- | --------------- | ---------------------------------------------------------------------- |
| 1.0     | August 10, 2026 | Initial design phase document — architecture, DB schema, REST API spec |
