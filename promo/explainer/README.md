# Cassie — 60-second explainer reel (Instagram)

`../cassie-explainer-reel.mp4` — 1080×1920, 30 fps, 60 s, H.264 + AAC. Cover: `../cassie-explainer-cover.jpg`.

Format (from the reference reel): a white 16:9 "screen" card on black with a glow spilling out
beneath it, the Cassie mark above, and a chapter bar below — **Intro · Problem · Features · Try it** —
whose active chapter lights up with a moving streak. Words blur in one at a time; scenes cut on the beat.

| Time | Chapter | Scene |
|---|---|---|
| 0–7.2 | Intro | "Every night, there's / something new to learn. / 47 slides. One exam. 2 AM." |
| 7.2–16.8 | Problem | floating study collage → "but it's buried in tabs, PDFs & slides" → S i m p l e on design guides → Cassie logo highlighted + clicked |
| 16.8–50.4 | Features | 01 Highlight anything (monitor zoom, popover) · 02 Snip & sketch (board, Check my work) · 03 PDFs/slides/docs → reviewer file (phone) · 04 Real graphs · 05 Quiz me · 06 Research with real sources · 07 Talk & memory · 08 Focus timer · 09 Student or Professional · 10 Your colour · 11 Anywhere · private · free |
| 50.4–60 | Try it | "Whatever you're studying, / Cassie explains it." (all five Cassies) → "Your new [Cassie] study buddy" · askcassie.pages.dev |

## Rebuild
```sh
cd cassie-3d && npx vite build -c vite.reel.config.js     # 3D stage → promo/reel/build/cassie-stage.js
cd ../promo/explainer
python3 explainer_music.py                                 # → explainer_music.wav
node render.cjs 0 1800 30 frames                           # (or 3 chunks in parallel)
./make_video.sh
```
