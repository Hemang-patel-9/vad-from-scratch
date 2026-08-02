# Rule-based

Signal-processing approaches driven by explicit, hand-tuned rules. Each one picks
a measurement that separates speech from everything else, then thresholds it.

| Page | Measurement | Status |
| --- | --- | --- |
| [energy-based.md](energy-based.md) | Frame energy against an adaptive noise floor | Implemented |
| `zero-crossing.md` | How often the waveform changes sign | Planned |
| `spectral.md` | Flatness and entropy of the spectrum | Planned |

They share a common shape: frame the signal, reduce each frame to a number,
threshold that number, then smooth the resulting decision so it does not
flicker. The stages after the threshold — hysteresis, hangover, duration
filtering — are the same regardless of which measurement feeds them, and are
documented in full on the energy-based page.

What separates them is what each measurement can and cannot see. Energy answers
"is something happening?" but not "is it speech?" — a slammed door passes it
cleanly. The later pages replace that measurement with ones that care about the
*shape* of the signal rather than its size.
