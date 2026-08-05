"""Neural VAD: a trained model in place of a hand-tuned measurement.

The other three detectors reduce a frame to a number somebody chose — energy,
crossing rate, spectral flatness — and threshold it. This one reduces a frame to
a probability a network chose, and thresholds that. Everything downstream is
unchanged, which is the point: the stages in `pipeline.py` were never specific
to how the measurement got made, so a learned measurement drops straight into
them.

Two things had to line up for that to be true.

The frame grid is the first. The model was trained on 30 ms windows at a 10 ms
hop, which is what `FrameSettings` already defaults to, so `frame_signal` builds
exactly the matrix the front end wants and there is no second grid to keep in
sync. Frame *t* here covers the same samples as frame *t* in the energy
detector, which is what lets the explorer draw them on one time axis.

The second is the front end itself. Training used torchaudio; this runs numpy.
Rebuilding a mel filterbank from parameters is where that quietly goes wrong —
torchaudio's defaults are HTK-scaled and unnormalised, librosa's are Slaney and
area-normalised, both are called "the mel filterbank" — so the notebook ships
the actual array in `vad_frontend.npz` and this module multiplies by it rather
than deriving anything.

Artifacts are looked for in `$VAD_MODEL_DIR`, then `backend/models/`, then
`models/` at the repo root. They are not in the repository: `vad.onnx` is a few
megabytes of binary in a project whose point is the source. Train them with
`ml/vad_dl_kaggle.ipynb`. Without them this module raises `ModelUnavailable` and
nothing else in the app notices.
"""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from functools import lru_cache
from pathlib import Path

import numpy as np

from app.vad.pipeline import (
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
    segments_to_flags,
)

# The grid the shipped model was trained on. Retraining on a different one means
# changing these two and the matching defaults in `schemas.NeuralVadParameters`;
# `load_model` refuses a mismatch rather than letting it pass silently.
MODEL_FRAME_MS = 30.0
MODEL_HOP_MS = 10.0

MODEL_FILES = ("vad.onnx", "vad_frontend.npz", "vad_meta.json")

_BACKEND_ROOT = Path(__file__).resolve().parent.parent.parent
_SEARCH_PATHS = (
    Path(os.environ["VAD_MODEL_DIR"]) if os.environ.get("VAD_MODEL_DIR") else None,
    _BACKEND_ROOT / "models",
    _BACKEND_ROOT.parent / "models",
)


class ModelUnavailable(RuntimeError):
    """No exported model on disk, or it could not be loaded."""


class GridMismatch(ValueError):
    """Asked to run the model on a frame grid it was not trained for."""


@dataclass(frozen=True)
class NeuralVadSettings(DecisionSettings):
    """Note the defaults.

    `smoothing_ms` is 0 where the rule-based detectors use 30: the GRU has
    already integrated over its own past, and median-filtering its output mostly
    just rounds off the onsets it was careful about. The duration filters are
    likewise far shorter than the 120/100 ms the rule-based pages need, because
    the flicker they exist to suppress largely is not there.
    """

    frame_ms: float = MODEL_FRAME_MS
    hop_ms: float = MODEL_HOP_MS
    smoothing_ms: float = 0.0
    pre_speech_ms: float = 30.0
    hangover_ms: float = 40.0
    min_speech_ms: float = 80.0
    min_silence_ms: float = 100.0

    enter_probability: float = 0.6
    exit_probability: float = 0.4


class NeuralModel:
    """The exported graph plus the front end that has to feed it exactly right."""

    def __init__(self, directory: Path) -> None:
        try:
            import onnxruntime
        except ImportError as error:  # pragma: no cover - environment problem
            raise ModelUnavailable(
                "onnxruntime is not installed; add it from backend/requirements.txt"
            ) from error

        self.directory = directory
        with open(directory / "vad_meta.json", encoding="utf-8") as handle:
            self.meta = json.load(handle)

        front = np.load(directory / "vad_frontend.npz")
        self.window = front["window"].astype(np.float32)
        self.fbank = front["fbank"].astype(np.float32)
        self.mel_mean = front["mel_mean"].astype(np.float32)

        self.sample_rate = int(self.meta["sr"])
        self.win = int(self.meta["win"])
        self.hop = int(self.meta["hop"])
        self.n_mels = int(self.meta["n_mels"])
        self.log_eps = float(self.meta["log_eps"])
        self.gru_hidden = int(self.meta["gru_hidden"])
        self.context = int(self.meta["left_context_frames"])

        frame_ms = self.win * 1000.0 / self.sample_rate
        hop_ms = self.hop * 1000.0 / self.sample_rate
        if (frame_ms, hop_ms) != (MODEL_FRAME_MS, MODEL_HOP_MS):
            raise ModelUnavailable(
                f"model was trained at {frame_ms:g} ms / {hop_ms:g} ms but this build "
                f"expects {MODEL_FRAME_MS:g} ms / {MODEL_HOP_MS:g} ms — update "
                "MODEL_FRAME_MS and MODEL_HOP_MS in app/vad/neural.py and the "
                "matching defaults in app/schemas.py"
            )
        if self.window.shape != (self.win,) or self.fbank.shape[1] != self.n_mels:
            raise ModelUnavailable(
                f"vad_frontend.npz does not match vad_meta.json: window {self.window.shape}, "
                f"fbank {self.fbank.shape}, expected ({self.win},) and (*, {self.n_mels})"
            )

        self.session = onnxruntime.InferenceSession(
            str(directory / "vad.onnx"), providers=["CPUExecutionProvider"]
        )

        # One frame of history per frame of left receptive field, seeded with
        # mel_mean so it normalises to zero inside the graph — which is exactly
        # what the causal convolutions pad their own left edge with. Anything
        # else and the first 1.7 s of a stream would disagree with a file pass.
        self._seed = np.repeat(self.mel_mean[:, None], self.context, axis=1)

    def seed_history(self) -> np.ndarray:
        return self._seed.copy()

    def zero_state(self) -> np.ndarray:
        return np.zeros((1, 1, self.gru_hidden), dtype=np.float32)

    def log_mel(self, frames: np.ndarray) -> np.ndarray:
        """(n_frames, win) as `frame_signal` builds it -> (n_mels, n_frames).

        Reproduces torchaudio's `MelSpectrogram(center=False, power=2.0)` on the
        same frames. `rfft` widens to float64 on the way through, which only
        makes this more accurate than the training front end, not different.
        """
        spectrum = np.abs(np.fft.rfft(frames * self.window, axis=-1)) ** 2
        mel = spectrum.astype(np.float32) @ self.fbank
        return np.log(mel + self.log_eps).T

    def run(self, mel: np.ndarray, state: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """`mel` is history + new frames; one probability comes back per new frame."""
        probabilities, state = self.session.run(
            None, {"mel": mel[None].astype(np.float32), "h_in": state}
        )
        return probabilities[0], state


def model_directory() -> Path | None:
    for candidate in _SEARCH_PATHS:
        if candidate is None:
            continue
        if all((candidate / name).is_file() for name in MODEL_FILES):
            return candidate
    return None


@lru_cache(maxsize=1)
def load_model() -> NeuralModel:
    """Cached across requests. ONNX Runtime sessions are thread-safe to call;
    the only per-connection state is the GRU vector, which lives in the detector.
    """
    directory = model_directory()
    if directory is None:
        searched = ", ".join(str(p) for p in _SEARCH_PATHS if p is not None)
        raise ModelUnavailable(
            f"no exported model found. Expected {', '.join(MODEL_FILES)} in one of: "
            f"{searched}. Train one with ml/vad_dl_kaggle.ipynb, or point "
            "VAD_MODEL_DIR at a directory that has them."
        )
    try:
        return NeuralModel(directory)
    except ModelUnavailable:
        raise
    except Exception as error:
        raise ModelUnavailable(f"could not load the model from {directory}: {error}") from error


def model_summary() -> dict[str, object]:
    """What `/api/vad/neural/model` reports, so a client can say why it is 503."""
    directory = model_directory()
    if directory is None:
        return {"available": False, "searched": [str(p) for p in _SEARCH_PATHS if p]}
    try:
        model = load_model()
    except ModelUnavailable as error:
        return {"available": False, "error": str(error)}
    return {"available": True, "directory": str(directory), "meta": model.meta}


def _require_grid(model: NeuralModel, settings: DecisionSettings) -> None:
    if settings.frame_length != model.win or settings.hop_length != model.hop:
        raise GridMismatch(
            f"model runs on {model.win}-sample frames at a {model.hop}-sample hop; "
            f"got {settings.frame_length} and {settings.hop_length}"
        )


def speech_probabilities(samples: np.ndarray, settings: NeuralVadSettings) -> np.ndarray:
    """One p(speech) per frame, for the whole recording in a single pass.

    No DC removal and no level normalisation, unlike the rule-based detectors.
    Both would be a mismatch with training, where scenes were mixed at levels
    from −38 to −12 dBFS precisely so the model would not need them.
    """
    model = load_model()
    _require_grid(model, settings)

    frames = frame_signal(
        np.ascontiguousarray(samples, dtype=np.float32),
        settings.frame_length,
        settings.hop_length,
    )
    mel = model.log_mel(frames)
    primed = np.concatenate([model.seed_history(), mel], axis=1)
    probabilities, _ = model.run(primed, model.zero_state())
    return probabilities.astype(np.float64)


def analyze_recording(samples: np.ndarray, settings: NeuralVadSettings) -> Analysis:
    samples = np.ascontiguousarray(samples, dtype=np.float32)
    duration = samples.size / settings.sample_rate

    probabilities = speech_probabilities(samples, settings)
    probabilities = median_filter(probabilities, settings.smoothing_frames)

    enter = settings.enter_probability
    leave = min(settings.exit_probability, enter)

    flags_after_threshold = apply_hysteresis_threshold(probabilities, enter, leave)
    flags_after_hangover = apply_hangover(
        apply_pre_speech(flags_after_threshold, settings.pre_speech_frames),
        settings.hangover_frames,
    )

    segments = finalise_segments(flags_after_hangover, settings, duration)
    flags_after_duration_filter = segments_to_flags(
        segments, probabilities.size, settings.hop_seconds, settings.frame_seconds
    )

    meta = load_model().meta
    statistics = [
        Statistic(label="Mean p(speech)", value=f"{float(probabilities.mean()):.3f}"),
        Statistic(label="Model", value=f"{meta.get('params_m', 0):.2f} M params"),
    ]
    if "val_f1" in meta:
        statistics.append(Statistic(label="Val F1", value=f"{meta['val_f1']:.3f}"))

    return Analysis(
        traces=[_build_trace(probabilities, enter, leave)],
        flags_after_threshold=flags_after_threshold,
        flags_after_hangover=flags_after_hangover,
        flags_after_duration_filter=flags_after_duration_filter,
        segments=segments,
        statistics=statistics,
        hop_seconds=settings.hop_seconds,
        frame_seconds=settings.frame_seconds,
        duration=duration,
    )


def _build_trace(probabilities: np.ndarray, enter: float, leave: float) -> Trace:
    # Fixed 0-to-1 bounds, unlike the other detectors. A probability does not
    # need its axis scaled to the recording, and holding it still makes two
    # recordings comparable by eye.
    count = probabilities.size
    return Trace(
        key="probability",
        label="Speech probability",
        unit="",
        hint="solid = enter · dashed = exit",
        values=probabilities,
        top=1.0,
        bottom=0.0,
        decimals=3,
        guides=[
            GuideCurve("exit", "Exit at", np.full(count, leave), style="dashed"),
            GuideCurve("enter", "Enter at", np.full(count, enter), style="solid"),
        ],
    )


class StreamingNeuralVad(StreamingDetector):
    """Causal counterpart to `analyze_recording`, and an unusually faithful one.

    The rule-based streaming detectors are approximations of their offline
    selves — they cannot take a percentile of a file they have not heard yet, so
    they track a reference with an exponential average and accept the drift.
    This one has no such compromise. The model is causal by construction, so the
    only state is mechanical: the mel frames the convolutions still need, and
    the GRU vector. Fed those, a stream returns the same numbers a file pass
    would, and the notebook asserts it.

    The two are carried differently, which is the one subtlety. The convolution
    stack needs the previous `context` frames re-fed every call because its
    output genuinely depends on them; the GRU must not see them again, having
    already advanced through them. The exported graph slices them off before the
    recurrence, so this only has to hand over the concatenation.
    """

    speech_above = True

    def __init__(self, settings: NeuralVadSettings, warmup_ms: float = 0.0) -> None:
        # No warm-up: the seeded history makes the very first frame exact,
        # where the rule-based detectors need 200 ms before their reference
        # means anything.
        super().__init__(settings, warmup_ms=warmup_ms)
        self._model = load_model()
        _require_grid(self._model, settings)
        self.forget_references()

    @property
    def settings(self) -> NeuralVadSettings:
        return self._settings

    def prepare(self, frames: np.ndarray) -> np.ndarray:
        mel = self._model.log_mel(frames)
        full = np.concatenate([self._history, mel], axis=1)
        self._history = full[:, -self._model.context:]
        probabilities, self._state = self._model.run(full, self._state)
        return probabilities.astype(np.float64)

    def observe(self, index: int, level: float, speaking: bool) -> None:
        # Nothing to adapt. The thresholds are fixed numbers chosen on a
        # validation set, not a reference chased at runtime.
        return

    def forget_references(self) -> None:
        self._history = self._model.seed_history()
        self._state = self._model.zero_state()

    def thresholds(self) -> tuple[float, float]:
        enter = self._settings.enter_probability
        return enter, min(self._settings.exit_probability, enter)

    def guides(self) -> list[GuideLevel]:
        enter, leave = self.thresholds()
        return [
            GuideLevel("enter", "Enter at", enter),
            GuideLevel("exit", "Exit at", leave, style="dashed"),
        ]
