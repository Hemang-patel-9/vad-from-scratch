# vad-from-scratch

Voice activity detection, built from scratch.

## Layout

| Path | What |
| --- | --- |
| `backend/` | FastAPI app. Serves `/api` and the exported frontend. |
| `frontend/` | Next.js app, built as a static export. |
| `docs/` | Notes per approach — see [docs/README.md](docs/README.md). |
| `ml/` | Training for the neural detector — see [ml/README.md](ml/README.md). |
| `samples/` | Audio samples. |

## Run

Both routes end at the same place: uvicorn on <http://localhost:8000>, serving
the JSON API under `/api` and the exported Next.js frontend from
`backend/static`. One port, no CORS, no second process. The only question is
whether Docker performs the two builds or you do.

| | Docker | Without Docker |
| --- | --- | --- |
| Needs | Docker Desktop | Node 22+ and Python 3.12+ |
| Builds the frontend | in the image | you run `npm run build` |
| Installs the backend | in the image | you make a venv |
| Serves on | `localhost:8000` | `localhost:8000` |

### With Docker

```bash
docker compose up --build
```

That is all of it. The first stage builds the static export with Node, the
second installs `backend/requirements.txt` into a Python 3.12 image, copies the
export to `backend/static`, and starts uvicorn. Expect a few minutes on the
first build and seconds afterwards, since both stages cache.

### Without Docker

Same two builds, same order, by hand. From the repository root:

```bash
# 1. Frontend -> frontend/out -> backend/static
cd frontend
npm ci
npm run build
rm -rf ../backend/static && cp -r out ../backend/static

# 2. Backend
cd ..
python3 -m venv .venv
.venv/bin/pip install -r backend/requirements.txt
cd backend && ../.venv/bin/python -m uvicorn app.main:app --port 8000
```

On Windows, only the paths change:

```powershell
# from frontend/, after npm run build
Remove-Item -Recurse -Force ..\backend\static -ErrorAction SilentlyContinue
Copy-Item -Recurse out ..\backend\static

# from the repository root
py -3.12 -m venv .venv
.venv\Scripts\python -m pip install -r backend\requirements.txt
cd backend
..\.venv\Scripts\python -m uvicorn app.main:app --port 8000
```

Run uvicorn from `backend/` either way — that is what puts `app` on the import
path. Add `--reload` while working on Python. `backend/static` is generated and
gitignored, so rebuild the frontend and copy `out` over again after any change
under `frontend/src`: the Python process serves whatever is sitting in that
directory and has no idea the source moved on.

## Approaches

| Approach | Measurement | Page | Docs |
| --- | --- | --- | --- |
| Energy-based | Frame energy against an adaptive noise floor | `/energy-based` | [energy-based.md](docs/rule-based/energy-based.md) |
| Zero-crossing | How often the waveform changes sign | `/zero-crossing` | [zero-crossing.md](docs/rule-based/zero-crossing.md) |
| Spectral | Flatness and entropy of the spectrum | `/spectral` | [spectral.md](docs/rule-based/spectral.md) |
| Neural | A learned probability, from a causal CNN and a GRU | `/dl-based` | [dl-based/README.md](docs/dl-based/README.md) |

All four share everything after the threshold — hysteresis, hangover, duration
filtering — in [`backend/app/vad/pipeline.py`](backend/app/vad/pipeline.py), and
answer with the same JSON, so one explorer serves all of them. Each detector
module supplies only its measurement and where the threshold goes. See
[docs/rule-based/README.md](docs/rule-based/README.md) for how the first three
compare.

That the neural detector needed no changes to those shared stages is the useful
result: they were never specific to how the measurement got made. It does need a
trained model, which is not in the repository — `/api/vad/neural` answers 503
until you train one with [`ml/vad_dl_kaggle.ipynb`](ml/vad_dl_kaggle.ipynb) and
drop the export into [`backend/models/`](backend/models/README.md). Everything
else works untouched without it.

The explorer plots the waveform, the measurement against its thresholds, and the
decision after each stage of the pipeline — all on one time axis. Moving a
slider re-runs the detector on the server, so what you see is what the Python
actually computes. The microphone tab runs the streaming detector over a
WebSocket.

## API

| Endpoint | What |
| --- | --- |
| `GET /api/health` | Liveness and version. |
| `GET /api/samples` | Lists `samples/` with duration, rate, channels. |
| `GET /api/samples/{name}/audio` | Original file, for playback. |
| `POST /api/vad/{energy,zero-crossing,spectral,neural}` | Analyses one sample: the traces to plot, thresholds, and per-stage segments. |
| `WS /api/vad/{energy,zero-crossing,spectral,neural}/stream` | Send settings as JSON, then 16 kHz mono float32 blocks. |
| `GET /api/vad/neural/model` | Whether a trained model is loadable, and what it reports about itself. |

The four detectors take different tuning parameters but return the same shape,
so a client that can plot one can plot all four.

## Notes

To iterate on the frontend alone, `npm run dev` serves it on :3000 with hot
reload, but `/api` calls 404 there until you build and serve through FastAPI.

The first `librosa.load` in a process pays a one-off lazy-import and JIT cost of
several seconds; the backend spends it during startup so requests do not. After
that, decoded samples are cached in memory and detection takes 5–16 ms for the
energy and zero-crossing detectors and up to 134 ms for the spectral one, which
is what makes re-analysing on every slider move practical. Slider round-trips
also skip the waveform envelope, since it depends only on the sample — that
alone is 60–80% of the response body.

Samples are found via `VAD_SAMPLES_DIR`, then `backend/samples/`, then
`samples/` at the repo root. The neural model is looked up the same way, via
`VAD_MODEL_DIR`, then `backend/models/`, then `models/` — which is how you point
a container at weights that are not baked into the image.
