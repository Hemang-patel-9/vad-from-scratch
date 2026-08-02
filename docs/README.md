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

A learned classifier over frame features.

| Page | Status |
| --- | --- |
| `dl-based/README.md` | Planned |

Each page follows the same outline: idea, method, parameters, evaluation, notes.
