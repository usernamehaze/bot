# Cassie browser extension

This is the browser-extension version of Cassie: highlight text on **any
webpage** — an article, a PDF opened in the browser, a Google Doc — and a
small, clearly-labeled popup shows Cassie's explanation or answer, right
where you selected it.

It's built the same way as the main [Cassie app](../README.md): no backend,
no account, calling the Anthropic API directly using an API key you
provide. It doesn't hide anything, doesn't disguise itself, and doesn't
watch your screen — it only reacts when you deliberately highlight text,
and it always shows up as an obvious "Cassie" popup with a close button and
your browser's normal extension icon in the toolbar.

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
2. Paste in your Anthropic API key (get one at console.anthropic.com) and
   pick a model.
3. Click **Save**.

Your key is stored in the extension's own local storage on your device —
never synced anywhere, never sent anywhere except directly to Anthropic's
API when you highlight something.

## Using it

Highlight a sentence, question, or term on any page. After a brief moment,
a small "Cassie" popup appears near your selection with an explanation and
answer. Click the **×** or press **Escape** to dismiss it; highlighting
something new replaces it.

## Files

- `manifest.json` — extension configuration (Manifest V3).
- `background.js` — service worker that calls the Anthropic API (keeps the
  network request out of the page's own context).
- `content.js` — injected into every page; watches for text selection and
  renders the popup in an isolated Shadow DOM so it can't be styled or
  interfered with by the host page.
- `popup.html` / `popup.js` — the settings screen shown when you click the
  toolbar icon.
