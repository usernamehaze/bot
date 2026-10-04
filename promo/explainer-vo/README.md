# Cassie — full explainer reel with voiceover (~2:10)

`../cassie-explainer-full.mp4` — 1080×1920, 30 fps, H.264 + AAC. Cover: `../cassie-explainer-full-cover.jpg`.

Same format as the 60-second explainer (white screen card on black, glow beneath, Intro · Problem · Features · Try it
chapter bar), now narrated and covering every feature: highlight (explain / answer / code), follow-ups & hints,
snip, board (draw, paste, check my work), PDFs/slides/docs/photos, reviewers you can save, real graphs,
image generation, quiz, research with citations, web sources, talk, memory, focus timer, levels & easy reading,
voice, Student/Professional, your colour, anywhere (extension, PDF side panel, phone), private & free.
The 3D Cassie appears only three times: the logo, the Professional switch, and the end card.

**Voice:** Kokoro-82M (Apache-2.0), voice `af_bella`, generated offline with sherpa-onnx — no cloud TTS.
Each scene lasts as long as its line; visuals are cued to the words (`said(key, word)` in `_scenes.js`).

## Rebuild
```sh
# voiceover → vo/*.wav + timeline.json/js  (needs sherpa-onnx-node + the kokoro-int8-en-v0_19 model; set TTS_DIR)
TTS_DIR=/path/to/tts node vo.cjs
python3 build.py          # assemble reel.js from _*.js
python3 mix.py            # music bed + voice → final_mix.wav
node render.cjs 0 3906 30 frames   # (or 3 chunks in parallel)
./make_video.sh
```
Edit the narration in `script.json`; durations and cue points follow automatically.
