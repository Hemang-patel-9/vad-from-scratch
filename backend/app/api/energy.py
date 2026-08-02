"""Energy-based VAD endpoints: one shot over a sample, and a live stream."""

from __future__ import annotations

from fastapi import APIRouter, WebSocket

from app.api.responses import run_analysis
from app.api.streams import run_detector_socket
from app.schemas import EnergyVadParameters, EnergyVadRequest, VadAnalysis
from app.vad.energy import StreamingEnergyVad, analyze_recording

router = APIRouter(prefix="/api/vad/energy", tags=["energy-vad"])

THRESHOLD_STAGE = "Frames whose energy crossed the enter and exit thresholds."


@router.post("")
def analyze_sample(request: EnergyVadRequest) -> VadAnalysis:
    return run_analysis(request, analyze_recording, THRESHOLD_STAGE)


@router.websocket("/stream")
async def stream_microphone(websocket: WebSocket) -> None:
    await run_detector_socket(websocket, EnergyVadParameters, StreamingEnergyVad)
