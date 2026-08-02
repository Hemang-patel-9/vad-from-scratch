"""Zero-crossing VAD endpoints: one shot over a sample, and a live stream."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

from app.api.responses import run_analysis
from app.api.streams import run_detector_socket
from app.schemas import VadAnalysis, ZeroCrossingVadParameters, ZeroCrossingVadRequest
from app.vad.zerocrossing import StreamingZeroCrossingVad, analyze_recording

router = APIRouter(prefix="/api/vad/zero-crossing", tags=["zero-crossing-vad"])

THRESHOLD_STAGE = "Frames crossing zero slowly enough to be voiced, and loud enough to matter."


@router.post("")
def analyze_sample(request: ZeroCrossingVadRequest) -> VadAnalysis:
    return run_analysis(request, analyze_recording, THRESHOLD_STAGE)


@router.websocket("/stream")
async def stream_microphone(websocket: WebSocket) -> None:
    await run_detector_socket(websocket, ZeroCrossingVadParameters, StreamingZeroCrossingVad)
