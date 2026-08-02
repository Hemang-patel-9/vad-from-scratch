"""Turning a detector's `Analysis` into the JSON every approach shares.

The three endpoint modules differ only in which detector they call and how they
describe their threshold stage, so everything else happens here.
"""

from __future__ import annotations

import time
from typing import Callable

import numpy as np
from fastapi import HTTPException

from app.schemas import (
    AnalysisRequest,
    GuideCurveModel,
    PipelineStage,
    SegmentModel,
    StatisticModel,
    TraceModel,
    VadAnalysis,
    WaveformEnvelope,
)
from app.vad.audio import TARGET_SAMPLE_RATE, compute_peak_envelope, load_sample
from app.vad.pipeline import Analysis, DecisionSettings, Segment, Trace, flags_to_segments

GUIDE_POINTS = 400

LATER_STAGES = (
    ("hangover", "Hangover", "Trailing frames held on so trailing consonants survive."),
    ("duration", "Duration filter", "Short bursts dropped, close neighbours merged."),
)


def _downsample(curve: np.ndarray, points: int, decimals: int) -> list[float]:
    if curve.size == 0:
        return []
    if curve.size <= points:
        return np.round(curve, decimals).tolist()
    picks = np.linspace(0, curve.size - 1, points).astype(int)
    return np.round(curve[picks], decimals).tolist()


def _to_segment_models(segments: list[Segment]) -> list[SegmentModel]:
    return [SegmentModel(start=round(s.start, 4), end=round(s.end, 4)) for s in segments]


def _to_trace_model(trace: Trace) -> TraceModel:
    return TraceModel(
        key=trace.key,
        label=trace.label,
        unit=trace.unit,
        hint=trace.hint,
        top=trace.top,
        bottom=trace.bottom,
        values=np.round(trace.values, trace.decimals).tolist(),
        guides=[
            GuideCurveModel(
                key=guide.key,
                label=guide.label,
                style=guide.style,
                emphasis=guide.emphasis,
                values=_downsample(guide.values, GUIDE_POINTS, trace.decimals + 1),
            )
            for guide in trace.guides
        ],
    )


def _build_stages(analysis: Analysis, threshold_description: str) -> list[PipelineStage]:
    described = (("threshold", "Threshold", threshold_description), *LATER_STAGES)
    per_stage = (
        flags_to_segments(
            analysis.flags_after_threshold, analysis.hop_seconds, analysis.frame_seconds
        ),
        flags_to_segments(
            analysis.flags_after_hangover, analysis.hop_seconds, analysis.frame_seconds
        ),
        analysis.segments,
    )
    return [
        PipelineStage(
            key=key,
            label=label,
            description=description,
            segments=_to_segment_models(segments),
        )
        for (key, label, description), segments in zip(described, per_stage)
    ]


def run_analysis(
    request: AnalysisRequest,
    analyse: Callable[[np.ndarray, DecisionSettings], Analysis],
    threshold_description: str,
) -> VadAnalysis:
    samples = load_sample(request.sample, TARGET_SAMPLE_RATE)
    if samples is None:
        raise HTTPException(status_code=404, detail=f"No sample named {request.sample!r}")

    settings = request.to_settings(TARGET_SAMPLE_RATE)
    started = time.perf_counter()
    analysis = analyse(samples, settings)
    elapsed_ms = (time.perf_counter() - started) * 1000.0

    waveform = None
    if request.include_waveform:
        low, high = compute_peak_envelope(samples, request.waveform_buckets)
        waveform = WaveformEnvelope(low=low, high=high)

    speech_seconds = sum(segment.duration for segment in analysis.segments)
    speech_ratio = speech_seconds / analysis.duration if analysis.duration else 0.0

    return VadAnalysis(
        sample=request.sample,
        sample_rate=TARGET_SAMPLE_RATE,
        duration=round(analysis.duration, 4),
        frame_seconds=analysis.frame_seconds,
        hop_seconds=analysis.hop_seconds,
        traces=[_to_trace_model(trace) for trace in analysis.traces],
        stages=_build_stages(analysis, threshold_description),
        segments=_to_segment_models(analysis.segments),
        speech_ratio=round(speech_ratio, 4),
        statistics=[
            StatisticModel(label="Segments", value=f"{len(analysis.segments)}"),
            StatisticModel(label="Speech", value=f"{round(speech_ratio * 100)}%"),
            # Whatever the detector considers worth reporting about itself, which
            # is the one place the three approaches are allowed to differ here.
            *(StatisticModel(label=s.label, value=s.value) for s in analysis.statistics),
            StatisticModel(label="Detector", value=f"{elapsed_ms:.1f} ms"),
        ],
        waveform=waveform,
        elapsed_ms=round(elapsed_ms, 2),
    )
