# Rule-based

Signal-processing approaches driven by explicit, hand-tuned rules. Each one picks
a measurement that separates speech from everything else, then thresholds it.

| Page | Measurement | Status |
| --- | --- | --- |
| [energy-based.md](energy-based.md) | Frame energy against an adaptive noise floor | Implemented |
| [zero-crossing.md](zero-crossing.md) | How often the waveform changes sign | Implemented |
| [spectral.md](spectral.md) | Flatness and entropy of the spectrum | Implemented |

They share a common shape: frame the signal, reduce each frame to a number,
threshold that number, then smooth the resulting decision so it does not
flicker. The stages after the threshold — hysteresis, hangover, duration
filtering — are the same regardless of which measurement feeds them, and live in
[`backend/app/vad/pipeline.py`](../../backend/app/vad/pipeline.py). Each detector
module supplies nothing but its measurement and where the threshold goes. The
stages themselves are documented in full on the energy-based page.

What separates them is what each measurement can and cannot see. Energy answers
"is something happening?" but not "is it speech?" — a slammed door passes it
cleanly. The later pages replace that measurement with ones that care about the
*shape* of the signal rather than its size.

## How they compare

Frame-level F1 on synthetic speech with known boundaries, six seeds per
scenario. The method and the caveats are on each page.

| Detector | Clean 25 dB | Noisy 10 dB | Noisy 5 dB | Drifting floor | Broadband intruder | With fricatives | Silent gaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Energy | 0.962 | **0.980** | 0.592 | 0.872 | 0.949 | **0.990** | 0.795 |
| Zero-crossing | **0.975** | 0.962 | 0.730 | **0.978** | **0.977** | 0.963 | **0.959** |
| Spectral | 0.964 | 0.972 | **0.976** | 0.966 | 0.966 | 0.963 | 0.956 |

Three things are worth taking from that:

- **Energy is not beaten everywhere.** It is still the best detector on a clean
  recording of ordinary loudness, and by a distance on trailing fricatives. The
  later approaches are not upgrades; they are different trades.
- **Zero-crossing is the cheap rejection of loud non-speech.** Its win on the
  intruder scenario is precision, 0.903 → 0.954, and it pays for it on
  fricatives, which are broadband and therefore look like the thing it rejects.
- **Spectral is the one that changes what is possible.** At 5 dB SNR energy's
  recall is 0.427 and spectral's is 1.000. Nothing about tuning closes that gap;
  it is what asking about shape instead of size buys.

Cost runs the other way, on a one-minute file: energy 16 ms, zero-crossing 28 ms,
spectral 134 ms.
