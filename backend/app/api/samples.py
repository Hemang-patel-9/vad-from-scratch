"""Endpoints for the bundled sample library."""

from __future__ import annotations

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse

from app.schemas import SampleSummary
from app.vad.audio import describe_sample, list_sample_names, resolve_sample_path

router = APIRouter(prefix="/api/samples", tags=["samples"])

MEDIA_TYPES = {
    ".wav": "audio/wav",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".mp3": "audio/mpeg",
}


@router.get("")
def list_samples() -> list[SampleSummary]:
    summaries = []
    for name in list_sample_names():
        info = describe_sample(name)
        if info is not None:
            summaries.append(SampleSummary(**vars(info)))
    return summaries


@router.get("/{name}/audio")
def stream_sample_audio(name: str) -> FileResponse:
    path = resolve_sample_path(name)
    if path is None:
        raise HTTPException(status_code=404, detail=f"No sample named {name!r}")
    return FileResponse(
        path,
        media_type=MEDIA_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        headers={"Cache-Control": "public, max-age=3600"},
    )
