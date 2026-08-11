-- InsightForge — Database Schema (Postgres / Neon)
-- Canonical DDL for InsightForge_Design_Phase_v1.0.md, Section 2.
-- Run against a fresh Neon database for M0 setup.

CREATE EXTENSION IF NOT EXISTS pgcrypto; -- gen_random_uuid()

-- 1. sessions — anonymous, cookie-based (no user accounts in MVP)
CREATE TABLE sessions (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_at      timestamptz NOT NULL DEFAULT now(),
    last_active_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_sessions_last_active_at ON sessions (last_active_at);
-- supports the session-pruning job (SRS 2.2 contingency, Design Phase doc Section 4)

-- 2. datasets — one row per uploaded file
CREATE TABLE datasets (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    session_id          uuid NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
    original_filename   varchar(255) NOT NULL,
    row_count           integer NOT NULL CHECK (row_count >= 0),
    column_count        integer NOT NULL CHECK (column_count >= 0),
    file_size_bytes     integer NOT NULL CHECK (file_size_bytes > 0 AND file_size_bytes <= 10485760), -- 10MB cap, NFR
    raw_csv             bytea NOT NULL, -- stored in Postgres, not disk — see Design Phase doc Section 1.1
    duplicate_row_count integer NOT NULL DEFAULT 0 CHECK (duplicate_row_count >= 0), -- dataset-level QA fact (FR-3); added in M1
    upload_time         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_datasets_session_id ON datasets (session_id);

-- 3. columns_profile — one row per column per dataset (data-quality report, FR-3)
CREATE TABLE columns_profile (
    id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id      uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
    column_name     varchar(255) NOT NULL,
    data_type       varchar(20) NOT NULL CHECK (data_type IN ('numeric', 'categorical', 'datetime', 'boolean', 'text')),
    missing_count   integer NOT NULL DEFAULT 0 CHECK (missing_count >= 0),
    missing_pct     numeric(5, 2) NOT NULL DEFAULT 0 CHECK (missing_pct BETWEEN 0 AND 100),
    unique_count    integer NOT NULL DEFAULT 0 CHECK (unique_count >= 0),
    outlier_count   integer CHECK (outlier_count >= 0), -- IQR method, numeric columns only; NULL otherwise
    summary_stats   jsonb, -- mean/median/std/min/max (numeric) or top value + frequency (categorical)
    UNIQUE (dataset_id, column_name)
);

CREATE INDEX idx_columns_profile_dataset_id ON columns_profile (dataset_id);

-- 4. test_results — one row per statistical test run (FR-5, FR-6)
CREATE TABLE test_results (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id  uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
    test_type   varchar(20) NOT NULL CHECK (test_type IN ('t_test', 'chi_square', 'anova')),
    column_a    varchar(255) NOT NULL,
    column_b    varchar(255) NOT NULL,
    statistic   double precision NOT NULL,
    p_value     double precision NOT NULL CHECK (p_value BETWEEN 0 AND 1),
    conclusion  text NOT NULL,
    created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_test_results_dataset_id ON test_results (dataset_id);

-- 5. model_runs — one row per baseline model training run (FR-8, FR-9 — Phase 2)
CREATE TABLE model_runs (
    id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    dataset_id          uuid NOT NULL REFERENCES datasets (id) ON DELETE CASCADE,
    target_column       varchar(255) NOT NULL,
    model_type          varchar(20) NOT NULL CHECK (model_type IN ('regression', 'classification')),
    algorithm           varchar(50) NOT NULL, -- e.g. linear_regression, random_forest
    metrics             jsonb NOT NULL, -- accuracy / R^2 / precision / recall depending on model_type
    feature_importance  jsonb,
    training_row_count  integer, -- rows fitted on; capped for large uploads to bound memory
    available_row_count integer, -- rows with a usable target, before that cap
    created_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_model_runs_dataset_id ON model_runs (dataset_id);
