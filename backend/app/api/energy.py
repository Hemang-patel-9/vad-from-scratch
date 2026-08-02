"""Energy-based VAD endpoints: one shot over a sample, and a live stream."""

from __future__ import annotations

import time

import numpy as np
from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.schemas import (
    EnergyVadParameters,
    EnergyVadRequest,
    EnergyVadResponse,
    PipelineStage,
    SegmentModel,
    WaveformEnvelope,
)
from app.vad.audio import TARGET_SAMPLE_RATE, compute_peak_envelope, load_sample
from app.vad.energy import (
    SILENCE_FLOOR_DB,
    EnergyVadResult,
    Segment,
    StreamingEnergyVad,
    analyze_recording,
    flags_to_segments,
)

router = APIRouter(prefix="/api/vad/energy", tags=["energy-vad"])

FLOOR_CURVE_POINTS = 400

STAGE_DESCRIPTIONS = (
    ("threshold", "Threshold", "Frames whose energy crossed the enter/exit thresholds."),
    ("hangover", "Hangover", "Trailing frames held on so trailing consonants survive."),
    ("duration", "Duration filter", "Short bursts dropped, close neighbours merged."),
)


def _downsample(curve: np.ndarray, points: int) -> list[float]:
    if curve.size == 0:
        return []
    if curve.size <= points:
        return np.round(curve, 1).tolist()
    picks = np.linspace(0, curve.size - 1, points).astype(int)
    return np.round(curve[picks], 1).tolist()


def _to_segment_models(segments: list[Segment]) -> list[SegmentModel]:
    return [SegmentModel(start=round(s.start, 4), end=round(s.end, 4)) for s in segments]


def _build_stages(result: EnergyVadResult) -> list[PipelineStage]:
    per_stage = (
        flags_to_segments(result.flags_after_threshold, result.hop_seconds, result.frame_seconds),
        flags_to_segments(result.flags_after_hangover, result.hop_seconds, result.frame_seconds),
        result.segments,
    )
    return [
        PipelineStage(
            key=key,
            label=label,
            description=description,
            segments=_to_segment_models(segments),
        )
        for (key, label, description), segments in zip(STAGE_DESCRIPTIONS, per_stage)
    ]


@router.post("")
def analyze_sample(request: EnergyVadRequest) -> EnergyVadResponse:
    samples = load_sample(request.sample, TARGET_SAMPLE_RATE)
    if samples is None:
        raise HTTPException(status_code=404, detail=f"No sample named {request.sample!r}")

    settings = request.to_settings(TARGET_SAMPLE_RATE)
    started = time.perf_counter()
    result = analyze_recording(samples, settings)
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    waveform = None
    if request.include_waveform:
        low, high = compute_peak_envelope(samples, request.waveform_buckets)
        waveform = WaveformEnvelope(low=low, high=high)

    speech_seconds = sum(segment.duration for segment in result.segments)

    return EnergyVadResponse(
        sample=request.sample,
        sample_rate=TARGET_SAMPLE_RATE,
        duration=round(result.duration, 4),
        frame_seconds=result.frame_seconds,
        hop_seconds=result.hop_seconds,
        energy_db=np.round(result.energy_db, 1).tolist(),
        noise_floor_curve_db=_downsample(result.noise_floor_curve_db, FLOOR_CURVE_POINTS),
        noise_floor_db=round(result.noise_floor_db, 2),
        enter_threshold_db=round(result.enter_threshold_db, 2),
        exit_threshold_db=round(result.exit_threshold_db, 2),
        threshold_offset_db=settings.threshold_offset_db,
        hysteresis_db=settings.hysteresis_db,
        silence_floor_db=SILENCE_FLOOR_DB,
        stages=_build_stages(result),
        segments=_to_segment_models(result.segments),
        speech_ratio=round(speech_seconds / result.duration, 4) if result.duration else 0.0,
        waveform=waveform,
        elapsed_ms=round(elapsed_ms, 2),
    )


@router.websocket("/stream")
async def stream_microphone(websocket: WebSocket) -> None:
    await websocket.accept()

    parameters = EnergyVadParameters()
    detector = StreamingEnergyVad(parameters.to_settings(TARGET_SAMPLE_RATE))
    elapsed_samples = 0

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if (text := message.get("text")) is not None:
                try:
                    parameters = EnergyVadParameters.model_validate_json(text)
                except ValidationError as error:
                    await websocket.send_json({"type": "error", "detail": error.errors(include_url=False)})
                    continue
                detector.reconfigure(parameters.to_settings(TARGET_SAMPLE_RATE))
                await websocket.send_json({"type": "configured", "sample_rate": TARGET_SAMPLE_RATE})
                continue

            payload = message.get("bytes")
            if not payload:
                continue

            chunk = np.frombuffer(payload, dtype="<f4")
            update = detector.process_chunk(chunk)
            chunk_start = elapsed_samples / TARGET_SAMPLE_RATE
            elapsed_samples += chunk.size

            await websocket.send_json(
                {
                    "type": "update",
                    "time": round(chunk_start, 4),
                    "energy_db": np.round(update.energy_db, 2).tolist(),
                    "flags": update.flags.astype(bool).tolist(),
                    "noise_floor_db": round(update.noise_floor_db, 2),
                    "enter_threshold_db": round(update.enter_threshold_db, 2),
                    "exit_threshold_db": round(update.exit_threshold_db, 2),
                    "speech_started": update.speech_started,
                    "speech_ended": update.speech_ended,
                    "hop_seconds": detector.settings.hop_seconds,
                }
            )
    except WebSocketDisconnect:
        return
