"""Spectral voice activity detection: flatness and entropy of the spectrum.

Energy asks how big a frame is, zero-crossing asks roughly where its energy
sits. This asks how that energy is *arranged*. Voiced speech is harmonic — a
handful of tall peaks over a quiet background — while room noise, a fan, or a
hiss spreads itself evenly across the band. Two classical measures put a number
on that difference:

* **Flatness**, the geometric mean of the power spectrum over its arithmetic
  mean. Equal for a perfectly flat spectrum, and driven toward zero by peaks.
* **Entropy**, the Shannon entropy of the spectrum read as a distribution.
  Maximal when every bin is equally likely, lower when a few bins dominate.

Both are ratios, so both are blind to loudness — which is the point. A whisper
and a shout score the same, and a door slam scores like the noise it is.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

from app.vad.pipeline import (
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
    finalise_segments,
    frame_signal,
    median_filter,
    overall_percentile,
    percentile_curve,
    remove_dc_offset,
    round_bounds,
    segments_to_flags,
)

# Digital silence has no spectrum at all. Flooring the power keeps both measures
# reading it as perfectly flat — that is, as noise — rather than dividing zero
# by zero and calling the result structure.
POWER_FLOOR = 1e-20

# The score is unitless and its useful range differs per recording, so the
# threshold is placed a fraction of the way from the room to the loudest
# structure in the file rather than at a fixed distance. This is the high
# percentile that defines the far end of that span.
SPEECH_PERCENTILE = 90.0

# Below this the file has no separation worth thresholding, and a proportional
# margin would collapse onto the reference.
MIN_SCORE_SPAN = 0.02

# Same runaway as the energy floor: inside a long utterance the window fills
# with speech and the low percentile climbs after it.
ADAPTIVE_REFERENCE_CEILING = 0.12


@dataclass(frozen=True)
class SpectralVadSettings(DecisionSettings):
    band_low_hz: float = 200.0
    band_high_hz: float = 4000.0
    flatness_weight: float = 0.5
    noise_percentile: float = 15.0
    reference_window_s: float = 5.0
    margin: float = 0.35
    hysteresis: float = 0.1

    @property
    def reference_window_frames(self) -> int:
        return self.frames_in(self.reference_window_s * 1000.0)


def compute_band_power(frames: np.ndarray, settings: SpectralVadSettings) -> np.ndarray:
    """Power spectrum of each frame, keeping only the bins speech lives in.

    Hann rather than a rectangular window: an abrupt frame edge smears energy
    across every bin, which is exactly the flat spectrum both measures below are
    trying to detect, and it would wash out real structure.
    """
    # Subtracting one mean from the whole signal does not leave every frame
    # zero-mean. A gap edited down to digital silence comes out of that as a
    # constant offset, and a constant is the most tonal thing there is: both
    # measures below read it as pure structure and score silence above speech.
    # Centring each frame on its own mean is what actually makes them agree that
    # nothing is happening.
    centred = frames - frames.mean(axis=1, keepdims=True, dtype=np.float64).astype(np.float32)

    # float32 window, or the multiply widens the whole frame matrix to float64
    # before the transform has even started.
    window = np.hanning(frames.shape[1]).astype(np.float32)
    spectrum = np.fft.rfft(centred * window, axis=1)
    power = np.square(spectrum.real) + np.square(spectrum.imag)

    frequencies = np.fft.rfftfreq(frames.shape[1], 1.0 / settings.sample_rate)
    keep = (frequencies >= settings.band_low_hz) & (frequencies <= settings.band_high_hz)
    # A band narrower than one bin would leave nothing to measure.
    if np.count_nonzero(keep) < 2:
        keep = np.ones(frequencies.size, dtype=bool)
    return np.maximum(power[:, keep], POWER_FLOOR)


def spectral_flatness(power: np.ndarray) -> np.ndarray:
    """Geometric over arithmetic mean: 1 for a flat spectrum, toward 0 for a peaky one."""
    geometric = np.exp(np.log(power).mean(axis=1))
    return geometric / power.mean(axis=1)


def spectral_entropy(power: np.ndarray) -> np.ndarray:
    """Shannon entropy of the normalised spectrum, over its maximum: 1 for a flat spectrum."""
    probabilities = power / power.sum(axis=1, keepdims=True)
    entropy = -np.sum(probabilities * np.log(probabilities), axis=1)
    return entropy / np.log(power.shape[1])


def compute_tonality_score(frames: np.ndarray, settings: SpectralVadSettings) -> np.ndarray:
    """Both measures inverted into "how structured is this frame", and blended.

    Inverting first is what makes them mixable: flatness and entropy are both 1
    for noise and fall as structure appears, so `1 - x` puts each on the same
    0-to-1 scale pointing the same way, and the weight is a plain crossfade.
    """
    power = compute_band_power(frames, settings)
    weight = min(1.0, max(0.0, settings.flatness_weight))
    score = np.zeros(power.shape[0])
    if weight > 0.0:
        score += weight * (1.0 - spectral_flatness(power))
    if weight < 1.0:
        score += (1.0 - weight) * (1.0 - spectral_entropy(power))
    return score


def estimate_room_score_curve(
    score: np.ndarray, percentile: float, window_frames: int
) -> np.ndarray:
    curve = percentile_curve(score, percentile, window_frames)
    overall = overall_percentile(score, percentile)
    return np.minimum(curve, overall + ADAPTIVE_REFERENCE_CEILING)


def analyze_recording(samples: np.ndarray, settings: SpectralVadSettings) -> Analysis:
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    duration = samples.size / settings.sample_rate
    samples = remove_dc_offset(samples)

    frames = frame_signal(samples, settings.frame_length, settings.hop_length)
    score = median_filter(compute_tonality_score(frames, settings), settings.smoothing_frames)

    window_frames = settings.reference_window_frames
    room_curve = estimate_room_score_curve(score, settings.noise_percentile, window_frames)
    speech_curve = percentile_curve(score, SPEECH_PERCENTILE, window_frames)
    span = np.maximum(speech_curve - room_curve, MIN_SCORE_SPAN)

    enter_curve = room_curve + settings.margin * span
    leave_curve = enter_curve - settings.hysteresis * span

    flags_after_threshold = apply_hysteresis_threshold(score, enter_curve, leave_curve)
    flags_after_hangover = apply_hangover(
        apply_pre_speech(flags_after_threshold, settings.pre_speech_frames),
        settings.hangover_frames,
    )

    segments = finalise_segments(flags_after_hangover, settings, duration)
    flags_after_duration_filter = segments_to_flags(
        segments, score.size, settings.hop_seconds, settings.frame_seconds
    )

    median_room = float(np.median(room_curve)) if room_curve.size else 0.0

    return Analysis(
        traces=[_build_trace(score, room_curve, enter_curve, leave_curve)],
        flags_after_threshold=flags_after_threshold,
        flags_after_hangover=flags_after_hangover,
        flags_after_duration_filter=flags_after_duration_filter,
        segments=segments,
        statistics=[Statistic(label="Room score", value=f"{median_room:.2f}")],
        hop_seconds=settings.hop_seconds,
        frame_seconds=settings.frame_seconds,
        duration=duration,
    )


def _build_trace(
    score: np.ndarray,
    room_curve: np.ndarray,
    enter_curve: np.ndarray,
    leave_curve: np.ndarray,
) -> Trace:
    top, bottom = round_bounds(
        min(float(score.min()), float(leave_curve.min())),
        max(float(score.max()), float(enter_curve.max())),
        pad_below=0.05,
        pad_above=0.05,
        step=0.1,
    )
    return Trace(
        key="tonality",
        label="Tonality score",
        unit="",
        hint="solid = enter · dashed = exit · dotted = the room's own score",
        values=score,
        top=min(1.0, top),
        bottom=max(0.0, bottom),
        decimals=3,
        guides=[
            GuideCurve("room", "Room score", room_curve, style="dotted", emphasis="secondary"),
            GuideCurve("exit", "Exit at", leave_curve, style="dashed"),
            GuideCurve("enter", "Enter at", enter_curve, style="solid"),
        ],
    )


class StreamingSpectralVad(StreamingDetector):
    """Causal counterpart to `analyze_recording`.

    The threshold sits a fraction of the way between two references, so both are
    tracked: the room's score, which behaves exactly like the energy floor, and
    a peak follower standing in for the file-wide high percentile.
    """

    speech_above = True

    def __init__(self, settings: SpectralVadSettings, warmup_ms: float = 200.0) -> None:
        super().__init__(settings, warmup_ms=warmup_ms)
        self._room = AdaptiveReference(speech_above=True)
        self._peak = AdaptiveReference(speech_above=False)

    @property
    def settings(self) -> SpectralVadSettings:
        return self._settings

    def prepare(self, frames: np.ndarray) -> np.ndarray:
        return compute_tonality_score(frames, self._settings)

    def observe(self, index: int, level: float, speaking: bool) -> None:
        self._room.update(level, speaking)
        # The peak reference is never held: speech is precisely when the peaks
        # it exists to follow arrive.
        self._peak.update(level, False)

    def forget_references(self) -> None:
        self._room.forget()
        self._peak.forget()

    def thresholds(self) -> tuple[float, float]:
        room = self._room.resolved(0.0)
        span = max(self._peak.resolved(1.0) - room, MIN_SCORE_SPAN)
        enter = room + self._settings.margin * span
        return enter, enter - self._settings.hysteresis * span

    def guides(self) -> list[GuideLevel]:
        enter, leave = self.thresholds()
        return [
            GuideLevel("enter", "Enter at", enter),
            GuideLevel("exit", "Exit at", leave, style="dashed"),
            GuideLevel(
                "room", "Room score", self._room.resolved(0.0), style="dotted", emphasis="secondary"
            ),
        ]
