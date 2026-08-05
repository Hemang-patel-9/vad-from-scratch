# models

Where the neural detector looks for its trained artifacts. Empty in a fresh
clone, and the app runs fine that way — `/api/vad/neural` answers 503 and
everything else is untouched.

Train them with [`ml/vad_dl_kaggle.ipynb`](../../ml/vad_dl_kaggle.ipynb) on
Kaggle, download these three from the notebook's Output panel, and drop them
here:

| File | What |
| --- | --- |
| `vad.onnx` | The graph. Log-mel and GRU state in, probability and new state out. |
| `vad_frontend.npz` | The analysis window, the mel filterbank, and `mel_mean`. |
| `vad_meta.json` | Frame grid, thresholds, and the validation metrics. |

`vad_frontend.npz` is not a convenience. The notebook builds features with
torchaudio and the backend rebuilds them with numpy, and a mel filterbank
reconstructed from parameters is the classic way for those two to disagree —
torchaudio defaults to HTK-scaled unnormalised filters, librosa to Slaney and
area-normalised. Shipping the array settles it. The notebook asserts the two
front ends agree to 1e-3 before it writes anything.

Set `VAD_MODEL_DIR` to load them from somewhere else instead. `GET
/api/vad/neural/model` reports which directory was used and what the model says
about itself.
