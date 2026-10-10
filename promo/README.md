# Cassie — the 1-minute tour

`cassie-ad-60s.mp4` — 1920×1080, 30 fps, about 60 s. Bella (Cassie's voice) reads the voice-over;
the music is synthesised from sine waves (no licensed music). It plays from "Watch the 1-minute tour"
on the landing page; `landing/tour-poster.jpg` is its poster.

Story: 2 A.M. hook → *Meet Cassie* → highlight a word and she explains it → slides in, reviewer out →
talk with her → Labs → 3D space → the human body in 3D → rocket → World atlas → daily puzzles →
Free · Private · Yours → try it free at askcassie.pages.dev.

Every filmed scene is the real thing, not a mock-up: the landing page's own demos and the real app
(`app.html?lab=…`), driven by a script with a visible cursor. Playwright's fake clock moves time 1/30 s
per frame, so even the 3D scenes come out smooth and identical on every run.

## Rebuild it

`ad3/` holds everything. `script.json` is the source of truth: each scene's voice-over line,
length and caption.

```bash
# serve the site with its real headers on :4700 (any static server; tests/smoke.cjs has one)
node promo/ad3/record.cjs OUT          # films every scene into OUT/<scene>/f_00000.jpg … (slow: ~30 min)
node promo/ad3/record.cjs OUT talk     # …or just one scene again
node promo/ad3/frames.cjs OUT          # the caption frames + window mask
python3 promo/ad3/build.py OUT         # cross-fades, voice-over + music → promo/cassie-ad-60s.mp4
```

The voice-over (`ad3/vo/*.wav`) was made with Kokoro (voice `af_bella`) from the lines in
`script.json`; re-make a line the same way if you change its text. Title cards are
`ad3/titles.html`; the frame around each scene is `ad3/frame.html`.

`build.py` needs numpy and imageio-ffmpeg (`pip install numpy imageio-ffmpeg`), `record.cjs` needs
the Playwright in `tests/` (`cd tests && npm install`).

Older pieces: `source/` is the first animated ad (2025), `reel/`, `explainer/` and `explainer-vo/`
are the earlier reels.

## The logo and the landing page's device screens

- **Logo (`brand/mark.cjs`):** Cursor Cassie herself — the pointer with her two caret eyes — in
  black and white. `node promo/brand/mark.cjs` redraws every app and extension icon
  (`icons/`, `extension/icons/`) and `icons/logo.svg` from that one shape.
- **Laptop & phone screens (`hero/labs.cjs`):** the 3D laptop and phone under the landing page's
  hero show Cassie's Labs. `node promo/hero/labs.cjs` (site served at :4700) takes them again; then
  convert `promo/hero/raw/*.png` to `landing/hero/*.webp` (laptop 1600 wide — the shelf cropped to where
  its cards end — phone 600 wide). `hero/capture.cjs` takes the older chat, Space and Body screens
  (`laptop-space.webp` is still used).
