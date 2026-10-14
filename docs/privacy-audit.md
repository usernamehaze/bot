# Privacy audit (step 1: report only)

Date: 14 October 2026. Branch `cassie-holding` at `a3d2f0d`. Nothing in the code was changed for this report.

Legend: **OK** matches what we want to promise · **FIX** must change before we can promise it · **NOTE** true, but the privacy page has to say it.

---

## 1. Uploads: where each one goes and whether anything keeps it

"Cassie's server" below is the Cloudflare Worker in `server/worker.src.js`. Its storage is one D1 database (`DB`). It has no R2 or KV bindings (`server/wrangler.toml`), and it uses Cloudflare's edge cache in exactly one place (`/speak`, see 1.6).

Every upload takes one of three roads, depending on the student's settings:

| Road | When | Who receives it |
|---|---|---|
| A. Own Groq key | the student pasted a Groq key | straight from the browser to **Groq** (`api.groq.com`) |
| B. Own Gemini key | the student pasted a Gemini key | straight from the browser to **Google Gemini** (`generativelanguage.googleapis.com`) |
| C. No key | the default | the browser sends it to **Cassie's server** `/chat`, which tries **Anthropic Claude** (paid plans only, `worker.src.js:601`), then **Groq**, then **Google Gemini** (the owner's key), then **Cloudflare Workers AI** (`worker.src.js:600-675`) |

### 1.1 Photos (camera, gallery, paste, Android Share)
- Read in the browser into a `data:image/...` URL; sent by road A, B or C as part of the question (`app.js:2188-2214`; server checks the parts in `cleanMessages`, `worker.src.js:322`).
- An Android "Share to Cassie" photo waits in the browser's Cache Storage (`cassie-share`) and is deleted the moment the app reads it (`sw.js:58-75`, `app.js:6817-6822`). **OK**
- Kept on our server: **no**. The server only adds 1 to a daily counter (`chats` table: day, source such as `groq`, count) (`worker.src.js:343`). **OK**
- Kept on the device: the photo is **not** saved in the chat history; the chat keeps only the student's typed text (`app.js:3343-3356`). **OK**

### 1.2 PDF, Word (.docx), PowerPoint (.pptx)
- Read **on the device** with libraries we ship ourselves: pdf.js, mammoth, JSZip in `vendor/` (`app.js:2814-2823`). Only the extracted **text** is sent (roads A, B or C). Scanned PDF pages are turned into page pictures on the device and sent like photos.
- Exception: with the student's **own Gemini key**, the whole PDF file is sent to Google Gemini (`app.js:2465`). **NOTE**
- Kept on our server: **no** (same `/chat` path as photos).
- Kept on the device: the chat keeps the **file name and the first 1,200 characters** of its text so follow-up questions work (`app.js:3345-3349`), in `localStorage` key `cassie.v2`. **NOTE** (device only)
- **FIX: file names can reach our database.** When something fails, the app sends an automatic error report to `/f` with the error message (`reportAuto`, `app.js:3210-3215`), and some file errors include the file name (for example `Couldn’t read ${file.name}`, `app.js:4410`). These rows land in the `feedback` table.
- From the Chrome extension ("Make a reviewer" on a PDF, Google Doc or Slides tab): the extension downloads the file in the browser and hands it to the Cassie web app in a new tab (`extension/background.js:771-900`, `extension/bridge.js`). From there it follows the same roads. **OK**

### 1.3 Voice recordings (Talk with Cassie, the mic button)
Three ways, picked by the device and the student's settings (`app.js:5554-5560`):
- **The browser's own speech recognition** (`SpeechRecognition`). In Chrome the audio goes to **Google**, in Safari to **Apple**. Cassie never sees the audio. **NOTE**
- **Recorded on the device and sent to Groq Whisper**: with the student's own Groq key, straight to Groq (`app.js:5764-5768`); without a key, to Cassie's server `/transcribe`, which sends it to **Groq**, then **Cloudflare Workers AI Whisper** as a backup (`worker.src.js:467-517`).
- Kept on our server: **no**. Only a count (`chats`: `voice`) and a per-IP daily counter (`quota`, see 2.1). If every service fails, the services' error messages go to `feedback` (no audio, no words). **OK**

### 1.4 Board pictures (Ask Cassie about the board, Send to Cassie, Cassie checks the board for everyone)
- The board is turned into a picture on the device and sent like a photo (road A, B or C). **OK**
- In a **study room**, drawings, sticky notes, flashcards, chat messages, quiz answers and notes are stored on our server so everyone in the room sees them (`room_ops`, up to 60,000 characters per step, `worker.src.js:944-958`). A picture **cannot** be put into a room: paste is blocked in a room, and a dropped picture only becomes your own background (`sketch.js:1125-1140`). **OK**
- **FIX: rooms are not reliably deleted after a day.** The clean-up of rooms older than 24 hours only runs when someone creates a new room (`worker.src.js:910-918`). If nobody makes a room, old rooms stay.

### 1.5 "A photo of the answer" (redraws the student's photo with the answer)
- The photo and a written prompt go to Cassie's server `/image`, then to **Google Gemini** picture models (`worker.src.js:711-769`). Without that, the text prompt goes to **Cloudflare Workers AI** (`worker.src.js:770-785`) or to **Pollinations** (`image.pollinations.ai`) straight from the browser. Pollinations gets **text only**, never a photo. **NOTE**
- Kept: **no** (a count only). **OK**

### 1.6 Other things the student sends (not uploads, but they leave the device)
| Feature | Goes to | What |
|---|---|---|
| Research | **OpenAlex** (`api.openalex.org`, `app.js:3777`) | the topic |
| Web answers | **Google Gemini with Google Search** (`app.js:3899`) | the question |
| Studio voice (Bella) | Cassie's server `/speak`, then **ElevenLabs** (`worker.src.js:822-866`) | **Cassie's answer text**. The made audio is kept in Cloudflare's edge cache for up to 30 days (`worker.src.js:864`), so the same sentence isn't paid for twice. **NOTE** |
| Phone voice (Kokoro) | made **on the device**; the model is downloaded once from **Hugging Face** | nothing is sent but the download request |
| World atlas | **Wikipedia** and the **World Bank** | a country or place name |
| Sign in | **Google** or **Apple** | their sign-in, checked by our server |
| iPhone Shortcut `/ask?text=…` | Cassie's server → Groq, then Workers AI | the highlighted text, **in the web address**. Not stored by our code, but if Cloudflare "Workers Logs" is switched on for the worker, web addresses are logged there. **NOTE** (please check the dashboard: Workers → cassie → Settings → Observability) |

### 1.7 Logs
- Our code writes **no** `console.log` anywhere in the server.
- `logProblem` (`worker.src.js:312-321`) writes up to 300 rows a day into `feedback` with the **services' own error messages** (up to 600 characters) and crash stack traces. It never writes the student's message. A service's error message could in rare cases quote part of a request. **NOTE** (step 2 will make sure no upload text can ever reach it)

---

## 2. Data we collect

### 2.1 On Cassie's server (D1 database, `worker.src.js:63-91`)
| Table | Fields | Tied to | How long |
|---|---|---|---|
| `users` | random install ID, first and last day seen, open and use counts, student or working, school level band, age band, phone or computer, language | install ID | forever |
| `events` | time, install ID, event (`open`, `feature`, `signup`), feature name | install ID | forever |
| `words` | day, single topic word, count (adults who left "topic words" on, never from files or photos: `app.js:3373`, `6130-6136`) | nobody | forever |
| `feedback` | time, install ID, kind, feature, typed report text (up to 1,500), broad groups; also automatic error reports (**file names**, see 1.2) and server problems | install ID | forever |
| `quota` | key with the **IP address**, account or install ID, day, count | IP / account / install ID | until a random clean-up (1 in 100 requests) removes old days (`worker.src.js:588`) **NOTE** |
| `chats` | day, which service answered, count | nobody | forever |
| `accounts` | account ID, email, scrambled password and salt, Google ID (old column), first name, `data` (profile, settings, quiz mistakes, up to 500 flashcards, analytics choice: `app.js` `accountData()`), created, updated | account | until deleted |
| `sessions` | scrambled sign-in token, account, created, last seen | account | until sign out or delete |
| `identities` | Google or Apple, their user number, account | account | until delete |
| `plans` | account, plan, end date, owner's note | account | **FIX: not removed when the account is deleted** (`worker.src.js:1277-1279`) |
| `rooms`, `room_members`, `room_ops`, `room_here` | room code, owner install ID, title, first names, everything drawn or written, pointer position | install ID | 24 hours, **FIX** (see 1.4) |
| `scores` | puzzle day, game, install ID, first name, time or score | install ID | 14 days |
| `health` | the owner's last "brain check" result | nobody | overwritten |

Flashcards made from a file are saved to the account like any other card (the student's own study notes, not the file). **NOTE**

There is no way today for someone **without an account** to delete what is tied to their install ID (usage counts, reports, scores). **NOTE** (step 2: say how to ask us)

### 2.2 In the browser
| Where | Key | What |
|---|---|---|
| localStorage | `cassie.v2` | everything in the app: profile, settings, **own API keys**, chats (typed text, file names and the first 1,200 characters of files), flashcards, quiz mistakes, plan |
| localStorage | `cassie.mem.v1` | what Cassie remembers about the student (Memory panel) |
| localStorage | `cassie.aid` | the random install ID |
| localStorage | `cassie.auth` | the sign-in token |
| localStorage | `cassie.labs`, `cassie.labs.ui`, `cassie.labs.view`, `cassie.labs.tutorVoice`, `cassie.logic`, `cassie.bodyMore`, `cassie.geminiModels`, `cassie.humanVoice` | lab progress and small settings |
| sessionStorage | `cassie.claude`, `cassie.pictures`, `cassie.hvLater` | small flags for this visit |
| Cache Storage | the app's own files, `kokoro-voices`, `transformers-cache` (voice model), `cassie-share` (emptied right away) | |
| Extension `chrome.storage.local` | `groqKey`, `geminiKey`, `cassieHistory` (last 60 questions and answers, page address and title, small thumbnails of the last 10 snips), highlight settings | |
| IndexedDB | not used by Cassie's own code | |

---

## 3. Exposure

### 3.1 What `scripts/build-site.sh` publishes to askcassie.pages.dev (`_site/`, 485 files, 62 MB)
Pages: `index.html app.html start.html privacy.html terms.html bot.html`. Scripts: `app.js errors.js board.js bot-page.js cards.js cassie-bot.js cite.js config.js export.js gradient.js listen.js memory.js native.js sketch.js start.js study-room.js sw.js voice.js`, `style.css`, `manifest.json`, `_headers`. Folders: `icons/ landing/ patterns/ explore/ voice/ labs/ vendor/`. Also `promo/cassie-ad-60s.mp4` and `cassie-extension.zip`.

Not published: `server/`, `tests/`, `docs/`, `founder/`, `extension/` source (only the zip), `promo/` sources, `README.md`, `SECURITY.md`, `STORES.md`.

Checked in the build: **no** API keys or secrets (searched for Groq, Google, Anthropic and ElevenLabs key patterns and `ADMIN_TOKEN`), **no** source maps, **no** server code, tests or dashboard.

Published but not needed to run the site:
- `voice/README.md`, `explore/body/README.md` (notes for developers)
- `icons/logo.svg` (nothing uses it)

Published and needed (keep): the licence and credit files (`vendor/licenses/`, `voice/KOKORO-JS-LICENSE.txt`, `explore/THREE-LICENSE.txt`, `explore/body/LICENSES.md`, `explore/body/ATTRIBUTION.md`, `labs/CREDITS.md`, `labs/atlas/LICENSE-*`). The body and globe credits link to them, and the licences require them.

### 3.2 The server
- `/stats`, `/health`, `/admin/plan` all check `ADMIN_TOKEN` (16+ characters, with a limit on wrong guesses): `worker.src.js:438`, `1357`, `1364`, `adminOk` at `1345`. **OK**
- `/` and `/dashboard` serve the dashboard page itself to anyone, but it shows nothing until you type the token. **OK**

### 3.3 GitHub
- **The repository `usernamehaze/bot` is public.** So the server source, tests, `docs/`, `founder/facts.md` and `founder/pricing-strategy.md` can already be read by anyone on github.com. No keys are in it (the same search found none in the whole repo).
- **GitHub Pages is switched on** for this repo: a "pages build and deployment" run follows every push to `claude/brave-tesla-ofygom`. Pages publishes the **whole branch**, so `usernamehaze.github.io/bot/` likely serves everything above, including `server/`, `tests/` and `founder/`, which the Cloudflare build leaves out. I couldn't open either site from here (the network blocks them), so please check in a browser. Turning Pages off (repo Settings → Pages) or making the repo private are your call. I won't change GitHub settings.

---

## 4. Reviews, ratings and numbers

I read every visible word and number on `index.html`, everything in `landing/`, `app.html`, `start.html`, `bot.html` and the extension (`manifest.json`, popup, side panel, README).

- **No testimonials, star ratings, user counts, download counts or quotes from students** anywhere.
- "**29 labs**" (`index.html:272`) is **true**: the Learn shelf has exactly 29 (`labs/labs.js`, 48 in all with 12 games and 7 study tools).
- The phone and desk demos show sample content ("3 reviewers ready", "+12 flashcards", "12-day streak", "Module 6: Ecosystems, 18 pages", "Grade 10, Section Rizal"). These are pictures of what the app does, not claims about users.
- The prices and limits in Pricing and the FAQ are product facts. Whether they match the code is outside this audit.

Nothing to remove here.

---

## 5. What the privacy page says today that isn't true

- "Cassie has no account" and "There is no Cassie account or login" (accounts exist, with Google and Apple sign-in).
- Groq "used for all text answers", Gemini "only for images": the server also uses **Anthropic Claude** (paid plans), **Gemini** for text, and **Workers AI**.
- Doesn't name **ElevenLabs**, **Pollinations**, **OpenAlex**, **Hugging Face**, **Apple**, or the browser's own speech recognition (**Google** in Chrome, **Apple** in Safari).
- "The developer of Cassie never receives, sees, or stores this content": without a key, questions pass through our server (not stored).
- "Rooms … are deleted after a day": only when someone makes a new room (1.4).
- "Thumbs up or down": not in the app any more. Doesn't mention automatic error reports.
- Doesn't mention IP addresses in the daily limits, or that a deleted account leaves a `plans` row.

---

## 6. Proposed step 2 (waiting for your "go")

Code:
1. Keep file names and file text out of automatic error reports (scrub them before `/f`, and have the server accept only known short error codes there).
2. Make server problem logs and transcription errors carry the service name and status only, never the service's own error text.
3. Delete old rooms on a schedule that doesn't depend on someone making a room (on room poll and join too).
4. "Delete my account" also removes the account's `plans` row. **This changes what a table holds (a delete), not the table itself. I'll ask you first.**
5. Build: stop publishing `voice/README.md`, `explore/body/README.md` and `icons/logo.svg` (left in the repo, only left out of `_site`).

Tests:
- Upload a photo, a PDF and a Word file with a unique marker word, get answers (including a failing one), then search **every** database table and the server's problem log for the marker and the file bytes: none found.
- `privacy.html` must name every outside service the code calls (a list kept next to the test, checked against the hosts found in the code), so a new service can't be added without updating the page.

Pages: rewrite `privacy.html` (Grade 6 words, no dashes) and the matching parts of `terms.html`.

Not mine to change (needs you): GitHub Pages and repo visibility, and Cloudflare Workers Logs.
