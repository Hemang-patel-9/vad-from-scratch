"""Request and response shapes for the JSON API."""

from __future__ import annotations

from pydantic import BaseModel, Field

from app.vad.energy import EnergyVadSettings


class SampleSummary(BaseModel):
    name: str
    duration: float
    source_sample_rate: int
    channels: int


class EnergyVadParameters(BaseModel):
    frame_ms: float = Field(default=30.0, ge=5.0, le=100.0)
    hop_ms: float = Field(default=10.0, ge=1.0, le=50.0)
    smoothing_ms: float = Field(default=30.0, ge=0.0, le=200.0)
    noise_percentile: float = Field(default=10.0, ge=1.0, le=50.0)
    noise_window_s: float = Field(default=5.0, ge=0.0, le=30.0)
    threshold_offset_db: float = Field(default=8.0, ge=0.0, le=40.0)
    hysteresis_db: float = Field(default=3.0, ge=0.0, le=20.0)
    pre_speech_ms: float = Field(default=30.0, ge=0.0, le=500.0)
    hangover_ms: float = Field(default=60.0, ge=0.0, le=1000.0)
    min_speech_ms: float = Field(default=120.0, ge=0.0, le=2000.0)
    min_silence_ms: float = Field(default=100.0, ge=0.0, le=2000.0)

    def to_settings(self, sample_rate: int) -> EnergyVadSettings:
        # Subclasses add transport-only fields, so select the tuning fields by name.
        tuning = {field: getattr(self, field) for field in EnergyVadParameters.model_fields}
        return EnergyVadSettings(sample_rate=sample_rate, **tuning)


class EnergyVadRequest(EnergyVadParameters):
    sample: str
    waveform_buckets: int = Field(default=1600, ge=100, le=8000)
    # The envelope depends only on the sample, so a client that already has it
    # can skip it and keep slider round-trips small.
    include_waveform: bool = True


class SegmentModel(BaseModel):
    start: float
    end: float


class PipelineStage(BaseModel):
    key: str
    label: str
    description: str
    segments: list[SegmentModel]


class WaveformEnvelope(BaseModel):
    low: list[float]
    high: list[float]


class EnergyVadResponse(BaseModel):
    sample: str
    sample_rate: int
    duration: float
    frame_seconds: float
    hop_seconds: float
    energy_db: list[float]
    # Sampled on a coarse grid spanning the recording; the curve is smooth by
    # construction, so the client interpolates between points.
    noise_floor_curve_db: list[float]
    noise_floor_db: float
    enter_threshold_db: float
    exit_threshold_db: float
    threshold_offset_db: float
    hysteresis_db: float
    silence_floor_db: float
    stages: list[PipelineStage]
    segments: list[SegmentModel]
    speech_ratio: float
    waveform: WaveformEnvelope | None
    elapsed_ms: float
