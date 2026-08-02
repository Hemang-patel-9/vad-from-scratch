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

## Approaches

| Approach | Measurement | Page | Docs |
| --- | --- | --- | --- |
| Energy-based | Frame energy against an adaptive noise floor | `/energy-based` | [energy-based.md](docs/rule-based/energy-based.md) |
| Zero-crossing | How often the waveform changes sign | `/zero-crossing` | [zero-crossing.md](docs/rule-based/zero-crossing.md) |
| Spectral | Flatness and entropy of the spectrum | `/spectral` | [spectral.md](docs/rule-based/spectral.md) |

All three share everything after the threshold — hysteresis, hangover, duration
filtering — in [`backend/app/vad/pipeline.py`](backend/app/vad/pipeline.py), and
answer with the same JSON, so one explorer serves all of them. Each detector
module supplies only its measurement and where the threshold goes. See
[docs/rule-based/README.md](docs/rule-based/README.md) for how they compare.

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
| `POST /api/vad/{energy,zero-crossing,spectral}` | Analyses one sample: the traces to plot, thresholds, and per-stage segments. |
| `WS /api/vad/{energy,zero-crossing,spectral}/stream` | Send settings as JSON, then 16 kHz mono float32 blocks. |

The three detectors take different tuning parameters but return the same shape,
so a client that can plot one can plot all three.

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

The first `librosa.load` in a process pays a one-off lazy-import and JIT cost of
several seconds; the backend spends it during startup so requests do not. After
that, decoded samples are cached in memory and detection takes 5–16 ms for the
energy and zero-crossing detectors and up to 134 ms for the spectral one, which
is what makes re-analysing on every slider move practical. Slider round-trips
also skip the waveform envelope, since it depends only on the sample — that
alone is 60–80% of the response body.

Samples are found via `VAD_SAMPLES_DIR`, then `backend/samples/`, then
`samples/` at the repo root.
