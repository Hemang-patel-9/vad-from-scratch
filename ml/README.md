# ml

Training for the neural detector. One notebook,
[`vad_dl_kaggle.ipynb`](vad_dl_kaggle.ipynb), written for a free Kaggle GPU
session.

## You do not download anything

This is worth saying first, because it is the usual reason people put off
training something. **No dataset is downloaded to your machine.** Kaggle mounts
its datasets read-only inside the notebook container at `/kaggle/input/`, so
attaching LibriSpeech is a click, not a 6 GB transfer to your laptop. The
notebook scans whatever is mounted and adapts.

The only thing that comes back down is about 9 MB of exported artifacts.

## Datasets to attach

In the Kaggle notebook editor: **Add Input → Datasets**, then paste the slug into
the search box.

| Role | Slug | Size | Needed |
| --- | --- | --- | --- |
| speech | `bacnguyenne/librispeech-train-clean-100` | ~6 GB | **yes** |
| noise | `dogrose/musan-dataset` | ~11 GB | strongly recommended |
| noise | any ESC-50 / UrbanSound8K / AudioSet mirror | ~6 GB | optional |
| rir | `tunguz/bird-big-impulse-response-dataset` | ~1 GB | optional |

Only the first is strictly required. Without a noise corpus the notebook falls
back to synthetic noise and says so, and the resulting model will have a
noticeably worse false alarm rate — false alarms come from noise the model has
never heard, so this is the row that matters most after the first.

Datasets are assigned a role by matching their folder name against a list of
hints. Anything unrecognised is **printed and skipped rather than guessed at**,
because a speech corpus misfiled as noise would silently poison the labels: the
scene builder assumes the noise bed contains no speech when it computes SNR. If
something you attached gets skipped, put it in `MANUAL_ROLES` at the top of the
discovery cell and rerun. MUSAN's own `speech/` folder is excluded for exactly
this reason.

## Session settings

| Setting | Value | Why |
| --- | --- | --- |
| Accelerator | **GPU P100** | T4 x2 also works; only one GPU is used. |
| Internet | **On** | Only for the Silero label cross-check. Off is survivable. |
| Persistence | Files only | So `/kaggle/working` survives between sessions. |

Kaggle's free tier is roughly 30 GPU-hours a week with a 9–12 h session limit.

## What it costs

Roughly 25 minutes packing the corpus into flat shards, then 3–5 hours training.
That fits in one session.

`cfg.time_budget_h` (default 7.5) stops training and runs the export regardless
of where the schedule got to, so a session that turns out slower than expected
still produces a usable model rather than dying at the wall clock with nothing
to show. If it does stop early, rerunning the notebook resumes from
`vad_ckpt.pt` and finishes the schedule.

There is a `SMOKE = False` switch in the config cell. Setting it to `True` runs
the entire pipeline — packing, training, evaluation, export, and all three
parity checks — on a small slice in about 15 minutes. It is worth doing once
before committing to a real run.

## What comes out

Four files land in `/kaggle/working`, downloadable from the notebook's Output
panel. Three of them go in [`backend/models/`](../backend/models/README.md):

| File | What |
| --- | --- |
| `vad.onnx` | The graph. Log-mel and GRU state in, probability and new state out. |
| `vad_frontend.npz` | The analysis window, the mel filterbank, and `mel_mean`. |
| `vad_meta.json` | Frame grid, thresholds, and the validation metrics. |
| `vad_best.pt` | PyTorch weights, for further training. Not needed by the backend. |

Before writing any of them the notebook asserts three things, because each is a
silent failure rather than a crash if it is wrong:

1. The numpy log-mel front end the backend uses reproduces torchaudio's to 1e-3.
2. ONNX Runtime reproduces PyTorch to 1e-3.
3. Feeding the graph in ragged blocks reproduces a whole-file pass to 1e-3.

## Why the artifacts are not in git

`vad.onnx` is several megabytes of binary that changes completely on every
retrain. Committing it would make the history of a repository whose point is the
source substantially less useful. `backend/models/.gitignore` keeps them out.

## Reading

- Jia, Wang & Ginsburg, [*MarbleNet: Deep 1D Time-Channel Separable Convolutional
  Neural Network for Voice Activity Detection*](https://arxiv.org/abs/2010.13886),
  ICASSP 2021 — the architecture.
- Snyder, Chen & Povey, [*MUSAN: A Music, Speech, and Noise
  Corpus*](https://arxiv.org/abs/1510.08484) — the noise corpus.
- Panayotov et al., [*LibriSpeech: An ASR corpus based on public domain audio
  books*](https://www.danielpovey.com/files/2015_icassp_librispeech.pdf),
  ICASSP 2015 — the speech corpus.
- [Silero VAD](https://github.com/snakers4/silero-vad) — used to cross-check
  labels, never as the sole source of truth.
- Chaudhuri et al., [*AVA-Speech: A Densely Labeled Dataset of Speech Activity in
  Movies*](https://www.isca-archive.org/interspeech_2018/chaudhuri18_interspeech.pdf),
  Interspeech 2018 — the real-world benchmark this project has not run yet, and
  the honest counterweight to the synthetic numbers the notebook reports.
