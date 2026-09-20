# StudyBuddy

A small, offline-first study companion you can install on your phone and your
computer straight from the browser — no app store, no account, no backend.
All your data (flashcards, tasks, notes, focus history) stays on your device
in local storage.

## Features

- **Flashcards** with lightweight spaced repetition (cards you find hard come
  back sooner; cards you know well come back later).
- **Tasks & assignments** with due dates, sorted by what's coming up.
- **Focus timer** (Pomodoro-style: focus sessions + short breaks), with a
  daily focus-minutes counter and a day streak.
- **Notes** per subject, saved automatically as you type.
- Works fully **offline** after the first load, thanks to a service worker.

## Running it locally

No build step or dependencies — it's plain HTML/CSS/JS. Serve the folder
with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

(Opening `index.html` directly via `file://` also mostly works, but the
service worker — and therefore full offline support and "Add to Home
Screen" — requires a real `http://` or `https://` origin.)

## Installing on your phone

1. Host the folder somewhere reachable over HTTPS (GitHub Pages, Netlify,
   Vercel, or any static host all work — see below), or serve it on your
   home network and open that URL on your phone.
2. **Android (Chrome):** open the site, tap the menu (⋮), then **"Add to
   Home screen" / "Install app"**.
3. **iPhone/iPad (Safari):** open the site, tap the **Share** icon, then
   **"Add to Home Screen"**.

It then behaves like a normal app icon and opens full-screen, offline.

## Installing on your computer

1. Open the site in Chrome, Edge, or another Chromium-based browser.
2. Click the **install icon** in the address bar (or the browser menu →
   "Install StudyBuddy…").
3. It opens in its own window from then on, like a native app.

## Deploying for free (so you can install it anywhere)

The simplest option is **GitHub Pages**:

1. Push this repo to GitHub (already done if you're reading this from the
   repo).
2. In the repo settings, enable **Pages**, serving from the branch/folder
   containing these files.
3. Open the published URL on your phone and computer and install it as
   described above.

Any static host (Netlify, Vercel, Cloudflare Pages) works the same way —
just point it at this folder.
