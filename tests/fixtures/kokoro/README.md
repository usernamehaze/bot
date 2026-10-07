Test stand-in for the Kokoro voice model (tests only — never served by the site).

- `onnx/model_quantized.onnx`: a 433-byte made-up model with Kokoro's inputs and output; it
  makes a tone, not speech. Built with the onnx Python package for the smoke test.
- `config.json`, `tokenizer*.json`: minimal files of the same shape as the real ones.
- `voices/af_heart.bin`, `voices/am_michael.bin`: the real voice styles, from the kokoro-js
  npm package (Apache-2.0).

The real model is onnx-community/Kokoro-82M-v1.0-ONNX on Hugging Face (Apache-2.0).
