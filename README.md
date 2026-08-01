# vad-from-scratch

Voice activity detection, built from scratch.

## Layout

| Path | What |
| --- | --- |
| `backend/` | FastAPI app. Serves `/api` and the exported frontend. |
| `frontend/` | Next.js app, built as a static export. |
| `docs/` | Notes per approach — see [docs/README.md](docs/README.md). |
| `samples/` | Audio samples. |

## Run

```bash
docker compose up --build
```

Then open <http://localhost:8000>. The API is on the same port under `/api`
(`/api/health`), because the Docker build copies the Next.js static export into
`backend/static` and FastAPI serves it from there.

## Run without Docker

```bash
cd frontend && npm ci && npm run build   # writes frontend/out
cp -r out ../backend/static

cd ../backend
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

To iterate on the frontend alone, `npm run dev` serves it on :3000, but `/api`
calls will 404 until you build and serve through FastAPI.
