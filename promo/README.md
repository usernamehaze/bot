# Cassie — 60-second ad

`cassie-ad-60s.mp4` — 1920×1080, 30 fps, with a synthesised soundtrack (no voice-over, no licensed music).

Story: hook → *Meet Cassie* (the loading-screen cursor highlights the word and clicks) → highlight popup →
snip + side board → PDF to reviewer (save as PDF) → real graphs → focus timer + memory → real talk →
Free / Private / Yours → end card. The footnote "not for use during tests or quizzes" is in the ad on purpose.

## Rebuild it

`source/ad.html` + `ad2.js` is a fully seekable animation (everything is a Web Animation on a 60 s timeline).

```bash
cd promo/source
node render.cjs 0 1800 30 frames        # needs Playwright + Chromium; writes frames/ and clicks.json
python3 music.py                        # needs numpy; writes music.wav (clicks are locked to the cursor)
ffmpeg -framerate 30 -i frames/f_%05d.jpg -i music.wav -c:v libx264 -crf 20 -pix_fmt yuv420p \
       -c:a aac -b:a 192k -movflags +faststart -shortest ../cassie-ad-60s.mp4
```

Change the copy, timings or colours in `ad.html` / `ad2.js`, then re-run the three commands.
