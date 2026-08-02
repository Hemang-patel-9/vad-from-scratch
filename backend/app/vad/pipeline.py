"""The parts every rule-based detector has in common.

Each approach differs only in what it measures per frame. Splitting the signal
into frames, turning a measurement into a decision, and stopping that decision
from flickering are the same work in all three cases, so they live here and the
detector modules supply nothing but the measurement and its thresholds.

The description types at the bottom — `Trace`, `GuideCurve`, `Analysis` — are
what makes one API contract and one set of plots serve every detector.
"""

from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

DEFAULT_SAMPLE_RATE = 16_000
SILENCE_FLOOR_DB = -100.0


@dataclass(frozen=True)
class FrameSettings:
    sample_rate: int = DEFAULT_SAMPLE_RATE
    frame_ms: float = 30.0
    hop_ms: float = 10.0

    @property
    def frame_length(self) -> int:
        return max(1, round(self.sample_rate * self.frame_ms / 1000.0))

    @property
    def hop_length(self) -> int:
        return max(1, round(self.sample_rate * self.hop_ms / 1000.0))

    @property
    def frame_seconds(self) -> float:
        return self.frame_length / self.sample_rate

    @property
    def hop_seconds(self) -> float:
        return self.hop_length / self.sample_rate

    def frames_in(self, milliseconds: float) -> int:
        return max(0, round(milliseconds / self.hop_ms))


@dataclass(frozen=True)
class DecisionSettings(FrameSettings):
    """Everything downstream of the measurement, identical for all three detectors."""

    smoothing_ms: float = 30.0
    pre_speech_ms: float = 30.0
    hangover_ms: float = 60.0
    min_speech_ms: float = 120.0
    min_silence_ms: float = 100.0

    @property
    def smoothing_frames(self) -> int:
        return self.frames_in(self.smoothing_ms)

    @property
    def pre_speech_frames(self) -> int:
        return self.frames_in(self.pre_speech_ms)

    @property
    def hangover_frames(self) -> int:
        return self.frames_in(self.hangover_ms)


@dataclass(frozen=True)
class Segment:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


def remove_dc_offset(samples: np.ndarray) -> np.ndarray:
    """A constant bias adds energy that is not sound, and sign changes that are not crossings."""
    return samples - samples.mean(dtype=np.float64).astype(np.float32)


def frame_signal(samples: np.ndarray, frame_length: int, hop_length: int) -> np.ndarray:
    if samples.size < frame_length:
        samples = np.pad(samples, (0, frame_length - samples.size))
    frame_count = 1 + (samples.size - frame_length) // hop_length
    item_stride = samples.strides[0]
    return np.lib.stride_tricks.as_strided(
        samples,
        shape=(frame_count, frame_length),
        strides=(item_stride * hop_length, item_stride),
        writeable=False,
    )


def compute_frame_energy_db(frames: np.ndarray) -> np.ndarray:
    # einsum sums each frame's squares in place. Squaring the whole frame matrix
    # first would allocate a copy the size of the signal times the overlap factor.
    # The widening afterwards is one value per frame, so it costs nothing and
    # keeps the contour in float64 like every other measurement here.
    totals = np.einsum("ij,ij->i", frames, frames).astype(np.float64)
    return np.maximum(10.0 * np.log10(totals / frames.shape[1] + 1e-12), SILENCE_FLOOR_DB)


def median_filter(values: np.ndarray, window_frames: int) -> np.ndarray:
    """Median rather than mean, so a single loud click is removed instead of smeared."""
    if window_frames <= 1 or values.size == 0:
        return values
    width = window_frames if window_frames % 2 == 1 else window_frames + 1
    if width >= values.size:
        return np.full_like(values, float(np.median(values)))
    padded = np.ascontiguousarray(np.pad(values, width // 2, mode="edge"))
    return np.median(frame_signal(padded, width, 1), axis=1)


def overall_percentile(
    values: np.ndarray,
    percentile: float,
    *,
    where: np.ndarray | None = None,
    when_empty: float = 0.0,
) -> float:
    """`where` restricts the estimate to frames worth estimating from.

    A block with nothing left after masking falls back to the whole block: a
    reference taken from no frames at all is worse than one taken from the
    wrong frames.
    """
    usable = values if where is None else values[where]
    if usable.size == 0:
        usable = values
    if usable.size == 0:
        return when_empty
    return float(np.percentile(usable, percentile))


def percentile_curve(
    values: np.ndarray,
    percentile: float,
    window_frames: int,
    *,
    where: np.ndarray | None = None,
    when_empty: float = 0.0,
) -> np.ndarray:
    """One percentile per block, linearly interpolated, so a drifting room is tracked.

    Callers clamp the result themselves: which direction runs away depends on
    whether their measurement rises or falls during speech.
    """
    overall = overall_percentile(values, percentile, where=where, when_empty=when_empty)
    if window_frames <= 0 or values.size <= window_frames * 2:
        return np.full(values.size, overall)

    block_count = max(2, int(np.ceil(values.size / window_frames)))
    edges = np.linspace(0, values.size, block_count + 1).astype(int)
    centres = np.empty(block_count)
    levels = np.empty(block_count)

    for index in range(block_count):
        block = values[edges[index] : edges[index + 1]]
        usable = block if where is None else block[where[edges[index] : edges[index + 1]]]
        levels[index] = np.percentile(usable if usable.size else block, percentile)
        centres[index] = (edges[index] + edges[index + 1] - 1) / 2.0

    return np.interp(np.arange(values.size), centres, levels)


def apply_hysteresis_threshold(
    values: np.ndarray,
    enter_threshold: np.ndarray | float,
    leave_threshold: np.ndarray | float,
    *,
    speech_above: bool = True,
) -> np.ndarray:
    """A Schmitt trigger. `speech_above` is False for measurements that fall during speech."""
    # The comparison is sequential, so it runs in Python. Materialising plain
    # floats first avoids paying numpy's scalar boxing cost on every frame.
    levels = values.tolist()
    enter = np.broadcast_to(np.asarray(enter_threshold, dtype=np.float64), values.shape).tolist()
    leave = np.broadcast_to(np.asarray(leave_threshold, dtype=np.float64), values.shape).tolist()

    decisions = [False] * len(levels)
    speaking = False
    for index, level in enumerate(levels):
        bound = leave[index] if speaking else enter[index]
        speaking = level > bound if speech_above else level < bound
        decisions[index] = speaking
    return np.array(decisions, dtype=bool)


def apply_pre_speech(flags: np.ndarray, pre_speech_frames: int) -> np.ndarray:
    """Onsets are detected late, because a frame only crosses once it is well underway."""
    if pre_speech_frames <= 0:
        return flags.copy()
    source = flags.tolist()
    extended = list(source)
    remaining = 0
    for index in range(len(source) - 1, -1, -1):
        if source[index]:
            remaining = pre_speech_frames
        elif remaining > 0:
            extended[index] = True
            remaining -= 1
    return np.array(extended, dtype=bool)


def apply_hangover(flags: np.ndarray, hangover_frames: int) -> np.ndarray:
    if hangover_frames <= 0:
        return flags.copy()
    source = flags.tolist()
    held = list(source)
    remaining = 0
    for index, speaking in enumerate(source):
        if speaking:
            remaining = hangover_frames
        elif remaining > 0:
            held[index] = True
            remaining -= 1
    return np.array(held, dtype=bool)


def flags_to_segments(
    flags: np.ndarray, hop_seconds: float, frame_seconds: float
) -> list[Segment]:
    padded = np.concatenate(([False], flags, [False]))
    edges = np.flatnonzero(padded[1:] != padded[:-1])
    return [
        Segment(
            start=start * hop_seconds,
            end=(end - 1) * hop_seconds + frame_seconds,
        )
        for start, end in zip(edges[0::2], edges[1::2])
    ]


def merge_close_segments(segments: list[Segment], min_gap: float) -> list[Segment]:
    if not segments:
        return []
    merged = [segments[0]]
    for segment in segments[1:]:
        previous = merged[-1]
        if segment.start - previous.end < min_gap:
            merged[-1] = Segment(start=previous.start, end=max(previous.end, segment.end))
        else:
            merged.append(segment)
    return merged


def drop_short_segments(segments: list[Segment], min_duration: float) -> list[Segment]:
    return [segment for segment in segments if segment.duration >= min_duration]


def segments_to_flags(
    segments: list[Segment], frame_count: int, hop_seconds: float, frame_seconds: float
) -> np.ndarray:
    flags = np.zeros(frame_count, dtype=bool)
    for segment in segments:
        first = min(max(0, round(segment.start / hop_seconds)), frame_count - 1)
        last = round((segment.end - frame_seconds) / hop_seconds)
        last = min(max(first, last), frame_count - 1)
        flags[first : last + 1] = True
    return flags


def clamp_segments_to_duration(segments: list[Segment], duration: float) -> list[Segment]:
    clamped = []
    for segment in segments:
        end = min(segment.end, duration)
        if end > segment.start:
            clamped.append(Segment(start=segment.start, end=end))
    return clamped


def finalise_segments(
    flags: np.ndarray, settings: DecisionSettings, duration: float
) -> list[Segment]:
    """Merge before dropping — the other order deletes an utterance a brief dip had split."""
    segments = flags_to_segments(flags, settings.hop_seconds, settings.frame_seconds)
    segments = merge_close_segments(segments, settings.min_silence_ms / 1000.0)
    segments = drop_short_segments(segments, settings.min_speech_ms / 1000.0)
    return clamp_segments_to_duration(segments, duration)


def round_bounds(
    lowest: float, highest: float, *, pad_below: float, pad_above: float, step: float
) -> tuple[float, float]:
    """Plot bounds that contain the data with a little air, rounded to whole steps."""
    top = np.ceil((highest + pad_above) / step) * step
    bottom = np.floor((lowest - pad_below) / step) * step
    return float(top), float(bottom)


class AdaptiveReference:
    """Causal stand-in for `percentile_curve`, used by the streaming detectors.

    Offline the reference is a percentile of the whole recording. A live stream
    has no such luxury, so it is tracked with an exponential average that moves
    quickly toward the non-speech side and slowly away from it, and does not
    move at all on a frame classified as speech — otherwise a long utterance
    drags its own threshold along behind it until the detector goes quiet.
    """

    def __init__(
        self,
        *,
        speech_above: bool,
        chase_weight: float = 0.7,
        drift_weight: float = 0.995,
    ) -> None:
        self._speech_above = speech_above
        self._chase_weight = chase_weight
        self._drift_weight = drift_weight
        self._value: float | None = None

    @property
    def value(self) -> float | None:
        return self._value

    def resolved(self, fallback: float) -> float:
        return fallback if self._value is None else self._value

    def forget(self) -> None:
        self._value = None

    def update(self, level: float, speaking: bool) -> None:
        if self._value is None:
            self._value = level
            return
        toward_silence = level < self._value if self._speech_above else level > self._value
        if toward_silence:
            weight = self._chase_weight
        elif speaking:
            return
        else:
            weight = self._drift_weight
        self._value = weight * self._value + (1.0 - weight) * level


@dataclass(frozen=True)
class GuideLevel:
    """One threshold as it stands right now, for the live plot and its readouts."""

    key: str
    label: str
    value: float
    style: str = "solid"
    emphasis: str = "primary"


@dataclass(frozen=True)
class GuideCurve:
    """One threshold across a whole recording, drawn under the measurement."""

    key: str
    label: str
    values: np.ndarray
    style: str = "solid"
    emphasis: str = "primary"


@dataclass(frozen=True)
class Trace:
    """A per-frame measurement and the lines it is compared against."""

    key: str
    label: str
    unit: str
    hint: str
    values: np.ndarray
    top: float
    bottom: float
    decimals: int = 1
    guides: list[GuideCurve] = field(default_factory=list)


@dataclass(frozen=True)
class Statistic:
    label: str
    value: str


@dataclass(frozen=True)
class Analysis:
    """What every `analyze_recording` returns, whatever it measured to get there."""

    traces: list[Trace]
    flags_after_threshold: np.ndarray
    flags_after_hangover: np.ndarray
    flags_after_duration_filter: np.ndarray
    segments: list[Segment]
    statistics: list[Statistic]
    hop_seconds: float
    frame_seconds: float
    duration: float


@dataclass(frozen=True)
class StreamingUpdate:
    """What every streaming detector returns for one block of audio."""

    measurements: np.ndarray
    flags: np.ndarray
    guides: list[GuideLevel]
    speech_started: bool
    speech_ended: bool


class StreamingDetector:
    """Frame-by-frame causal detector. Subclasses supply the measurement.

    Audio arrives in blocks that do not divide evenly into frames, so leftover
    samples are carried in a buffer and prepended to the next block. Frame
    boundaries therefore stay on the same grid however the network chunks the
    stream.
    """

    speech_above = True

    def __init__(self, settings: DecisionSettings, warmup_ms: float = 200.0) -> None:
        self._settings = settings
        self._warmup_ms = warmup_ms
        self._pending = np.zeros(0, dtype=np.float32)
        self._speaking = False
        self._hangover_remaining = 0
        self._elapsed_frames = 0

    # -- hooks ---------------------------------------------------------------

    def prepare(self, frames: np.ndarray) -> np.ndarray:
        """One measurement per frame, in whatever unit this detector thresholds.

        Anything else a subclass needs per frame — a second measurement feeding a
        gate, say — is computed here too and read back by index, so the frames
        are only ever walked once.
        """
        raise NotImplementedError

    def admits(self, index: int) -> bool:
        """Whether frame `index` is allowed to be speech at all, whatever it measured."""
        return True

    def observe(self, index: int, level: float, speaking: bool) -> None:
        """Fold frame `index` into whatever references this detector adapts."""
        raise NotImplementedError

    def thresholds(self) -> tuple[float, float]:
        """The enter and leave levels as they stand, before the next frame."""
        raise NotImplementedError

    def guides(self) -> list[GuideLevel]:
        raise NotImplementedError

    def forget_references(self) -> None:
        raise NotImplementedError

    # -- driver --------------------------------------------------------------

    @property
    def settings(self) -> DecisionSettings:
        return self._settings

    @property
    def _warmup_frames(self) -> int:
        return max(1, round(self._warmup_ms / self._settings.hop_ms))

    def reconfigure(self, settings: DecisionSettings) -> None:
        keeps_frame_layout = (
            settings.sample_rate == self._settings.sample_rate
            and settings.frame_ms == self._settings.frame_ms
            and settings.hop_ms == self._settings.hop_ms
        )
        self._settings = settings
        self._speaking = False
        self._hangover_remaining = 0
        if not keeps_frame_layout:
            self._pending = np.zeros(0, dtype=np.float32)
            self._elapsed_frames = 0
            self.forget_references()

    def process_chunk(self, chunk: np.ndarray) -> StreamingUpdate:
        buffered = np.concatenate((self._pending, np.asarray(chunk, dtype=np.float32)))
        frame_length = self._settings.frame_length
        hop_length = self._settings.hop_length

        if buffered.size < frame_length:
            self._pending = buffered
            return StreamingUpdate(
                measurements=np.zeros(0),
                flags=np.zeros(0, dtype=bool),
                guides=self.guides(),
                speech_started=False,
                speech_ended=False,
            )

        frame_count = 1 + (buffered.size - frame_length) // hop_length
        frames = frame_signal(buffered, frame_length, hop_length)
        self._pending = buffered[frame_count * hop_length :]

        measurements = self.prepare(frames)
        flags = np.zeros(frame_count, dtype=bool)
        was_speaking = self._speaking

        for index, measurement in enumerate(measurements):
            level = float(measurement)
            enter, leave = self.thresholds()
            bound = leave if self._speaking else enter
            raw_speaking = bool(level > bound if self.speech_above else level < bound)
            raw_speaking = raw_speaking and self.admits(index)
            # The first frames are compared against a reference nothing has
            # settled yet, so their verdict is withheld rather than latched.
            if self._elapsed_frames < self._warmup_frames:
                raw_speaking = False

            if raw_speaking:
                self._hangover_remaining = self._settings.hangover_frames
            elif self._hangover_remaining > 0:
                self._hangover_remaining -= 1

            self._speaking = bool(raw_speaking or self._hangover_remaining > 0)
            flags[index] = self._speaking

            self.observe(index, level, raw_speaking)
            self._elapsed_frames += 1

        return StreamingUpdate(
            measurements=measurements,
            flags=flags,
            guides=self.guides(),
            speech_started=not was_speaking and self._speaking,
            speech_ended=was_speaking and not self._speaking,
        )
