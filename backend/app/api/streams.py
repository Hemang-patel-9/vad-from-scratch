"""One WebSocket loop, driven by whichever streaming detector is plugged into it.

Every detector reports the same three things per block — a measurement per
frame, a decision per frame, and where its thresholds currently sit — so the
loop never needs to know which approach it is running.
"""

from __future__ import annotations

from typing import Callable

import numpy as np
from fastapi import WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from app.schemas import DetectorParameters
from app.vad.audio import TARGET_SAMPLE_RATE
from app.vad.pipeline import DecisionSettings, StreamingDetector

MEASUREMENT_DECIMALS = 3


async def run_detector_socket(
    websocket: WebSocket,
    parameters_type: type[DetectorParameters],
    detector_type: Callable[[DecisionSettings], StreamingDetector],
) -> None:
    await websocket.accept()

    parameters = parameters_type()
    detector = detector_type(parameters.to_settings(TARGET_SAMPLE_RATE))
    elapsed_samples = 0

    try:
        while True:
            message = await websocket.receive()

            if message.get("type") == "websocket.disconnect":
                break

            if (text := message.get("text")) is not None:
                try:
                    parameters = parameters_type.model_validate_json(text)
                except ValidationError as error:
                    await websocket.send_json(
                        {"type": "error", "detail": error.errors(include_url=False)}
                    )
                    continue
                detector.reconfigure(parameters.to_settings(TARGET_SAMPLE_RATE))
                await websocket.send_json(
                    {"type": "configured", "sample_rate": TARGET_SAMPLE_RATE}
                )
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
                    "hop_seconds": detector.settings.hop_seconds,
                    "measurements": np.round(update.measurements, MEASUREMENT_DECIMALS).tolist(),
                    "flags": update.flags.astype(bool).tolist(),
                    "guides": [
                        {
                            "key": guide.key,
                            "label": guide.label,
                            "value": round(guide.value, MEASUREMENT_DECIMALS),
                            "style": guide.style,
                            "emphasis": guide.emphasis,
                        }
                        for guide in update.guides
                    ],
                    "speech_started": update.speech_started,
                    "speech_ended": update.speech_ended,
                }
            )
    except WebSocketDisconnect:
        return
