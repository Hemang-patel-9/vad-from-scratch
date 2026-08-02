"""Energy-based voice activity detection, written directly against numpy.

The pipeline is: split the signal into overlapping frames, measure the energy of
each frame in decibels, estimate where the noise floor sits, and mark a frame as
speech when its energy rises above a threshold placed relative to that floor.
Everything after the threshold lives in `pipeline.py`, because it is the same
for every rule-based detector here.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.vad.pipeline import (
    SILENCE_FLOOR_DB,
    AdaptiveReference,
    Analysis,
    DecisionSettings,
    GuideCurve,
    GuideLevel,
    Statistic,
    StreamingDetector,
    Trace,
    apply_hangover,
    apply_hysteresis_threshold,
    apply_pre_speech,
    compute_frame_energy_db,
    finalise_segments,
    frame_signal,
    median_filter,
    overall_percentile,
    percentile_curve,
    remove_dc_offset,
    round_bounds,
    segments_to_flags,
)

# A windowed noise floor tracks drift, but inside a long utterance the window
# fills with speech and the floor chases it upward. Capping it relative to the
# whole-file estimate keeps that runaway bounded.
ADAPTIVE_FLOOR_CEILING_DB = 6.0


@dataclass(frozen=True)
class EnergyVadSettings(DecisionSettings):
    noise_percentile: float = 10.0
    noise_window_s: float = 5.0
    threshold_offset_db: float = 8.0
    hysteresis_db: float = 3.0

    @property
    def noise_window_frames(self) -> int:
        return self.frames_in(self.noise_window_s * 1000.0)


def audible(energy_db: np.ndarray) -> np.ndarray:
    """Frames above digital silence, so a zero-padded file cannot drag the floor to −100 dB."""
    return energy_db > SILENCE_FLOOR_DB


def estimate_noise_floor_db(energy_db: np.ndarray, percentile: float) -> float:
    return overall_percentile(
        energy_db, percentile, where=audible(energy_db), when_empty=SILENCE_FLOOR_DB
    )


def estimate_noise_floor_curve(
    energy_db: np.ndarray, percentile: float, window_frames: int
) -> np.ndarray:
    curve = percentile_curve(
        energy_db,
        percentile,
        window_frames,
        where=audible(energy_db),
        when_empty=SILENCE_FLOOR_DB,
    )
    overall = estimate_noise_floor_db(energy_db, percentile)
    return np.minimum(curve, overall + ADAPTIVE_FLOOR_CEILING_DB)


def analyze_recording(samples: np.ndarray, settings: EnergyVadSettings) -> Analysis:
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    duration = samples.size / settings.sample_rate
    samples = remove_dc_offset(samples)

    frames = frame_signal(samples, settings.frame_length, settings.hop_length)
    energy_db = median_filter(compute_frame_energy_db(frames), settings.smoothing_frames)

    floor_curve = estimate_noise_floor_curve(
        energy_db, settings.noise_percentile, settings.noise_window_frames
    )
    enter_curve = floor_curve + settings.threshold_offset_db
    leave_curve = enter_curve - settings.hysteresis_db

    flags_after_threshold = apply_hysteresis_threshold(energy_db, enter_curve, leave_curve)
    flags_after_hangover = apply_hangover(
        apply_pre_speech(flags_after_threshold, settings.pre_speech_frames),
        settings.hangover_frames,
    )

    segments = finalise_segments(flags_after_hangover, settings, duration)
    flags_after_duration_filter = segments_to_flags(
        segments, energy_db.size, settings.hop_seconds, settings.frame_seconds
    )

    median_floor = float(np.median(floor_curve)) if floor_curve.size else SILENCE_FLOOR_DB

    return Analysis(
        traces=[_build_trace(energy_db, floor_curve, enter_curve, leave_curve)],
        flags_after_threshold=flags_after_threshold,
        flags_after_hangover=flags_after_hangover,
        flags_after_duration_filter=flags_after_duration_filter,
        segments=segments,
        statistics=[Statistic(label="Noise floor", value=f"{median_floor:.1f} dB")],
        hop_seconds=settings.hop_seconds,
        frame_seconds=settings.frame_seconds,
        duration=duration,
    )


def _build_trace(
    energy_db: np.ndarray,
    floor_curve: np.ndarray,
    enter_curve: np.ndarray,
    leave_curve: np.ndarray,
) -> Trace:
    # The bottom follows the floor rather than the quietest frame: a file padded
    # with digital silence would otherwise squash everything interesting into a
    # sliver at the top of the plot.
    top, bottom = round_bounds(
        min(float(floor_curve.min()), float(leave_curve.min())),
        float(energy_db.max()),
        pad_below=12.0,
        pad_above=4.0,
        step=5.0,
    )
    return Trace(
        key="energy",
        label="Frame energy",
        unit="dB",
        hint="solid = enter · dashed = exit · dotted = noise floor",
        values=energy_db,
        top=min(6.0, top),
        bottom=max(SILENCE_FLOOR_DB - 2.0, bottom),
        guides=[
            GuideCurve("floor", "Noise floor", floor_curve, style="dotted", emphasis="secondary"),
            GuideCurve("exit", "Exit at", leave_curve, style="dashed"),
            GuideCurve("enter", "Enter at", enter_curve, style="solid"),
        ],
    )


class StreamingEnergyVad(StreamingDetector):
    """Causal counterpart to `analyze_recording`.

    The offline version can take a percentile of the whole file before choosing
    a noise floor. A live stream cannot, so the floor is tracked with an
    exponential average instead. Onset backtracking is unavailable for the same
    reason: the frames before an onset have already been sent.
    """

    speech_above = True

    def __init__(self, settings: EnergyVadSettings, warmup_ms: float = 200.0) -> None:
        super().__init__(settings, warmup_ms=warmup_ms)
        self._floor = AdaptiveReference(speech_above=True)

    @property
    def settings(self) -> EnergyVadSettings:
        return self._settings

    def prepare(self, frames: np.ndarray) -> np.ndarray:
        return compute_frame_energy_db(frames)

    def observe(self, index: int, level: float, speaking: bool) -> None:
        self._floor.update(level, speaking)

    def forget_references(self) -> None:
        self._floor.forget()

    def thresholds(self) -> tuple[float, float]:
        enter_db = self._floor.resolved(SILENCE_FLOOR_DB) + self._settings.threshold_offset_db
        return enter_db, enter_db - self._settings.hysteresis_db

    def guides(self) -> list[GuideLevel]:
        enter_db, leave_db = self.thresholds()
        return [
            GuideLevel("enter", "Enter at", enter_db),
            GuideLevel("exit", "Exit at", leave_db, style="dashed"),
            GuideLevel(
                "floor",
                "Noise floor",
                self._floor.resolved(SILENCE_FLOOR_DB),
                style="dotted",
                emphasis="secondary",
            ),
        ]
