# InsightForge

Self-serve, automated data analytics & statistical insight platform. Upload a CSV, get an automated data-quality audit, EDA, statistical testing, and a baseline predictive model with plain-language interpretation — no code required.

Full requirements and design: [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx), [InsightForge_Design_Phase_v1.0.md](InsightForge_Design_Phase_v1.0.md), [schema.sql](schema.sql). Milestone progress: [InsightForge_M0_Summary.md](InsightForge_M0_Summary.md), [InsightForge_M1_Summary.md](InsightForge_M1_Summary.md), [InsightForge_M2_Summary.md](InsightForge_M2_Summary.md).

## Stack

- **Frontend** — Next.js / React / Recharts (`frontend/`), deployed on Vercel
- **Backend** — FastAPI (`backend/`), deployed on Render/Railway
- **Database** — PostgreSQL via Neon

## Local development

### Backend

```bash
cd backend
python -m venv venv
venv\Scripts\activate        # Windows
pip install -r requirements.txt
cp .env.example .env         # fill in DATABASE_URL
uvicorn app.main:app --reload
```

API docs at `http://localhost:8000/docs`.

### Frontend

```bash
cd frontend
npm install
cp .env.local.example .env.local   # fill in NEXT_PUBLIC_API_URL
npm run dev
```

App at `http://localhost:3000`.

### Database

Create a free [Neon](https://neon.tech) project, then apply the schema:

```bash
psql "$DATABASE_URL" -f schema.sql
```

Existing databases provisioned before M1 also need the migration in [`migrations/`](migrations):

```bash
psql "$DATABASE_URL" -f migrations/001_add_duplicate_row_count.sql
```

## Deployment

- **Backend (Render)** — connect this repo, Render auto-detects [render.yaml](render.yaml) (Docker, `backend/`). Set `DATABASE_URL` (Neon connection string) and `CORS_ORIGINS` (deployed frontend URL) in the Render dashboard.
- **Frontend (Vercel)** — import this repo, set root directory to `frontend/`, add `NEXT_PUBLIC_API_URL` (deployed backend URL) as an env var.
- Both redeploy automatically on push to `main`.

## CI

GitHub Actions (`.github/workflows/`) run backend (`ruff` + `pytest`) and frontend (`eslint` + `next build`) checks on every push/PR touching that folder.

## Milestones

See [InsightForge_SRS_v1.0.docx](InsightForge_SRS_v1.0.docx) Section 8. Current: **M2 — Auto-EDA**.
