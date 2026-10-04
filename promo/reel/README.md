# Cassie — 60-second Instagram reel

`../cassie-reel-60s.mp4` — 1080×1920, 30 fps, H.264 + AAC, 60 s. Cover: `../cassie-reel-cover.jpg`.

| Time | Beat |
|---|---|
| 0–4.8 s | **Hook** — "POV: your study buddy is literally a fluffball" (the word gets highlighted by Cassie's cursor) while Cassie waddles in and waves |
| 4.8–9.6 s | **2 AM** — clock, slides spinning around a dizzy Cassie, "47 slides. exam tomorrow." |
| 9.6–16.8 s | **The drop** — "just highlight it. she explains it." on a phone: highlight → Cassie's popover types the explanation |
| 16.8–31.2 s | **She dresses for the job** — one look per bar with the real app switch/chips lit: Student, Professional, Research, Quiz me, Talk, then "pick your buddy" |
| 31.2–40.8 s | **PDF in, reviewer out** — a 412-page PDF flies in, she thinks, celebrates, the Word file card pops up |
| 40.8–48 s | **Rest** — the heart naps on her pillow while the focus timer runs down to break time |
| 48–55.2 s | **Free & private** — three Cassies parade across: free to start · no account · notes stay on your phone |
| 55.2–60 s | **CTA** — Cassie logo, "Highlight anything. Cassie explains it.", link in bio |

Everything is original: the 3D felt Cassies are rendered from `cassie-3d/src/reel-stage.jsx`
(the app's own `FuzzyCassie`), and the music is synthesised (`reel_music.py`, 100 BPM) — nothing to license.

## Rebuild
```sh
cd cassie-3d && npx vite build -c vite.reel.config.js   # → promo/reel/build/cassie-stage.js
cd ../promo/reel
python3 reel_music.py                                   # → reel_music.wav
node render.cjs 0 1800 30 frames                         # or 3 chunks in parallel: 0 600 / 600 1200 / 1200 1800
./make_video.sh
```
`node render.cjs --stills 3.4,21,47` renders preview stills.

## Suggested caption
> POV: your study buddy is literally a fluffball 🧶
> Highlight anything — Cassie explains it. Reviewers from your PDFs, quizzes, real research, and a focus timer that makes you rest. Free, no account, your notes stay on your phone.
> 🔗 link in bio
>
> #studytok #studygram #studywithme #studytips #reviewer #college #studentlife #ai #studybuddy #philippines
