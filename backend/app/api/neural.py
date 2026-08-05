"""Neural VAD endpoints.

The same two as every other detector, plus one the others do not need: this is
the only approach whose code can be present while the thing it runs is not. The
model is a build artifact, not source, so every entry point here has to answer
usefully when nobody has trained one yet — 503 with an explanation rather than a
stack trace, and a `/model` probe the page can call to say so before the user
moves a slider.
"""

from __future__ import annotations

from fastapi import APIRouter, HTTPException, WebSocket

from app.api.responses import run_analysis
from app.api.streams import run_detector_socket
from app.schemas import NeuralVadParameters, NeuralVadRequest, VadAnalysis
from app.vad.neural import (
    GridMismatch,
    ModelUnavailable,
    StreamingNeuralVad,
    analyze_recording,
    load_model,
    model_summary,
)

router = APIRouter(prefix="/api/vad/neural", tags=["neural-vad"])

THRESHOLD_STAGE = "Frames whose predicted speech probability crossed the enter and exit lines."


@router.get("/model")
def describe_model() -> dict[str, object]:
    """Whether a model is loadable, and what it reports about itself."""
    return model_summary()


@router.post("")
def analyze_sample(request: NeuralVadRequest) -> VadAnalysis:
    try:
        return run_analysis(request, analyze_recording, THRESHOLD_STAGE)
    except ModelUnavailable as error:
        raise HTTPException(status_code=503, detail=str(error)) from error
    except GridMismatch as error:
        raise HTTPException(status_code=400, detail=str(error)) from error


@router.websocket("/stream")
async def stream_microphone(websocket: WebSocket) -> None:
    # Loaded before handing over, because `run_detector_socket` accepts the
    # socket itself and constructing the detector after that would fail inside
    # the loop with nowhere useful to report it.
    try:
        load_model()
    except ModelUnavailable as error:
        await websocket.accept()
        await websocket.send_json({"type": "error", "detail": str(error)})
        await websocket.close()
        return

    await run_detector_socket(websocket, NeuralVadParameters, StreamingNeuralVad)
