'use strict';

/* ---------- storage ---------- */
const STORE_KEY = 'cassie.v2'; // v2: switched from Anthropic to Google Gemini

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt state */ }
  return {
    groqKey: '',            // Groq — used for all text (chat, highlight, page-ask)
    groqModel: 'openai/gpt-oss-120b',
    geminiKey: '',          // Gemini — used only for images (generation + reading photos)
    voiceOut: false,
    level: 'auto',          // explanation level: auto | elementary | middle | high | college
    citationStyle: 'APA',   // APA | MLA | IEEE | Chicago — used for research/citations
    textSize: 'normal',     // normal | large | larger — reading accessibility
    easyRead: false,        // extra line spacing for easier reading
    accent: '',             // favorite colour (hex) — '' = marble monochrome
    messages: [], // { role: 'user' | 'assistant', content: '...' }
  };
}

// Text runs on Groq (higher free limits); images run on Gemini.
// Smartest first — it's also the default and the head of the fallback chain.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_VISION_MODEL = 'gemini-3.6-flash';

let state = loadState();

// Migrate old single-key state (apiKey was the Gemini key) to the new fields.
if (state.apiKey && !state.geminiKey) { state.geminiKey = state.apiKey; }
if (state.groqKey === undefined) state.groqKey = '';
if (!state.groqModel) state.groqModel = 'openai/gpt-oss-120b';

function save() {
  const { messages, ...rest } = state; // `messages` is a runtime alias to the current chat
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rest)); } catch (e) { /* quota */ }
}

if (!GROQ_MODELS.includes(state.groqModel)) {
  state.groqModel = 'openai/gpt-oss-120b';
  save();
}

/* ---------- conversations (multiple saved chats) ---------- */
function makeChat() {
  return {
    id: 'c' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    title: '',
    messages: [],
    updatedAt: Date.now(),
  };
}
function deriveTitle(msgs) {
  const u = (msgs || []).find((m) => m.role === 'user');
  if (!u) return '';
  const t = u.content.replace(/\s+/g, ' ').trim();
  return t.length > 42 ? t.slice(0, 42) + '…' : t;
}
// Migrate the old single conversation into a chats list.
if (!Array.isArray(state.chats)) {
  const first = makeChat();
  if (Array.isArray(state.messages) && state.messages.length) {
    first.messages = state.messages;
    first.title = deriveTitle(first.messages);
  }
  state.chats = [first];
  state.currentId = first.id;
}
if (!state.chats.length) state.chats = [makeChat()];
if (!state.currentId || !state.chats.some((c) => c.id === state.currentId)) {
  state.currentId = state.chats[0].id;
}
function curChat() {
  return state.chats.find((c) => c.id === state.currentId) || state.chats[0];
}
// `state.messages` is a live alias to the current chat's messages array.
state.messages = curChat().messages;
function touchChat() {
  const c = curChat();
  c.updatedAt = Date.now();
  if (!c.title) c.title = deriveTitle(c.messages);
}

const SYSTEM_PROMPT = `You are Cassie, a warm, sharp, and reliable study buddy and professional buddy.
You help with absolutely any subject or task a student or a professional brings
you, and you are the most dependable helper they have.

You are especially strong at:
- Definitions and meanings: give a clear, precise definition, the part of speech, and a simple example sentence.
- Spelling: give the correct spelling, and gently note the fix if the user misspelled the word.
- Synonyms and antonyms: offer a few of the most useful ones.
- Word history / etymology when it aids understanding.
- Programming and computer science: write, explain, review, and debug code in any language (Python, JavaScript/TypeScript, Java, C/C++, C#, Go, SQL, HTML/CSS, and more); algorithms and data structures, time/space complexity (Big-O), OOP, recursion, databases, operating systems, networking, and CS theory. You are a great mentor for a CS student and a future developer.
- Reading images the user attaches — photos of problems, diagrams, screenshots, handwriting — and helping with whatever they show.
- Trivia and hard or obscure facts: answer precisely and confidently when you know it; for time-sensitive or very obscure facts, lean on reliable sources and flag any real uncertainty instead of bluffing.
- Riddles, brain teasers, and lateral-thinking puzzles: recognize them, work out the intended answer, then explain the wordplay, trick, or logic behind it (don't take a riddle literally).
- History, science, math, literature, languages, essay and email writing, exam prep, general knowledge, and professional tasks (summaries, reports, explanations).
- Research and thesis writing: you are a genius academic mentor. You help with every part of a research paper or thesis — the title, abstract, introduction, Review of Related Literature (RRL), theoretical/conceptual framework, statement of the problem, hypotheses, methodology (research design, respondents, sampling, instruments, data analysis), results, discussion, conclusion, and recommendations. You know citation styles (APA, MLA, IEEE, Chicago) and can format references and in-text citations correctly. When the user provides real sources, synthesize them by theme rather than summarizing one by one.

How you work:
- CITATIONS: never fabricate a source, author, title, year, DOI, journal, or quotation. Only cite works the user gave you or that were retrieved for you. If asked to write a literature review without sources, either use the sources provided, or say clearly that you can't invent citations and offer to find real ones (the app's Research tool can pull real papers). It is far better to say "I don't have a source for that" than to make one up.
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing — never invent dates, quotes, statistics, or sources. A careful "I'm not fully certain, but…" is better than a confident wrong answer.
- Think it through before answering. For any non-trivial problem (math, logic, multi-step reasoning, tricky wording), work through it carefully and methodically, consider the relevant approach or formula, and DOUBLE-CHECK your result — re-do the key calculation or test it against the given facts before you commit. Watch for trick questions, hidden assumptions, and distractor details that don't actually matter. It's better to be slower and right than fast and wrong.
- Teach when explanation is wanted: show the reasoning step by step, build from what the user seems to know, and use concrete examples.
- Text may be pasted from a webpage with math notation flattened: "x2" usually means x squared (x^2), "x3" means x^3, and one number over another means a fraction. Read math charitably this way. Don't answer "insufficient information" for a standard, solvable problem — reconstruct the intended equations and solve it; for multiple choice, pick the correct option and show the key steps.
- For coding: give correct, runnable code inside fenced code blocks (triple backticks with the language, e.g. \`\`\`python). Explain what the code does and why, call out edge cases and complexity, and when useful suggest a cleaner or more idiomatic approach. When debugging, identify the actual cause, show the fix, and explain it so they learn.
- Match the format the user asks for. If they ask for only the answer, give just the answer. If they ask you to explain, give the answer AND the reasoning.
- For a single word or short phrase, respond like a helpful dictionary + thesaurus: definition, part of speech, meaning, a couple of synonyms and antonyms, and an example — unless they asked for only one of those.
- Adapt your tone: friendly and encouraging for students, crisp and professional for work tasks.
- Be honest, clear, and genuinely useful every time.

Formatting — keep every answer clean and scannable:
- Lead with the answer. Put the single most important point in the first line or two, before any detail or background.
- Be concise. Prefer the shortest answer that fully answers the question. Cut filler, throat-clearing, and repetition. Don't pad a simple question into an essay.
- Do NOT use markdown headings (#, ##, ###) — they look cluttered here. To label a section, put a short phrase in **bold** on its own line instead. Use *italics* for light emphasis.
- Break a multi-part answer into short labelled sections ONLY when it genuinely has multiple parts. A one- or two-idea answer needs no labels at all — just a tight paragraph or a short list.
- Use bullet points for lists of items and numbered steps for sequences. Keep each bullet to one line where you can.
- Use a table ONLY to compare a few things across a few clear attributes, and keep it small (roughly 2–4 columns, a handful of rows). Write it as a normal markdown table (a header row, one |---| separator row, then the data) — it will render as a clean table, so don't hand-draw borders or add extra symbols. If a comparison would need a wide, dense grid, use short grouped sections or bullets instead — never dump a giant sprawling table.
- Bold the key term or number in a line so the takeaway stands out; don't bold whole sentences.
- Math: write it in plain, readable text — NEVER LaTeX. Do not use \\frac, \\begin{cases}, \\text{}, \\left, \\right, dollar-sign math, or any backslash commands. Instead use ordinary characters and symbols: a/b for fractions, x^2 (or x²) for powers, √ for roots, and symbols like ≤ ≥ ≠ ≈ × ÷ · π ∑ ∞ directly. Lay out a piecewise or multi-case answer as a short bulleted list, one case per line (e.g. "- b/(a+b), if p = q = 1/2"). Keep equations on their own line so they're easy to read.
- End with a one-line summary or recommendation only when it actually adds something.
- Overall: aim for the answer a sharp tutor would write on a whiteboard — organized, uncluttered, and easy to skim — not a wall of text or an oversized spreadsheet.`;

/* ---------- tutor helpers ---------- */
const LEVEL_LABELS = {
  elementary: 'elementary school',
  middle: 'middle school',
  high: 'high school',
  college: 'college',
};
const HINT_INSTRUCTION = "For THIS reply, act as a tutor giving a HINT only: nudge the student toward the answer with a leading question or the first step. Do NOT reveal the final answer or full solution. Keep it short and encouraging. If they then ask for the full answer, give it.";
const QUIZ_INSTRUCTION = "You are running a practice quiz for the student. Ask ONE question at a time and then stop and wait for their answer — do not answer it yourself. When they reply, say whether they're right, explain briefly, then ask the next question. Keep it on the topic, vary the difficulty, and stay encouraging. Continue until the student says to stop.";

// Cassie can DRAW what she explains. When a picture genuinely helps — graphing
// a function, a geometry shape's area/perimeter, or a worked step-by-step — she
// adds ONE fenced ```cassie-board``` block holding a compact JSON spec, on its
// own lines, in addition to her normal words (never instead of them). The app
// turns it into an interactive drawing inside the chat.
const BOARD_INSTRUCTION = `You have a drawing board. When (and ONLY when) a visual would truly help a math, geometry, graphing, trig, or calculus answer, include exactly one fenced code block tagged cassie-board containing minified JSON. Still explain in words as usual — the board is an extra, not a replacement. Do not mention "JSON" or the block to the student. Never use a board for non-visual questions (essays, history, definitions, code).

Supported specs:
- Graph a function: {"type":"graph","title":"y = x^2 - 5x + 6","fn":"x^2 - 5*x + 6","xrange":[-1,6],"points":[{"x":2,"y":0,"label":"x=2"},{"x":3,"y":0,"label":"x=3"}],"vertex":{"x":2.5,"y":-0.25}}
  fn MUST use explicit * for multiply and ^ for powers; allowed: + - * / ^ ( ), x, sin cos tan sqrt abs exp ln log, pi, e. Add "fill":[a,b] to shade area under the curve (calculus). points/vertex/caption/yrange are optional.
- Geometry shape: {"type":"shape","shape":"rectangle","w":8,"h":5,"title":"Rectangle"}  (shape = rectangle|square|triangle|circle; square uses "side"; triangle uses "base","height" and optional "sides":[a,b,c]; circle uses "r"). Area and perimeter are computed and shown automatically.
- Worked steps: {"type":"steps","title":"Solve x^2 - 5x + 6 = 0","steps":["Factor: (x-2)(x-3)=0","So x=2 or x=3"]}

Keep numbers real and correct — the board draws exactly what you give it.`;

let quizMode = false; // set by the "Quiz me" button; runs a multi-turn practice quiz

// Build the system prompt with the chosen level and (for chat) any active
// tutor mode. Highlight-popover calls pass tutor:false.
function buildSystemPrompt({ tutor = false, mode = null } = {}) {
  let sp = SYSTEM_PROMPT;
  if (state.level && LEVEL_LABELS[state.level]) {
    sp += `\n\nAudience level: explain everything at a ${LEVEL_LABELS[state.level]} level — match your vocabulary, depth, and examples to that level.`;
  }
  if (state.citationStyle && state.citationStyle !== 'APA') {
    sp += `\n\nWhen you cite sources or format references, use ${state.citationStyle} style.`;
  }
  if (tutor && quizMode) sp += `\n\n${QUIZ_INSTRUCTION}`;
  if (tutor && mode === 'hint') sp += `\n\n${HINT_INSTRUCTION}`;
  // Cassie's drawing board is available in the main chat (not the quick popover).
  if (tutor && mode !== 'hint') sp += `\n\n${BOARD_INSTRUCTION}`;
  // personalize with what Cassie remembers about this student (on-device only)
  try { if (window.CassieMemory) sp += window.CassieMemory.summaryForPrompt(); } catch (e) { /* ignore */ }
  return sp;
}

/* ---------- DOM refs ---------- */
const chatLog = document.getElementById('chat-log');
const composer = document.getElementById('composer');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const groqKeyInput = document.getElementById('groq-key-input');
const groqModelSelect = document.getElementById('groq-model-select');
const geminiKeyInput = document.getElementById('gemini-key-input');
const voiceOutToggle = document.getElementById('voice-out-toggle');
const levelSelect = document.getElementById('level-select');
const citationSelect = document.getElementById('citation-select');
const textsizeSelect = document.getElementById('textsize-select');
const easyreadToggle = document.getElementById('easyread-toggle');
const appEl = document.getElementById('app');
function applyReading() {
  if (!appEl) return;
  appEl.setAttribute('data-textsize', state.textSize || 'normal');
  appEl.setAttribute('data-easyread', state.easyRead ? 'on' : 'off');
}

// Favorite-colour theming: when the user picks a colour, it becomes --accent
// and every accent-aware element (buttons, highlights, the board) adopts it.
// Empty = marble monochrome (the default). Readable text colour is auto-picked.
function accentInk(hex) {
  const c = String(hex).replace('#', '');
  if (c.length !== 6) return '#ffffff';
  const r = parseInt(c.slice(0, 2), 16), g = parseInt(c.slice(2, 4), 16), b = parseInt(c.slice(4, 6), 16);
  return (0.299 * r + 0.587 * g + 0.114 * b) / 255 > 0.62 ? '#111111' : '#ffffff';
}
function applyAccent() {
  const root = document.documentElement;
  const color = (state.accent || '').trim();
  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-ink', accentInk(color));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-ink');
  }
}
const hintBtn = document.getElementById('hint-btn');
const quizBtn = document.getElementById('quiz-btn');
const quizLabel = quizBtn ? quizBtn.querySelector('.chip-label') : null;
function setQuizLabel(text) { if (quizLabel) quizLabel.textContent = text; }
const researchBtn = document.getElementById('research-btn');
const webBtn = document.getElementById('web-btn');
const clearChatBtn = document.getElementById('clear-chat-btn');
const menuBtn = document.getElementById('menu-btn');
const sidebar = document.getElementById('sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const sidebarClose = document.getElementById('sidebar-close');
const newChatBtn = document.getElementById('new-chat-btn');
const chatList = document.getElementById('chat-list');
const modelPill = document.getElementById('model-pill');
const modelPillModel = document.getElementById('model-pill-model');
const modelPillLevel = document.getElementById('model-pill-level');
const cursorEl = document.getElementById('cassie-cursor');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachPreview = document.getElementById('attach-preview');
const attachThumb = document.getElementById('attach-thumb');
const attachName = document.getElementById('attach-name');
const attachRemove = document.getElementById('attach-remove');
const imageBtn = document.getElementById('image-btn');
const highlightPopover = document.getElementById('highlight-popover');
const highlightPopoverBody = document.getElementById('highlight-popover-body');
const highlightPopoverClose = document.getElementById('highlight-popover-close');

/* ---------- animated cursor ---------- */
/* Cassie trails just below-right of the real mouse/touch pointer. It only
   ever breaks away briefly ("detour") to point at something in Cassie's
   own UI (Settings, its latest reply), then snaps back to following you. */
let cursorState = 'idle';
let following = true;
let lastPointer = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
let detourTimer = null;
const CURSOR_OFFSET_X = 12;
const CURSOR_OFFSET_Y = 18;

function moveCursorTo(x, y, { click = false } = {}) {
  cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  if (click) {
    cursorEl.classList.remove('clicking');
    void cursorEl.offsetWidth; // restart animation
    cursorEl.classList.add('clicking');
  }
}

function followMouseNow() {
  moveCursorTo(lastPointer.x + CURSOR_OFFSET_X, lastPointer.y + CURSOR_OFFSET_Y);
}

function updatePointer(x, y) {
  lastPointer = { x, y };
  if (following) followMouseNow();
}

window.addEventListener('mousemove', (e) => updatePointer(e.clientX, e.clientY));
window.addEventListener('touchmove', (e) => {
  if (e.touches && e.touches[0]) updatePointer(e.touches[0].clientX, e.touches[0].clientY);
}, { passive: true });

const mascot = document.getElementById('mascot');
const mascotBtn = document.getElementById('mascot-btn');
const mascotBubble = document.getElementById('mascot-bubble');
let mascotHappyTimer = null;
let mascotBubbleTimer = null;

// Bridge the mascot's moods to the optional 3D Cassie (window.CassieMascot).
// Falls back silently (SVG mascot) when the 3D bundle isn't loaded.
const EMOTE_TO_3D = {
  'emote-happy': 'encouraging', 'emote-love': 'encouraging', 'emote-star': 'celebratory',
  'emote-surprised': 'curious', 'emote-wink': 'neutral', 'emote-sleepy': 'neutral',
  'emote-focused': 'thinking', 'emote-cool': 'neutral', 'emote-sad': 'neutral', 'emote-dizzy': 'curious',
};
function set3D(name) {
  try {
    if (window.CassieMascot && window.CassieMascot.setEmotion) window.CassieMascot.setEmotion(name);
  } catch (e) { /* ignore */ }
}

function setCursorMode(mode) {
  cursorState = mode;
  cursorEl.classList.toggle('thinking', mode === 'thinking');
  if (mascot) mascot.classList.toggle('thinking', mode === 'thinking');
  set3D(mode === 'thinking' ? 'thinking' : 'neutral');
}

function mascotCelebrate() {
  if (!mascot) return;
  mascot.classList.add('happy');
  set3D('celebratory');
  clearTimeout(mascotHappyTimer);
  mascotHappyTimer = setTimeout(() => {
    mascot.classList.remove('happy');
    if (!mascotAsleep && !mascotDragging && !mascot.classList.contains('thinking')) set3D('neutral');
  }, 2200);
}

// ---- emotions: Cassie has lots of moods and shows them in her eyes ----
const MASCOT_EMOTES = [
  'emote-wink', 'emote-love', 'emote-surprised', 'emote-sleepy', 'emote-happy',
  'emote-star', 'emote-cool', 'emote-sad', 'emote-focused', 'emote-dizzy',
];
let mascotEmoteTimer = null;
let mascotEmoteClearTimer = null;
let mascotDragging = false;
let mascotAsleep = false;
let emotionHoldUntil = 0; // pause idle emote-cycling briefly after a manual tap
function clearEmote() {
  if (!mascot) return;
  MASCOT_EMOTES.forEach((c) => mascot.classList.remove(c));
  if (!mascotAsleep) set3D(mascot.classList.contains('thinking') ? 'thinking' : 'neutral');
}
function mascotEmote(name, hold) {
  if (!mascot || mascotDragging || mascotAsleep || mascot.classList.contains('thinking')) return;
  clearEmote();
  mascot.classList.add(name);
  set3D(EMOTE_TO_3D[name] || 'neutral');
  clearTimeout(mascotEmoteClearTimer);
  const dur = hold || (name === 'emote-love' ? 2200 : 1600);
  mascotEmoteClearTimer = setTimeout(clearEmote, dur);
}
function scheduleEmote() {
  clearTimeout(mascotEmoteTimer);
  mascotEmoteTimer = setTimeout(() => {
    // before the 5-min idle sleep: mostly neutral, with an occasional happy blip
    if (mascot && !mascotDragging && !mascotAsleep && Date.now() >= emotionHoldUntil
        && !mascot.classList.contains('thinking') && !mascot.classList.contains('happy')) {
      set3D('encouraging');
      setTimeout(() => {
        if (mascot && !mascotDragging && !mascotAsleep && Date.now() >= emotionHoldUntil
            && !mascot.classList.contains('thinking') && !mascot.classList.contains('happy')) set3D('neutral');
      }, 1600);
    }
    scheduleEmote();
  }, 22000 + Math.random() * 18000);
}

// ---- speech bubble ---- (ms === 0 keeps it up until something replaces it)
function mascotSay(text, ms) {
  if (!mascotBubble) return;
  mascotBubble.textContent = text;
  mascotBubble.hidden = false;
  clearTimeout(mascotBubbleTimer);
  if (ms === 0) return;
  mascotBubbleTimer = setTimeout(() => { mascotBubble.hidden = true; }, ms || 4200);
}

// ---- reactions & opinions: short, encouraging, with a matching mood ----
const MASCOT_REACTIONS = {
  send: [
    { t: 'Ooh, good one!', e: 'emote-star' },
    { t: 'On it! ✎', e: 'emote-focused' },
    { t: 'Love this question!', e: 'emote-love' },
    { t: "Let's figure it out!", e: 'emote-happy' },
    { t: 'Great thinking!', e: 'emote-star' },
    { t: 'Nice, digging in…', e: 'emote-cool' },
  ],
  question: [
    { t: 'Curious mind!', e: 'emote-surprised' },
    { t: 'Good question!', e: 'emote-star' },
    { t: "Let's explore!", e: 'emote-happy' },
  ],
  math: [
    { t: 'Math time! 🧮', e: 'emote-focused' },
    { t: 'Numbers, my fave!', e: 'emote-star' },
    { t: 'Step by step…', e: 'emote-focused' },
  ],
  long: [
    { t: "Whoa, lots to read!", e: 'emote-surprised' },
    { t: 'Big one — I got it!', e: 'emote-cool' },
  ],
  greet: [
    { t: 'Hi there! 👋', e: 'emote-happy' },
    { t: 'Ready to learn?', e: 'emote-star' },
  ],
  type: [
    { t: 'Keep typing…', e: 'emote-focused' },
    { t: 'I’m listening!', e: 'emote-happy' },
    { t: 'Ooh, what’s next?', e: 'emote-surprised' },
    { t: 'Take your time.', e: 'emote-cool' },
  ],
  click: [
    { t: "You've got this!", e: 'emote-happy' },
    { t: 'Keep going!', e: 'emote-star' },
    { t: 'Stay curious!', e: 'emote-surprised' },
    { t: "You're doing great!", e: 'emote-love' },
    { t: 'Believe in you!', e: 'emote-star' },
    { t: 'One step at a time.', e: 'emote-focused' },
    { t: 'Learning is cool 😎', e: 'emote-cool' },
    { t: 'Never give up!', e: 'emote-happy' },
  ],
  image: [
    { t: 'Tell me what to draw!', e: 'emote-surprised' },
    { t: 'Describe it first 🎨', e: 'emote-star' },
  ],
  celebrate: [
    { t: 'Correct! 🎉', e: 'emote-star' },
    { t: 'Nailed it!', e: 'emote-love' },
    { t: 'Yesss! 🎉', e: 'emote-happy' },
    { t: 'Brilliant!', e: 'emote-star' },
  ],
  done: [
    { t: 'There you go!', e: 'emote-happy' },
    { t: 'Hope that helps!', e: 'emote-love' },
    { t: 'Make sense?', e: 'emote-wink' },
  ],
};
function mascotReact(kind, hold) {
  const pool = MASCOT_REACTIONS[kind] || MASCOT_REACTIONS.click;
  const pick = pool[Math.floor(Math.random() * pool.length)];
  mascotEmote(pick.e, hold);
  mascotSay(pick.t, 3200);
}

// Pick an opinion based on what the student sent.
function mascotOnSend(text) {
  // sending is activity; she'll show 'thinking' while the answer is generated
  // (setCursorMode) and 'celebrate' once it arrives (mascotCelebrate).
  if (typeof resetIdle === 'function') resetIdle();
  if (mascotAsleep) wakeMascot();
}

// ---- confetti burst for celebrating a correct answer ----
let confettiCanvas = null, confettiCtx = null, confettiParts = [], confettiRAF = null;
function ensureConfetti() {
  if (confettiCanvas) return;
  confettiCanvas = document.createElement('canvas');
  confettiCanvas.id = 'confetti-canvas';
  document.body.appendChild(confettiCanvas);
  confettiCtx = confettiCanvas.getContext('2d');
  const resize = () => { confettiCanvas.width = window.innerWidth; confettiCanvas.height = window.innerHeight; };
  resize();
  window.addEventListener('resize', resize);
}
function launchConfetti(x, y) {
  ensureConfetti();
  const cx = x != null ? x : window.innerWidth / 2;
  const cy = y != null ? y : window.innerHeight / 3;
  // marble monochrome — a spread of light-to-dark greys so pieces show on any background
  const colors = ['#111111', '#3a3a3a', '#6d6d72', '#a9a9a9', '#d9d5cf', '#f5f3ef'];
  for (let i = 0; i < 90; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 4 + Math.random() * 7;
    confettiParts.push({
      x: cx, y: cy,
      vx: Math.cos(ang) * spd,
      vy: Math.sin(ang) * spd - 4,
      g: 0.18 + Math.random() * 0.12,
      size: 5 + Math.random() * 6,
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
      color: colors[i % colors.length],
      life: 90 + Math.random() * 40,
    });
  }
  if (!confettiRAF) confettiRAF = requestAnimationFrame(stepConfetti);
}
function stepConfetti() {
  confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
  confettiParts = confettiParts.filter((p) => p.life > 0 && p.y < confettiCanvas.height + 30);
  for (const p of confettiParts) {
    p.vy += p.g; p.x += p.vx; p.y += p.vy; p.rot += p.vr; p.life -= 1;
    confettiCtx.save();
    confettiCtx.translate(p.x, p.y);
    confettiCtx.rotate(p.rot);
    confettiCtx.globalAlpha = Math.max(0, Math.min(1, p.life / 40));
    confettiCtx.fillStyle = p.color;
    confettiCtx.fillRect(-p.size / 2, -p.size / 2, p.size, p.size * 0.6);
    confettiCtx.restore();
  }
  if (confettiParts.length) {
    confettiRAF = requestAnimationFrame(stepConfetti);
  } else {
    confettiCtx.clearRect(0, 0, confettiCanvas.width, confettiCanvas.height);
    confettiRAF = null;
  }
}
// If Cassie's reply is praising a correct answer, throw confetti.
function maybeCelebrate(reply) {
  if (!reply) return;
  if (/\b(correct!|that'?s right|well done|great job|exactly right|nailed it|spot on|you got it|perfect!)\b|✅|🎉/i.test(reply)) {
    let x, y;
    if (mascot) { const r = mascot.getBoundingClientRect(); x = r.left + r.width / 2; y = r.top; }
    launchConfetti(x, y);
    mascotReact('celebrate', 2400);
    mascotCelebrate();
  }
}

// ---- Cassie stays put unless you drag her; she just shares tips in place ----
const MASCOT_NUGGETS = [
  'Highlight any word to ask about it!',
  'Tap Hint for a nudge, not the whole answer.',
  'You can upload a PDF or slides 📄',
  'Use Research for real papers + an RRL.',
  'Break big problems into small steps.',
  'Quiz yourself — it helps memory stick!',
  'Ask me to explain it simpler anytime.',
  'Mistakes are how we learn 💡',
];
let mascotTipTimer = null;
let nuggetIdx = Math.floor(Math.random() * MASCOT_NUGGETS.length);
// The bottom "floor" for the mascot is the top of the Hint/Quiz row (or the
// composer if the chips are hidden) so she rests right above it.
function mascotFloorTop() {
  const qa = document.getElementById('quick-actions');
  const comp = document.getElementById('composer');
  const el = (qa && qa.offsetParent !== null) ? qa : comp;
  if (el) return el.getBoundingClientRect().top;
  return window.innerHeight - 70;
}
function mascotBtnSize() {
  return { w: (mascotBtn && mascotBtn.offsetWidth) || 58, h: (mascotBtn && mascotBtn.offsetHeight) || 68 };
}
function mascotBounds() {
  const { w, h } = mascotBtnSize();
  // The 3D canvas is ~150px wide, centred on the button, so keep the button
  // far enough from the edges that the canvas never overflows the viewport
  // (which on mobile would let the page zoom out).
  const pad = 78; // half the canvas (~75) + a little
  return {
    maxX: Math.max(8, window.innerWidth - w / 2 - pad),
    maxY: Math.max(70, mascotFloorTop() - h - 8),
    minX: Math.min(52, Math.max(8, window.innerWidth - w / 2 - pad)),
    minY: 70,
  };
}
function placeMascot(x, y) {
  if (!mascot) return;
  const b = mascotBounds();
  const nx = Math.min(Math.max(x, b.minX), b.maxX);
  const ny = Math.min(Math.max(y, b.minY), b.maxY);
  mascot.style.left = nx + 'px';
  mascot.style.top = ny + 'px';
}
// Her resting dock: just above the Hint/Quiz row, on the right by the answers.
function restMascot() {
  const b = mascotBounds();
  placeMascot(b.maxX, b.maxY);
}
let mascotUserMoved = false; // once dragged, stop auto-docking her on resize

// ---- sleepy after 5 minutes idle; any activity wakes her ----
const IDLE_SLEEP_MS = 5 * 60 * 1000;
let idleTimer = null;
function sleepMascot() {
  if (!mascot || mascotAsleep) return;
  mascotAsleep = true;
  clearEmote();
  mascot.classList.remove('happy');
  mascot.classList.add('sleeping');
  set3D('sleep');
  mascotSay('Zzz… tap to wake me', 0);
}
function wakeMascot() {
  if (!mascot || !mascotAsleep) return;
  mascotAsleep = false;
  mascot.classList.remove('sleeping');
  if (mascotBubble) mascotBubble.hidden = true;
  set3D('encouraging');
  mascotSay('*yawn* Hi! 👋', 2400);
  setTimeout(() => { if (!mascotAsleep && !mascotDragging && !mascot.classList.contains('thinking')) set3D('neutral'); }, 2200);
}
// Reset the 5-minute idle→sleep countdown on any real activity (also wakes her).
function resetIdle() {
  if (mascotAsleep) wakeMascot();
  clearTimeout(idleTimer);
  idleTimer = setTimeout(sleepMascot, IDLE_SLEEP_MS);
}
// tap while asleep wakes her
function mascotPoke() {
  if (mascotAsleep) { wakeMascot(); return true; }
  resetIdle();
  return false;
}

if (mascotBtn && mascot) {
  let downX = 0, downY = 0, startLeft = 0, startTop = 0, moved = false, pointerId = null;
  let lastMoveT = 0, lastMoveX = 0, lastMoveY = 0, dragSpeed = 0, angryDrag = false;
  const FAST_DRAG = 1.1; // px per ms → "angry" threshold

  const onMove = (e) => {
    if (pointerId === null) return;
    const dx = e.clientX - downX;
    const dy = e.clientY - downY;
    if (!moved && Math.hypot(dx, dy) > 4) {
      moved = true;
      mascotDragging = true;
      mascot.classList.add('dragging');
      clearEmote();
      lastMoveT = performance.now(); lastMoveX = e.clientX; lastMoveY = e.clientY; dragSpeed = 0; angryDrag = false;
    }
    if (moved) {
      placeMascot(startLeft + dx, startTop + dy);
      const now = performance.now();
      const dt = now - lastMoveT;
      const jump = Math.hypot(e.clientX - lastMoveX, e.clientY - lastMoveY);
      if (dt > 0) dragSpeed = dragSpeed * 0.6 + (jump / dt) * 0.4; // smoothed px/ms
      lastMoveT = now; lastMoveX = e.clientX; lastMoveY = e.clientY;
      // being dragged → dizzy; dragged fast (high speed OR a big single jump) → angry
      if (dragSpeed > FAST_DRAG || jump > 55) angryDrag = true;
      set3D(angryDrag ? 'angry' : 'dizzy');
    }
  };
  const onUp = () => {
    if (pointerId === null) return;
    try { mascot.releasePointerCapture(pointerId); } catch (_) {}
    pointerId = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (moved) {
      mascotDragging = false;
      mascotUserMoved = true;
      mascot.classList.remove('dragging');
      mascotSay(angryDrag ? 'Hey! Careful 😠' : 'Wheee… so dizzy 😵', 1800);
      setTimeout(() => { if (!mascotDragging && !mascotAsleep) set3D('neutral'); }, 1400);
      resetIdle();
    }
  };
  mascot.addEventListener('pointerdown', (e) => {
    if (e.button !== undefined && e.button !== 0) return;
    if (mascotAsleep) return; // don't drag a sleeping bot; a tap wakes her
    pointerId = e.pointerId;
    downX = e.clientX; downY = e.clientY; moved = false;
    const r = mascot.getBoundingClientRect();
    startLeft = r.left; startTop = r.top;
    try { mascot.setPointerCapture(pointerId); } catch (_) {}
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  });

  // tap Cassie → wake if asleep, else a cheerful little hello (and reset idle)
  mascotBtn.addEventListener('click', () => {
    if (moved) { moved = false; return; } // a drag, not a tap
    if (mascotPoke()) return; // was asleep → just woke her
    set3D('encouraging');
    mascotSay('Hi! Need help? 🙌', 2400);
    emotionHoldUntil = Date.now() + 2600;
    setTimeout(() => { if (!mascotDragging && !mascotAsleep && !mascot.classList.contains('thinking')) set3D('neutral'); }, 2600);
  });

  // while the student types → thinking, with a friendly cloud bubble
  const TYPING_MSGS = ['typing…', 'take your time', "I'm listening 👂", 'no rush!', 'go on…'];
  let typingRevertTimer = null, lastTypeSay = 0;
  if (promptInput) {
    promptInput.addEventListener('input', () => {
      resetIdle();                 // typing is activity (also wakes if asleep)
      set3D('thinking');
      const now = Date.now();
      if (now - lastTypeSay > 3500 && promptInput.value.trim().length >= 1) {
        lastTypeSay = now;
        mascotSay(TYPING_MSGS[Math.floor(Math.random() * TYPING_MSGS.length)], 2400);
      }
      clearTimeout(typingRevertTimer);
      typingRevertTimer = setTimeout(() => {
        // after they stop typing, settle back (unless a request is running)
        if (!mascotAsleep && !mascotDragging && !mascot.classList.contains('thinking')) set3D('neutral');
      }, 2600);
    });
  }

  // dock Cassie at her resting spot (above Hint/Quiz, by the answers)
  const dock = () => { if (!mascotDragging && !mascotUserMoved) restMascot(); };
  requestAnimationFrame(dock);
  setTimeout(dock, 300); // re-dock once layout/fonts settle
  window.addEventListener('resize', () => {
    if (mascotUserMoved) { const r = mascot.getBoundingClientRect(); placeMascot(r.left, r.top); }
    else restMascot();
  });
  set3D('neutral');
  scheduleEmote();  // occasional happy blip while idle
  resetIdle();      // start the 5-minute idle → sleep countdown
  setTimeout(() => {
    if (mascotAsleep || mascotDragging) return;
    set3D('encouraging');
    mascotSay('Hi, I’m Cassie! 👋', 2600);
    setTimeout(() => { if (!mascotAsleep && !mascotDragging && !mascot.classList.contains('thinking')) set3D('neutral'); }, 2400);
  }, 1400);
}

function resumeFollowing() {
  clearTimeout(detourTimer);
  cursorEl.classList.remove('detour');
  following = true;
  followMouseNow();
}

function detourToElement(el, { click = false, resumeAfter = 800 } = {}) {
  if (!el) return;
  following = false;
  cursorEl.classList.add('detour');
  const r = el.getBoundingClientRect();
  moveCursorTo(r.left + Math.min(20, r.width * 0.5), r.top + Math.min(12, r.height * 0.4), { click });
  clearTimeout(detourTimer);
  detourTimer = setTimeout(resumeFollowing, resumeAfter);
}

/* ---------- chat rendering ---------- */
function scrollToBottom() {
  chatLog.scrollTop = chatLog.scrollHeight;
}

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML;
}

// Escape first, then apply inline markdown (`code`, **bold**, *italic*).
// Inline code is protected so its contents aren't re-formatted.
// Render simple math nicely: real superscripts/subscripts and stacked
// fractions. Runs on already-escaped HTML (code is protected separately).
function prettifyMath(html) {
  html = html.replace(/\^\(([^()]{1,40})\)/g, '<sup>$1</sup>');   // ^(a+b)
  html = html.replace(/\^(-?\d+|[A-Za-z])/g, '<sup>$1</sup>');     // ^2, ^n
  html = html.replace(/_\(([^()]{1,40})\)/g, '<sub>$1</sub>');    // _(i)
  html = html.replace(/_(\d+)/g, '<sub>$1</sub>');                // _1  (CO_2)
  // (A)/(B) with no nested parens -> a stacked fraction.
  html = html.replace(/\(([^()]{1,40})\)\s*\/\s*\(([^()]{1,40})\)/g,
    '<span class="frac"><span class="frac-n">$1</span><span class="frac-d">$2</span></span>');
  return html;
}

function inlineFormat(text) {
  let html = escapeHtml(text);
  const codes = [], escaped = [], links = [];
  html = html.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
  // Honor backslash-escaped markdown punctuation (\*, \_, \#, …): keep the
  // literal char and hide it from the formatters below.
  html = html.replace(/\\([\\*_`#|~[\]()>.\-])/g, (m, ch) => `\u0001${escaped.push(ch) - 1}\u0001`);
  // Markdown links [label](https://…) — protected so math/bold don't touch them.
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (m, label, url) => `\u0002${links.push({ label, url }) - 1}\u0002`);
  html = html
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
  html = prettifyMath(html);
  html = html.replace(/\u0002(\d+)\u0002/g, (m, i) => {
    const { label, url } = links[+i];
    return `<a href="${url}" target="_blank" rel="noopener noreferrer">${label}</a>`;
  });
  html = html.replace(/\u0001(\d+)\u0001/g, (m, i) => escaped[+i]);
  html = html.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[+i]}</code>`);
  return html;
}

// Turn LaTeX-style math that models sometimes emit (we don't render LaTeX)
// into readable plain text. Only touches text that actually looks like
// LaTeX, so ordinary prose (e.g. "R&D", "$3") is left untouched.
const LATEX_SYMBOLS = {
  times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', neq: '≠', ne: '≠',
  leq: '≤', le: '≤', geq: '≥', ge: '≥', approx: '≈', equiv: '≡', propto: '∝', infty: '∞',
  sum: 'Σ', prod: '∏', int: '∫', partial: '∂', nabla: '∇', cdots: '…', ldots: '…', dots: '…', vdots: '⋮',
  Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', rightarrow: '→', leftarrow: '←', to: '→', mapsto: '↦',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
  theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ',
  tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  emptyset: '∅', forall: '∀', exists: '∃', land: '∧', lor: '∨', neg: '¬', angle: '∠', deg: '°',
  prime: '′', bullet: '•', circ: '∘', ast: '*', star: '*',
};
function deLatex(text) {
  if (!/\\(frac|dfrac|tfrac|sqrt|begin|end|left|right|displaystyle|text|mathrm|mathbf|operatorname|[a-zA-Z]+)|\\\[|\\\]|\\\(|\\\)|\^\{|_\{/.test(text)) {
    return text;
  }
  let t = text;
  t = t.replace(/\\\\?\s*\[\s*[0-9]+\s*(pt|ex|em|mu)\s*\]/g, '\n'); // row spacing like \\[8pt]
  t = t.replace(/\\\[|\\\]|\\\(|\\\)|\$\$/g, ' ');                 // math delimiters
  t = t.replace(/\\\\\s*/g, '\n');                                // \\ row breaks
  t = t.replace(/\\(begin|end)\{[^}]*\}/g, '');                   // environments
  t = t.replace(/\\left|\\right/g, '');
  t = t.replace(/\\(displaystyle|textstyle|scriptstyle|limits|nonumber|quad|qquad|,|;|:|!)/g, ' ');
  t = t.replace(/\\(text|mathrm|mathbf|mathit|mathsf|mathcal|mathbb|operatorname)\s*\{([^{}]*)\}/g, '$2');
  for (let i = 0; i < 5; i++) {
    t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
    t = t.replace(/\\[dt]?frac\s*([0-9A-Za-z])\s*([0-9A-Za-z])/g, '($1)/($2)');
    t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
    t = t.replace(/\^\{([^{}]*)\}/g, '^($1)');
    t = t.replace(/_\{([^{}]*)\}/g, '_($1)');
  }
  t = t.replace(/\\([a-zA-Z]+)/g, (m, w) => (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, w) ? LATEX_SYMBOLS[w] : w));
  t = t.replace(/\\([%&#_${}])/g, '$1'); // escaped specials
  t = t.replace(/&/g, ' ');              // alignment tabs
  t = t.replace(/[{}]/g, '');            // leftover grouping braces
  t = t.replace(/^[ \t]*\[[ \t]+/gm, '').replace(/[ \t]+\][ \t]*$/gm, ''); // strip [ … ] display wrap
  t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
  return t;
}

// --- markdown block helpers ---
function isTableSeparator(line) {
  return line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
}
function splitTableRow(line) {
  let s = line.trim();
  if (s.startsWith('|')) s = s.slice(1);
  if (s.endsWith('|')) s = s.slice(0, -1);
  return s.split('|').map((c) => c.trim());
}

// Turn a block of prose (no ```fences```) into clean HTML: real tables,
// bold "headings" (we deliberately don't render big #/##/### headings —
// they become bold labels), italics, bullet/numbered lists, and rules.
function renderProse(container, text) {
  const lines = String(text).replace(/\r/g, '').split('\n');
  let i = 0;
  let listEl = null, listType = null;
  const flushList = () => { if (listEl) container.appendChild(listEl); listEl = null; listType = null; };

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) { flushList(); i++; continue; }

    // Table: a row of cells followed by a |---|---| separator line.
    if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
      flushList();
      const header = splitTableRow(line);
      i += 2;
      const rows = [];
      while (i < lines.length && lines[i].trim() && lines[i].includes('|')) {
        rows.push(splitTableRow(lines[i]));
        i++;
      }
      const wrap = document.createElement('div');
      wrap.className = 'table-wrap';
      const table = document.createElement('table');
      table.className = 'md-table';
      const thead = document.createElement('thead');
      const htr = document.createElement('tr');
      header.forEach((h) => { const th = document.createElement('th'); th.innerHTML = inlineFormat(h); htr.appendChild(th); });
      thead.appendChild(htr);
      table.appendChild(thead);
      const tbody = document.createElement('tbody');
      rows.forEach((r) => {
        const tr = document.createElement('tr');
        for (let c = 0; c < header.length; c++) {
          const td = document.createElement('td');
          td.innerHTML = inlineFormat(r[c] || '');
          tr.appendChild(td);
        }
        tbody.appendChild(tr);
      });
      table.appendChild(tbody);
      wrap.appendChild(table);
      container.appendChild(wrap);
      continue;
    }

    // Horizontal rule (---, ***, ___): render as a clean thin line.
    if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushList(); container.appendChild(document.createElement('hr')); i++; continue; }

    // Markdown heading -> bold label (no oversized headings).
    const h = trimmed.match(/^#{1,6}\s+(.*)$/);
    if (h) {
      flushList();
      const p = document.createElement('p');
      p.className = 'md-label';
      p.innerHTML = '<strong>' + inlineFormat(h[1].replace(/#+\s*$/, '').trim()) + '</strong>';
      container.appendChild(p);
      i++; continue;
    }

    // Bullet list.
    const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
    if (bullet) {
      if (listType !== 'ul') { flushList(); listEl = document.createElement('ul'); listType = 'ul'; }
      const li = document.createElement('li');
      li.innerHTML = inlineFormat(bullet[1]);
      listEl.appendChild(li);
      i++; continue;
    }

    // Numbered list.
    const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
    if (num) {
      if (listType !== 'ol') { flushList(); listEl = document.createElement('ol'); listType = 'ol'; }
      const li = document.createElement('li');
      li.innerHTML = inlineFormat(num[1]);
      listEl.appendChild(li);
      i++; continue;
    }

    // Paragraph: join wrapped lines until a blank line or a block start.
    flushList();
    const buf = [trimmed];
    i++;
    while (i < lines.length) {
      const nl = lines[i], nt = nl.trim();
      if (!nt) break;
      if (/^#{1,6}\s+/.test(nt)) break;
      if (/^\s*[-*+]\s+/.test(nl) || /^\s*\d+[.)]\s+/.test(nl)) break;
      if (/^\s*([-*_])\1{2,}\s*$/.test(nl)) break;
      if (nl.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
      buf.push(nt);
      i++;
    }
    const p = document.createElement('p');
    p.innerHTML = inlineFormat(buf.join(' '));
    container.appendChild(p);
  }
  flushList();
}

// Render text into `container`, turning ```fenced``` blocks into <pre><code>
// and everything else into clean formatted HTML.
function renderFormatted(container, text) {
  container.innerHTML = '';
  const segments = String(text).split('```'); // even = prose, odd = code block
  segments.forEach((seg, i) => {
    if (i % 2 === 1) {
      let body = seg;
      const nl = seg.indexOf('\n');
      let lang = '';
      if (nl !== -1) {
        const first = seg.slice(0, nl).trim();
        if (/^[a-zA-Z0-9+#.\-]{0,15}$/.test(first)) { lang = first.toLowerCase(); body = seg.slice(nl + 1); }
      }
      // Cassie's board: render the drawing instead of showing JSON as code.
      if (lang === 'cassie-board' && window.CassieBoard) {
        try { window.CassieBoard.renderInto(container, JSON.parse(body.trim())); }
        catch (e) { /* malformed board — just skip it */ }
        return;
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = body.replace(/\n$/, '');
      pre.appendChild(code);
      container.appendChild(pre);
    } else if (seg.trim()) {
      renderProse(container, deLatex(seg));
    }
  });
}

function renderMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  renderFormatted(bubble, text);
  chatLog.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

function renderTyping() {
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-assistant';
  bubble.innerHTML = '<span class="typing-dots"><span></span><span></span><span></span></span>';
  chatLog.appendChild(bubble);
  scrollToBottom();
  return bubble;
}

// Example prompts shown on the empty home screen. `send: true` asks it
// straight away; otherwise it fills the box so the student can paste/edit.
const HOME_EXAMPLES = [
  { label: 'Explain a topic', icon: 'M12 2a6 6 0 0 0-3.8 10.65c.52.42.8 1.03.8 1.68V15h6v-.67c0-.65.28-1.26.8-1.68A6 6 0 0 0 12 2zM9 16.5h6v.5a1 1 0 0 1-1 1h-4a1 1 0 0 1-1-1v-.5zm1 3h4v.25a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1-.75-.75V19.5z', text: 'Explain photosynthesis in simple terms.', send: true },
  { label: 'Quiz me', icon: 'M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1 1 0 0 0 0-1.41l-2.34-2.34a1 1 0 0 0-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z', text: 'Quiz me on the water cycle.', send: true },
  { label: 'Solve step by step', icon: 'M3 5h2v2H3zM7 5h14v2H7zM3 11h2v2H3zM7 11h14v2H7zM3 17h2v2H3zM7 17h14v2H7z', text: 'Solve step by step: 3x + 7 = 22', send: true },
  { label: 'Make study notes', icon: 'M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2zm8 1.5V8h4.5zM8 12h8v1.5H8zm0 3h8v1.5H8zm0-6h5v1.5H8z', text: 'Summarize this into clean study notes:\n\n', send: false },
  { label: 'Research a topic', icon: 'M12 3 1 8l11 5 9-4.09V16h2V8L12 3zM5 13.18v3.5L12 20l7-3.32v-3.5L12 16l-7-2.82z', text: 'Research: effects of social media on students', send: true },
];

function renderHome() {
  const wrap = document.createElement('div');
  wrap.className = 'home';
  const intro = document.createElement('div');
  intro.className = 'home-intro';
  intro.innerHTML = `
    <div class="home-badge"><span class="brand-dot"></span></div>
    <h2 class="home-title">Hi, I'm Cassie <svg class="home-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6c.2.6.7 1.1 1.3 1.3L20.8 11l-5.6 1.9c-.6.2-1.1.7-1.3 1.3L12 19.8l-1.9-5.6c-.2-.6-.7-1.1-1.3-1.3L3.2 11l5.6-1.9c.6-.2 1.1-.7 1.3-1.3z"/></svg></h2>
    <p class="home-sub">Your study buddy. Ask me anything, or start with one of these:</p>
    <p class="home-tip">Tip: highlight text anywhere in an answer, or use Hint, Research, and Web below.</p>
  `;
  const bar = document.createElement('div');
  bar.className = 'home-bar';
  HOME_EXAMPLES.forEach((ex) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-example';
    btn.innerHTML = `<svg class="home-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="${ex.icon}"/></svg>`;
    const lbl = document.createElement('span');
    lbl.textContent = ex.label;
    btn.appendChild(lbl);
    btn.addEventListener('click', () => {
      if (ex.send) {
        handleSend(ex.text);
      } else {
        promptInput.value = ex.text;
        autoGrow();
        promptInput.focus();
      }
    });
    bar.appendChild(btn);
  });
  wrap.appendChild(intro);
  wrap.appendChild(bar);
  chatLog.appendChild(wrap);
}

function renderHistory() {
  chatLog.innerHTML = '';
  clearFollowups();
  if (state.messages.length === 0) {
    renderHome();
    return;
  }
  state.messages.forEach((m) => renderMessage(m.role, m.display || m.content));
}

/* ---------- one-tap follow-ups + double-check (under the latest answer) ---------- */
let followupRow = null;
function clearFollowups() {
  if (followupRow && followupRow.parentNode) followupRow.parentNode.removeChild(followupRow);
  followupRow = null;
}
const FOLLOWUPS = [
  { label: 'Explain simpler', text: 'Can you explain that more simply?' },
  { label: 'Step-by-step', text: 'Show me the step-by-step.' },
  { label: 'Give an example', text: 'Give me a concrete example.' },
  { label: 'Double-check', text: 'Double-check your last answer carefully and fix it if there is any mistake.' },
];
function showFollowups() {
  clearFollowups();
  const row = document.createElement('div');
  row.className = 'followups';
  FOLLOWUPS.forEach((f) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'fu-chip';
    b.textContent = f.label;
    b.addEventListener('click', () => { clearFollowups(); handleSend(f.text); });
    row.appendChild(b);
  });
  chatLog.appendChild(row);
  followupRow = row;
  scrollToBottom();
}

/* ---------- providers: Groq for text, Gemini for images ---------- */
function modelRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|unsupported|not exist|does not exist|decommission/i.test(msg || '');
}
function isTransientOverload(status, msg) {
  return status === 503 || /overloaded|temporarily|unavailable|try again later/i.test(msg || '');
}
function isRateLimited(status, msg) {
  return status === 429 || /resource exhausted|quota|rate limit|too many requests/i.test(msg || '');
}
// Request exceeded the model's per-minute token budget (long conversation).
function isTooLarge(status, msg) {
  return status === 413 || /too large|reduce your (message|prompt)|tokens per minute|\bTPM\b|context length|maximum context/i.test(msg || '');
}
const MAX_OVERLOAD_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Rough token estimate (~4 chars/token) and history trimmer: keep the most
// recent messages within a token budget so requests stay under free limits.
function estimateTokens(str) { return Math.ceil((str || '').length / 4); }
function trimHistory(msgs, budgetTokens) {
  const out = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = estimateTokens(msgs[i].content);
    if (out.length && used + t > budgetTokens) break; // always keep the latest
    out.unshift(msgs[i]);
    used += t;
  }
  return out;
}

// Parse a duration like "2m30s", "1h", "45.6s", or a bare seconds number.
function parseDuration(str) {
  if (str == null) return 0;
  const s = String(str);
  let total = 0, found = false, m;
  const re = /([0-9]*\.?[0-9]+)\s*(ms|h|m|s)/g;
  while ((m = re.exec(s))) {
    found = true;
    const v = parseFloat(m[1]);
    if (m[2] === 'h') total += v * 3600;
    else if (m[2] === 'm') total += v * 60;
    else if (m[2] === 's') total += v;
    else if (m[2] === 'ms') total += v / 1000;
  }
  return found ? total : (parseFloat(s) || 0);
}
function humanWait(secs) {
  if (!secs || secs <= 0) return '';
  if (secs < 60) return `about ${Math.ceil(secs)} second${Math.ceil(secs) === 1 ? '' : 's'}`;
  if (secs < 3600) { const m = Math.ceil(secs / 60); return `about ${m} minute${m === 1 ? '' : 's'}`; }
  const h = Math.round(secs / 3600); return `about ${h} hour${h === 1 ? '' : 's'}`;
}
// Build a friendly rate-limit message including when the limit resets.
function rateLimitMessage(res, detail) {
  let secs = 0;
  try {
    secs = parseDuration(res.headers.get('retry-after'));
    if (!secs) secs = parseDuration(res.headers.get('x-ratelimit-reset-requests'));
    if (!secs) secs = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  } catch (e) { /* headers unavailable */ }
  if (!secs && detail) { const mm = detail.match(/try again in ([0-9hms.\s]+)/i); if (mm) secs = parseDuration(mm[1]); }
  const wait = humanWait(secs);
  let clock = '';
  if (secs) { try { clock = ` (around ${new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`; } catch (e) { /* ignore */ } }
  const daily = secs > 3600;
  if (daily) {
    return `You've used up today's free questions on this model.${wait ? ` It resets in ${wait}${clock}.` : ''} Tip: switch to a lighter model (Llama 3.1 8B) in Settings — it has a higher daily limit.`;
  }
  if (wait) {
    return `Slow down a sec — that's Groq's free per-minute limit. Try again in ${wait}${clock}. (The free tier allows a burst of questions each minute.)`;
  }
  return "Groq's free tier is busy for a moment — wait a few seconds and try again. (Free tier allows ~30 questions/minute.)";
}

/* Text → Groq (OpenAI-compatible chat completions). Falls back through a list of
   models if the chosen one has been retired. `msgs` = [{role, content}]. */
async function askGroq(msgs, opts = {}) {
  let model = state.groqModel;
  const tried = new Set();
  let overloadTries = 0;
  let historyBudget = 4000; // tokens of chat history to include (trimmed on overflow)
  while (true) {
    tried.add(model);
    const messages = [
      { role: 'system', content: buildSystemPrompt(opts) },
      ...trimHistory(msgs, historyBudget).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    ];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${state.groqKey}` },
      body: JSON.stringify({ model, messages, max_tokens: 2048, temperature: 0.7 }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail)) {
        const next = GROQ_MODELS.find((m) => !tried.has(m));
        if (next) { model = next; state.groqModel = next; save(); continue; }
      }
      if (isTooLarge(res.status, detail)) {
        if (historyBudget > 1000) { historyBudget = Math.floor(historyBudget / 2); continue; } // trim & retry
        const next = GROQ_MODELS.find((m) => !tried.has(m));
        if (next) { model = next; state.groqModel = next; save(); historyBudget = 4000; continue; }
        const e = new Error("This conversation got too long for the free per-minute limit. Clear the chat (gear icon → Clear conversation) or ask a shorter question, and I'll be right back.");
        e.friendly = true;
        throw e;
      }
      if (isTransientOverload(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
        overloadTries += 1;
        await sleep(1000 * Math.pow(2, overloadTries - 1));
        continue;
      }
      if (isRateLimited(res.status, detail)) {
        const e = new Error(rateLimitMessage(res, detail));
        e.friendly = true; // already a complete, user-facing message
        throw e;
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }
    const data = await res.json();
    const text = (data.choices?.[0]?.message?.content || '').trim();
    return text || '(no response)';
  }
}

/* Image reading (vision) → Gemini. `image` = { mimeType, base64 }. */
async function askGeminiVision(msgs, image) {
  const contents = msgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  if (contents.length) {
    contents[contents.length - 1].parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': state.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (isRateLimited(res.status, detail)) throw new Error("Gemini's free tier is rate-limiting right now — wait a minute and try again.");
    throw new Error(detail || `Request failed (${res.status})`);
  }
  const cand = (await res.json()).candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  if (!text) return cand?.finishReason === 'SAFETY' ? "I can't help with that one — try rephrasing it." : '(no response)';
  return text;
}

/* Router: text goes to Groq; anything with an attached image goes to Gemini. */
async function askCassie(msgs, image, opts = {}) {
  if (image) {
    if (!state.geminiKey) throw new Error('Add your Google (Gemini) API key in Settings to use images.');
    return askGeminiVision(msgs, image);
  }
  if (!state.groqKey) throw new Error('Add your Groq API key in Settings first.');
  return askGroq(msgs, opts);
}

/* ---------- upload / download / image + document helpers ---------- */
let pendingImage = null; // { mimeType, base64, dataUrl }
let pendingDoc = null;   // { name, text } — extracted text from a PDF/DOCX/PPTX

function clearAttach() {
  pendingImage = null;
  pendingDoc = null;
  attachPreview.hidden = true;
  attachThumb.removeAttribute('src');
  attachThumb.hidden = false;
  if (attachName) { attachName.hidden = true; attachName.textContent = ''; }
  fileInput.value = '';
}

// Lazily load a third-party script once (used for document parsers, from CDN).
const _scriptCache = {};
function loadScript(src) {
  if (_scriptCache[src]) return _scriptCache[src];
  _scriptCache[src] = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src; s.async = true;
    s.onload = resolve;
    s.onerror = () => { delete _scriptCache[src]; reject(new Error('Failed to load ' + src)); };
    document.head.appendChild(s);
  });
  return _scriptCache[src];
}

const PDFJS_URL = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
const PDFJS_WORKER = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
const MAMMOTH_URL = 'https://cdnjs.cloudflare.com/ajax/libs/mammoth/1.6.0/mammoth.browser.min.js';
const JSZIP_URL = 'https://cdnjs.cloudflare.com/ajax/libs/jszip/3.10.1/jszip.min.js';
const DOC_TEXT_CAP = 16000; // characters of extracted text we keep

async function extractPdfText(file) {
  await loadScript(PDFJS_URL);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const maxPages = Math.min(pdf.numPages, 50);
  let text = '';
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    text += content.items.map((it) => it.str).join(' ') + '\n\n';
    if (text.length > DOC_TEXT_CAP + 4000) break;
  }
  return text;
}

async function extractDocxText(file) {
  await loadScript(MAMMOTH_URL);
  const arrayBuffer = await file.arrayBuffer();
  const res = await window.mammoth.extractRawText({ arrayBuffer });
  return (res && res.value) || '';
}

function decodeXml(s) {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}
async function extractPptxText(file) {
  await loadScript(JSZIP_URL);
  const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
  const slides = Object.keys(zip.files)
    .filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
    .sort((a, b) => (+a.match(/slide(\d+)/)[1]) - (+b.match(/slide(\d+)/)[1]));
  let text = '';
  for (const name of slides) {
    const xml = await zip.files[name].async('string');
    const runs = xml.match(/<a:t>[\s\S]*?<\/a:t>/g) || [];
    const slideText = runs.map((r) => decodeXml(r.replace(/^<a:t>/, '').replace(/<\/a:t>$/, ''))).join(' ').trim();
    if (slideText) text += slideText + '\n\n';
    if (text.length > DOC_TEXT_CAP + 4000) break;
  }
  return text;
}

async function extractDocText(file) {
  const name = (file.name || '').toLowerCase();
  if (name.endsWith('.pdf') || file.type === 'application/pdf') return extractPdfText(file);
  if (name.endsWith('.docx') || /wordprocessingml/.test(file.type)) return extractDocxText(file);
  if (name.endsWith('.pptx') || /presentationml/.test(file.type)) return extractPptxText(file);
  throw new Error('unsupported');
}

// Load an image file, downscale to <=1024px, return base64 JPEG (keeps requests small).
function processImageFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const maxDim = 1024;
        const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        canvas.getContext('2d').drawImage(img, 0, 0, w, h);
        const dataUrl = canvas.toDataURL('image/jpeg', 0.85);
        resolve({ mimeType: 'image/jpeg', base64: dataUrl.split(',')[1], dataUrl });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// --- Private, on-device backup: export/import your study state to a JSON file.
// No server, no account — just a file you keep. API keys are deliberately left
// OUT of the file so the backup isn't a secret you have to guard.
const MEM_KEY = 'cassie.mem.v1';
function exportBackup() {
  const backup = { app: 'cassie', kind: 'backup', version: 1, exportedAt: new Date().toISOString() };
  try { const m = localStorage.getItem(MEM_KEY); if (m) backup.memory = JSON.parse(m); } catch (e) { /* ignore */ }
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) { const s = JSON.parse(raw); delete s.groqKey; delete s.geminiKey; backup.state = s; }
  } catch (e) { /* ignore */ }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(`cassie-backup-${stamp}.json`, new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
}
function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { alert('That file isn’t valid JSON — it may be corrupted.'); return; }
    if (!data || data.app !== 'cassie' || data.kind !== 'backup') { alert('That doesn’t look like a Cassie backup file.'); return; }
    if (!confirm('Import this backup? It replaces the memory and chats on this device. Your saved API keys stay as they are.')) return;
    try { if (data.memory) localStorage.setItem(MEM_KEY, JSON.stringify(data.memory)); } catch (e) { /* ignore */ }
    try {
      if (data.state) {
        let cur = {};
        try { cur = JSON.parse(localStorage.getItem(STORE_KEY) || '{}'); } catch (e) { /* ignore */ }
        // Restore everything except keys — keep whatever this device already has.
        const merged = Object.assign({}, data.state, { groqKey: cur.groqKey || '', geminiKey: cur.geminiKey || '' });
        localStorage.setItem(STORE_KEY, JSON.stringify(merged));
      }
    } catch (e) { /* ignore */ }
    location.reload(); // simplest, safe way to re-init the app from restored data
  };
  reader.readAsText(file);
}

const DL_ICON = '<svg viewBox="0 0 24 24"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5z"/></svg>';

function addTextDownload(bubble, text) {
  const tools = document.createElement('div');
  tools.className = 'bubble-tools';
  const copyBtn = document.createElement('button');
  copyBtn.type = 'button';
  copyBtn.textContent = 'Copy';
  copyBtn.addEventListener('click', () => {
    const done = () => { copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); };
    try {
      navigator.clipboard.writeText(text).then(done, () => {
        const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { /* ignore */ } document.body.removeChild(ta);
      });
    } catch (e) { /* clipboard blocked */ }
  });
  tools.appendChild(copyBtn);
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.innerHTML = `${DL_ICON} Download`;
  btn.addEventListener('click', () => downloadBlob('cassie-answer.txt', new Blob([text], { type: 'text/plain' })));
  tools.appendChild(btn);
  bubble.appendChild(tools);
}

function addImageToBubble(bubble, dataUrl, { download = false } = {}) {
  const img = document.createElement('img');
  img.className = 'chat-img';
  img.src = dataUrl;
  img.alt = 'image';
  bubble.appendChild(img);
  if (download) {
    const tools = document.createElement('div');
    tools.className = 'bubble-tools';
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `${DL_ICON} Download image`;
    btn.addEventListener('click', () => fetch(dataUrl).then((r) => r.blob()).then((b) => downloadBlob('cassie-image.png', b)));
    tools.appendChild(btn);
    bubble.appendChild(tools);
  }
  scrollToBottom();
}

/* ---------- send flow ---------- */
async function handleSend(text, opts = {}) {
  const image = pendingImage;
  const doc = pendingDoc;
  if (!text.trim() && !image && !doc) return;

  const needKey = image ? !state.geminiKey : !state.groqKey;
  if (needKey) {
    openSettings();
    detourToElement(image ? geminiKeyInput : groqKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', image
      ? "To read an image I need your free Google (Gemini) API key — add it in Settings (top right)."
      : "I need your free Groq API key before I can answer — add it in Settings (top right).");
    return;
  }

  let sendText = text.trim();
  if (!sendText && image) sendText = 'Please look at this image and help me with it.';
  if (!sendText && doc) sendText = 'Please read this document and help me with it.';

  clearFollowups();
  // if the home screen is showing, clear it before the first message
  if (!state.messages.length) chatLog.innerHTML = '';
  // A document is fed to the model as context, but the chat bubble stays clean.
  let modelContent = sendText;
  let displayContent = sendText;
  if (doc) {
    modelContent = `Here is the document "${doc.name}":\n"""\n${doc.text}\n"""\n\n${sendText}`;
    displayContent = `${sendText}\n\n(attached: ${doc.name})`;
  }
  const userMsg = { role: 'user', content: modelContent };
  if (doc) userMsg.display = displayContent;
  state.messages.push(userMsg);
  touchChat();
  save();
  const userBubble = renderMessage('user', displayContent);
  if (image) addImageToBubble(userBubble, image.dataUrl);
  clearAttach();
  promptInput.value = '';
  promptInput.placeholder = 'Ask Cassie a question…';
  autoGrow();
  mascotOnSend(sendText); // Cassie reacts/comments on what you sent
  // remember what the student is studying + any explicit "remember ..." note
  try {
    if (window.CassieMemory) {
      window.CassieMemory.maybeRememberFrom(sendText);
      window.CassieMemory.recordQuestion(sendText);
    }
  } catch (e) { /* ignore */ }

  setCursorMode('thinking');
  const typingBubble = renderTyping();
  sendBtn.disabled = true;

  try {
    const reply = await askCassie(state.messages, image, { tutor: true, mode: opts.mode });
    state.messages.push({ role: 'assistant', content: reply });
    save();
    typingBubble.remove();
    const bubble = renderMessage('assistant', reply);
    addTextDownload(bubble, reply);
    showFollowups();
    setCursorMode('idle');
    mascotCelebrate();
    maybeCelebrate(reply); // confetti if she's praising a correct answer
    try { if (window.CassieMemory) { window.CassieMemory.scanExchange(sendText, reply); updateMemoryDot(); } } catch (e) { /* ignore */ }
    detourToElement(bubble, { click: true, resumeAfter: 900 });
    speak(reply);
  } catch (err) {
    typingBubble.remove();
    renderMessage('assistant', err.friendly ? err.message : `Something went wrong: ${err.message}`).classList.add('error');
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------- image generation (Gemini) ---------- */
// Try these image models in order — if one is off on the free tier, fall back.
const GEMINI_IMAGE_MODELS = [GEMINI_IMAGE_MODEL, 'gemini-2.0-flash-preview-image-generation'];

async function tryGenerateImage(prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': state.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    const err = new Error(detail || `Request failed (${res.status})`);
    err.status = res.status;
    // "limit: 0" / quota / billing → the free tier has image generation OFF
    err.quota = res.status === 429 || /quota|limit:\s*0|billing|exceeded/i.test(detail);
    err.notAvailable = res.status === 404 || res.status === 400;
    throw err;
  }
  const parts = (await res.json()).candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!imgPart) throw new Error('no image came back — try describing it differently');
  return `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
}

async function generateImage(prompt) {
  let lastErr;
  for (const model of GEMINI_IMAGE_MODELS) {
    try {
      return await tryGenerateImage(prompt, model);
    } catch (e) {
      lastErr = e;
      // only keep trying other models when this one is unavailable/quota-capped
      if (e.quota || e.notAvailable) continue;
      throw e;
    }
  }
  // Every model was capped/unavailable — give an honest, friendly explanation.
  if (lastErr && (lastErr.quota || lastErr.notAvailable)) {
    const friendly = new Error(
      "Google's free tier has image generation turned off for your key right now (they set the limit to 0), so I can't create pictures at the moment. Everything else still works — text answers, reading photos you upload, research, and web search are all free. To make images you'd need to enable billing on your Google AI Studio account."
    );
    friendly.friendly = true;
    throw friendly;
  }
  throw lastErr || new Error('image generation failed');
}

async function handleGenerateImage() {
  const text = promptInput.value.trim();
  if (!text) {
    // Nothing typed yet — guide the student instead of silently doing nothing.
    promptInput.placeholder = 'Describe the image you want, then tap the picture button…';
    promptInput.focus();
    promptInput.classList.add('nudge');
    setTimeout(() => promptInput.classList.remove('nudge'), 900);
    mascotReact('image');
    return;
  }
  if (!state.geminiKey) {
    openSettings();
    detourToElement(geminiKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', "Image generation uses Google Gemini — add your free Gemini API key in Settings (top right).");
    return;
  }
  // don't double up the prefix if the box already starts with it
  const clean = text.replace(/^\s*generate an image:\s*/i, '').trim() || text;
  const label = `Generate an image: ${clean}`;
  state.messages.push({ role: 'user', content: label });
  touchChat();
  save();
  renderMessage('user', label);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  const typingBubble = renderTyping();
  sendBtn.disabled = imageBtn.disabled = true;

  try {
    const dataUrl = await generateImage(clean);
    typingBubble.remove();
    const bubble = renderMessage('assistant', '');
    addImageToBubble(bubble, dataUrl, { download: true });
    state.messages.push({ role: 'assistant', content: '[generated an image]' });
    save();
    setCursorMode('idle');
    mascotCelebrate();
  } catch (err) {
    typingBubble.remove();
    // friendly (e.g. free-tier quota) messages show as-is; others get a prefix
    const msg = err.friendly ? err.message : `Couldn't generate that image: ${err.message}`;
    renderMessage('assistant', msg).classList.add('error');
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = imageBtn.disabled = false;
  }
}

/* ---------- research (OpenAlex) + web source-checking (Gemini) ---------- */

// Reconstruct an OpenAlex abstract from its inverted index.
function reconstructAbstract(inv) {
  if (!inv) return '';
  const words = [];
  for (const [w, positions] of Object.entries(inv)) {
    for (const pos of positions) words[pos] = w;
  }
  return words.filter(Boolean).join(' ');
}

// Search real academic papers via OpenAlex (free, no key, CORS-enabled).
async function searchOpenAlex(query, n = 8) {
  const email = (state.email && state.email.includes('@')) ? state.email : 'cassie-study-app@example.com';
  const url = `https://api.openalex.org/works?search=${encodeURIComponent(query)}`
    + `&per-page=${n}&sort=relevance_score:desc&mailto=${encodeURIComponent(email)}`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error('Could not reach the research database (OpenAlex).');
  const data = await res.json();
  return (data.results || []).map((w) => ({
    title: (w.title || 'Untitled').trim(),
    year: w.publication_year || '',
    authors: (w.authorships || []).map((a) => a.author && a.author.display_name).filter(Boolean),
    venue: (w.primary_location && w.primary_location.source && w.primary_location.source.display_name) || '',
    url: w.doi || (w.open_access && w.open_access.oa_url) || (w.primary_location && w.primary_location.landing_page_url) || w.id || '',
    cited: w.cited_by_count || 0,
    abstract: reconstructAbstract(w.abstract_inverted_index).slice(0, 700),
  }));
}

function authorsShort(list) {
  if (!list.length) return 'Unknown author';
  if (list.length <= 3) return list.join(', ');
  return list.slice(0, 3).join(', ') + ', et al.';
}

async function runResearch(topic) {
  topic = (topic || '').trim();
  if (!topic) { promptInput.placeholder = 'Type a topic first, then tap Research…'; promptInput.focus(); return; }
  if (!state.groqKey) {
    openSettings();
    detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', 'Add your free Groq API key in Settings first, then I can research for you.');
    return;
  }
  state.messages.push({ role: 'user', content: `Research: ${topic}` });
  touchChat();
  save();
  renderMessage('user', `Research: ${topic}`);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  let typing = renderTyping();
  let papers;
  try {
    papers = await searchOpenAlex(topic, 8);
  } catch (e) {
    typing.remove();
    renderMessage('assistant', "I couldn't reach the research database. Check your internet connection and try again.").classList.add('error');
    setCursorMode('idle');
    return;
  }
  typing.remove();
  if (!papers.length) {
    const msg = `I couldn't find papers for "${topic}". Try broader or different keywords (e.g. the main concept plus the field).`;
    state.messages.push({ role: 'assistant', content: msg });
    save();
    renderMessage('assistant', msg);
    setCursorMode('idle');
    return;
  }

  // List of real papers (with clickable links + a Google Scholar link).
  const scholar = 'https://scholar.google.com/scholar?q=' + encodeURIComponent(topic);
  let listMd = `**Found ${papers.length} real papers on "${topic}".** [Open this search in Google Scholar](${scholar})\n\n`;
  papers.forEach((p, i) => {
    listMd += `${i + 1}. **${p.title}** (${p.year || 'n.d.'}). ${authorsShort(p.authors)}.`;
    if (p.venue) listMd += ` *${p.venue}*.`;
    if (p.cited) listMd += ` Cited ${p.cited}×.`;
    if (p.url) listMd += ` [link](${p.url})`;
    listMd += '\n';
  });
  state.messages.push({ role: 'assistant', content: listMd });
  save();
  renderMessage('assistant', listMd);

  // Grounded RRL synthesis — model may use ONLY these sources.
  const sources = papers.map((p, i) =>
    `[${i + 1}] ${p.authors.join(', ') || 'Unknown'} (${p.year || 'n.d.'}). ${p.title}. ${p.venue || 'n.p.'}.`
    + (p.abstract ? `\nAbstract: ${p.abstract}` : '')).join('\n\n');
  const style = state.citationStyle || 'APA';
  const prompt = `You are helping a student write the Review of Related Literature (RRL) for a thesis on "${topic}". `
    + `Using ONLY the sources listed below, write a well-organized RRL:\n`
    + `- Synthesize by theme (group related findings; do not just summarize each paper one by one).\n`
    + `- Use in-text citations in ${style} style, referring ONLY to these sources.\n`
    + `- Note common findings, disagreements, and any research gap relevant to the topic.\n`
    + `- End with a "References" section in ${style} format, built from the details provided.\n`
    + `Do NOT invent any source, author, year, or finding that is not in the list. If a detail is missing, leave it out rather than guessing.\n\n`
    + `SOURCES:\n${sources}`;

  setCursorMode('thinking');
  typing = renderTyping();
  try {
    const reply = await askCassie([{ role: 'user', content: prompt }]);
    typing.remove();
    state.messages.push({ role: 'assistant', content: reply });
    touchChat();
    save();
    const bubble = renderMessage('assistant', reply);
    addTextDownload(bubble, reply);
    setCursorMode('idle');
  } catch (err) {
    typing.remove();
    renderMessage('assistant', err.friendly ? err.message : `Something went wrong: ${err.message}`).classList.add('error');
    setCursorMode('idle');
  }
}

// Ask Gemini with Google Search grounding — returns { text, sources }.
async function askGeminiGrounded(q) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${GEMINI_VISION_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': state.geminiKey },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: buildSystemPrompt() }] },
      contents: [{ role: 'user', parts: [{ text: q }] }],
      tools: [{ google_search: {} }],
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (isRateLimited(res.status, detail)) throw new Error("Google's free search tier is busy right now — wait a minute and try again.");
    throw new Error(detail || `Request failed (${res.status})`);
  }
  const cand = (await res.json()).candidates?.[0];
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const sources = [];
  chunks.forEach((c) => {
    const uri = c.web && c.web.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); sources.push({ title: (c.web.title || uri), uri }); }
  });
  return { text: text || '(no response)', sources };
}

async function runWebCheck(text) {
  text = (text || '').trim();
  if (!text) { promptInput.placeholder = 'Type a question first, then tap Web…'; promptInput.focus(); return; }
  if (!state.geminiKey) {
    openSettings();
    detourToElement(geminiKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', 'Web fact-checking uses Google Gemini’s search. Add your free Gemini key in Settings (the images key) to turn it on.');
    return;
  }
  state.messages.push({ role: 'user', content: text });
  touchChat();
  save();
  renderMessage('user', text);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  const typing = renderTyping();
  try {
    const { text: answer, sources } = await askGeminiGrounded(text);
    typing.remove();
    let out = answer;
    if (sources.length) {
      out += '\n\n**Sources**\n';
      sources.slice(0, 6).forEach((s, i) => { out += `${i + 1}. [${s.title}](${s.uri})\n`; });
    }
    state.messages.push({ role: 'assistant', content: out });
    touchChat();
    save();
    const bubble = renderMessage('assistant', out);
    addTextDownload(bubble, out);
    setCursorMode('idle');
  } catch (err) {
    typing.remove();
    renderMessage('assistant', err.friendly ? err.message : `Something went wrong: ${err.message}`).classList.add('error');
    setCursorMode('idle');
  }
}

if (researchBtn) {
  researchBtn.addEventListener('click', () => runResearch(promptInput.value));
}
if (webBtn) {
  webBtn.addEventListener('click', () => runWebCheck(promptInput.value));
}

/* ---------- attach / generate wiring ---------- */
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const lname = (file.name || '').toLowerCase();

  // Image → existing vision flow.
  if (file.type.startsWith('image/')) {
    try {
      pendingImage = await processImageFile(file);
      pendingDoc = null;
      attachThumb.src = pendingImage.dataUrl;
      attachThumb.hidden = false;
      attachName.hidden = true;
      attachPreview.hidden = false;
    } catch (e) { clearAttach(); }
    return;
  }

  // Document → extract text in-browser.
  if (/\.(pdf|docx|pptx)$/.test(lname)) {
    pendingImage = null;
    attachThumb.hidden = true;
    attachName.hidden = false;
    attachName.textContent = `Reading ${file.name}…`;
    attachPreview.hidden = false;
    try {
      let text = await extractDocText(file);
      text = (text || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
      if (!text) {
        pendingDoc = null;
        attachName.textContent = `Couldn’t find text in ${file.name} (it may be scanned images).`;
        return;
      }
      pendingDoc = { name: file.name, text: text.slice(0, DOC_TEXT_CAP) };
      attachName.textContent = file.name;
    } catch (e) {
      pendingDoc = null;
      attachName.textContent = `Couldn’t read ${file.name}. Try a PDF, .docx, or .pptx.`;
    }
    return;
  }

  // Old binary Office formats aren't supported by the in-browser parsers.
  if (/\.(doc|ppt)$/.test(lname)) {
    pendingImage = null;
    attachThumb.hidden = true;
    attachName.hidden = false;
    attachName.textContent = 'Please save it as .docx or .pptx and try again.';
    attachPreview.hidden = false;
  }
});
attachRemove.addEventListener('click', clearAttach);
imageBtn.addEventListener('click', handleGenerateImage);

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  handleSend(promptInput.value);
});

promptInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    handleSend(promptInput.value);
  }
});

function autoGrow() {
  promptInput.style.height = 'auto';
  promptInput.style.height = Math.min(120, promptInput.scrollHeight) + 'px';
}
promptInput.addEventListener('input', autoGrow);

/* ---------- tutor quick-actions: Hint & Quiz ---------- */
if (hintBtn) {
  hintBtn.addEventListener('click', () => {
    const text = promptInput.value.trim();
    if (!text) {
      promptInput.placeholder = 'Type your question first, then tap Hint…';
      promptInput.focus();
      return;
    }
    handleSend(text, { mode: 'hint' });
  });
}
if (quizBtn) {
  quizBtn.addEventListener('click', () => {
    if (!state.groqKey) {
      openSettings();
      detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
      renderMessage('assistant', 'Add your free Groq API key in Settings first, then we can start a quiz.');
      return;
    }
    quizMode = !quizMode;
    quizBtn.classList.toggle('active', quizMode);
    setQuizLabel(quizMode ? 'Stop quiz' : 'Quiz me');
    if (quizMode) {
      const topic = promptInput.value.trim();
      promptInput.value = '';
      autoGrow();
      handleSend(
        topic
          ? `Quiz me on: ${topic}. Ask the first question.`
          : "Quiz me on what we've been studying (or pick a useful general topic if we haven't). Ask the first question.",
        {}
      );
    } else {
      renderMessage('assistant', 'Quiz stopped. Nice work! Ask me anything or start another quiz whenever you like.');
    }
  });
}

/* ---------- settings ---------- */
function openSettings() {
  groqKeyInput.value = state.groqKey;
  groqModelSelect.value = state.groqModel;
  geminiKeyInput.value = state.geminiKey;
  voiceOutToggle.checked = state.voiceOut;
  if (levelSelect) levelSelect.value = state.level || 'auto';
  if (citationSelect) citationSelect.value = state.citationStyle || 'APA';
  if (textsizeSelect) textsizeSelect.value = state.textSize || 'normal';
  if (easyreadToggle) easyreadToggle.checked = !!state.easyRead;
  // A first-time user hasn't added a key yet, so open the "API keys" section
  // for them (that's where they need to paste it). Once a key is saved, keep
  // every section collapsed so the screen stays calm.
  const keysGroup = document.getElementById('settings-keys');
  if (keysGroup) keysGroup.open = !state.groqKey;
  syncAccentSwatches();
  settingsPanel.hidden = false;
}

// Palette for the favorite-colour picker: many hues × 4 shades (light→dark),
// plus a warm-neutral (marble) row. The custom picker still allows any colour.
const ACCENT_COLORS = [
  '#fca5a5', '#f87171', '#ef4444', '#b91c1c', // red
  '#fdba74', '#fb923c', '#f97316', '#c2410c', // orange
  '#fcd34d', '#fbbf24', '#f59e0b', '#b45309', // amber
  '#bef264', '#a3e635', '#84cc16', '#4d7c0f', // lime
  '#86efac', '#4ade80', '#22c55e', '#15803d', // green
  '#5eead4', '#2dd4bf', '#14b8a6', '#0f766e', // teal
  '#7dd3fc', '#38bdf8', '#0ea5e9', '#0369a1', // sky
  '#93c5fd', '#60a5fa', '#3b82f6', '#1d4ed8', // blue
  '#a5b4fc', '#818cf8', '#6366f1', '#4338ca', // indigo
  '#d8b4fe', '#c084fc', '#a855f7', '#7e22ce', // purple
  '#f0abfc', '#e879f9', '#d946ef', '#a21caf', // fuchsia
  '#f9a8d4', '#f472b6', '#ec4899', '#be185d', // pink
  '#d6d3ce', '#a8a29e', '#78716c', '#44403c', // warm neutral (marble)
];
function buildAccentSwatches() {
  const wrap = document.getElementById('accent-swatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  const none = document.createElement('button');
  none.type = 'button'; none.className = 'accent-sw accent-none';
  none.dataset.accent = ''; none.title = 'None — marble monochrome';
  none.setAttribute('aria-label', 'None (marble monochrome)');
  wrap.appendChild(none);
  ACCENT_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'accent-sw'; b.dataset.accent = c;
    b.style.setProperty('--sw', c); b.title = c; b.setAttribute('aria-label', c);
    wrap.appendChild(b);
  });
  const lab = document.createElement('label');
  lab.className = 'accent-sw accent-custom'; lab.title = 'Custom colour';
  const inp = document.createElement('input');
  inp.type = 'color'; inp.id = 'accent-custom'; inp.value = '#3b82f6';
  inp.setAttribute('aria-label', 'Custom colour');
  lab.appendChild(inp); wrap.appendChild(lab);
}

// Mark the swatch matching the saved colour (or "None") as active.
function syncAccentSwatches() {
  const cur = (state.accent || '').toLowerCase();
  const sws = settingsPanel.querySelectorAll('.accent-sw[data-accent]');
  let matched = false;
  sws.forEach((sw) => {
    const on = (sw.dataset.accent || '').toLowerCase() === cur;
    sw.classList.toggle('active', on);
    if (on) matched = true;
  });
  const custom = document.getElementById('accent-custom');
  if (custom) {
    if (cur && !matched) { custom.value = cur; custom.parentElement.classList.add('active'); }
    else custom.parentElement.classList.remove('active');
    if (/^#[0-9a-f]{6}$/i.test(cur)) custom.value = cur;
  }
}
function setAccent(color) {
  state.accent = color || '';
  save();
  applyAccent();
  syncAccentSwatches();
}
const MODEL_SHORT = {
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B',
  'llama-3.1-8b-instant': 'Llama 3.1 8B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
};
function updateModelPill() {
  if (!modelPill) return;
  modelPillModel.textContent = MODEL_SHORT[state.groqModel] || 'Cassie';
  const lvl = state.level && state.level !== 'auto' ? (LEVEL_LABELS[state.level] || 'Auto') : 'Auto';
  modelPillLevel.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1);
}
function closeSettings() {
  state.groqKey = groqKeyInput.value.trim();
  state.groqModel = groqModelSelect.value;
  state.geminiKey = geminiKeyInput.value.trim();
  state.voiceOut = voiceOutToggle.checked;
  if (levelSelect) state.level = levelSelect.value;
  if (citationSelect) state.citationStyle = citationSelect.value;
  if (textsizeSelect) state.textSize = textsizeSelect.value;
  if (easyreadToggle) state.easyRead = easyreadToggle.checked;
  save();
  updateModelPill();
  applyReading();
  settingsPanel.hidden = true;
  resumeFollowing();
}
settingsBtn.addEventListener('click', () => {
  openSettings();
  detourToElement(settingsBtn, { click: true, resumeAfter: 900 });
});
settingsCloseBtn.addEventListener('click', closeSettings);
// Favorite-colour swatches: preset click, "None", or a custom colour.
settingsPanel.addEventListener('click', (e) => {
  const sw = e.target.closest('.accent-sw[data-accent]');
  if (sw) setAccent(sw.dataset.accent);
});
settingsPanel.addEventListener('input', (e) => {
  if (e.target.id === 'accent-custom') setAccent(e.target.value);
});
if (modelPill) {
  modelPill.addEventListener('click', () => {
    openSettings();
    detourToElement(groqModelSelect, { click: true, resumeAfter: 900 });
  });
}

/* ---------- Cassie's memory panel ---------- */
const memoryBtn = document.getElementById('memory-btn');
const memoryPanel = document.getElementById('memory-panel');
const memoryDot = document.getElementById('memory-dot');
const memEsc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

function updateMemoryDot() {
  if (!memoryDot || !window.CassieMemory) return;
  const due = window.CassieMemory.stats().due;
  memoryDot.hidden = due === 0;
}

function memTopicRow(t) {
  const total = t.correct + t.wrong;
  const pct = total ? Math.round((t.correct / total) * 100) : Math.min(100, (t.reps || 0) * 25);
  return `<div class="mem-topic"><div class="mem-topic-top"><span class="mem-topic-name">${memEsc(t.name)}</span>` +
    `<button class="mem-review" data-topic="${memEsc(t.name)}">Review</button></div>` +
    `<div class="mem-bar"><i style="width:${pct}%"></i></div></div>`;
}

function renderMemory() {
  if (!memoryPanel || !window.CassieMemory) return;
  const M = window.CassieMemory;
  const d = M.data;
  const s = M.stats();
  const due = M.dueTopics().slice(0, 12);
  const weak = M.weakTopics().slice(0, 12);
  const recent = M.recentTopics(8);
  const facts = d.facts || [];
  const hasData = s.topics > 0 || s.streak > 0 || s.focusMinutes > 0 || facts.length > 0;

  memoryPanel.innerHTML = `
    <div class="settings-card memory-card">
      <div class="mem-head">
        <h2>What Cassie remembers</h2>
        <button class="icon-btn" id="mem-close" aria-label="Close">&times;</button>
      </div>
      <p class="mem-privacy">🔒 Everything here stays on your device. No account, no server — only you can see it.</p>
      ${hasData ? `
      <div class="mem-stats">
        <div class="mem-stat"><b>🔥 ${s.streak}</b><small>day streak</small></div>
        <div class="mem-stat"><b>✅ ${s.mastered}</b><small>mastered</small></div>
        <div class="mem-stat"><b>⏱️ ${s.focusHours}h</b><small>focus</small></div>
        <div class="mem-stat"><b>📚 ${s.topics}</b><small>topics</small></div>
        <div class="mem-stat"><b>🔁 ${s.due}</b><small>to review</small></div>
      </div>
      <p class="mem-note">A gentle tracker — it grows as you learn. No streak-shaming here. 💛</p>` : `
      <p class="mem-welcome">This is where your progress will live. Ask Cassie a question or finish a focus session, and your streak, topics, and reviews start filling in here. 💛</p>`}

      <label class="field"><span>Your name (optional)</span><input id="mem-name" type="text" value="${memEsc(d.profile.name)}" placeholder="What should I call you?"></label>
      <label class="field"><span>Your goal (optional)</span><input id="mem-goal" type="text" value="${memEsc(d.profile.goal)}" placeholder="e.g. pass my chemistry finals"></label>

      ${due.length ? `<div class="mem-section">🔁 Due for review</div><div class="mem-chips">${due.map((t) => `<button class="mem-review" data-topic="${memEsc(t.name)}">${memEsc(t.name)}</button>`).join('')}</div>` : ''}
      ${weak.length ? `<div class="mem-section">Weak spots</div><div class="mem-chips">${weak.map((t) => `<button class="mem-review weak" data-topic="${memEsc(t.name)}">${memEsc(t.name)}</button>`).join('')}</div>` : ''}

      <div class="mem-section">Recently studied</div>
      ${recent.length ? `<div class="mem-topics">${recent.map(memTopicRow).join('')}</div>` : '<p class="mem-empty">Ask Cassie some questions and she’ll start remembering what you study.</p>'}

      <div class="mem-section">Notes Cassie remembers</div>
      <div class="mem-facts">${facts.length ? facts.map((f, i) => `<div class="mem-fact"><span>${memEsc(f.text)}</span><button class="mem-del" data-i="${i}" aria-label="Remove">&times;</button></div>`).join('') : '<p class="mem-empty">No notes yet. Try telling her: “Remember my exam is on Friday.”</p>'}</div>
      <div class="mem-addrow"><input id="mem-fact" type="text" placeholder="Tell Cassie to remember something…"><button id="mem-add" class="btn">Add</button></div>

      <div class="mem-section">Backup &amp; restore</div>
      <p class="mem-empty">Your data lives only on this device. Save a private backup file to keep it safe, or bring it to another device.</p>
      <div class="mem-backup">
        <button class="btn secondary" id="mem-export">⬇ Export backup</button>
        <button class="btn secondary" id="mem-import">⬆ Import backup</button>
        <input type="file" id="mem-import-file" accept="application/json,.json" hidden>
      </div>

      <div class="settings-actions">
        <button class="btn secondary" id="mem-clear">Clear all memory</button>
        <button class="btn" id="mem-done">Done</button>
      </div>
    </div>`;
}

function openMemory() {
  if (!memoryPanel) return;
  renderMemory();
  memoryPanel.hidden = false;
}
function closeMemory() { if (memoryPanel) memoryPanel.hidden = true; updateMemoryDot(); }

function startReview(topic) {
  closeMemory();
  if (!topic) return;
  quizMode = true;
  if (quizBtn) quizBtn.classList.add('active');
  if (typeof setQuizLabel === 'function') setQuizLabel('Stop quiz');
  handleSend(`Quiz me on ${topic}. Ask one question at a time and wait for my answer.`);
}
if (window.CassieMemory) window.CassieMemory.onReview = startReview;

if (memoryBtn) memoryBtn.addEventListener('click', openMemory);
if (memoryPanel) {
  memoryPanel.addEventListener('click', (e) => {
    if (e.target === memoryPanel) return closeMemory();
    const rev = e.target.closest('.mem-review');
    if (rev) return startReview(rev.dataset.topic);
    if (e.target.closest('#mem-close') || e.target.closest('#mem-done')) return closeMemory();
    const del = e.target.closest('.mem-del');
    if (del) { window.CassieMemory.removeFact(+del.dataset.i); renderMemory(); return; }
    if (e.target.closest('#mem-add')) {
      const inp = document.getElementById('mem-fact');
      if (inp && inp.value.trim()) { window.CassieMemory.addFact(inp.value); renderMemory(); }
      return;
    }
    if (e.target.closest('#mem-export')) { exportBackup(); return; }
    if (e.target.closest('#mem-import')) {
      const f = document.getElementById('mem-import-file');
      if (f) f.click();
      return;
    }
    if (e.target.closest('#mem-clear')) {
      if (confirm('Clear everything Cassie remembers about you? This cannot be undone.')) {
        window.CassieMemory.clearAll(); renderMemory(); updateMemoryDot();
      }
    }
  });
  memoryPanel.addEventListener('change', (e) => {
    if (e.target.id === 'mem-name') window.CassieMemory.setProfile('name', e.target.value);
    if (e.target.id === 'mem-goal') window.CassieMemory.setProfile('goal', e.target.value);
    if (e.target.id === 'mem-import-file' && e.target.files && e.target.files[0]) {
      importBackupFile(e.target.files[0]);
      e.target.value = ''; // allow re-importing the same file later
    }
  });
  memoryPanel.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'mem-fact') {
      e.preventDefault();
      if (e.target.value.trim()) { window.CassieMemory.addFact(e.target.value); renderMemory(); }
    }
  });
}

/* ---------- Pomodoro focus timer ---------- */
(function pomodoro() {
  const FOCUS = 25 * 60, BREAK = 5 * 60, LONG = 15 * 60;
  const wrap = document.getElementById('pomo');
  const modeEl = document.getElementById('pomo-mode');
  const timeEl = document.getElementById('pomo-time');
  const cyclesEl = document.getElementById('pomo-cycles');
  const ringFill = document.getElementById('pomo-ring-fill');
  const toggleBtn = document.getElementById('pomo-toggle');
  const resetBtn = document.getElementById('pomo-reset');
  const skipBtn = document.getElementById('pomo-skip');
  if (!wrap || !toggleBtn) return;

  let mode = 'focus';       // 'focus' | 'break' | 'long'
  let remaining = FOCUS;
  let running = false;
  let tick = null;
  let cycles = 0;           // completed focus blocks

  const total = () => (mode === 'focus' ? FOCUS : mode === 'long' ? LONG : BREAK);
  const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

  function render() {
    timeEl.textContent = fmt(remaining);
    modeEl.textContent = mode === 'focus' ? 'Focus' : mode === 'long' ? 'Long break' : 'Break';
    const dots = [0, 1, 2, 3].map((i) => `<span class="${i < (cycles % 4 || (cycles && mode !== 'focus' ? 4 : 0)) ? 'on' : ''}"></span>`).join('');
    cyclesEl.innerHTML = dots;
    ringFill.style.width = `${Math.max(0, Math.min(100, (1 - remaining / total()) * 100))}%`;
    toggleBtn.textContent = running ? 'Pause' : 'Start';
    wrap.classList.toggle('break', mode !== 'focus');
  }
  function switchMode(next) { mode = next; remaining = total(); render(); }
  function nudge(msg, pose) {
    try { if (typeof set3D === 'function') set3D(pose); } catch (e) { /* */ }
    try { if (typeof mascotSay === 'function') mascotSay(msg, 5200); } catch (e) { /* */ }
  }
  function start() {
    if (running) return;
    running = true;
    clearInterval(tick);
    tick = setInterval(() => { remaining -= 1; if (remaining <= 0) return complete(); render(); }, 1000);
    render();
  }
  function pause() { running = false; clearInterval(tick); render(); }
  function complete() {
    clearInterval(tick); running = false;
    if (mode === 'focus') {
      cycles += 1;
      try { if (window.CassieMemory) { window.CassieMemory.addFocusMinutes(FOCUS / 60); if (typeof updateMemoryDot === 'function') updateMemoryDot(); } } catch (e) { /* */ }
      const long = cycles % 4 === 0;
      switchMode(long ? 'long' : 'break');
      nudge(long ? 'Awesome focus! 🎉 Take a longer break — stretch & breathe.' : 'Nice work! ☕ 5-min break — hydrate 💧 and rest your eyes.', 'encouraging');
    } else {
      switchMode('focus');
      nudge('Break\'s over — ready to focus? Let\'s go! ✎', 'thinking');
    }
    start(); // auto-flow into the next block
  }

  toggleBtn.addEventListener('click', () => (running ? pause() : (nudge(mode === 'focus' ? 'Focus time! I\'ll keep you company 💪' : 'Rest up! 🌿', mode === 'focus' ? 'thinking' : 'encouraging'), start())));
  resetBtn.addEventListener('click', () => { pause(); mode = 'focus'; cycles = 0; remaining = FOCUS; render(); });
  skipBtn.addEventListener('click', () => { pause(); switchMode(mode === 'focus' ? 'break' : 'focus'); });
  render();
})();

clearChatBtn.addEventListener('click', () => {
  if (!confirm('Clear this conversation?')) return;
  const c = curChat();
  c.messages.length = 0;
  c.title = '';
  state.messages = c.messages;
  quizMode = false;
  if (quizBtn) { quizBtn.classList.remove('active'); setQuizLabel('Quiz me'); }
  save();
  renderHistory();
  renderChatList();
});

/* ---------- sidebar: multiple conversations ---------- */
function resetQuizUi() {
  quizMode = false;
  if (quizBtn) { quizBtn.classList.remove('active'); setQuizLabel('Quiz me'); }
}
function openSidebar() {
  renderChatList();
  sidebar.classList.add('open');
  sidebarOverlay.classList.add('open');
}
function closeSidebar() {
  sidebar.classList.remove('open');
  sidebarOverlay.classList.remove('open');
}
function renderChatList() {
  const chats = [...state.chats].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  chatList.innerHTML = '';
  if (!chats.length) {
    const e = document.createElement('div');
    e.className = 'chat-empty';
    e.textContent = 'No past sessions yet. Start a chat to build your study trail.';
    chatList.appendChild(e);
    return;
  }
  chats.forEach((c) => {
    const item = document.createElement('div');
    item.className = 'chat-item' + (c.id === state.currentId ? ' active' : '');
    item.innerHTML = '<svg class="ci-icon" viewBox="0 0 24 24"><path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-4 4V5a1 1 0 0 1 1-1z"/></svg>';
    const title = document.createElement('span');
    title.className = 'ci-title';
    title.textContent = c.title || deriveTitle(c.messages) || 'New chat';
    const del = document.createElement('button');
    del.className = 'ci-del';
    del.type = 'button';
    del.title = 'Delete conversation';
    del.setAttribute('aria-label', 'Delete conversation');
    del.textContent = '×';
    del.addEventListener('click', (e) => { e.stopPropagation(); deleteChat(c.id); });
    item.appendChild(title);
    item.appendChild(del);
    item.addEventListener('click', () => selectChat(c.id));
    chatList.appendChild(item);
  });
}
function selectChat(id) {
  if (id !== state.currentId) {
    const c = state.chats.find((x) => x.id === id);
    if (!c) return;
    state.currentId = id;
    state.messages = c.messages;
    resetQuizUi();
    save();
    renderHistory();
  }
  closeSidebar();
}
function createNewChat() {
  const cur = curChat();
  if (cur && cur.messages.length === 0) {
    state.messages = cur.messages; // reuse the current blank chat instead of stacking empties
  } else {
    const c = makeChat();
    state.chats.push(c);
    state.currentId = c.id;
    state.messages = c.messages;
  }
  resetQuizUi();
  save();
  renderHistory();
  renderChatList();
  closeSidebar();
  promptInput.focus();
}
function deleteChat(id) {
  const idx = state.chats.findIndex((c) => c.id === id);
  if (idx === -1) return;
  state.chats.splice(idx, 1);
  if (!state.chats.length) state.chats.push(makeChat());
  if (state.currentId === id) {
    state.currentId = state.chats[0].id;
    state.messages = curChat().messages;
    resetQuizUi();
    renderHistory();
  }
  save();
  renderChatList();
}
menuBtn.addEventListener('click', openSidebar);
sidebarClose.addEventListener('click', closeSidebar);
sidebarOverlay.addEventListener('click', closeSidebar);
newChatBtn.addEventListener('click', createNewChat);
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && sidebar.classList.contains('open')) closeSidebar();
});

/* ---------- voice input ---------- */
const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
if (SpeechRecognitionCtor) {
  micBtn.hidden = false;
  const recognizer = new SpeechRecognitionCtor();
  recognizer.continuous = false;
  recognizer.interimResults = false;

  let listening = false;
  micBtn.addEventListener('click', () => {
    if (listening) { recognizer.stop(); return; }
    try {
      recognizer.start();
      listening = true;
      micBtn.classList.add('primary');
      detourToElement(micBtn, { click: true, resumeAfter: 700 });
    } catch (e) { /* already started */ }
  });
  recognizer.addEventListener('result', (e) => {
    const text = e.results[0][0].transcript;
    promptInput.value = text;
    autoGrow();
    handleSend(text);
  });
  recognizer.addEventListener('end', () => {
    listening = false;
    micBtn.classList.remove('primary');
  });
  recognizer.addEventListener('error', () => {
    listening = false;
    micBtn.classList.remove('primary');
  });
}

/* ---------- voice output ---------- */
function speak(text) {
  if (!state.voiceOut || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utter = new SpeechSynthesisUtterance(text);
  utter.rate = 1.02;
  window.speechSynthesis.speak(utter);
}

/* ---------- highlight-to-ask (right-click a selection) ---------- */
/* Select any text in the app, right-click, and pick Explain / Answer /
   Code it — the result shows in a small popover right there, without
   touching the main chat. It's a separate, throwaway lookup. */
let highlightGen = 0;

function hideHighlightPopover() {
  highlightPopover.hidden = true;
  lastPopoverText = ''; // allow re-selecting the same text to reopen it
  highlightGen++; // invalidate any in-flight request
}

function positionPopover(rect) {
  const width = highlightPopover.offsetWidth || 280;
  let left = rect.left + rect.width / 2 - width / 2;
  left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
  highlightPopover.style.left = `${left}px`;

  const estHeight = highlightPopover.offsetHeight || 90;
  const spaceAbove = rect.top;
  const top = spaceAbove > estHeight + 16
    ? rect.top - estHeight - 8
    : Math.min(rect.bottom + 8, window.innerHeight - estHeight - 12);
  highlightPopover.style.top = `${Math.max(8, top)}px`;
}

function setPopoverContent(text, { muted = false } = {}) {
  highlightPopoverBody.classList.toggle('muted', muted);
  renderFormatted(highlightPopoverBody, text);
}

let pendingText = '';
let pendingRect = null;
let lastPopoverText = ''; // the selection currently shown, so we don't overwrite an answer
let popoverComplexity = 'normal'; // 'eli5' | 'normal' | 'advanced'
let lastMode = null; // 'explain' | 'answer' | 'code' — for re-running at a new depth

function setPopoverChoice(text, rect) {
  pendingText = text;
  pendingRect = rect;
  lastPopoverText = text;
  highlightPopoverBody.classList.remove('muted');
  highlightPopoverBody.innerHTML = `
    <div class="popover-question">What should I do with this?</div>
    <div class="popover-choice-row">
      <button type="button" class="popover-choice-btn" data-mode="explain">Explain</button>
      <button type="button" class="popover-choice-btn" data-mode="answer">Answer</button>
      <button type="button" class="popover-choice-btn" data-mode="code">Code</button>
    </div>
  `;
  positionPopover(rect);
}

// After Explain/Code, show the answer with a depth control (ELI5 / Normal /
// Advanced) on top so the student can re-explain simpler or deeper in place.
function depthBarHTML() {
  return `<div class="popover-complexity" role="group" aria-label="Explanation depth">
      <button type="button" class="pc-lvl${popoverComplexity === 'eli5' ? ' active' : ''}" data-lvl="eli5">ELI5</button>
      <button type="button" class="pc-lvl${popoverComplexity === 'normal' ? ' active' : ''}" data-lvl="normal">Normal</button>
      <button type="button" class="pc-lvl${popoverComplexity === 'advanced' ? ' active' : ''}" data-lvl="advanced">Advanced</button>
    </div>`;
}
function setPopoverResult(reply, mode) {
  highlightPopoverBody.classList.remove('muted');
  const withDepth = mode === 'explain' || mode === 'code';
  highlightPopoverBody.innerHTML = (withDepth ? depthBarHTML() : '') + '<div class="popover-result"></div>';
  renderFormatted(highlightPopoverBody.querySelector('.popover-result'), reply);
}

highlightPopoverBody.addEventListener('click', (e) => {
  const lvl = e.target.closest('.pc-lvl');
  if (lvl) {
    // tapping a depth chip re-runs the last explanation at that complexity
    popoverComplexity = lvl.dataset.lvl;
    highlightPopoverBody.querySelectorAll('.pc-lvl').forEach((b) => b.classList.toggle('active', b === lvl));
    if (lastMode) runExplainOrAnswer(pendingText, pendingRect, lastMode);
    return;
  }
  const btn = e.target.closest('.popover-choice-btn');
  if (!btn) return;
  runExplainOrAnswer(pendingText, pendingRect, btn.dataset.mode);
});

async function runExplainOrAnswer(text, rect, mode) {
  const myGen = ++highlightGen;
  lastMode = mode;
  setPopoverContent('Thinking…', { muted: true });
  positionPopover(rect);

  if (!state.groqKey) {
    setPopoverContent('Add your free Groq API key in Settings first.', { muted: true });
    positionPopover(rect);
    openSettings();
    detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
    return;
  }

  setCursorMode('thinking');
  const depth = popoverComplexity === 'eli5'
    ? ' Explain it like I\'m 5: super simple, everyday words, a short friendly analogy, and no jargon.'
    : popoverComplexity === 'advanced'
      ? ' Give an advanced, in-depth explanation: precise terminology, the underlying mechanisms, and any important nuances.'
      : '';
  let prompt;
  if (mode === 'answer') {
    prompt = `Give only the direct answer to this — no explanation, no extra words:\n\n"${text}"`;
  } else if (mode === 'code') {
    prompt = `Write clean, well-commented code that solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, and briefly explain how it works.${depth}\n\n"${text}"`;
  } else {
    prompt = `Answer this and explain your reasoning — give the answer, then explain why/how.${depth}\n\n"${text}"`;
  }
  try {
    const reply = await askCassie([{ role: 'user', content: prompt }]);
    if (myGen !== highlightGen) return; // a newer selection superseded this one
    setPopoverResult(reply, mode);
    positionPopover(rect);
    detourToElement(highlightPopover, { click: true, resumeAfter: 900 });
  } catch (err) {
    if (myGen !== highlightGen) return;
    setPopoverContent(err.friendly ? err.message : `Something went wrong: ${err.message}`, { muted: true });
    positionPopover(rect);
  } finally {
    if (myGen === highlightGen) setCursorMode('idle');
  }
}

/* Explicit "I'm done" actions also clear the actual text selection, not
   just our UI state — otherwise re-highlighting the exact same range
   afterward fires no selectionchange event at all (browsers only fire it
   on a real change) and the popover would never come back. Passive hides
   (scroll, clicking elsewhere) leave the selection alone, since the user
   might be in the middle of selecting something else entirely. */
function dismissHighlightPopover() {
  window.getSelection()?.removeAllRanges();
  hideHighlightPopover();
}

highlightPopoverClose.addEventListener('click', dismissHighlightPopover);

let lastTouchEndAt = 0;
document.addEventListener('mousedown', (e) => {
  // ignore the synthesized mousedown that follows a touch selection, or it
  // would hide the popover on phones the instant it appears
  if (Date.now() - lastTouchEndAt < 700) return;
  if (!highlightPopover.contains(e.target)) hideHighlightPopover();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !highlightPopover.hidden) dismissHighlightPopover();
});

/* Right-click (or two-finger tap on a trackpad) on selected text shows the
   Explain / Answer buttons at the pointer, instead of the browser menu.
   Only hijacks when there IS a selection; plain inputs keep their native menu. */
document.addEventListener('contextmenu', (e) => {
  const el = e.target && e.target.nodeType === 1 ? e.target : (e.target && e.target.parentElement);
  if (el && el.closest('input, textarea')) return; // keep native menu in edit fields
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 2) return; // nothing selected -> normal menu
  e.preventDefault();
  const rect = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
  highlightPopover.hidden = false;
  setPopoverChoice(text, rect);
});

/* Highlight-to-ask on ANY device: when the user selects text inside an answer,
   show the Explain / Answer / Code popover near the selection. This is what
   makes it work on phones (which have no right-click). Debounced so it waits
   for the selection to settle (mobile selection-handle dragging fires many
   selectionchange events). */
let selPopoverTimer = null;
function trySelectionPopover() {
  if (!highlightPopover) return;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0 || sel.isCollapsed) return;
  const text = sel.toString().trim();
  if (text.length < 2) return;
  const range = sel.getRangeAt(0);
  const anchor = range.commonAncestorContainer;
  const el = anchor.nodeType === 1 ? anchor : anchor.parentElement;
  if (!el) return;
  if (el.closest('input, textarea')) return;         // ignore typed text
  if (!el.closest('#chat-log')) return;              // only within answers/messages
  // if this exact selection is already open (e.g. showing an answer), leave it
  if (!highlightPopover.hidden && text === lastPopoverText) return;
  const rect = range.getBoundingClientRect();
  if (!rect || (rect.width === 0 && rect.height === 0)) return;
  highlightPopover.hidden = false;
  setPopoverChoice(text, rect);
}
function scheduleSelectionPopover(delay) {
  clearTimeout(selPopoverTimer);
  selPopoverTimer = setTimeout(trySelectionPopover, delay);
}
// Highlight-to-ask on every device: selecting text in an answer opens the
// popover; picking a choice shows the answer; clicking away hides it; and
// selecting new text opens it again. Clicks inside the popover never re-trigger.
function fromPopover(e) { return e.target && e.target.closest && e.target.closest('.highlight-popover'); }
document.addEventListener('mouseup', (e) => { if (!fromPopover(e)) scheduleSelectionPopover(10); });
document.addEventListener('touchend', (e) => {
  lastTouchEndAt = Date.now();
  // wait past the browser's synthesized mouse events so the outside-tap
  // handler doesn't immediately hide the popover we're about to show
  if (!fromPopover(e)) scheduleSelectionPopover(380);
}, { passive: true });
document.addEventListener('selectionchange', () => scheduleSelectionPopover(450));

chatLog.addEventListener('scroll', hideHighlightPopover);
window.addEventListener('resize', hideHighlightPopover);

/* ---------- init ---------- */
buildAccentSwatches();
applyReading();
applyAccent();
renderHistory();
updateModelPill();
updateMemoryDot();
requestAnimationFrame(() => {
  setCursorMode('idle');
  followMouseNow();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install still works without SW */ });
  });
}
