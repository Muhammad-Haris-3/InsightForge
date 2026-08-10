# InsightForge — M0 (Setup) Milestone Summary

Companion to [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) (Section 8) and [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md). Records what M0 delivered, how it was verified, and decisions made along the way — for future reference and as a record of process.

**Status: Complete** — 2026-08-10

---

## 1. Scope (per SRS Section 8)

> Repo structure, FastAPI + Next.js skeleton, Neon DB connected, CI deploy pipeline live.

## 2. What was built

| Area | Delivered |
|---|---|
| **Repo structure** | Monorepo: `backend/`, `frontend/`, shared root docs. Root `.gitignore`, `README.md` with local-dev and deploy instructions. |
| **Backend** | FastAPI app (`backend/app/`) — `/health` endpoint (pings the DB, doubles as the cold-start warm-up route), config via env vars (`pydantic-settings`), SQLAlchemy models mirroring `schema.sql` exactly, `Dockerfile` for portability (NFR), `pytest` test suite, `ruff` linting. |
| **Frontend** | Next.js 16 + TypeScript + Tailwind + Recharts (`frontend/`). Landing page that live-checks backend health client-side, as a working proof the two services can talk to each other. |
| **Database** | `schema.sql` — 5 tables (`sessions`, `datasets`, `columns_profile`, `test_results`, `model_runs`), UUID PKs, `CHECK` constraints, cascading FKs — applied to a live Neon Postgres project. |
| **CI** | `.github/workflows/backend-ci.yml` (ruff + pytest) and `frontend-ci.yml` (eslint + build), run on every push/PR touching that folder. |
| **Deploy config** | `render.yaml` (Render Blueprint, Docker runtime) for the backend. |

## 3. Live deployment

| Service | URL |
|---|---|
| Frontend (Vercel) | `insight-forge-beta.vercel.app` |
| Backend (Render) | `insightforge-api-muyx.onrender.com` |
| Database (Neon) | Postgres, project `insightforge`, region AWS US East 2 |

Verified end-to-end: the deployed frontend calls the deployed backend, which pings the live Neon database — confirmed visually via the "Backend API: ok" indicator on the landing page.

## 4. How it was verified (not just "should work")

Before touching any cloud service, the full stack was proven locally first:

1. Applied `schema.sql` to a local Postgres instance.
2. Ran the FastAPI backend against that real database (not mocked) — `/health` returned `{"status": "ok"}` with an actual `SELECT 1` round-trip.
3. Ran the Next.js frontend against that backend and confirmed the live status indicator in a real browser.

Only after that local proof did deployment to Neon/Render/Vercel happen — so any issue found in the cloud step was isolated to *deployment configuration*, not application logic.

## 5. Decisions & notes worth remembering

- **Render subdomains are globally unique.** The intended name `insightforge-api` was already taken by another Render user, so the platform silently assigned `insightforge-api-muyx.onrender.com` instead. Lesson: always confirm the *actual* assigned URL from the dashboard — don't assume `<service-name>.onrender.com` resolves.
- **CORS is a two-step deploy.** `CORS_ORIGINS` on Render can't be set correctly until the Vercel URL exists, so the backend was deployed first with a placeholder, then updated once the frontend URL was known (Render auto-redeploys on env var change).
- **`psycopg2-binary` needed pinning to `2.9.10`** — earlier versions have no prebuilt wheel for Python 3.13 on Windows and fail to build without Visual C++ Build Tools.
- **Raw CSV storage decision** (from the Design Phase doc) carries through here: `datasets.raw_csv` is a `bytea` column, not a file on disk — Render's free-tier filesystem is ephemeral, and Postgres already stores the metadata, so this avoids needing a second free storage service.

## 6. Definition of Done (SRS Section 8.1) — checked

- [x] Feature works end-to-end on the deployed URL, not just locally
- [x] Edge cases N/A at this stage (no user-facing feature logic yet — this is infrastructure)
- [x] Code committed with descriptive messages; README reflects current setup
- [x] Automated test covers the new logic (`test_health.py`, passing in CI)

## 7. Next: M1 — Ingestion & QA

Upload endpoint + data-quality report UI (FR-1, FR-2, FR-3), per SRS Section 8.

---

## Document Control

| Version | Date | Change |
|---|---|---|
| 1.0 | August 10, 2026 | M0 completed and documented |
