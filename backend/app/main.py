"""FastAPI entrypoint.

Serves the JSON API under /api and the exported Next.js frontend from ./static,
so both are reachable on a single port.
"""

from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles
from starlette.responses import Response
from starlette.types import Scope

from app.api import energy, samples
from app.vad.audio import warm_decoder

APP_VERSION = "0.2.0"
STATIC_DIR = Path(__file__).resolve().parent.parent / "static"


@asynccontextmanager
async def lifespan(_: FastAPI):
    warm_decoder()
    yield


app = FastAPI(title="VAD from Scratch", version=APP_VERSION, lifespan=lifespan)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok", "service": "vad-backend", "version": APP_VERSION}


app.include_router(samples.router)
app.include_router(energy.router)


class ExportedFrontend(StaticFiles):
    """Never let a cached HTML page outlive the hashed bundles it points at.

    Next.js fingerprints everything under /_next/static, so those are immutable.
    The HTML that references them is not, and a browser holding an older copy
    after a rebuild will request chunks that no longer exist and render nothing.
    """

    def file_response(self, full_path, stat_result, scope: Scope, status_code: int = 200) -> Response:
        response = super().file_response(full_path, stat_result, scope, status_code)
        path = str(full_path)
        if "/_next/static/" in path.replace("\\", "/"):
            response.headers["Cache-Control"] = "public, max-age=31536000, immutable"
        elif path.endswith((".html", ".txt")):
            response.headers["Cache-Control"] = "no-cache, must-revalidate"
        return response


# Mounted last so /api routes win. html=True serves index.html at /.
if STATIC_DIR.is_dir():
    app.mount("/", ExportedFrontend(directory=STATIC_DIR, html=True), name="frontend")
