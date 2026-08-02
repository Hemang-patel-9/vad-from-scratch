"""Zero-crossing-rate voice activity detection.

Energy asks how *big* a frame is. This asks what *shape* it has: count how often
the waveform changes sign, and you have a crude estimate of where its spectral
energy sits. Voiced speech is dominated by a low-frequency glottal buzz and
crosses zero slowly. Room noise is broadband and crosses zero far more often.
So the comparison runs the other way round from energy — a frame is speech when
its crossing rate falls *below* the threshold.

That inversion is the whole idea, and it brings a failure energy does not have:
digital silence never changes sign at all, so it reads as the most voiced thing
in the file. The energy gate exists to answer that, and can be switched off to
watch it happen.
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
    percentile_curve,
    remove_dc_offset,
    round_bounds,
    segments_to_flags,
)

# The gate only has to tell "the room" from "something happening", which is a far
# coarser question than the energy detector answers, so its floor is not exposed
# as a parameter.
GATE_NOISE_PERCENTILE = 10.0

# The reference is only as good as its assumption, so the threshold it produces
# is clamped into the band voiced speech actually occupies at 16 kHz. A file
# with no speech in it at all would otherwise anchor the reference to its own
# hiss and then admit that hiss as speech; the ceiling stops that, and the floor
# stops a heavily edited file from collapsing the threshold to nothing.
ENTER_FLOOR_HZ = 600.0
ENTER_CEILING_HZ = 3500.0


@dataclass(frozen=True)
class ZeroCrossingVadSettings(DecisionSettings):
    zcr_percentile: float = 25.0
    zcr_window_s: float = 5.0
    zcr_margin_hz: float = 1400.0
    hysteresis_hz: float = 250.0
    energy_gate: bool = True
    gate_offset_db: float = 3.0

    @property
    def zcr_window_frames(self) -> int:
        return self.frames_in(self.zcr_window_s * 1000.0)


def compute_crossing_rate_hz(frames: np.ndarray, sample_rate: int) -> np.ndarray:
    """Sign changes per second. Roughly twice the dominant frequency of the frame."""
    # signbit rather than a comparison against zero: it treats -0.0 as negative
    # and, more usefully, avoids materialising a second float array per frame.
    signs = np.signbit(frames)
    crossings = np.count_nonzero(signs[:, 1:] != signs[:, :-1], axis=1)
    intervals = max(1, frames.shape[1] - 1)
    return crossings * (sample_rate / intervals)


def estimate_voiced_rate_curve(
    crossing_rate_hz: np.ndarray,
    percentile: float,
    window_frames: int,
    audible: np.ndarray | None,
) -> np.ndarray:
    """How fast the most voiced part of the audio crosses zero.

    The threshold is anchored to the *low* end of the distribution and placed
    above it, rather than anchored to the broadband end and placed below it.
    Both readings are defensible on paper; only this one survives contact with
    real files. A recording may contain no broadband noise to measure — plenty
    are edited down to digital silence between utterances — in which case a high
    percentile lands inside the speech and subtracting a margin puts the
    threshold underneath the very thing it is meant to admit. The voiced end,
    by contrast, is present whenever there is speech to detect.

    Silent frames are excluded where the gate can identify them: they cross zero
    almost never, and would drag the anchor to nothing.
    """
    return percentile_curve(crossing_rate_hz, percentile, window_frames, where=audible)


def analyze_recording(samples: np.ndarray, settings: ZeroCrossingVadSettings) -> Analysis:
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    duration = samples.size / settings.sample_rate
    samples = remove_dc_offset(samples)

    frames = frame_signal(samples, settings.frame_length, settings.hop_length)
    crossing_rate_hz = median_filter(
        compute_crossing_rate_hz(frames, settings.sample_rate), settings.smoothing_frames
    )
    energy_db = median_filter(compute_frame_energy_db(frames), settings.smoothing_frames)

    gate_floor_curve = percentile_curve(
        energy_db,
        GATE_NOISE_PERCENTILE,
        settings.zcr_window_frames,
        where=energy_db > SILENCE_FLOOR_DB,
        when_empty=SILENCE_FLOOR_DB,
    )
    gate_curve = gate_floor_curve + settings.gate_offset_db
    admitted = energy_db > gate_curve if settings.energy_gate else None

    voiced_curve = estimate_voiced_rate_curve(
        crossing_rate_hz, settings.zcr_percentile, settings.zcr_window_frames, admitted
    )
    enter_curve = np.clip(
        voiced_curve + settings.zcr_margin_hz, ENTER_FLOOR_HZ, ENTER_CEILING_HZ
    )
    leave_curve = enter_curve + settings.hysteresis_hz

    # Gating after the threshold would let the Schmitt trigger stay latched
    # through a gated-out pause and then leave via the wrong bound. Sending the
    # rejected frames in as infinitely fast crossings settles it properly.
    guarded = crossing_rate_hz if admitted is None else np.where(admitted, crossing_rate_hz, np.inf)

    flags_after_threshold = apply_hysteresis_threshold(
        guarded, enter_curve, leave_curve, speech_above=False
    )
    flags_after_hangover = apply_hangover(
        apply_pre_speech(flags_after_threshold, settings.pre_speech_frames),
        settings.hangover_frames,
    )

    segments = finalise_segments(flags_after_hangover, settings, duration)
    flags_after_duration_filter = segments_to_flags(
        segments, crossing_rate_hz.size, settings.hop_seconds, settings.frame_seconds
    )

    median_voiced = float(np.median(voiced_curve)) if voiced_curve.size else 0.0

    return Analysis(
        traces=[
            _build_rate_trace(crossing_rate_hz, voiced_curve, enter_curve, leave_curve, settings),
            _build_gate_trace(energy_db, gate_curve, settings),
        ],
        flags_after_threshold=flags_after_threshold,
        flags_after_hangover=flags_after_hangover,
        flags_after_duration_filter=flags_after_duration_filter,
        segments=segments,
        statistics=[Statistic(label="Voiced rate", value=f"{median_voiced:,.0f}/s")],
        hop_seconds=settings.hop_seconds,
        frame_seconds=settings.frame_seconds,
        duration=duration,
    )


def _build_rate_trace(
    crossing_rate_hz: np.ndarray,
    voiced_curve: np.ndarray,
    enter_curve: np.ndarray,
    leave_curve: np.ndarray,
    settings: ZeroCrossingVadSettings,
) -> Trace:
    top, bottom = round_bounds(
        min(float(crossing_rate_hz.min()), float(voiced_curve.min())),
        max(float(crossing_rate_hz.max()), float(leave_curve.max())),
        pad_below=250.0,
        pad_above=250.0,
        step=500.0,
    )
    return Trace(
        key="crossing-rate",
        label="Zero-crossing rate",
        unit="/s",
        hint="speech is below the solid line · dotted = the voiced reference",
        values=crossing_rate_hz,
        top=min(float(settings.sample_rate), top),
        bottom=max(0.0, bottom),
        decimals=0,
        guides=[
            GuideCurve("voiced", "Voiced rate", voiced_curve, style="dotted", emphasis="secondary"),
            GuideCurve("exit", "Exit above", leave_curve, style="dashed"),
            GuideCurve("enter", "Enter below", enter_curve, style="solid"),
        ],
    )


def _build_gate_trace(
    energy_db: np.ndarray, gate_curve: np.ndarray, settings: ZeroCrossingVadSettings
) -> Trace:
    top, bottom = round_bounds(
        min(float(gate_curve.min()), float(energy_db.min())),
        float(energy_db.max()),
        pad_below=6.0,
        pad_above=4.0,
        step=5.0,
    )
    return Trace(
        key="gate",
        label="Energy gate",
        unit="dB",
        hint=(
            "frames under the line can never be speech"
            if settings.energy_gate
            else "gate off — the rate decides alone, silence included"
        ),
        values=energy_db,
        top=min(6.0, top),
        bottom=max(SILENCE_FLOOR_DB - 2.0, bottom),
        guides=(
            [GuideCurve("gate", "Gate at", gate_curve, style="solid")]
            if settings.energy_gate
            else []
        ),
    )


class StreamingZeroCrossingVad(StreamingDetector):
    """Causal counterpart to `analyze_recording`.

    Two references adapt instead of one. The noise floor under the gate behaves
    exactly as it does in the energy detector. The voiced reference is a valley
    follower — quick to drop, slow to rise — standing in for the low percentile
    the offline path takes, and it is never held during speech, because voiced
    speech is precisely the thing it is trying to measure.
    """

    speech_above = False

    def __init__(self, settings: ZeroCrossingVadSettings, warmup_ms: float = 200.0) -> None:
        super().__init__(settings, warmup_ms=warmup_ms)
        self._voiced = AdaptiveReference(speech_above=True)
        self._floor = AdaptiveReference(speech_above=True)
        self._energy_db = np.zeros(0)

    @property
    def settings(self) -> ZeroCrossingVadSettings:
        return self._settings

    def prepare(self, frames: np.ndarray) -> np.ndarray:
        self._energy_db = compute_frame_energy_db(frames)
        return compute_crossing_rate_hz(frames, self._settings.sample_rate)

    def admits(self, index: int) -> bool:
        if not self._settings.energy_gate:
            return True
        # Read against the floor as it stands at this frame, not at the start of
        # the block, so the gate matches the offline path frame for frame.
        gate_db = self._floor.resolved(SILENCE_FLOOR_DB) + self._settings.gate_offset_db
        return bool(self._energy_db[index] > gate_db)

    def observe(self, index: int, level: float, speaking: bool) -> None:
        if self.admits(index):
            self._voiced.update(level, False)
        self._floor.update(float(self._energy_db[index]), speaking)

    def forget_references(self) -> None:
        self._voiced.forget()
        self._floor.forget()

    def thresholds(self) -> tuple[float, float]:
        reference = self._voiced.resolved(0.0)
        enter_hz = min(
            ENTER_CEILING_HZ, max(ENTER_FLOOR_HZ, reference + self._settings.zcr_margin_hz)
        )
        return enter_hz, enter_hz + self._settings.hysteresis_hz

    def guides(self) -> list[GuideLevel]:
        enter_hz, leave_hz = self.thresholds()
        return [
            GuideLevel("enter", "Enter below", enter_hz),
            GuideLevel("exit", "Exit above", leave_hz, style="dashed"),
            GuideLevel(
                "voiced",
                "Voiced rate",
                self._voiced.resolved(0.0),
                style="dotted",
                emphasis="secondary",
            ),
        ]
