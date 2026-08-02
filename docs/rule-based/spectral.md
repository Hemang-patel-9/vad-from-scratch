# Spectral

Energy asks how much of a frame there is. Zero-crossing asks roughly where it
sits. This asks how it is *arranged* — and it is the first detector here that
works at signal-to-noise ratios where energy has effectively stopped hearing.

Implementation: [`backend/app/vad/spectral.py`](../../backend/app/vad/spectral.py).
Interactive version: `/spectral` in the running app.

## Idea

Voiced speech is harmonic. Its spectrum is a handful of tall peaks — the
fundamental, its harmonics, the formants shaping them — over a much quieter
background. Room noise, a fan, a hiss, air conditioning: all of these spread
their energy roughly evenly across the band.

Two classical measures put a number on the difference, and both are *ratios*, so
both are blind to loudness. A whisper and a shout score the same. A door slam
scores like the noise it is. That is the whole appeal: it removes the one
assumption — that speech is the loudest thing present — that energy is built on.

| Measure | Flat spectrum | Peaky spectrum |
| --- | --- | --- |
| Flatness (geometric mean over arithmetic mean) | 1 | toward 0 |
| Entropy (Shannon, normalised) | 1 | toward 0 |

Both are 1 for noise and fall as structure appears, which is what makes them
mixable: invert each and they point the same way on the same 0-to-1 scale.

## Method

Audio is decoded to 16 kHz mono and framed by the shared code in
[`pipeline.py`](../../backend/app/vad/pipeline.py).

**1 — Centre each frame.** The signal already had its mean removed, but that
does not leave every *frame* zero-mean, and here it matters more than anywhere
else in the project. A gap edited down to digital silence comes out of a global
DC correction as a constant offset — and a constant is the most tonal thing
there is. Both measures below read it as pure structure and score silence
*above* speech.

This is not hypothetical: it is worth **0.144 F1 against 0.956** on a file with
edited gaps, and it was the single largest bug found while building this page.
Each frame is centred on its own mean before anything else happens.

**2 — Window and transform.** A Hann window, then `np.fft.rfft`. The window is
not cosmetic: an abrupt frame edge smears energy across every bin, which is
exactly the flat spectrum both measures are looking for, and a rectangular
window would wash out real structure.

**3 — Keep the speech band.** Bins outside `band_low_hz`–`band_high_hz`
(200–4000 Hz) are dropped, taking rumble and mains hum with them. The power is
floored at $10^{-20}$, which is what makes a genuinely empty frame come out
uniform — that is, flat, that is, noise — instead of dividing zero by zero.

**4 — Measure flatness and entropy.** Over the $K$ retained bins with power
$P_k$:

$$\mathcal{F} = \frac{\exp\!\left(\frac{1}{K}\sum_k \ln P_k\right)}{\frac{1}{K}\sum_k P_k}
\qquad
H = -\frac{1}{\ln K}\sum_k p_k \ln p_k, \quad p_k = \frac{P_k}{\sum_j P_j}$$

Flatness is the geometric mean over the arithmetic mean, and the geometric mean
is dragged down by any bin near zero — which is what makes it sensitive to the
quiet valleys between harmonics. Entropy reads the spectrum as a probability
distribution and asks how uncertain it is; a few dominant bins mean low
uncertainty.

**5 — Blend into one score.**

$$S = w\,(1 - \mathcal{F}) + (1 - w)\,(1 - H)$$

Both terms are already in $[0, 1]$ and already point the same way, so `w` is a
plain crossfade with no scaling constants to justify. At `w = 0.5` it is an even
mix of the two.

**6 — Threshold proportionally.** The score is unitless, and how much separation
a recording offers varies enormously, so a fixed offset — energy's "8 dB above
the floor" — has nothing to be fixed relative to. Instead the threshold is
placed a *fraction of the way* across the file's own range:

```
room   = 15th percentile of the score, windowed
loudest = 90th percentile of the score, windowed
span   = max(loudest - room, 0.02)

enter = room + margin * span
exit  = enter - hysteresis * span
```

That is what keeps one setting working on a recording with huge separation and
one with very little. The `room` curve is capped at `overall + 0.12` for the
same reason energy caps its floor: inside a long utterance the window fills with
speech and the low percentile climbs after it.

**7 — Clean up.** The same hysteresis, backtracking, hangover and duration
filtering as every other detector here, documented on the
[energy-based](energy-based.md) page.

## Parameters

| Parameter | Default | Effect |
| --- | --- | --- |
| `frame_ms` | 30 | Also sets the frequency resolution — 33 Hz at 30 ms. |
| `hop_ms` | 10 | Boundary resolution, and most of the cost. |
| `smoothing_ms` | 30 | Median window over the score contour. |
| `flatness_weight` | 0.5 | 0 is pure entropy, 1 is pure flatness. |
| `band_low_hz` | 200 | Bins below this are ignored, along with rumble and hum. |
| `band_high_hz` | 4000 | Bins above this are ignored. |
| `noise_percentile` | 15 | Quantile of the score taken as the room's own structure. |
| `reference_window_s` | 5 | Window the references are re-estimated over. |
| `margin` | 0.35 | Fraction of the room-to-speech span the threshold sits at. |
| `hysteresis` | 0.1 | Gap between enter and exit, on the same proportional scale. |
| `pre_speech_ms` | 30 | Shared with the other detectors. |
| `hangover_ms` | 60 | Shared. See [Evaluation](#evaluation) — 120 ms measures better here. |
| `min_speech_ms` | 120 | Shared. |
| `min_silence_ms` | 100 | Shared. |

## Streaming

`StreamingSpectralVad` tracks both ends of the span, because the threshold sits
between them.

The `room` reference behaves exactly like the energy detector's noise floor:
fast down, slow up, frozen on frames that read as speech. The `loudest`
reference is a **peak follower** — fast up, slow down — standing in for the high
percentile, and it is deliberately *never* frozen during speech, because speech
is when the peaks it exists to follow actually arrive.

Against the offline detector on the bundled samples the streaming path agrees on
**90–96%** of frames. It has more to converge than the other two detectors do,
since a proportional threshold is wrong until *both* references have settled,
not just one.

## Evaluation

Same synthetic benchmark as the other two pages: formant-like tones with 4 Hz
syllable modulation over noise at a controlled SNR, frame-level F1, six seeds per
scenario.

| Detector | Clean 25 dB | Noisy 10 dB | Noisy 5 dB | Drifting floor | Broadband intruder | With fricatives | Silent gaps |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Energy | 0.962 | **0.980** | 0.592 | 0.872 | 0.949 | **0.990** | 0.795 |
| Zero-crossing | **0.975** | 0.962 | 0.730 | **0.978** | 0.977 | 0.963 | **0.959** |
| Spectral | 0.964 | 0.972 | **0.976** | 0.966 | 0.966 | 0.963 | 0.956 |

The headline is the **5 dB SNR** column, and it is not close:

| Detector | Precision | Recall | F1 |
| --- | --- | --- | --- |
| Energy | 0.979 | 0.427 | 0.592 |
| Zero-crossing | 0.988 | 0.583 | 0.730 |
| Spectral | 0.953 | **1.000** | **0.976** |

Energy's recall is 0.427. It is not making mistakes — precision is 0.979 — it
simply cannot hear more than half the speech, because at 5 dB SNR most frames no
longer stand far enough above the floor. Spectral finds all of it, because the
harmonic structure is still plainly there in the spectrum even when the level
difference has nearly gone. That is the entire argument for looking at shape
rather than size, in one column.

The other columns are the quieter result: spectral is **within 0.02 of the best
detector in every single scenario**. Nothing else here is. It never wins by much
outside heavy noise, and it never loses.

Reading the ablations honestly is less flattering:

| Variant | Silent gaps | Noisy 5 dB | Everything else |
| --- | --- | --- | --- |
| As shipped (50/50 blend) | 0.956 | 0.976 | — |
| Flatness only | 0.955 | 0.975 | within 0.001 |
| Entropy only | **0.964** | 0.976 | within 0.001 |
| Full band, no 200–4000 Hz limit | 0.955 | **0.978** | within 0.002 |
| One reference for the whole file | 0.956 | 0.976 | unchanged |
| Without per-frame DC removal | **0.144** | 0.976 | unchanged |

Only the last row matters. **The blend earns nothing** — flatness alone, entropy
alone and any mix of them are within 0.001 of each other on every scenario,
because on a synthetic harmonic stack both measures see the same thing. The band
limit earns nothing either, and is very slightly *negative* at 5 dB. The
windowed reference does nothing at all, since a proportional threshold already
adapts to whatever the window would have told it.

They are kept because real recordings have mains hum, rumble and non-stationary
rooms that this benchmark does not, and because the crossfade is what lets the
page show the two measures are different things. But the honest summary is that
one measure, full-band, with a single global reference, would have scored the
same here — and it is better to say so than to imply every part earned its place.

**Hangover, as with zero-crossing, wants to be longer than energy's default:**

| `hangover_ms` | Precision | Recall | F1 |
| --- | --- | --- | --- |
| 0 | 0.982 | 0.904 | 0.941 |
| 60 | 0.983 | 0.944 | 0.963 |
| 120 | 0.983 | 0.984 | **0.984** |
| 200 | 0.949 | 1.000 | 0.974 |

Precision does not start paying until past 120 ms. The default stays at 60 ms so
the decision stage is identical across all three approaches, which is the point
of sharing it, but 120 ms is the better number here.

On the bundled samples, at default settings:

| Sample | Segments | Speech | Room score | Detector | Agrees with energy |
| --- | --- | --- | --- | --- | --- |
| `sample1.wav` | 5 | 88% | 0.50 | 38.5 ms | 87.5% |
| `sample2.wav` | 11 | 97% | 0.58 | 134.1 ms | 96.7% |
| `sample3.wav` | 1 | 84% | 0.45 | 48.6 ms | 99.9% |

A note on the `margin` default, because the benchmark and the real recordings
disagree. On synthetic audio a larger margin is free — 0.6 scores best on every
scenario, since the separation is artificially clean. On `sample2.wav` that same
0.6 fragments 13 utterances into **31**, because real speech dips below a
threshold placed 60% of the way up far more often than synthetic speech does.
0.35 is chosen on the real files and merely happens to be near-optimal on the
synthetic ones. Where the two disagree, the recordings win.

## Notes

**Where it fails.** Anything else harmonic passes: music, singing, a tone, an
alarm, a reversing beeper. It is blind to loudness by construction, so it cannot
tell a whispered word from a shouted one, which is a feature until you want a
detector that ignores a conversation two desks away. Whispered speech itself is
unvoiced and largely flat, so it is missed. And a recording that is *entirely*
speech gives the room percentile nothing to anchor to — the same assumption
energy makes about its own floor, and the same failure when it does not hold.

**Why it is still worth building.** It is the only detector here that survives
5 dB SNR, and the reason is structural rather than a matter of tuning. It also
degrades gracefully: within 0.02 of the best result in every scenario tested,
including the ones built to defeat the other two.

**On cost.** 38 ms for an 18-second file and 134 ms for a minute — roughly eight
times energy, and effectively all of it is the FFT. A minute of audio at a 30 ms
frame and 10 ms hop is 6,000 transforms of length 480, and numpy returns
`complex128` regardless of the input dtype, so the transform alone allocates
about 23 MB. Casting the Hann window to `float32` keeps the multiply that feeds
it from widening the frame matrix first, which took a minute of audio from
143 ms to 134 ms and halved the peak allocation; the transform itself is the
floor, and getting under it would mean a different FFT library.

That still fits inside the explorer's 160 ms debounce, so moving a slider stays
interactive — but this is the first approach here where that was in question,
and the first where the measurement costs more than the pipeline around it.
