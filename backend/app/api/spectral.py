"""Spectral VAD endpoints: one shot over a sample, and a live stream."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

from app.api.responses import run_analysis
from app.api.streams import run_detector_socket
from app.schemas import SpectralVadParameters, SpectralVadRequest, VadAnalysis
from app.vad.spectral import StreamingSpectralVad, analyze_recording

router = APIRouter(prefix="/api/vad/spectral", tags=["spectral-vad"])

THRESHOLD_STAGE = "Frames whose spectrum is more structured than the room's."


@router.post("")
def analyze_sample(request: SpectralVadRequest) -> VadAnalysis:
    return run_analysis(request, analyze_recording, THRESHOLD_STAGE)


@router.websocket("/stream")
async def stream_microphone(websocket: WebSocket) -> None:
    await run_detector_socket(websocket, SpectralVadParameters, StreamingSpectralVad)
