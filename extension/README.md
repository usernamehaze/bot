# Cassie browser extension

This is the browser-extension version of Cassie: highlight text on **any
webpage** — an article, a PDF opened in the browser, a Google Doc — and a
small, clearly-labeled popup shows Cassie's explanation or answer, right
where you selected it.

It's built the same way as the main [Cassie app](../README.md): no backend,
no account, calling Groq's free API directly using a key you provide (Groq's
free tier allows ~30 requests/minute, which comfortably handles highlighting
across your tabs). It doesn't hide anything, doesn't disguise itself, and
doesn't watch your screen — it only reacts when you deliberately highlight
text (or click the floating button), and it always shows up as an obvious
"Cassie" popup with a close button and your browser's normal extension icon
in the toolbar.

**This is meant for reading and homework help, not for use during a test or
quiz** — using it to get instant answers during graded work is exactly the
kind of use this project deliberately doesn't support.

## Platform note

Browser extensions only work on desktop browsers (Chrome, Edge, and other
Chromium-based browsers). They don't work on phones — for a phone, use the
main installable web app instead (see the [root README](../README.md)).

## Installing it (unpacked, for your own use)

This extension isn't published to the Chrome Web Store, so you load it
directly from these files:

1. Open `chrome://extensions` (or `edge://extensions` on Edge).
2. Turn on **Developer mode** (top right toggle).
3. Click **Load unpacked**.
4. Select this `extension/` folder.
5. Cassie's icon appears in your browser toolbar.

## Setting your API key

1. Click the Cassie icon in your toolbar.
2. Paste in your **free** Groq API key — get one with no credit card at
   console.groq.com/keys — and pick a model.
3. Click **Save**.

Your key is stored in the extension's own local storage on your device —
never synced anywhere, never sent anywhere except directly to Groq's API
when you ask something.

## Copying Cassie to your other computers (via Google Drive or USB)

The extension is just a folder of files, so you can carry it between your own
desktops/laptops with Google Drive (or a USB stick). Do this once per computer.

**A. Get just the extension folder (do this once)**

1. On GitHub, download the project ZIP (green **Code** button → **Download
   ZIP**), or download an already-zipped extension file if one is provided.
2. Extract/unzip it on your laptop.
3. Inside, find the **`extension/`** folder — that folder *is* the whole
   extension. You do **not** need the rest of the project (the web app, the
   3D bot source, etc.).
4. Copy the `extension/` folder into your Google Drive (rename it something
   clear like `cassie-extension` so you recognise it).

**B. Put it on another computer**

5. On the other computer, open Google Drive and **download** the
   `cassie-extension` folder to the actual disk — for example into your
   **Documents** folder. *Don't* try to load it while it's still "cloud only"
   in Drive; it must be really downloaded and stay in a permanent spot.
6. Open `chrome://extensions` (or `edge://extensions`).
7. Turn on **Developer mode** (top-right toggle).
8. Click **Load unpacked** and select that downloaded `cassie-extension`
   folder.
9. Cassie's icon appears in the toolbar. Click it and paste your **free Groq
   API key** (you enter the key once on each computer — it doesn't travel with
   the files, on purpose).

**Important notes**

- **Keep the folder where it is.** Chrome keeps pointing at that exact folder,
  so don't delete or move it after loading. If you move it, re-run steps 6–8.
- **Desktop only.** This works on Chrome/Edge/Brave (and some Android
  browsers). It does **not** work on iPhone/iPad — on a phone, just open the
  web app at askcassie.pages.dev instead (no install needed).
- **Updating.** If a newer version comes out, replace the folder's files with
  the new ones, then click the **↻ reload** icon on the extension's card at
  `chrome://extensions`.
- **Work/school laptops** may block Developer mode by policy; if **Load
  unpacked** is greyed out, that's why.

For a true one-click install that auto-updates across all your devices, the
extension would need to be published to the Chrome Web Store (a one-time ~$5
developer fee) — a good step once you're ready to share it more widely.

## Using it

Highlight a sentence, question, or term on any page. Highlighting on its own
is left for copy and paste: only a small **Ask Cassie** button shows beside the
words. Click it (or double-tap **Ctrl**, or right-click → **Explain with
Cassie**) and the "Cassie" popup opens with an **Explain / Answer / Code**
choice. Click the **×** or press **Escape** to dismiss it.

The extension popup's **When I highlight text** setting changes this: the small
button (default), nothing at all (double-tap Ctrl or right-click when you want
her), or the old way, where the popup opens as soon as you highlight.

This highlight → Explain/Answer/Code flow is the **core** of the extension
and always works.

## Experimental HUD add-on (premium — subject to change)

The extension also ships an optional, more advanced "HUD" layer, kept
separate from the core highlight flow. It is **experimental** and intended
as a future **premium** feature, so its behaviour and shortcuts may change:

- A floating, **draggable** panel you can move anywhere on the page.
- A **hotkey** to summon Cassie at your cursor without highlighting first.
- **Side tab**: the page-ask and snip buttons live in a slim tab on the right
  edge (hover or tap to open), so they never cover a site's own Send button.
  Drag it up or down (remembered per site), or tap **Hide here** to turn it off
  on that site — the toolbar popup can show it again.
- **Side panel** (toolbar popup → *Open Cassie side panel*, or **Alt+Shift+C**): sits beside
  any tab — including Chrome's PDF viewer — with **Snip** (picture of the tab, drag over the
  part you want → board + explanation), **Whole file** (reviewer of a PDF / Slides / Doc) and
  **Board**. Highlight text anywhere (PDFs too) → right-click → **Explain with Cassie** /
  **Answer with Cassie**; right-click a picture → **Explain this picture with Cassie**.
- **PDFs, Google Docs and Slides**: Chrome's PDF viewer (and Google's
  canvas-based editors) don't let extensions see highlighted text. On those
  tabs the side tab shows a **page** button that sends the whole file to the
  Cassie app, which reads every page (pictures included) and writes the
  reviewer. "Ask about this page" reads what's on screen instead.
- **Board beside the page**: the side tab has a **board** button, and every snip
  opens straight into the side board — your snip on the canvas, Cassie's
  step-by-step explanation above it, an "Ask Cassie about this snip…" box, and
  **Check my work** / **New snip** buttons. Add a free Google (Gemini) key in the
  toolbar popup for the most reliable picture reading (Groq's picture models are
  tried first-come otherwise).
- **If Chrome's screenshot comes back black** (it does on a few machines): Cassie
  detects it, retries, then asks Chrome for a one-time screen share of the tab
  (choose “This tab” → Share; she takes one picture and stops), and as a last
  resort reads the text / SVG / canvas / images inside your box straight from the page. You can also take your own screenshot (Win+Shift+S, or
  Cmd+Shift+4 on Mac), click the board, and press **Ctrl+V** — or drag an image onto
  it — and she explains that.
- **Snip & explain** (the crosshair button): drag a box around any graph,
  picture, diagram or question like a snipping tool — or just tap one — and
  Cassie reads the picture and explains it step by step. She then asks if you
  want it on **her board**: a sketch board docked beside the page where you
  can write, highlight, draw lines and type on the snip, then tap
  **Check my work** for feedback — no tab switching. Reading pictures uses
  Groq's free vision model on your same key. Snipping needs the extension to
  capture the visible tab, which is why it asks for access to all sites.
- An **emotional mini-bot avatar** in the panel header that reacts as she
  works (curious → thinking → happy).

None of this is required to use Cassie — the highlight popup stands on its
own. Treat the HUD as opt-in polish while it's still being refined.

## Files

- `manifest.json` — extension configuration (Manifest V3).
- `sketch.js` — the drawing board (identical copy of the web app's `sketch.js`).
- `board.js` — draws real graphs/shapes in the popup (identical copy of the web app's `board.js`).
- `panel.html` / `panel.js` — the side panel.
- `vendor/html2canvas.min.js` — MIT-licensed page renderer, loaded only when a snip needs it.
- `bridge.js` — runs only on the Cassie web app; hands it a file from a PDF/Docs tab.
- `background.js` — service worker that calls the Groq API (keeps the
  network request out of the page's own context).
- `content.js` — injected into every page; watches for text selection and
  renders the popup in an isolated Shadow DOM so it can't be styled or
  interfered with by the host page.
- `popup.html` / `popup.js` — the settings screen shown when you click the
  toolbar icon.
