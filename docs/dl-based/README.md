# DL-based

The other three detectors each pick a measurement and threshold it. Picking the
measurement is the hard part, and every page so far is really an argument about
that choice: energy asks how much of a frame there is, zero-crossing asks roughly
where it sits, spectral asks how it is arranged. This one declines to choose.

Implementation: [`backend/app/vad/neural.py`](../../backend/app/vad/neural.py).
Training: [`ml/vad_dl_kaggle.ipynb`](../../ml/vad_dl_kaggle.ipynb).
Interactive version: `/dl-based` in the running app.

> **Status: implemented, not yet evaluated.** The detector and its endpoints are
> in place and the export contract is verified, but the numbers in
> [Evaluation](#evaluation) are not filled in because no model has been trained
> yet. The repository ships no weights — see [Getting a model](#getting-a-model).

## Idea

A rule-based detector is a hypothesis about what makes speech distinguishable,
written down as arithmetic. The spectral page is the clearest case: harmonic
structure is genuinely the right idea, and it is genuinely why that detector
survives 5 dB SNR when energy has stopped hearing. But it also inherits every
limit of the hypothesis. Music is harmonic, so music passes. Whispers are not,
so whispers are missed. No amount of tuning fixes either, because neither is a
tuning problem.

Learning the measurement replaces the hypothesis with data. The network is given
64 log-mel bands per frame and a label saying whether that frame was speech, and
what it extracts is whatever separates the two in the training set — including
things nobody would have thought to write down.

This buys two specific things the rule-based detectors cannot have at any
setting:

- **Nothing adapts to the recording.** Every other detector here estimates a
  reference from the file it is looking at — a noise percentile, a voiced
  reference, a room score — because a threshold in dB or crossings per second
  means nothing until you know what this particular recording sounds like. That
  assumption breaks on a recording that is entirely speech, and it is why those
  detectors have a `noise_percentile` at all. A probability needs no such
  anchor: 0.6 means the network is 60% sure, in every recording, forever.
- **Memory that was learned rather than set.** Hysteresis and hangover are a
  hand-set memory of the recent past — a fixed number of milliseconds, the same
  in a pause between words and a pause between speakers. The GRU's memory is
  learned, and roughly 1.7 s of history reaches each decision.

The cost is that it is no longer possible to say why any individual frame was
called speech, which every previous page could do exactly.

## Method

### The frame grid is the shared one

30 ms window, 10 ms hop, 16 kHz — the `FrameSettings` defaults every other
detector uses. This is a deliberate constraint on the model rather than a
convenience for it, and it earns two things: `frame_signal` builds exactly the
matrix the front end wants, so there is no second grid to keep in sync; and
frame *t* here covers the same samples as frame *t* in the energy detector, so
the explorer draws all four on one time axis.

`n_fft` is 480, not rounded up to 512. A 512-point transform would make
`torch.stft` zero-pad the 480-sample window out to 512 and analyse a 512-sample
frame, which is not the frame `frame_signal` produces.

### 1 — Features

64 log-mel bands per frame, `center=False` so frame *t* sees only samples up to
*t*. That flag is what makes the front end causal; without it every frame would
peek 15 ms into the future and the streaming detector could not reproduce the
offline result.

Normalisation uses fixed global statistics baked into the graph, not
per-utterance CMVN. Mean-and-variance normalising an utterance requires the whole
utterance, which a microphone does not have, so a model trained that way cannot
be streamed faithfully.

### 2 — The network

A causal MarbleNet: five residual stacks of 1D time-channel separable
convolutions with kernels 11 to 25, then a unidirectional GRU, then a linear
head. About 1 M parameters.

Separable convolution is what keeps that number near 1 M instead of 10 M at the
same accuracy — a depthwise convolution over time followed by a pointwise mix
across channels, rather than one dense kernel doing both. Every convolution pads
on the left only. The left receptive field is 172 frames, so 1.72 s of history
reaches each frame, and total algorithmic latency is one window: 30 ms.

> Jia, Wang & Ginsburg, *MarbleNet: Deep 1D Time-Channel Separable Convolutional
> Neural Network for Voice Activity Detection*, ICASSP 2021.

### 3 — Where the labels come from

There is no hand-labelled corpus here, and that is a design decision rather than
a compromise.

Training scenes are synthesised: speech spans from LibriSpeech dropped onto a
4-second canvas with realistic pauses, optionally convolved with a room impulse
response, then mixed with MUSAN noise at an SNR between −10 and 25 dB. The
labels are taken from the **clean** signal before the noise is added, so they
stay exact no matter how bad the SNR gets. Labelling the mixture instead would
cap the model at the accuracy of whatever did the labelling.

The clean-signal labeller is, essentially, the energy detector from this project
— hysteresis above a noise floor, gaps closed, blips dropped, boundaries
dilated — plus a zero-crossing rescue for the unvoiced fricatives energy clips.
Silero VAD then cross-checks a quarter of the corpus; files where the two
disagree badly are dropped, because that usually means the "clean" source was
not clean. Silero is used as a filter and a partial union, never as the sole
truth, so the model is not capped at its teacher.

One scene in eight contains no speech at all and one in thirty is digital
silence. That is what holds the false alarm rate down on long pauses, which is
the failure mode that actually annoys people using a VAD.

### 4 — Everything after the threshold

Unchanged. `apply_hysteresis_threshold`, `apply_pre_speech`, `apply_hangover`
and `finalise_segments` from
[`pipeline.py`](../../backend/app/vad/pipeline.py), exactly as the rule-based
detectors use them, documented in full on the
[energy-based](../rule-based/energy-based.md) page. That those stages needed no
changes at all is the useful result: they were never specific to how the
measurement got made.

## Parameters

| Parameter | Default | Effect |
| --- | --- | --- |
| `frame_ms` | 30 | **Pinned.** The model's grid; anything else is refused with a 400. |
| `hop_ms` | 10 | **Pinned.** Same. |
| `smoothing_ms` | 0 | Median window. 0, unlike the rule-based 30 — see below. |
| `enter_probability` | 0.6 | Confidence a frame must reach for speech to start. |
| `exit_probability` | 0.4 | Confidence it must fall below for speech to end. |
| `pre_speech_ms` | 30 | Shared with the other detectors. |
| `hangover_ms` | 40 | Shared, but shorter than the rule-based 60. |
| `min_speech_ms` | 80 | Shared, but shorter than the rule-based 120. |
| `min_silence_ms` | 100 | Shared. |

Three defaults differ from the rule-based pages and all three differ for the
same reason: the GRU has already integrated over its own past, so most of the
flicker those stages exist to suppress is not there to suppress. Median
smoothing in particular is off by default because it mostly rounds off the
onsets the network was deliberate about.

The framing controls are pinned rather than merely defaulted. A model asked to
run on a grid it was not trained for would not fail — it would quietly produce
worse answers — so `NeuralVadParameters` constrains both fields and the detector
raises `GridMismatch` as a backstop. The `/dl-based` page leaves the sliders out
entirely.

## Streaming

This is the one place the neural detector is unambiguously better behaved than
its predecessors, and the reason is structural.

The rule-based streaming detectors are *approximations* of their offline selves.
Offline they take a percentile of the whole recording; a live stream has no such
luxury, so they track a reference with an exponential average and accept the
drift. The spectral detector agrees with its own offline version on 90–96% of
frames, and it cannot do better without seeing the future.

`StreamingNeuralVad` has no such compromise. The model is causal by
construction, so the only state is mechanical, and fed that state a stream
returns **the same numbers a file pass returns** — verified to 1e-7 across block
sizes from 37 samples to whole files.

Two kinds of state are carried, and keeping them separate is the subtlety:

- The **convolution stack** needs the previous 172 mel frames re-fed on every
  call, because its output for a new frame genuinely depends on them.
- The **GRU** must not see those frames again, having already advanced through
  them. Re-feeding would advance its state twice over the same audio.

The exported graph resolves this by taking `172 + n_new` frames, running the
trunk over all of them, and handing only the last `n_new` to the recurrence.

That leaves what to seed the history with on the first block. Offline, the
causal convolutions left-pad with zeros — but they pad *after* normalisation, so
the correct seed is not a zero mel frame, it is `mel_mean`, which normalises to
exactly zero. Seeded that way there is no warm-up period at all, where the
rule-based detectors need 200 ms before their references mean anything.

## Getting a model

No weights are in the repository. `vad.onnx` is several megabytes of binary that
changes completely on every retrain, which is exactly the kind of thing that
makes a history useless. Without it `/api/vad/neural` answers 503 with an
explanation and nothing else in the app notices.

Train one with [`ml/vad_dl_kaggle.ipynb`](../../ml/vad_dl_kaggle.ipynb) on a free
Kaggle GPU, then drop the three exported files into
[`backend/models/`](../../backend/models/README.md). See
[`ml/README.md`](../../ml/README.md) for which datasets to attach.

The notebook exports the mel filterbank as an array rather than letting the
backend rebuild it from parameters. That is not caution for its own sake:
torchaudio's filterbank defaults are HTK-scaled and unnormalised, librosa's are
Slaney and area-normalised, both are called "the mel filterbank", and the
resulting mismatch would not crash anything — it would just make the deployed
model quietly worse than the one that was measured. The notebook asserts the two
front ends agree to 1e-3, and that the ONNX graph reproduces PyTorch, before it
writes anything.

## Evaluation

_Not yet measured._ Filling this in requires a trained model; the protocol is
fixed and the notebook already computes most of it.

**What the notebook reports.** Frame-level accuracy, F1, false alarm and miss
rate on held-out speakers and held-out noise, broken down by mixing SNR (−5, 0,
5, 10, 20 dB and clean), plus ROC-AUC and EER. Validation holds out whole
*files* on both sides — splitting after augmentation would leak badly, since one
source file feeds thousands of synthetic chunks.

**What still needs doing here.** The comparison that belongs on this page is
against the other three detectors on the same synthetic benchmark the
[rule-based pages](../rule-based/README.md) use, so the numbers sit in the same
table, plus the bundled-samples table and streaming-agreement figure every other
page carries.

**The caveat that should not be buried.** The notebook's evaluation is entirely
on synthetic mixtures. That is honest about the *labels* — they come from clean
audio, so they are exact — and dishonest about *realism*, because the noise is
added rather than recorded in the room, and the reverberation is a convolution
rather than a microphone in a space. Real-world numbers will be worse. Treating
the per-SNR table as a way to compare training runs is fair; treating it as a
claim about field performance is not. A real check means a labelled real corpus,
and AVA-Speech is the usual one.

## Notes

**Where it fails.** Wherever the training data was unrepresentative, and unlike
the rule-based detectors there is no way to inspect the rule and predict it in
advance. LibriSpeech is read English audiobook speech, so accents, spontaneous
conversational speech, children's voices and non-English phonetics are all
under-represented relative to how often they occur in the world. Noise the model
has never heard is the usual source of false alarms in the field, which is why
attaching more distinct *noise* to a training run generally buys more than
attaching more speech.

**It is not a strict upgrade.** The rule-based comparison table makes the same
point about energy: it is still the best detector on a clean recording of
ordinary loudness, and by a distance on trailing fricatives. A learned detector
is a different trade, not the end of the sequence. It needs a training corpus, a
GPU, and several hours, to replace something that needs a threshold and a
`for` loop — and on a quiet recording of one person talking, the `for` loop is
extremely hard to beat.

**On explainability.** Every previous page can point at a frame and say exactly
which comparison decided it. This one cannot, and that is a genuine loss, not a
rhetorical one. What it can do instead is report calibrated confidence, which
none of the others can: `0.55` and `0.99` are different claims, where "3 dB above
the floor" and "20 dB above the floor" are the same decision.
