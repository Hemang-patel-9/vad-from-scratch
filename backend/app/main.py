"""FastAPI entrypoint.

Serves the JSON API under /api and the exported Next.js frontend from ./static,
so both are reachable on a single port.
"""

from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

APP_VERSION = "0.1.0"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"

app = FastAPI(title="VAD from Scratch", version=APP_VERSION)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "vad-backend", "version": APP_VERSION}


# Mounted last so /api routes win. html=True serves index.html at /.
if STATIC_DIR.is_dir():
    app.mount("/", StaticFiles(directory=STATIC_DIR, html=True), name="frontend")
