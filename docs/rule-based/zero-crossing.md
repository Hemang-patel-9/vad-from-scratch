# Zero-crossing rate

Energy asks how *big* a frame is. This asks what *shape* it has: count how often
the waveform changes sign, and you have a crude estimate of where its energy
sits in frequency — without computing a spectrum at all.

Implementation: [`backend/app/vad/zerocrossing.py`](../../backend/app/vad/zerocrossing.py).
Interactive version: `/zero-crossing` in the running app.

## Idea

A voiced vowel is carried by the glottal buzz — a fundamental somewhere between
80 and 250 Hz with harmonics above it — so the waveform swings slowly and
crosses zero a few hundred to a couple of thousand times a second. Hiss, a fan,
a click and a laptop's own noise floor are broadband, and cross zero several
thousand times a second.

So the comparison runs the other way round from energy. A frame is speech when
its crossing rate falls **below** the threshold, and that single inversion is
what lets this detector reject things energy cannot: a door slam is loud, but it
is not voiced.

It also brings a failure energy does not have, and it is worth stating up front
because it drives half the design:

> Digital silence never changes sign at all. On the crossing rate alone, an
> edited-out gap is the most perfectly voiced thing in the file.

## Method

Audio is decoded to 16 kHz mono, framed by the shared code in
[`pipeline.py`](../../backend/app/vad/pipeline.py), and DC-corrected first — a
constant bias shifts the whole waveform off zero and deletes real crossings.

**1 — Count sign changes.** For a frame $x$ of length $N$ at sample rate $f_s$:

$$Z = \frac{f_s}{N-1} \sum_{n=1}^{N-1} \frac{\left|\operatorname{sgn}(x_n) - \operatorname{sgn}(x_{n-1})\right|}{2}$$

which is crossings per second — roughly twice the dominant frequency of the
frame. The implementation is `np.signbit` and a neighbour comparison, so it
costs one pass and no arithmetic on the samples themselves.

The contour then goes through the same median filter energy uses, for the same
reason: one stray frame should not decide anything.

**2 — Gate on energy.** Frames less than `gate_offset_db` above the noise floor
are refused before the crossing rate is consulted at all. The floor is the 10th
percentile of frame energy, windowed exactly as the energy detector does it, but
it is not exposed as a parameter — the gate only has to separate "the room" from
"something is happening", which is a far coarser question than the energy
detector answers.

This is the answer to digital silence, and it is a toggle on the page rather
than a hidden constant, because watching it fail is the fastest way to
understand what the crossing rate does and does not know.

**3 — Anchor the threshold.** Here is the interesting part, and the place where
the obvious design is wrong.

The tempting reading of the idea above is: take a *high* percentile of the
crossing rate, call that the broadband content, and put the threshold some
margin *below* it. It matches the story exactly. It also fails on any recording
that contains no broadband noise to measure — and plenty do not, because they
were edited, gated, or recorded somewhere quiet. With nothing broadband in the
file, the high percentile lands inside the speech, subtracting a margin puts the
threshold underneath the very thing it is meant to admit, and the detector
returns nothing. Measured, that costs **0.026 F1** on such a file, against
**0.959** for what is shipped.

So the anchor points the other way. A *low* percentile of the crossing rate over
audible frames is the rate the most voiced part of this recording runs at, and
the threshold is placed a margin **above** it:

```
enter = clip(voiced_reference + zcr_margin_hz, 600, 3500)
exit  = enter + hysteresis_hz
```

The voiced end is present whenever there is speech to detect, which is precisely
when the detector needs to be right. Silent frames are excluded from the
estimate where the gate can identify them, since they cross zero almost never
and would drag the anchor to nothing.

**4 — Clamp it.** The reference is only as good as its assumption, so the result
is clipped into the band voiced speech actually occupies at 16 kHz. A recording
with no speech in it would otherwise anchor to its own hiss and then admit that
hiss; the ceiling stops that. The floor stops a heavily edited file from
collapsing the threshold to nothing. On the bundled samples the clamp rarely
binds; on a file that is mostly one texture, it is the only thing standing
between the detector and a confident wrong answer.

**5 — Threshold and clean up.** A Schmitt trigger with the comparison inverted
(`speech_above=False` in `apply_hysteresis_threshold`), then the same
backtracking, hangover and duration filtering every detector here shares, all
documented on the [energy-based](energy-based.md) page.

One implementation note: gated-out frames are fed into the trigger as `np.inf`
rather than being masked afterwards. Masking afterwards leaves the trigger
latched through the gated-out gap, so it leaves via the wrong bound when audio
returns.

## Parameters

| Parameter | Default | Effect |
| --- | --- | --- |
| `frame_ms` | 30 | Longer frames give a steadier rate estimate but blur onsets. |
| `hop_ms` | 10 | Boundary resolution. |
| `smoothing_ms` | 30 | Median window over the rate contour. |
| `zcr_percentile` | 25 | Quantile of the rate taken as the voiced reference. |
| `zcr_window_s` | 5 | Window the reference is re-estimated over. 0 uses one for the file. |
| `zcr_margin_hz` | 1400 | The main sensitivity dial: how far above the voiced reference still counts. |
| `hysteresis_hz` | 250 | Gap between the enter and exit thresholds. |
| `energy_gate` | on | Whether silence is refused before the rate is consulted. |
| `gate_offset_db` | 3 | How far above the noise floor a frame must be to be considered. |
| `pre_speech_ms` | 30 | Shared with the other detectors. |
| `hangover_ms` | 60 | Shared. See [Evaluation](#evaluation) — 120 ms measures better here. |
| `min_speech_ms` | 120 | Shared. |
| `min_silence_ms` | 100 | Shared. |

## Streaming

`StreamingZeroCrossingVad` adapts two references instead of one. The noise floor
under the gate behaves exactly as it does in the energy detector: quick to fall,
slow to rise, frozen while a frame reads as speech.

The voiced reference is a **valley follower** — quick to drop, slow to rise —
standing in for the low percentile the offline path takes. Unlike the noise
floor it is *never* held during speech, because voiced speech is the thing it
exists to measure; freezing it there would freeze it permanently.

The gate is evaluated per frame against the floor as it stands at that frame,
not once per arriving block, so the streaming path gates on the same rule the
offline path does rather than on a value up to a block stale.

Against the offline detector on the bundled samples, the streaming path agrees
on **87–95%** of frames, the residual being the warmup window and the time both
references take to converge. That is lower than energy's 96–100% and it is the
valley follower's fault: it has no equivalent of the percentile's hindsight, and
a recording that opens on its quietest voiced frame seeds it badly.

## Evaluation

Same synthetic benchmark as the energy page — formant-like tones with 4 Hz
syllable modulation over noise at a controlled SNR, ground truth being where the
utterance envelope is non-zero, frame-level F1, six seeds per scenario. Three
scenarios are new and exist for this page and the next one: a loud broadband
burst that is not speech, speech at 5 dB SNR, and a file whose gaps have been
edited down to true digital silence.

| Detector | Clean 25 dB | Noisy 10 dB | Noisy 5 dB | Drifting floor | Broadband intruder | With fricatives | Silent gaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Energy | 0.962 | **0.980** | 0.592 | 0.872 | 0.949 | **0.990** | 0.795 |
| Zero-crossing | **0.975** | 0.962 | 0.730 | **0.978** | **0.977** | 0.963 | **0.959** |
| Spectral | 0.964 | 0.972 | **0.976** | 0.966 | 0.966 | 0.963 | 0.956 |

Reading that honestly:

- On the **broadband intruder** it does what it was built to do, and the F1
  understates it because the bursts are short. The number that matters is
  precision: **0.903 → 0.954**. The detector is refusing a loud sound because it
  is not voiced, which is exactly the failure the energy page ends on.
- On a **drifting floor** it beats energy by a wide margin (0.872 → 0.978), and
  this is close to free: a ratio of crossings does not care how loud the room
  got.
- It **loses to energy where energy is already good** — clean recordings and
  trailing fricatives. Fricatives are the honest cost of the whole idea: `/s/`
  and `/f/` are broadband, so the measurement that rejects hiss rejects them
  too. Recall on the fricative scenario is 0.935 against energy's near-perfect
  score.
- At **5 dB SNR** it is better than energy (0.592 → 0.730) but both are poor,
  and for the same reason: recall collapses (0.583 and 0.427) because the noise
  is loud enough to raise the crossing rate of the speech itself.

**The energy gate is not optional.** Turning it off changes nothing on any
scenario that contains noise, and destroys the one that does not:

| Variant | Silent gaps | Everything else |
| --- | --- | --- |
| As shipped | **0.959** | unchanged |
| Energy gate off | 0.060 | unchanged |
| Anchored to the broadband end instead | 0.026 | unchanged |

Both failures are the same failure seen twice: with no broadband content to
measure against, a rate is just a number. That is worth more than the headline
table, because it is the thing the crossing rate genuinely cannot do.

The remaining knobs barely move on this benchmark. Hysteresis is worth 0.010 at
5 dB SNR and nothing anywhere else; a windowed reference beats a single one by
0.005 on the drifting scenario; `zcr_percentile` is flat from the 5th to the
50th, because the low end of an audible-frame distribution is voiced speech
wherever you cut it. They are kept because they cost nothing and real recordings
are less tidy than this one, but the benchmark does not justify them.

**Hangover wants to be longer here than for energy.** The shared 60 ms default
was tuned against the energy detector:

| `hangover_ms` | Precision | Recall | F1 |
| --- | --- | --- | --- |
| 0 | 0.993 | 0.895 | 0.942 |
| 60 | 0.994 | 0.935 | 0.963 |
| 120 | 0.994 | 0.975 | **0.984** |
| 200 | 0.967 | 1.000 | 0.983 |

Precision is flat to 120 ms and only then starts paying, because this
measurement drops away at the end of an utterance faster than energy does. The
default is left at 60 ms so the three pages stay comparable — the decision
stages are meant to be identical across approaches — but 120 ms is the better
setting if trailing fricatives matter to you, and the slider is right there.

On the bundled samples, at default settings:

| Sample | Segments | Speech | Voiced rate | Detector | Agrees with energy |
| --- | --- | --- | --- | --- | --- |
| `sample1.wav` | 6 | 88% | 491/s | 10.2 ms | 93.5% |
| `sample2.wav` | 18 | 94% | 401/s | 27.9 ms | 96.1% |
| `sample3.wav` | 4 | 81% | 501/s | 11.5 ms | 97.2% |

All three of these recordings have near-silence between utterances rather than
noise, which is the case this measurement has least to say about — so agreeing
with energy 93–97% of the time is about the most interesting result available
from them. The disagreements are mostly fricatives it drops.

## Notes

**Where it fails.** Unvoiced speech is broadband and looks exactly like noise;
this detector rejects `/s/`, `/f/` and `/ʃ/` on purpose and relies on hangover
to put them back. Whispered speech is unvoiced throughout and is missed almost
entirely. Music with percussion crosses like speech. And the whole measurement
assumes something audible: without the energy gate it cannot tell a quiet room
from a vowel, which is why the gate is on by default and why the toggle exists.

**Why it is still worth building.** It is the cheapest possible answer to "loud,
but is it speech?" — one comparison per sample, no spectrum, no training data —
and it is the first detector here that rejects a door slam. It is also a good
demonstration that a measurement is only half a detector: the same crossing rate
scores 0.959 or 0.060 depending entirely on what it is compared against.

**On cost.** About 10 ms for an 18-second file and 28 ms for a minute — roughly
twice energy, because it computes the crossing rate *and* the energy the gate
needs. `np.signbit` on the framed view allocates one boolean array the size of
the overlap rather than a float one, which is where the difference would
otherwise have been much larger.

The next page keeps the "shape, not size" idea and stops approximating. Instead
of inferring where the energy sits from sign changes, it looks at the spectrum
directly.
