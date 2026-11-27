# Cassie

Cassie is a study companion: a friendly animated cursor that teaches you whatever you are studying, by text
or by voice, and shows it to you: drawings that draw themselves, 3D models you can turn and pull apart,
simulations, games and a board to work on. It runs in the browser and installs on a phone, a tablet or a
computer straight from the website. There is also a browser extension that brings Cassie to any page you read.

## What Cassie does

**Teaching**
- Ask anything, at any level, by typing or by talking. Cassie teaches step by step instead of only handing over
  answers, and can read her answers aloud.
- Study tools: quizzes, flashcards, reviewers and notes from your own files and photos, a study plan, lessons by
  level, a calendar and progress tracking, a focus timer, and research with real, cited sources.
- Cassie remembers what you tell her about yourself (your level, your goals) so her answers fit you; you can see
  and change what she remembers at any time.

**Drawings and 3D, in the chat**
- Ask Cassie to draw, show, build or make something and she asks how to show it: drawn line by line, as a 3D model,
  as a real photo, or just explained. Asking "in 3D" goes straight to a model. Drawings are made in the chat you are
  in.
- **Her own kits come first, before any AI.** Cassie knows hundreds of things by name and builds them herself, flat
  or in 3D, at once and even offline: animals (dinosaurs included), foods, fruits and vegetables, home appliances,
  vehicles, trees, plants and the sky (the sun, the moon, clouds, rain, snow, storms, rainbows). She knows groups
  too: "land animals", "sea animals", "farm animals", "dinosaurs", "insects", "pets", "foods", "vehicles" are scenes
  on an island of their own ground. A drawing book holds checked drawings and models of common school topics (the
  heart, the lungs, the eye, the brain, the skin, the water cycle, photosynthesis, a volcano, a bicycle, a jet
  engine, a refrigerator, habitats and more).
- When she needs an AI for a drawing, any part of its answer that her kits know (a lion in a savanna, a toaster in
  a kitchen) is still drawn with her kit, in its place.
- **Typos never hide a drawing:** "shoe me how the heart works" or "a toastr" is read as meant, while real words
  stay as written.
- **Only means only:** "only show me the heart" is the heart alone, with nothing running round it; "only the
  refrigerator" is the whole, closed refrigerator.
- **Drawn as you watch:** nothing shows before it is drawn. Each part appears in turn (a 3D model grows piece by
  piece from the ground up), and its name and a sentence about it are added to a **Step by step** list under the
  drawing, at a pace you can read.
- **Things move:** blood flows through the heart and it beats, the lungs breathe, light travels through the eye,
  wheels turn, liquids flow.
- **Exploring a model:** drag to turn it; pinch or scroll to zoom right where your fingers or pointer are; two
  fingers move it; a double tap flies in close; tap a part or its name to pick it (with many parts, the view goes in
  close); **Pull apart** separates the parts (a sandwich's layers, a toaster's case); **Hide labels** shows the
  drawing on its own; **Machine view** draws the model as a clean technical illustration.
- A pinch on a drawing zooms the drawing only: on a phone or tablet the rest of the app always holds still.

**Pictures**
- Pictures of real people and characters are never made up: Cassie finds real pictures on the web (an
  encyclopedia's own picture first, then free picture libraries) and says where each one comes from.
- Other pictures she can make for you; they are kept on your device, so they are still there when you come back to
  the chat.

**Labs, games and the board**
- Over seventy interactive labs across physics, chemistry, biology, earth and space science, math and more, with a
  3D human body, 3D cells, a globe atlas and a museum.
- Learning games and daily puzzles.
- A drawing board for working out problems by hand, with graphs, shapes and Cassie's help.

**Accessibility and comfort**
- Light and dark themes, a Lite mode for slow connections and older phones, Reduce Motion respected everywhere,
  large tap targets, readable contrast, and a design that works from a small phone to a wide screen.

## The browser extension

The extension brings Cassie to any page you read on a computer. Highlight words, an equation or a picture and she
explains, answers or draws it right there; snip part of the page and she reads every word, number, symbol,
equation, label and line of code in it first. Press Ctrl twice to ask about the page. Her drawings and 3D models
float beside the page on a board you can move by its top bar and resize from any corner. It only acts when you ask,
and it is meant for reading and homework, not for use during a test. See [extension/README.md](extension/README.md).

## Privacy

Cassie only reacts to what you type, say, highlight or share with her. She does not watch your screen or run in the
background. Your chats stay on your device unless you choose to sign in and sync them.

## Folders

| Folder | What's in it |
|---|---|
| `web/` | The website and the app: every page, script, stylesheet and icon, the drawing kits and book (`livedraw.js`, `drawbook.js`), the labs, the 3D explorer and the landing page. |
| `extension/` | The browser extension. Its `livedraw.js` and `drawbook.js` are copies of the app's (a test checks they match). |
| `server/` | Cassie's server (`worker.src.js`, built into `worker.js` with `cd server && python3 build.py`). |
| `docs/` | Notes and guides: publishing, audits, plans and promotional material. |
| `scripts/` | The site build (`build-site.sh`), helper scripts (`typo-keep.mjs` refreshes the real words the typo reader leaves alone; run it after the kits or the book gain words), the 3D model sources, and the tests (`scripts/tests`). |

## Running it locally

There is no build step for the app: it is plain HTML, CSS and JavaScript. Serve the `web/` folder with any static
file server, for example:

```bash
cd web && python3 -m http.server 8000
```

Then open `http://localhost:8000`. Installing the app and working offline need a real `http://` or `https://`
address (not a file opened from disk).

## Installing

- **On a phone or tablet:** open the site and use the browser's "Add to Home Screen" or "Install app".
- **On a computer:** open the site and use the install button in the address bar or the browser menu. It then opens
  in its own window, like any other app.

## Deploying

Any static host works: point it at the `web/` folder, or run `bash scripts/build-site.sh` and serve `_site`. The build
stamps every `?v=` and the offline cache's name with the commit, so there is nothing to bump by hand.

## Tests

```bash
cd scripts/tests && npm ci && npm test
```

A single test runs with `node smoke.cjs "<part of its name>"`.

## Team

Cassie is made by **haze!** ([@usernamehaze](https://github.com/usernamehaze)) and **Aecoryn**, with the help of Claude Code.
