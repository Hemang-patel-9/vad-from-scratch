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

`vad.onnx` has to have exactly this signature, and the notebook asserts it before
writing anything:

```
in   mel   [batch, n_mels, time]      out  prob   [batch, time]
in   h_in  [1, batch, gru_hidden]     out  h_out  [1, batch, gru_hidden]
```

The time axis being *dynamic* is the part that is easy to lose. `torch.onnx.export`
switched to the torch.export-based exporter in PyTorch 2.9, and that exporter
ignores `dynamic_axes`: the graph it writes accepts only the exact length the
dummy input had, and renames the outputs to graph-internal numbers. Nothing warns
at export time. The backend feeds whole recordings and stream blocks of whatever
size arrived, so such a graph cannot serve a single request.

`vad_frontend.npz` is not a convenience. The notebook builds features with
torchaudio and the backend rebuilds them with numpy, and a mel filterbank
reconstructed from parameters is the classic way for those two to disagree —
torchaudio defaults to HTK-scaled unnormalised filters, librosa to Slaney and
area-normalised. Shipping the array settles it. The notebook asserts the two
front ends agree to 1e-3 before it writes anything.

Set `VAD_MODEL_DIR` to load them from somewhere else instead. `GET
/api/vad/neural/model` reports which directory was used and what the model says
about itself.
