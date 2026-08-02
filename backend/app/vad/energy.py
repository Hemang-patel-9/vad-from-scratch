"""Energy-based voice activity detection, written directly against numpy.

The pipeline is: split the signal into overlapping frames, measure the energy of
each frame in decibels, estimate where the noise floor sits, and mark a frame as
speech when its energy rises above a threshold placed relative to that floor.
Everything after the threshold exists to stop the decision from flickering.
"""

from __future__ import annotations

from dataclasses import dataclass

import numpy as np

SILENCE_FLOOR_DB = -100.0
DEFAULT_SAMPLE_RATE = 16_000

# A windowed noise floor tracks drift, but inside a long utterance the window
# fills with speech and the floor chases it upward. Capping it relative to the
# whole-file estimate keeps that runaway bounded.
ADAPTIVE_FLOOR_CEILING_DB = 6.0


@dataclass(frozen=True)
class EnergyVadSettings:
    sample_rate: int = DEFAULT_SAMPLE_RATE
    frame_ms: float = 30.0
    hop_ms: float = 10.0
    smoothing_ms: float = 30.0
    noise_percentile: float = 10.0
    noise_window_s: float = 5.0
    threshold_offset_db: float = 8.0
    hysteresis_db: float = 3.0
    pre_speech_ms: float = 30.0
    hangover_ms: float = 60.0
    min_speech_ms: float = 120.0
    min_silence_ms: float = 100.0

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

    @property
    def smoothing_frames(self) -> int:
        return max(0, round(self.smoothing_ms / self.hop_ms))

    @property
    def noise_window_frames(self) -> int:
        return max(0, round(self.noise_window_s * 1000.0 / self.hop_ms))

    @property
    def pre_speech_frames(self) -> int:
        return max(0, round(self.pre_speech_ms / self.hop_ms))

    @property
    def hangover_frames(self) -> int:
        return max(0, round(self.hangover_ms / self.hop_ms))


@dataclass(frozen=True)
class Segment:
    start: float
    end: float

    @property
    def duration(self) -> float:
        return self.end - self.start


@dataclass(frozen=True)
class EnergyVadResult:
    energy_db: np.ndarray
    noise_floor_curve_db: np.ndarray
    enter_curve_db: np.ndarray
    noise_floor_db: float
    enter_threshold_db: float
    exit_threshold_db: float
    flags_after_threshold: np.ndarray
    flags_after_hangover: np.ndarray
    flags_after_duration_filter: np.ndarray
    segments: list[Segment]
    hop_seconds: float
    frame_seconds: float
    duration: float


def remove_dc_offset(samples: np.ndarray) -> np.ndarray:
    """A constant bias adds energy that is not sound, inflating every frame equally."""
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


def smooth_energy_db(energy_db: np.ndarray, window_frames: int) -> np.ndarray:
    """Median rather than mean, so a single loud click is removed instead of smeared."""
    if window_frames <= 1 or energy_db.size == 0:
        return energy_db
    width = window_frames if window_frames % 2 == 1 else window_frames + 1
    if width >= energy_db.size:
        return np.full_like(energy_db, float(np.median(energy_db)))
    padded = np.ascontiguousarray(np.pad(energy_db, width // 2, mode="edge"))
    return np.median(frame_signal(padded, width, 1), axis=1)


def estimate_noise_floor_db(energy_db: np.ndarray, percentile: float) -> float:
    audible = energy_db[energy_db > SILENCE_FLOOR_DB]
    if audible.size == 0:
        return SILENCE_FLOOR_DB
    return float(np.percentile(audible, percentile))


def estimate_noise_floor_curve(
    energy_db: np.ndarray, percentile: float, window_frames: int
) -> np.ndarray:
    """One floor per block, linearly interpolated, so a drifting room is tracked."""
    global_floor = estimate_noise_floor_db(energy_db, percentile)
    if window_frames <= 0 or energy_db.size <= window_frames * 2:
        return np.full(energy_db.size, global_floor)

    block_count = max(2, int(np.ceil(energy_db.size / window_frames)))
    edges = np.linspace(0, energy_db.size, block_count + 1).astype(int)
    centres = np.empty(block_count)
    values = np.empty(block_count)

    for index in range(block_count):
        block = energy_db[edges[index] : edges[index + 1]]
        audible = block[block > SILENCE_FLOOR_DB]
        values[index] = np.percentile(audible if audible.size else block, percentile)
        centres[index] = (edges[index] + edges[index + 1] - 1) / 2.0

    curve = np.interp(np.arange(energy_db.size), centres, values)
    return np.minimum(curve, global_floor + ADAPTIVE_FLOOR_CEILING_DB)


def apply_hysteresis_threshold(
    energy_db: np.ndarray,
    enter_threshold_db: np.ndarray | float,
    exit_threshold_db: np.ndarray | float,
) -> np.ndarray:
    # The comparison is sequential, so it runs in Python. Materialising plain
    # floats first avoids paying numpy's scalar boxing cost on every frame.
    levels = energy_db.tolist()
    enter = np.broadcast_to(np.asarray(enter_threshold_db, dtype=np.float64), energy_db.shape).tolist()
    leave = np.broadcast_to(np.asarray(exit_threshold_db, dtype=np.float64), energy_db.shape).tolist()

    decisions = [False] * len(levels)
    speaking = False
    for index, level in enumerate(levels):
        speaking = level > leave[index] if speaking else level > enter[index]
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


def analyze_recording(samples: np.ndarray, settings: EnergyVadSettings) -> EnergyVadResult:
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    duration = samples.size / settings.sample_rate
    samples = remove_dc_offset(samples)

    frames = frame_signal(samples, settings.frame_length, settings.hop_length)
    energy_db = smooth_energy_db(compute_frame_energy_db(frames), settings.smoothing_frames)

    floor_curve = estimate_noise_floor_curve(
        energy_db, settings.noise_percentile, settings.noise_window_frames
    )
    enter_curve = floor_curve + settings.threshold_offset_db
    exit_curve = enter_curve - settings.hysteresis_db

    flags_after_threshold = apply_hysteresis_threshold(energy_db, enter_curve, exit_curve)
    flags_after_hangover = apply_hangover(
        apply_pre_speech(flags_after_threshold, settings.pre_speech_frames),
        settings.hangover_frames,
    )

    segments = flags_to_segments(
        flags_after_hangover, settings.hop_seconds, settings.frame_seconds
    )
    segments = merge_close_segments(segments, settings.min_silence_ms / 1000.0)
    segments = drop_short_segments(segments, settings.min_speech_ms / 1000.0)
    segments = clamp_segments_to_duration(segments, duration)

    flags_after_duration_filter = segments_to_flags(
        segments, energy_db.size, settings.hop_seconds, settings.frame_seconds
    )

    median_floor = float(np.median(floor_curve)) if floor_curve.size else SILENCE_FLOOR_DB

    return EnergyVadResult(
        energy_db=energy_db,
        noise_floor_curve_db=floor_curve,
        enter_curve_db=enter_curve,
        noise_floor_db=median_floor,
        enter_threshold_db=median_floor + settings.threshold_offset_db,
        exit_threshold_db=median_floor + settings.threshold_offset_db - settings.hysteresis_db,
        flags_after_threshold=flags_after_threshold,
        flags_after_hangover=flags_after_hangover,
        flags_after_duration_filter=flags_after_duration_filter,
        segments=segments,
        hop_seconds=settings.hop_seconds,
        frame_seconds=settings.frame_seconds,
        duration=duration,
    )


@dataclass(frozen=True)
class StreamingUpdate:
    energy_db: np.ndarray
    flags: np.ndarray
    noise_floor_db: float
    enter_threshold_db: float
    exit_threshold_db: float
    speech_started: bool
    speech_ended: bool


class StreamingEnergyVad:
    """Causal counterpart to `analyze_recording`.

    The offline version can look at the whole file before choosing a noise floor.
    A live stream cannot, so the floor is tracked with an exponential average
    that falls quickly and rises slowly. Onset backtracking is unavailable here
    for the same reason: the frames before an onset have already been sent.
    """

    def __init__(
        self,
        settings: EnergyVadSettings,
        noise_rise_weight: float = 0.995,
        noise_fall_weight: float = 0.7,
        warmup_ms: float = 200.0,
    ) -> None:
        self._settings = settings
        self._noise_rise_weight = noise_rise_weight
        self._noise_fall_weight = noise_fall_weight
        self._warmup_ms = warmup_ms
        self._pending = np.zeros(0, dtype=np.float32)
        self._noise_floor_db: float | None = None
        self._speaking = False
        self._hangover_remaining = 0
        self._elapsed_frames = 0

    @property
    def settings(self) -> EnergyVadSettings:
        return self._settings

    @property
    def _warmup_frames(self) -> int:
        return max(1, round(self._warmup_ms / self._settings.hop_ms))

    def reconfigure(self, settings: EnergyVadSettings) -> None:
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
            self._noise_floor_db = None
            self._elapsed_frames = 0

    def process_chunk(self, chunk: np.ndarray) -> StreamingUpdate:
        buffered = np.concatenate((self._pending, np.asarray(chunk, dtype=np.float32)))
        frame_length = self._settings.frame_length
        hop_length = self._settings.hop_length

        if buffered.size < frame_length:
            self._pending = buffered
            return self._empty_update()

        frame_count = 1 + (buffered.size - frame_length) // hop_length
        frames = frame_signal(buffered, frame_length, hop_length)
        self._pending = buffered[frame_count * hop_length :]

        energy_db = compute_frame_energy_db(frames)
        flags = np.zeros(frame_count, dtype=bool)
        was_speaking = self._speaking

        for index, level in enumerate(energy_db):
            if self._noise_floor_db is None:
                self._noise_floor_db = float(level)

            enter_db, exit_db = self._current_thresholds()
            raw_speaking = bool(level > exit_db if self._speaking else level > enter_db)
            if self._elapsed_frames < self._warmup_frames:
                raw_speaking = False

            if raw_speaking:
                self._hangover_remaining = self._settings.hangover_frames
            elif self._hangover_remaining > 0:
                self._hangover_remaining -= 1

            self._speaking = bool(raw_speaking or self._hangover_remaining > 0)
            flags[index] = self._speaking

            self._track_noise_floor(float(level), raw_speaking)
            self._elapsed_frames += 1

        enter_db, exit_db = self._current_thresholds()

        return StreamingUpdate(
            energy_db=energy_db,
            flags=flags,
            noise_floor_db=self._resolved_noise_floor(),
            enter_threshold_db=enter_db,
            exit_threshold_db=exit_db,
            speech_started=not was_speaking and self._speaking,
            speech_ended=was_speaking and not self._speaking,
        )

    def _track_noise_floor(self, level: float, raw_speaking: bool) -> None:
        floor = self._resolved_noise_floor()
        if level < floor:
            weight = self._noise_fall_weight
        elif raw_speaking:
            return
        else:
            weight = self._noise_rise_weight
        self._noise_floor_db = weight * floor + (1.0 - weight) * level

    def _resolved_noise_floor(self) -> float:
        return SILENCE_FLOOR_DB if self._noise_floor_db is None else self._noise_floor_db

    def _current_thresholds(self) -> tuple[float, float]:
        enter_db = self._resolved_noise_floor() + self._settings.threshold_offset_db
        return enter_db, enter_db - self._settings.hysteresis_db

    def _empty_update(self) -> StreamingUpdate:
        enter_db, exit_db = self._current_thresholds()
        return StreamingUpdate(
            energy_db=np.zeros(0),
            flags=np.zeros(0, dtype=bool),
            noise_floor_db=self._resolved_noise_floor(),
            enter_threshold_db=enter_db,
            exit_threshold_db=exit_db,
            speech_started=False,
            speech_ended=False,
        )
