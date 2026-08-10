# InsightForge — M6 (What-If Simulator) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M6 delivered, how it was verified, and decisions made along the way. This was the last milestone in the SRS's Phase-2 (Should-Have) scope.

**Status: Complete, verified locally** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Interactive prediction sliders. Maps to FR-10.

- FR-10 — allow the user to adjust input values via sliders and see the model's live prediction ("what-if" simulation).

## 2. What was built

| Area | Delivered |
|---|---|
| **Live prediction (FR-10)** | `app/services/modeling.py::predict` — given a `target_column` and partial/full feature values, reconstructs the exact fitted model (same train/test split, same `random_state=42`) that `train_model` produced for that run, then predicts on a single user-supplied row. Any feature not supplied falls back to the training data's median (numeric) or most-frequent value (categorical) via the already-fitted imputer — so a "what-if" can start from an incomplete or empty input and still return a sensible baseline prediction. |
| **API (FR-10)** | `POST /api/datasets/{id}/model/{run_id}/predict` (body `{features: {...}}`) — matches the Design Phase doc's REST spec. Transient by design: nothing about a prediction is persisted, only the request/response round trip. |
| **Frontend UI** | `PredictSimulator` (`frontend/src/components/PredictSimulator.tsx`) — renders one slider per numeric feature (range bounded by that column's observed min/max, from the FR-3 quality report) and one dropdown per categorical/boolean feature (options from the FR-4 EDA category frequencies), scoped to exactly the feature set that specific model run used. Debounced 400ms after the last change before calling `/predict`, so dragging a slider doesn't flood the backend with a full model refit per pixel of movement. Nested inside each trained-model card in `ModelPanel`, one simulator per run. |
| **Tests** | `backend/tests/test_modeling.py` (8 new cases — numeric/classification prediction shape, determinism, missing/unknown features, and a dedicated case for the case-insensitive category-matching decision below) and `test_model_api.py` (4 new cases — 200 with correct shape, empty-body success via imputation, foreign-session 404, cross-dataset 404). All passing; `ruff` clean. |

## 3. Schema change

None. `predict()` never writes to the database — it only reads the dataset's `raw_csv` and the target model run's `target_column`/`model_type`, matching the Design Phase doc's own description of this endpoint ("no persistence, this is transient").

## 4. Key architecture decision: the fitted model is never stored — `predict()` refits on demand

The `ModelRun` table only ever stored `metrics` and `feature_importance` (plain JSON); the actual fitted `scikit-learn` object was always thrown away after `train_model()` returned. Two options existed for `/predict`: persist the fitted pipeline (e.g. `pickle` into a `bytea` column, mirroring how `raw_csv` is stored), or reconstruct it on demand.

Chose reconstruction, for two concrete reasons, not just "simpler":

- **Unpickling is a real risk, not a theoretical one, even for data an app wrote itself.** A `pickle.loads` call executes arbitrary code embedded in the byte stream; the moment there's any path — a bug, a migration, a future feature — where that column's provenance isn't airtight, it becomes a code-execution vector. Refit-on-demand has no deserialization step at all.
- **A `scikit-learn` pickle isn't guaranteed to load after a dependency bump.** `sklearn`'s own docs are explicit that pickled estimators aren't guaranteed compatible across versions. A stored model would become a silent time bomb the next time `requirements.txt` changes.

Since `train_model` and `predict` share the exact same fitting code (`_fit()` in `modeling.py`, extracted from the pre-M6 `train_model` in this milestone's refactor) with the exact same `random_state`, `predict()`'s reconstructed model is bit-for-bit identical to the one `train_model()` reported metrics for — verified by `test_predict_matches_train_model_reported_metrics_model` (fully deterministic given fixed inputs). The tradeoff is a full model refit per prediction request rather than a cheap forward pass; acceptable at the demo-CSV scale this project targets, not something that would hold up at production ML-serving scale.

## 5. Real correctness risk found and fixed during design (not left to be discovered live): case-sensitive category matching

`OneHotEncoder(handle_unknown="ignore")` matches predict-time categorical values against categories it saw during training **by exact value**. If training data had `city = "Lahore"` and a predict request sent `"lahore"`, `"LAHORE"`, or a JS boolean serialized differently than the CSV's own text, the encoder would silently treat it as an unseen category — an all-zero encoding for that feature, not an error, just a quietly worse prediction with no indication anything went wrong. This is exactly the kind of failure that's invisible until someone happens to compare two runs and gets different numbers for what should be the same input.

Fixed by normalizing every categorical/boolean value — both the training data (via a `FunctionTransformer` step ahead of the imputer in `_build_pipeline`) and the classification target — through `.astype(str).str.strip().str.lower()` consistently. `test_predict_categorical_feature_matches_regardless_of_case` pins this: `"lahore"`, `"LAHORE  "`, and `"Lahore"` as predict-time input all produce identical predictions and probabilities.

**Side effect surfaced during manual verification**: normalizing the classification target this way means a predicted class label itself comes back lowercase (e.g. `"lahore"`), which looked inconsistent next to the rest of the UI's capitalized category labels once actually seen rendered in the browser. Fixed with a frontend-only `displayLabel()` capitalization in `PredictSimulator` rather than touching the backend's matching logic — the lowercase normalization is correct and necessary for matching; only the *display* needed adjusting.

## 6. How it was verified (not just "should work")

1. `pytest` (106 tests total, 12 new) + `ruff` clean, including the case-insensitive-matching regression test and edge cases: missing/unknown feature keys (ignored, not rejected), an empty `features` body (fully imputed baseline prediction), determinism across repeated calls, and the same target-type/insufficient-data rejections `train_model` already covers.
2. Backend run locally against the **real Neon database**, driven through a real browser: uploaded a 40-row synthetic dataset, trained a regression model on a numeric target — the simulator rendered sliders (bounded to the column's real min/max, defaulted to its mean) and a category dropdown, with an initial baseline prediction shown on mount.
3. **Actually moved a slider and confirmed the live update, not just that the UI rendered**: dragged the dominant-feature (92% importance) slider from its mean to the column's max — prediction jumped from 26,642.92 to 34,079.86, the expected direction and rough magnitude given that feature's correlation with the target. Changed the category dropdown next — prediction shifted by a small amount, consistent with that feature's much smaller (1%) importance. Confirmed via network inspection that both changes triggered a real `POST .../predict` (200 OK), debounced rather than firing on every intermediate drag value.
4. Trained a second model on a categorical target (classification) on the same dataset and confirmed probabilities render correctly, sum to 100%, and — after the fix in Section 5 — display with capitalization matching the rest of the UI.
5. Test data deleted from Neon afterward — production DB is clean. **Not yet pushed/redeployed** — production still runs the M4 PDF addendum as of this writing.

## 7. Decisions & notes worth remembering

- **`predict()` reuses the train/test split, not a full-data refit** — a "refit on 100% of the data for the best possible live prediction" is the more common ML practice, but was deliberately rejected here: it would mean the prediction comes from a *different* model instance than the one whose R²/accuracy is displayed on screen, which is a subtle trust problem in a tool whose whole point is showing plain-language, trustworthy results. Reusing the identical split keeps "here's this model's accuracy" and "here's this model's live prediction" always describing the same fitted object.
- **Sliders are bounded to the training data's observed min/max**, not an arbitrary padded range — matches the "what-if" framing (exploring within the space the model actually learned from) rather than inviting extrapolation the model has no basis for.
- **Debounce, not `onMouseUp`/`onTouchEnd`** — a timer-based debounce (400ms after the last change) handles mouse drag, touch drag, and keyboard-arrow slider adjustment uniformly without needing separate handlers per input modality, at the cost of a small fixed delay after the user stops interacting.
- **This finding continues M5's JSONB lesson but is a different failure mode** — M5 was about *order* surviving a round trip; this one is about *exact-value matching* surviving a round trip through an ML encoder. Both are instances of the same underlying discipline: don't assume data arrives back in the shape you last saw it.

## 8. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end locally against the real Neon database, driven through the actual UI — not yet re-verified on the deployed URL (pending push/redeploy)
- [x] Edge cases handled: missing/unknown feature keys, empty request body, case/whitespace mismatches in categorical input, unsupported target types (inherited from `train_model`'s validation)
- [ ] Code committed with a descriptive message; README updated — pending
- [x] Automated tests cover the new logic (12 new backend tests, all passing)

## 9. Next

All seven milestones (M0–M6) from the SRS's project plan are now built. Remaining per SRS Section 8: **M7 — Polish & Docs** (README, architecture diagram, 60-second demo video, unit tests) — the wrap-up milestone rather than a new feature. Also worth a look before then: the SRS's Section 4.3 stretch goals (multi-dataset comparison, saved user accounts) are explicitly out of MVP scope and were never on this milestone plan.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M6 built and locally verified |
