# Energy-based

The simplest voice activity detector that works: speech is louder than the room
it is spoken in, so measure loudness over short frames and threshold it.

Implementation: [`backend/app/vad/energy.py`](../../backend/app/vad/energy.py), with
everything downstream of the threshold in
[`pipeline.py`](../../backend/app/vad/pipeline.py), shared with the other two
rule-based detectors.
Interactive version: `/energy-based` in the running app.

## Idea

A microphone picks up two things — the room, and whatever happens in it. The
room is roughly constant, so its level (the *noise floor*) can be estimated from
the recording itself. Anything that rises far enough above that floor is a
candidate for speech.

That single comparison gets the broad strokes right and fails in three specific
ways, each of which the pipeline answers with one more stage:

| Failure | Stage that fixes it |
| --- | --- |
| Frames hovering at the threshold flip on and off every hop | Hysteresis: separate enter and exit thresholds |
| Speech tails off quietly, so trailing consonants get clipped | Hangover: hold the decision on briefly |
| Door knocks and lip smacks produce one-frame bursts | Duration filter: drop short segments, merge close ones |

## Method

Audio is decoded to 16 kHz mono. `librosa` does the decode and resample; every
measurement below is plain numpy.

**1 — Frame.** Split the signal into overlapping windows of `frame_ms`, advancing
by `hop_ms` each time. Overlap matters: with a 30 ms frame and a 10 ms hop, a
boundary is located to within 10 ms rather than 30 ms. `frame_signal` builds this
as a strided view, so no audio is copied.

**2 — Measure energy.** For frame $x$ of length $N$, take mean square power and
convert to decibels:

$$E_{\text{dB}} = 10 \cdot \log_{10}\left(\frac{1}{N}\sum_{n=0}^{N-1} x_n^2 + \epsilon\right)$$

Decibels rather than raw power because loudness spans several orders of
magnitude; in dB, "8 dB above the floor" means the same thing for a quiet
recording and a loud one. The $\epsilon$ keeps digital silence from producing
$-\infty$; the result is clamped at `SILENCE_FLOOR_DB` (−100 dB).

Two details that are easy to skip and both cost accuracy. A DC offset is a
constant bias that adds energy which is not sound, inflating every frame
equally — `remove_dc_offset` subtracts the mean first. And a single-frame click
can cross any threshold, so the contour is passed through a short **median**
filter. Median rather than mean: a mean smears the spike across neighbouring
frames, a median deletes it.

**3 — Estimate the noise floor.** Take a low percentile (default 10th) of frame
energies. The assumption is that at least 10% of any recording is not speech.
Frames sitting exactly at digital silence are excluded first, so a file padded
with true zeros does not drag the floor to −100 dB and make every threshold
meaningless.

One floor for a whole file only works if the room is stationary, which real
rooms are not — a fan spins up, someone moves closer, gain drifts. So the floor
is re-estimated per window (default 5 s) and linearly interpolated between
window centres, giving a floor that follows the room.

That introduces its own failure: inside a long utterance the window fills with
speech and the floor chases it upward, raising the threshold until the detector
silences itself. The curve is therefore capped at `global_floor + 6 dB`, which
bounds the runaway while still tracking genuine drift. Setting the window to 0
restores the single global floor.

This is the offline shortcut: it reads the whole file before deciding. The
streaming detector cannot, and pays for it — see [Streaming](#streaming).

**4 — Threshold with hysteresis.** Two thresholds, not one:

```
enter = noise_floor + threshold_offset_db
exit  = enter - hysteresis_db
```

A silent frame becomes speech only above `enter`; a speech frame stays speech
until it drops below `exit`. A frame parked between the two keeps its previous
state. This is a Schmitt trigger, and it is why `apply_hysteresis_threshold`
is a sequential loop rather than a vectorised comparison — each decision depends
on the one before it.

**5 — Extend both edges.** A frame only crosses the threshold once speech is
well underway, so onsets are detected late; `apply_pre_speech` walks the mask
backwards and extends each segment by `pre_speech_ms`. Symmetrically, speech
decays gradually and unvoiced endings (`/s/`, `/f/`, `/th/`) carry little
energy, so `apply_hangover` holds the decision on for `hangover_ms` after the
last frame above threshold.

Both are measured, not guessed — see [Evaluation](#evaluation). The interesting
result is that hangover has a real optimum rather than "longer is safer".

**6 — Segment and filter.** Convert the frame mask to `(start, end)` intervals,
merge any pair separated by less than `min_silence_ms`, then discard whatever is
still shorter than `min_speech_ms`. Merge before dropping — the other order
deletes a real utterance that a brief dip had split in two.

## Parameters

| Parameter | Default | Effect |
| --- | --- | --- |
| `frame_ms` | 30 | Longer frames smooth the energy contour but blur onsets. |
| `hop_ms` | 10 | Boundary resolution, and the cost of the whole pipeline. |
| `smoothing_ms` | 30 | Median window over the contour. Removes impulsive clicks. |
| `noise_percentile` | 10 | Raise it when a recording is mostly silence, lower it when it is mostly speech. |
| `noise_window_s` | 5 | Window the floor is re-estimated over. 0 uses one floor for the whole file. |
| `threshold_offset_db` | 8 | The main sensitivity dial. Too low admits noise, too high clips soft speech. |
| `hysteresis_db` | 3 | Larger values stop chattering at the boundary; too large and offsets are late. |
| `pre_speech_ms` | 30 | Extends segments backwards to recover late-detected onsets. |
| `hangover_ms` | 60 | Too short clips trailing consonants, too long swallows pauses between words. |
| `min_speech_ms` | 120 | Rejects clicks and knocks. |
| `min_silence_ms` | 100 | Closes the natural gaps inside a single utterance. |

The last three interact: hangover already bridges short gaps, so a long hangover
makes `min_silence_ms` nearly inert.

## Streaming

`StreamingEnergyVad` is the causal version, used for the microphone. It differs
from the offline path in exactly one respect — it cannot take a percentile of
audio it has not heard yet — and that one difference drives the rest:

- The noise floor is tracked with an asymmetric exponential average: **fast
  downward, slow upward**. Falling quickly means a floor initialised too high
  recovers within a few hundred milliseconds; rising slowly means sustained
  speech does not drag the floor up behind it.
- The floor only rises on frames classified as non-speech, which stops a long
  utterance from raising its own threshold until it silences itself.
- Decisions are withheld for the first `warmup_ms` (200 ms) while the floor
  settles. Without this the first frame is compared against the −100 dB default,
  reads as speech, and latches the detector on permanently.

The known limitation: if speech starts within that warmup window, the floor is
seeded too high and the first utterance may be missed. Real streaming detectors
handle this with minimum statistics over a longer window; this one accepts it.

Audio arrives in 100 ms blocks that do not divide evenly into frames, so leftover
samples are carried in a buffer and prepended to the next block. Frame boundaries
therefore stay on the same grid regardless of how the network chunks the stream —
verified by feeding the same signal in different block sizes and comparing.

## Evaluation

There is no labelled corpus here, so accuracy is measured against **synthetic
speech with known boundaries**: formant-like tones, 4 Hz syllable modulation,
realistic attack and decay, over noise at a controlled SNR. Ground truth is the
interval where the utterance envelope is non-zero. Frame-level F1, six seeds per
scenario.

| Configuration | Clean (25 dB) | Noisy (10 dB) | Drifting floor | Mean |
| --- | --- | --- | --- | --- |
| Single global floor, no smoothing, no backtracking | 0.938 | 0.949 | 0.800 | 0.896 |
| + median smoothing | 0.938 | 0.950 | 0.798 | 0.895 |
| + onset backtracking | 0.932 | 0.971 | 0.798 | 0.900 |
| + windowed noise floor | 0.938 | 0.950 | **0.940** | 0.943 |
| All three, tuned defaults | **0.980** | **0.963** | **0.983** | **0.975** |

Reading that honestly:

- The **windowed floor** is the single biggest win, and only in the scenario it
  targets. On a drifting room it lifts F1 from 0.800 to 0.940; elsewhere it is
  neutral. That is what a correct fix looks like.
- **Onset backtracking** trades: it helps in noise (0.949 → 0.971, mean onset
  error 60 ms → 3 ms) and slightly hurts when clean, where the crossing was
  already accurate. 30 ms is the empirical compromise.
- **Median smoothing** does essentially nothing here, because the synthetic
  noise is Gaussian and has no impulsive clicks to remove. It is kept because
  real recordings do, but the benchmark does not justify it — worth stating
  rather than implying every part earned its place.

**Hangover has an optimum.** The original 180 ms default was simply too long. A
second benchmark gives every utterance a trailing fricative and counts it as
speech, which is precisely what hangover exists to protect:

| `hangover_ms` | Precision | Recall | F1 |
| --- | --- | --- | --- |
| 0 | 1.000 | 0.959 | 0.979 |
| 40 | 0.999 | 0.988 | **0.993** |
| 60 | 0.986 | 0.990 | 0.988 |
| 120 | 0.944 | 0.990 | 0.966 |
| 200 | 0.893 | 0.990 | 0.939 |

Recall climbs from 0.959 to 0.988 between 0 and 40 ms — that is the fricative
being recovered, and it is the whole justification for the stage. Past ~60 ms
recall is flat while precision falls steadily: every extra millisecond is pure
over-extension. The default is 60 ms, slightly generous, since real tails run
longer than the synthetic 140 ms one.

Against the offline detector on the same signal, the streaming path agrees on
**98%** of frames, the residual being the warmup window and the floor's
convergence time.

On the bundled samples, at default settings:

| Sample | Duration | Noise floor | Segments | Speech | Detector |
| --- | --- | --- | --- | --- | --- |
| `sample1.wav` | 18.4 s | −57.2 dB | 6 | 83% | 4.8 ms |
| `sample2.wav` | 60.0 s | −46.1 dB | 13 | 97% | 16.1 ms |
| `sample3.wav` | 24.0 s | −77.6 dB | 1 | 84% | 5.7 ms |

`sample2` is the only one where the windowed floor shows up at all. A single
global floor is set by the quietest moment in the whole minute, sits 1.1 dB
lower, and fragments the same speech into **18** segments; re-estimating per
window follows the recording and resolves **13** longer ones. `sample1` and
`sample3` come out identical either way — `sample3`'s gaps are true digital
silence, so there is no drift to track.

These are the numbers the UI reports, not a separate offline script.

## Notes

**Where it fails.** Energy alone cannot tell speech from any other loud sound. A
slammed door, music, a fan spinning up, or a second conversation across the room
all cross the threshold. It also assumes a roughly stationary noise floor — in a
café or a moving car the floor drifts, and a percentile taken over the whole file
is wrong for most of it.

**Why it is still worth building.** It costs microseconds per frame, needs no
training data, and is trivially auditable — when it misfires you can point at the
exact frame and the exact threshold. It is also the honest baseline: any learned
detector should be measured against this before its complexity is justified.

**On cost.** A 60-second file is analysed in ~16 ms. Nearly all of that used to
be one line: squaring the framed matrix allocates a copy the size of the signal
times the overlap factor (23 MB at a 30 ms frame and 10 ms hop). Replacing it
with `np.einsum("ij,ij->i", frames, frames)`, which accumulates each frame's
squares without materialising the squares, cut that step from 22 ms to 1.5 ms
for a worst-case error of 9e-6 dB. The sequential stages — hysteresis, hangover,
backtracking — cannot be vectorised because each decision depends on the last,
but converting to Python lists before looping avoids numpy's per-element boxing
and is several times faster than indexing the arrays directly.

The next two approaches address the "loud but not speech" problem directly.
[Zero-crossing rate](zero-crossing.md) separates voiced speech from broadband
noise by how often the waveform changes sign, and rejects a door slam that
sails through this detector. [Spectral](spectral.md) measures ask whether energy
is *arranged* like speech rather than merely present, and are the only approach
here that still works at 5 dB SNR, where the recall of this one falls to 0.427.

Neither of them replaces this page. Energy is still the best of the three on a
clean recording and on trailing fricatives, and it costs a fraction of what they
do — see [the comparison](README.md#how-they-compare).
