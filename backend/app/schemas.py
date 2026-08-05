"""Request and response shapes for the JSON API.

Every detector answers with the same envelope: the traces to plot, the decision
after each stage, and the segments that survived. Only what is inside a trace
differs between approaches, which is what lets one page serve all of them.
"""

from __future__ import annotations

from dataclasses import fields
from typing import ClassVar

from pydantic import BaseModel, Field

from app.vad.energy import EnergyVadSettings
from app.vad.neural import MODEL_FRAME_MS, MODEL_HOP_MS, NeuralVadSettings
from app.vad.pipeline import DecisionSettings
from app.vad.spectral import SpectralVadSettings
from app.vad.zerocrossing import ZeroCrossingVadSettings


class SampleSummary(BaseModel):
    name: str
    duration: float
    source_sample_rate: int
    channels: int


class DetectorParameters(BaseModel):
    """The stages every detector shares. Subclasses add what they measure with."""

    settings_type: ClassVar[type[DecisionSettings]] = DecisionSettings

    frame_ms: float = Field(default=30.0, ge=5.0, le=100.0)
    hop_ms: float = Field(default=10.0, ge=1.0, le=50.0)
    smoothing_ms: float = Field(default=30.0, ge=0.0, le=200.0)
    pre_speech_ms: float = Field(default=30.0, ge=0.0, le=500.0)
    hangover_ms: float = Field(default=60.0, ge=0.0, le=1000.0)
    min_speech_ms: float = Field(default=120.0, ge=0.0, le=2000.0)
    min_silence_ms: float = Field(default=100.0, ge=0.0, le=2000.0)

    def to_settings(self, sample_rate: int) -> DecisionSettings:
        # The settings dataclass is the authority on which fields are tuning and
        # which are transport, so the request is read through it rather than the
        # other way round — a request may carry a sample name too.
        tuning = {
            field.name: getattr(self, field.name)
            for field in fields(self.settings_type)
            if field.name != "sample_rate"
        }
        return self.settings_type(sample_rate=sample_rate, **tuning)


class EnergyVadParameters(DetectorParameters):
    settings_type: ClassVar[type[DecisionSettings]] = EnergyVadSettings

    noise_percentile: float = Field(default=10.0, ge=1.0, le=50.0)
    noise_window_s: float = Field(default=5.0, ge=0.0, le=30.0)
    threshold_offset_db: float = Field(default=8.0, ge=0.0, le=40.0)
    hysteresis_db: float = Field(default=3.0, ge=0.0, le=20.0)


class ZeroCrossingVadParameters(DetectorParameters):
    settings_type: ClassVar[type[DecisionSettings]] = ZeroCrossingVadSettings

    zcr_percentile: float = Field(default=25.0, ge=1.0, le=90.0)
    zcr_window_s: float = Field(default=5.0, ge=0.0, le=30.0)
    zcr_margin_hz: float = Field(default=1400.0, ge=0.0, le=4000.0)
    hysteresis_hz: float = Field(default=250.0, ge=0.0, le=1500.0)
    energy_gate: bool = True
    gate_offset_db: float = Field(default=3.0, ge=0.0, le=30.0)


class SpectralVadParameters(DetectorParameters):
    settings_type: ClassVar[type[DecisionSettings]] = SpectralVadSettings

    band_low_hz: float = Field(default=200.0, ge=0.0, le=2000.0)
    band_high_hz: float = Field(default=4000.0, ge=1000.0, le=8000.0)
    flatness_weight: float = Field(default=0.5, ge=0.0, le=1.0)
    noise_percentile: float = Field(default=15.0, ge=1.0, le=50.0)
    reference_window_s: float = Field(default=5.0, ge=0.0, le=30.0)
    margin: float = Field(default=0.35, ge=0.05, le=0.9)
    hysteresis: float = Field(default=0.1, ge=0.0, le=0.5)


class NeuralVadParameters(DetectorParameters):
    """The framing controls are inherited but not really tunable.

    `frame_ms` and `hop_ms` are the grid the model was trained on, so they are
    pinned to it rather than offered as choices — the detector answers 400 for
    anything else instead of resampling the model's opinion onto a time axis it
    never saw. The `/dl-based` page leaves both sliders out for that reason.
    """

    settings_type: ClassVar[type[DecisionSettings]] = NeuralVadSettings

    frame_ms: float = Field(default=MODEL_FRAME_MS, ge=MODEL_FRAME_MS, le=MODEL_FRAME_MS)
    hop_ms: float = Field(default=MODEL_HOP_MS, ge=MODEL_HOP_MS, le=MODEL_HOP_MS)
    # The GRU has already smoothed its own output; a median filter on top of it
    # mostly rounds off onsets the model was deliberate about.
    smoothing_ms: float = Field(default=0.0, ge=0.0, le=200.0)
    hangover_ms: float = Field(default=40.0, ge=0.0, le=1000.0)
    min_speech_ms: float = Field(default=80.0, ge=0.0, le=2000.0)

    enter_probability: float = Field(default=0.6, ge=0.05, le=0.95)
    exit_probability: float = Field(default=0.4, ge=0.05, le=0.95)


class AnalysisRequest(DetectorParameters):
    """A detector's parameters, plus which sample to run them over."""

    sample: str
    waveform_buckets: int = Field(default=1600, ge=100, le=8000)
    # The envelope depends only on the sample, so a client that already has it
    # can skip it and keep slider round-trips small.
    include_waveform: bool = True


class EnergyVadRequest(EnergyVadParameters, AnalysisRequest):
    pass


class ZeroCrossingVadRequest(ZeroCrossingVadParameters, AnalysisRequest):
    pass


class SpectralVadRequest(SpectralVadParameters, AnalysisRequest):
    pass


class NeuralVadRequest(NeuralVadParameters, AnalysisRequest):
    pass


class SegmentModel(BaseModel):
    start: float
    end: float


class PipelineStage(BaseModel):
    key: str
    label: str
    description: str
    segments: list[SegmentModel]


class GuideCurveModel(BaseModel):
    key: str
    label: str
    style: str
    emphasis: str
    # Sampled on a coarse grid spanning the recording; guides are smooth by
    # construction, so the client interpolates between points.
    values: list[float]


class TraceModel(BaseModel):
    key: str
    label: str
    unit: str
    hint: str
    top: float
    bottom: float
    values: list[float]
    guides: list[GuideCurveModel]


class StatisticModel(BaseModel):
    label: str
    value: str


class WaveformEnvelope(BaseModel):
    low: list[float]
    high: list[float]


class VadAnalysis(BaseModel):
    sample: str
    sample_rate: int
    duration: float
    frame_seconds: float
    hop_seconds: float
    traces: list[TraceModel]
    stages: list[PipelineStage]
    segments: list[SegmentModel]
    speech_ratio: float
    statistics: list[StatisticModel]
    waveform: WaveformEnvelope | None
    elapsed_ms: float
