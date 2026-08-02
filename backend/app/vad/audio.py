"""Access to the bundled sample library.

librosa appears here and nowhere else in the project. It decodes and resamples;
every measurement the detector makes is computed from the raw array in energy.py.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import librosa
import numpy as np
import soundfile

TARGET_SAMPLE_RATE = 16_000
AUDIO_SUFFIXES = (".wav", ".flac", ".ogg", ".mp3")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_SEARCH_PATHS = (
    Path(os.environ["VAD_SAMPLES_DIR"]) if os.environ.get("VAD_SAMPLES_DIR") else None,
    _BACKEND_ROOT / "samples",
    _BACKEND_ROOT.parent / "samples",
)


@dataclass(frozen=True)
class SampleInfo:
    name: str
    duration: float
    source_sample_rate: int
    channels: int


def samples_directory() -> Path:
    for candidate in _SEARCH_PATHS:
        if candidate is not None and candidate.is_dir():
            return candidate
    return _BACKEND_ROOT / "samples"


def list_sample_names() -> list[str]:
    directory = samples_directory()
    if not directory.is_dir():
        return []
    return sorted(
        entry.name
        for entry in directory.iterdir()
        if entry.is_file() and entry.suffix.lower() in AUDIO_SUFFIXES
    )


def resolve_sample_path(name: str) -> Path | None:
    if name not in list_sample_names():
        return None
    return samples_directory() / name


def describe_sample(name: str) -> SampleInfo | None:
    path = resolve_sample_path(name)
    if path is None:
        return None
    details = soundfile.info(str(path))
    return SampleInfo(
        name=name,
        duration=details.duration,
        source_sample_rate=details.samplerate,
        channels=details.channels,
    )


@lru_cache(maxsize=16)
def load_sample(name: str, sample_rate: int = TARGET_SAMPLE_RATE) -> np.ndarray | None:
    path = resolve_sample_path(name)
    if path is None:
        return None
    samples, _ = librosa.load(str(path), sr=sample_rate, mono=True)
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    samples.flags.writeable = False
    return samples


def compute_peak_envelope(samples: np.ndarray, bucket_count: int) -> tuple[list[float], list[float]]:
    if samples.size == 0 or bucket_count <= 0:
        return [], []

    bucket_count = min(bucket_count, samples.size)
    starts = np.linspace(0, samples.size, bucket_count + 1).astype(int)[:-1]
    lows = np.minimum.reduceat(samples, starts)
    highs = np.maximum.reduceat(samples, starts)
    return np.round(lows, 4).tolist(), np.round(highs, 4).tolist()


def warm_decoder() -> None:
    """First librosa.load pays a large lazy-import and JIT cost; spend it at startup."""
    names = list_sample_names()
    if names:
        load_sample(names[0])
