# Cassie's human voice

Cassie's voice is made on the student's own device by **Kokoro-82M**, a small open
text-to-speech model. Nothing is sent to a server, there are no limits, and once the
model has downloaded (about 86 MB, once) she speaks offline too.

| File | What it is | Licence |
|---|---|---|
| `kokoro.web.js` | [kokoro-js](https://www.npmjs.com/package/kokoro-js) 1.2.1, unchanged. It bundles [Transformers.js](https://github.com/huggingface/transformers.js) 3.5.1 (Apache-2.0) and [phonemizer.js](https://github.com/xenova/phonemizer.js) (Apache-2.0, built from espeak-ng) | Apache-2.0 (`KOKORO-JS-LICENSE.txt`) |
| `ort-wasm-simd-threaded.jsep.wasm`, `.mjs` | [ONNX Runtime Web](https://github.com/microsoft/onnxruntime), from the `@huggingface/transformers@3.5.1` npm package, unchanged | MIT |
| `voice-worker.js` | Cassie's code: loads the model and makes one sentence at a time | — |

The model weights and the voice styles are **not** in this folder. The browser downloads
them from Hugging Face, [onnx-community/Kokoro-82M-v1.0-ONNX](https://huggingface.co/onnx-community/Kokoro-82M-v1.0-ONNX)
(Apache-2.0), and keeps them in its cache. Voices: `af_bella` (woman — the voice of Cassie’s explainer video), `am_michael` (man).
