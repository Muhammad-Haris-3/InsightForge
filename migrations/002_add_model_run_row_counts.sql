-- Training set size on model_runs.
--
-- Large uploads are now capped at MAX_TRAINING_ROWS before the forest is fitted
-- (see services/modeling.py) — an unbounded forest on a 56k-row file peaked at
-- 636 MB and was killed by the 512 MB container. Recording both counts keeps that
-- cap visible: the UI can say the metrics came from a sample of the file rather
-- than implying every row was used.
--
-- schema.sql carries these columns for fresh databases; this migration brings an
-- already-provisioned Neon database in line. Both are nullable — model runs
-- recorded before this column existed have no value to backfill.
ALTER TABLE model_runs
    ADD COLUMN IF NOT EXISTS training_row_count integer
        CHECK (training_row_count IS NULL OR training_row_count >= 0);

ALTER TABLE model_runs
    ADD COLUMN IF NOT EXISTS available_row_count integer
        CHECK (available_row_count IS NULL OR available_row_count >= 0);
