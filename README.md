# Cassie

An animated AI cursor that tutors you through whatever you're studying — by
text or voice. Installable on your phone and your computer straight from
the browser (a Progressive Web App), no app store, no account, no backend
server to run.

## How it works

- Cassie is a little animated cursor character that lives on screen, idles
  near the input box, and "clicks" toward its own answers and toward
  Settings when it needs your attention (e.g. to ask for an API key).
- Ask it anything — any subject, any level — by typing or (on supported
  browsers) tapping the mic button and talking.
- It answers using Anthropic's Claude models, teaching step by step rather
  than just handing over answers.
- Optionally, it can read its answers aloud.

## Bring your own API key

This app is 100% client-side: there's no server, so it calls the Anthropic
API directly from your browser using an API key you provide.

1. Get a key at [console.anthropic.com](https://console.anthropic.com).
2. Open Cassie, tap the gear icon (top right) → Settings.
3. Paste your key in and pick a model (Sonnet 5 for the smartest answers,
   Haiku 4.5 for speed).

Your key is stored only in your browser's `localStorage` on your device. It
is never sent anywhere except directly to Anthropic's API when you ask a
question. If you host this app somewhere public, don't share a URL that has
your key typed into it into anyone else's browser — each browser keeps its
own separate copy, so this is safe by default, but treat the key like a
password.

**Cost note:** Anthropic API usage is billed per token on your own account
(it isn't included with a claude.ai subscription). Check current pricing
before heavy use.

## Running it locally

No build step or dependencies — it's plain HTML/CSS/JS. Serve the folder
with any static file server, for example:

```bash
python3 -m http.server 8000
```

Then open `http://localhost:8000` in your browser.

(Opening `index.html` directly via `file://` mostly works too, but the
service worker — and therefore full offline caching of the app shell, and
"Add to Home Screen" — requires a real `http://` or `https://` origin.
Talking to the Anthropic API always requires an internet connection.)

## Installing on your phone

1. Host the folder somewhere reachable over HTTPS (GitHub Pages, Netlify,
   Vercel, or any static host all work — see below).
2. **Android (Chrome):** open the site, tap the menu (⋮), then **"Add to
   Home screen" / "Install app"**.
3. **iPhone/iPad (Safari):** open the site, tap the **Share** icon, then
   **"Add to Home Screen"**.
   (Voice input via the mic button isn't supported in Safari; typing
   always works. Voice *output* — read-aloud — works everywhere.)

## Installing on your computer

1. Open the site in Chrome, Edge, or another Chromium-based browser.
2. Click the **install icon** in the address bar (or the browser menu →
   "Install Cassie…").
3. It opens in its own window from then on, like a native app.

## Deploying for free

The simplest option is **GitHub Pages**:

1. Push this repo to GitHub.
2. In the repo settings, enable **Pages**, serving from the branch/folder
   containing these files.
3. Open the published URL on your phone and computer and install it as
   described above.

Any static host (Netlify, Vercel, Cloudflare Pages) works the same way —
just point it at this folder.

## Browser extension (desktop only)

There's also a [browser extension](extension/README.md) that brings the
same highlight-to-explain behavior to any webpage, not just Cassie's own
paste box — highlight text on an article, a PDF, a Google Doc, and a
small "Cassie" popup explains it right there. It only works on desktop
Chrome/Edge (browser extensions don't run on phones), and it's meant for
reading and homework help, not for use during a test.

## What Cassie is and isn't

Cassie is inspired by desktop assistants like HeyClicky that place an AI
next to your cursor — but it only "sees" and points within its own chat
window (or, for the browser extension, the page you deliberately
highlighted text on). It doesn't capture your screen, doesn't run
silently in the background, and doesn't require any special OS-level
permissions — everything it does is a direct, visible reaction to text
you selected.
