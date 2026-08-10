-- M1: datasets.duplicate_row_count — persisted dataset-level QA fact (FR-3).
-- schema.sql was updated to include this column for fresh databases;
-- this migration brings an already-provisioned Neon database in line.
ALTER TABLE datasets
    ADD COLUMN IF NOT EXISTS duplicate_row_count integer NOT NULL DEFAULT 0
        CHECK (duplicate_row_count >= 0);
