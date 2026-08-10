# InsightForge — M5 (Modeling, Phase 2) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M5 delivered, how it was verified, and decisions made along the way.

**Status: Complete, verified live** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Baseline model + feature importance. Maps to FR-8, FR-9. First Phase-2 (Should-Have) milestone.

- FR-8 — offer a baseline regression or classification model (auto-selected by target column type) with train/test split and accuracy/R² reporting.
- FR-9 — display feature importance for the trained model in plain language.

## 2. What was built

| Area | Delivered |
|---|---|
| **Model training (FR-8)** | `app/services/modeling.py::train_model` — target column's persisted `data_type` decides the task (numeric → regression, categorical/boolean → classification), same auto-selection pattern as M3's `stats_tests.py`. Both tasks use a `RandomForestRegressor`/`RandomForestClassifier` (100 trees) behind an sklearn `Pipeline`: numeric features are median-imputed, categorical/boolean features are most-frequent-imputed then one-hot encoded; datetime/text columns are excluded from the feature set entirely. 80/20 train/test split (`random_state=42` for reproducibility). Regression reports `r2`/`mae`/`rmse`; classification reports `accuracy`/`precision`/`recall`/`f1` (weighted average). |
| **Feature importance (FR-9)** | `_aggregate_feature_importance` sums the one-hot-encoded sub-columns' importances back to their original column name (so a categorical column gets one importance value, not one per category) and normalizes to sum to 1 (a "share of importance" percentage). `describe_feature_importance` turns that into a plain-language sentence — *"The strongest predictors of 'bracket' are 'salary' (59%), 'score' (20%), and 'age' (16%)."* — computed fresh on every read rather than stored, same pattern as M2/M4. |
| **API** | `POST /api/datasets/{id}/model` (body `{target_column}`, trains + persists), `GET /api/datasets/{id}/model` (list, newest first), `GET /api/datasets/{id}/model/{run_id}` (single run) — matches the Design Phase doc's REST spec exactly. |
| **Frontend UI** | `ModelPanel` (`frontend/src/components/ModelPanel.tsx`) — target-column dropdown (filtered to numeric/categorical/boolean columns only), "Train Model" button, and a running list of results: model-type badge, metric chips, the plain-language summary, and a horizontal Recharts bar chart of feature importance (client-side sorted, so it renders correctly independent of API response order). Wired into `UploadPanel` between `StatsTestPanel` and `ReportExportButton`. |
| **Tests** | `backend/tests/test_modeling.py` (16 cases — regression/classification selection incl. boolean target, feature-importance sum-to-one and sort order, every rejection path: missing column, unsupported target type, no usable features, too few rows, single-class target, missing target values dropped correctly, numeric-feature imputation, and the JSONB-key-order regression test below) and `test_model_api.py` (7 cases — endpoint-level: successful train + persistence, unsupported target type, foreign-session 404, list ordering, single-run fetch, cross-dataset 404, and the same JSONB-order regression at the API layer). All passing; `ruff` clean. |

## 3. Schema change

None. `model_runs` already existed in the live schema from M0.

## 4. Real bug found and fixed during local verification: feature importance ranked wrong after a DB round-trip

While verifying against the real Neon database (not a mock), the trained model's own API response showed the wrong ranking: `{"age": 0.93, "city": 0.01, "salary": 0.06, "bracket": 0.01}` — `city` listed ahead of `salary` despite `salary`'s value being six times larger. `train_model` builds `feature_importance` correctly sorted descending in Python, but **Postgres JSONB does not preserve the original key order of a stored JSON object** — reading `model_run.feature_importance` back from the DB (even immediately, via `db.refresh()` right after `db.commit()`) returned it re-ordered. `describe_feature_importance`, which assumed its input was already sorted and just took `list(...)[:3]`, silently produced a wrong "strongest predictors" sentence — the exact kind of quietly-wrong output FR-9's "plain language" requirement should never produce.

Confirmed the root cause directly by querying `model_runs.feature_importance` from Neon via `psql`-equivalent SQL and comparing it to what was inserted. Fixed at two points, both now sorting explicitly by value rather than trusting dict order: `describe_feature_importance` itself, and `_build_model_run_out` in the router (which also re-sorts the `feature_importance` field in the API response, not just the summary text — a consumer other than this frontend could otherwise get the same wrong impression, even though this frontend's own chart already re-sorts client-side and was unaffected). Two regression tests pin this: one on the service function with a deliberately out-of-order dict, one at the API layer simulating the exact ordering observed in the live DB.

## 5. How it was verified (not just "should work")

1. `pytest` (89 tests total, 23 new) + `ruff` clean, including the two JSONB-ordering regression tests and edge cases: unsupported target type (datetime), no usable features (all-text dataset), fewer than `MIN_ROWS` (10) non-missing target rows, a single-class classification target, missing target values correctly excluded from the row count rather than crashing, missing numeric feature values imputed rather than dropping rows.
2. Backend run locally against the **real Neon database**, driven through a real browser: uploaded a 40-row synthetic dataset (`age`, `salary`, `city`, `score` [numeric], `bracket` [categorical, derived from `salary`]). Trained a regression model on `score` (R²=0.87) and a classification model on `bracket` (accuracy=1.0, a clean separation by construction) — both through the actual `ModelPanel` UI, both persisted and displayed with correctly ordered feature-importance bars and an accurate plain-language summary after the ordering fix.
3. Confirmed session isolation still holds (`POST`/`GET /model` 404 for a foreign session, same as every other dataset-scoped endpoint).
4. Test data deleted from Neon afterward — production DB is clean.
5. Pushed to `main` (`eea0f3b`); confirmed the deploy on the actual production URLs (`insight-forge-beta.vercel.app` → `insightforge-api-muyx.onrender.com`) — Render's build installed `scikit-learn` (a heavier dependency than earlier milestones, so this took longer) and redeployed successfully. Uploaded a fresh 40-row synthetic dataset through the live frontend and trained a regression model on `score` via the real `ModelPanel` UI (R²=0.9319, feature importance rendered as `age` 93% → `salary` 6% → `city` 1%, correctly ordered in both the chart and the plain-language summary). **Re-verified the JSONB-ordering fix specifically against production**: queried the raw `model_runs.feature_importance` row directly in Neon and confirmed storage order was indeed scrambled again (`age, city, salary` — the same bug pattern, reproduced independently in prod), then re-fetched `GET /model` through the browser's real session and confirmed the API still returned the correctly sorted order (`age, salary, city`) despite the scrambled storage — proving the read-time sort fix, not luck, is what's holding production correct. Verification row deleted from Neon afterward.

## 6. Decisions & notes worth remembering

- **Random forest for both tasks, not linear/logistic regression** — gives feature importance "for free" via `.feature_importances_` for both regression and classification with the same code path, handles the mixed numeric/categorical feature set without needing separate linear-model assumptions (no need to worry about multicollinearity from one-hot dummies), and is a defensible "baseline" model that still produces a plain-language importance story — directly serving FR-9, not just FR-8.
- **Feature importance is normalized to sum to 1, not raw `.feature_importances_` values** — raw random-forest importances already sum to ~1 for a *single* tree ensemble output, but summing one-hot sub-columns back into their parent categorical column and then re-normalizing keeps the "percentage of total importance" framing correct and intuitive after that aggregation.
- **Never trust JSONB round-trip order for anything meant to display "top-N" or "in order"** — this is the load-bearing lesson from Section 4. Any code that reads a JSONB column and assumes dict order carries meaning (sortedness, insertion sequence, etc.) needs to re-establish that order explicitly at read time. Worth checking `metrics`/`feature_importance`/`summary_stats` and any other JSONB field across the app for the same latent assumption if one shows up in a future milestone.
- **`MIN_ROWS = 10` is a demo-appropriate floor, not a statistically rigorous one** — this is a portfolio/demo tool, not a production ML pipeline; the threshold exists to avoid a meaningless single-row test split, not to guarantee generalizable metrics on small data.

## 7. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end on the deployed URL, not just locally — verified on both localhost and the live Vercel/Render URLs, including a targeted re-check of the JSONB-ordering fix against production data
- [x] Edge cases handled: unsupported target type, no usable features, too few rows, single-class target, missing target/feature values, plus the JSONB feature-importance-ordering bug found during verification
- [x] Code committed with a descriptive message (`eea0f3b`); README updated
- [x] Automated tests cover the new logic (23 new backend tests, all passing)

## 8. Next

**M6 — What-If Simulator**: interactive prediction sliders (FR-10), per SRS Section 8 — the final milestone in the SRS's Phase-2 scope.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M5 built and locally verified |
