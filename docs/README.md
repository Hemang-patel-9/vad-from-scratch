# Docs

Notes for the `backend/` implementations. One page per approach.

## [Rule-based](rule-based/README.md)

Hand-tuned signal processing. No training data, and every decision can be traced
back to a specific frame and threshold. All three share the stages after the
threshold; only the measurement differs.

| Page | Status |
| --- | --- |
| [energy-based.md](rule-based/energy-based.md) | Implemented |
| [zero-crossing.md](rule-based/zero-crossing.md) | Implemented |
| [spectral.md](rule-based/spectral.md) | Implemented |

## [DL-based](dl-based/README.md)

A learned measurement rather than a chosen one. Same pipeline after the
threshold — the stages in `pipeline.py` were never specific to how the
measurement got made, which this is the proof of.

| Page | Status |
| --- | --- |
| [dl-based/README.md](dl-based/README.md) | Implemented, not yet evaluated |

The detector and its endpoints are in place, but no weights ship with the
repository. Train them with [`ml/vad_dl_kaggle.ipynb`](../ml/vad_dl_kaggle.ipynb);
until they are present `/api/vad/neural` answers 503 and the rest of the app is
unaffected.

Each page follows the same outline: idea, method, parameters, evaluation, notes.
