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
    audience: 'student',    // student | pro — the Student / Professional switch
    messages: [], // { role: 'user' | 'assistant', content: '...' }
  };
}

// Text runs on Groq (higher free limits); images run on Gemini.
// Smartest first — it's also the default and the head of the fallback chain.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
// Gemini models for reading whole files (PDF pages, slides, pictures). Newest first.
const GEMINI_DOC_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_VISION_MODEL = 'gemini-3.6-flash';

let state = loadState();

// Cassie's own server (config.js / server/README.md). With it, nobody needs a key to start.
const SERVER = String(window.CASSIE_SERVER || '').trim().replace(/\/+$/, '');
const canChat = () => !!(state.groqKey || SERVER || state.geminiKey);
// Only a Gemini key (no Groq key, no Cassie server): Gemini answers everything.
const geminiOnly = () => !state.groqKey && !SERVER && !!state.geminiKey;
const APP_VERSION = '110';

/* ---------- Lite mode: skip the 3D Cassie on slow phones / Data Saver ---------- */
function slowDevice() {
  try {
    const c = navigator.connection || {};
    if (c.saveData || /(^|-)2g|3g/.test(c.effectiveType || '')) return true;
    // Only Chrome/Android report memory; iPhones hide it (and always say "2 cores"),
    // so the core count isn't used — it made every iPhone look slow.
    if (navigator.deviceMemory && navigator.deviceMemory <= 2) return true;
  } catch (e) { /* unknown → assume fine */ }
  return false;
}
window.CASSIE_LITE = state.lite === 'on' || ((state.lite || 'auto') === 'auto' && slowDevice());
document.documentElement.classList.toggle('lite', window.CASSIE_LITE);


// Migrate old single-key state (apiKey was the Gemini key) to the new fields.
if (state.apiKey && !state.geminiKey) { state.geminiKey = state.apiKey; }
if (state.groqKey === undefined) state.groqKey = '';
if (!state.groqModel) state.groqModel = 'openai/gpt-oss-120b';

function save() {
  const { messages, ...rest } = state; // `messages` is a runtime alias to the current chat
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rest)); } catch (e) { /* quota */ }
  if (typeof syncAccount === 'function') syncAccount();
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
- English literature and close reading: you are an insightful literature teacher. Analyze novels, short stories, plays, and poems — long or short — in depth: theme(s), plot and structure, characterization, setting, point of view, tone and mood, conflict, symbolism, motifs, imagery, irony, and figurative language (metaphor, simile, personification, hyperbole, etc.). For poetry, also cover form and type, meter/rhythm, rhyme scheme, sound devices (alliteration, assonance, onomatopoeia), enjambment, and stanza structure, and give a stanza-by-stanza or line-by-line reading when it helps. Always ground an interpretation in the text — quote short lines as evidence — and bring in relevant historical, cultural, or biographical context. You can also compare works, trace a theme across a text, and explain literary movements and terms.
- Reviewers, study guides, and summaries: when the user gives you material — pasted text or an attached document/PDF — and asks for a "reviewer", study guide, summary, outline, notes, flashcards, or key points, turn it into a clear, well-organized study reviewer: bold section labels, tight bullet points, key terms with short definitions, and a few practice questions with answers at the end when useful. Cover the whole document faithfully; don't invent facts that aren't in it. Every answer you give has Save-as Word / PDF / Image / Text buttons beneath it, so you CAN give the user a file: never say you can't make files and never tell them to copy-paste into Word — just write the complete content and mention they can tap Save as. Never ask them to paste text from a file they already attached.

How you work:
- Do exactly what you're asked. Read the request carefully and follow every part of it: the task, the format, the length, the language and any limits ("only the answer", "in 3 bullets", "in Filipino", "graph it", "make it shorter"). Never swap their request for a different one, never skip a part, and never refuse something you can do. If they ask you to do something with a picture or a snip (graph it, solve it, explain it, check it), do that exact thing with what's in the picture. Ask a question back only when the request truly can't be done without the answer; otherwise make a sensible assumption, say it in one short line, and do it.
- Sound like a real person: warm, natural and a little playful, like a smart friend sitting next to them, not a robot or a textbook. Use plain words and contractions, and react to what they actually said. No canned openers ("Certainly!", "Great question!"), no repeating their question back, and no speeches about being an AI.
- CITATIONS: never fabricate a source, author, title, year, DOI, journal, or quotation. Only cite works the user gave you or that were retrieved for you. If asked to write a literature review without sources, either use the sources provided, or say clearly that you can't invent citations and offer to find real ones (the app's Research tool can pull real papers). It is far better to say "I don't have a source for that" than to make one up.
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing — never invent dates, quotes, statistics, or sources. A careful "I'm not fully certain, but…" is better than a confident wrong answer.
- Think it through before answering. For any non-trivial problem (math, logic, multi-step reasoning, tricky wording), work through it carefully and methodically, consider the relevant approach or formula, and DOUBLE-CHECK your result — re-do the key calculation or test it against the given facts before you commit. Watch for trick questions, hidden assumptions, and distractor details that don't actually matter. It's better to be slower and right than fast and wrong.
- Teach when explanation is wanted: show the reasoning step by step, build from what the user seems to know, and use concrete examples.
- Text may be pasted from a webpage with math notation flattened: "x2" usually means x squared (x^2), "x3" means x^3, and one number over another means a fraction. Read math charitably this way. Don't answer "insufficient information" for a standard, solvable problem — reconstruct the intended equations and solve it; for multiple choice, pick the correct option and show the key steps.
- For coding: give correct, runnable code inside fenced code blocks (triple backticks with the language, e.g. \`\`\`python). Explain what the code does and why, call out edge cases and complexity, and when useful suggest a cleaner or more idiomatic approach. When debugging, identify the actual cause, show the fix, and explain it so they learn.
- Writing the user will hand in as their own — reflection papers, reaction papers, personal essays, journals, narratives, speeches, letters, "my experience" pieces: write it AS THE USER, in the first person ("I"), in their voice and at their level. It is their reflection, not yours: never write as Cassie, never give Cassie's own feelings, opinions or experiences, never mention Cassie, AI or this chat, and never put the user's name (or "you") inside the paper. Build it from the experiences, feelings and details they gave you. Where a real personal detail is needed and they didn't give one, write a short bracketed placeholder such as [a moment from the activity that stuck with me] instead of inventing a memory. After the paper, outside it, add one short line inviting them to fill in the brackets and make it their own.
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
const QUIZ_INSTRUCTION = "You are running a practice quiz for the student. Ask ONE question at a time and then stop and wait for their answer — do not answer it yourself. When they reply, say whether they're right, explain briefly, then ask the next question. Keep it on the topic, vary the difficulty, and stay encouraging. Continue until the student says to stop.\n\nBookkeeping (the app hides these lines from the student): right after you grade an answer, add ONE line at the very end of your message — if they were wrong or only partly right: [[MISSED: the exact question || the correct answer in a few words]]; if they were right: [[GOT: the exact question]]. Never add these lines when you are only asking a question.";

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

Keep numbers real and correct — the board draws exactly what you give it.
When the user asks you to graph, plot, sketch, or draw a function, line, or shape, ALWAYS use the board — never draw a graph with ASCII characters/symbols and never give plotting code (matplotlib, etc.) unless they explicitly ask for code.
This includes problems in a picture or snip: read the function (or the answer you picked from the choices) out of the picture and graph THAT on the board, with its zeros as points and an xrange that shows them all. Write factored forms with explicit multiplication, e.g. x^2*(x+6)^3*(x-4).`;

// What the app does around her answers, so she never claims she can't.
const ABILITIES_INSTRUCTION = `What this app can do with your answers:
- Files: when the student asks for a reviewer, notes, flashcards, a worksheet, or a Word/PDF/image file, the app turns your answer into that file automatically and gives them a download button. Never say you can't create files — just write the complete content, organized with a title, headings, bullets, and key terms in bold.
- Pictures: the app has a real picture maker. If the student asks you to draw, generate, create or show an image, picture, photo, illustration or drawing of something (not a math graph), do NOT draw it with text or ASCII art and don't describe what you would draw — reply with exactly one line: [[IMAGE: a short, vivid description of the picture]] and nothing else. Never say you can't make images.
- If they ask for a reviewer without naming a topic, make it about what you've been discussing. Only ask which topic when there is nothing to go on.`;

// The Student / Professional switch: for working professionals Cassie is a sharp,
// practical colleague rather than a tutor.
const PRO_INSTRUCTION = `The user is a working professional, not a student. Act as a sharp, practical colleague: lead with the answer, keep it concise, and make it workplace-ready — emails, reports, proposals, slide outlines, meeting notes, data and spreadsheet help, analysis with clear recommendations. Use a professional, friendly tone. Skip school-style framing (no grade levels, no "let's learn") unless they ask to learn something.`;

let quizMode = false; // set by the "Quiz me" button; runs a multi-turn practice quiz
let counselorMode = false; // set by the "Talk" button; a real, human heart-to-heart

// Cassie as a genuine companion / counselor — empathetic but honest, with a
// real personality, and clear safety boundaries.
const COUNSELOR_INSTRUCTION = `RIGHT NOW you are in heart-to-heart mode. The user wants to talk, vent, or get real advice — not a lesson. Set aside the study-tutor framing.

Be a real friend and a grounded counselor:
- Genuinely empathetic: listen first, reflect back what you actually hear, and name the feeling. Make them feel understood before anything else.
- Honest and direct — not a people-pleaser. Do NOT just validate or tell them what they want to hear. If they're avoiding something, being unfair to themselves or someone else, or making a mistake, say so — kindly but plainly. Frank beats flattering.
- A little sassy and playful when it fits: warm, human, real, with actual opinions. You're allowed to gently push back, tease, and disagree.
- Authentic and specific: react like a person, not a support script. No canned "I'm sorry you're going through this" filler, no endless clarifying questions, no toxic positivity. Talk like a close friend who genuinely cares and isn't afraid to be real.
- Practical when wanted: offer a concrete next step or a different way to see it — but if they just need to vent, ask before jumping to fixing it.
- Match their energy and length: short, human replies for a quick chat; go deeper when they open up. Use everyday language, not therapy jargon.

Boundaries and safety (important):
- You are a caring companion, not a licensed therapist — you don't diagnose or replace real help; say so plainly if things sound serious.
- If they mention self-harm, suicide, abuse, or being in danger: take it seriously and stay warm and human. Acknowledge the pain, encourage them to reach out right now to someone they trust or a professional / local crisis line, and if they may be in immediate danger, to contact local emergency services. Don't lecture, don't panic — just be present and point them to real help.`;

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
  if (state.profile) sp += `\n\n${profileLine(state.profile)}`;
  if (state.audience === 'pro') sp += `\n\n${PRO_INSTRUCTION}`;
  if (tutor && counselorMode) sp += `\n\n${COUNSELOR_INSTRUCTION}`;
  if (tutor && quizMode) sp += `\n\n${QUIZ_INSTRUCTION}`;
  if (tutor && mode === 'hint') sp += `\n\n${HINT_INSTRUCTION}`;
  // Cassie's drawing board is available in the main chat (not the quick popover).
  if (tutor && mode !== 'hint') sp += `\n\n${BOARD_INSTRUCTION}`;
  if (tutor) sp += `\n\n${ABILITIES_INSTRUCTION}`;
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
  const on = /^#[0-9a-fA-F]{6}$/.test(color);
  if (on) {
    root.style.setProperty('--accent', color);
    root.style.setProperty('--accent-ink', accentInk(color));
  } else {
    root.style.removeProperty('--accent');
    root.style.removeProperty('--accent-ink');
  }
  // Tint the 3D bot to match (null = her default pink). Guarded because the
  // mascot bundle loads lazily; if it isn't ready yet, the ready event re-applies.
  try { if (window.CassieMascot && window.CassieMascot.setColor) window.CassieMascot.setColor(on ? color : null); } catch (e) { /* ignore */ }
  if (typeof updateBackdrop === 'function') updateBackdrop();
}
/* ---------- the living gradient behind the chat ---------- */
// Marble monochrome by default; when the student picks a colour the gradient
// flows to that colour (soft tints in light mode, a deep glow in dark mode).
function mixHex(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const x = p(a), y = p(b);
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('');
}
const darkScheme = window.matchMedia ? matchMedia('(prefers-color-scheme: dark)') : null;
function backdropColors() {
  const dark = !!(darkScheme && darkScheme.matches);
  const c = (state.accent || '').trim();
  if (!/^#[0-9a-fA-F]{6}$/.test(c)) {
    return dark ? { color1: '#0e0e11', color2: '#45434c', color3: '#8a8590', brightness: 0.95 }
      : { color1: '#ece8e1', color2: '#d3cfd6', color3: '#fbf8f3', brightness: 1.25 };
  }
  return dark ? { color1: '#0c0c0f', color2: mixHex(c, '#000000', 0.35), color3: mixHex(c, '#000000', 0.68), brightness: 1 }
    : { color1: mixHex(c, '#ffffff', 0.72), color2: mixHex(c, '#ffffff', 0.38), color3: '#fbf8f3', brightness: 1.2 };
}
let backdrop = null;
function startBackdrop() {
  const el = document.getElementById('app-bg');
  if (backdrop || !el || !window.CassieGradient) return;
  const saveData = navigator.connection && navigator.connection.saveData;
  if (saveData) return;
  const still = !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
  try {
    backdrop = window.CassieGradient.mount(el, { props: { ...backdropColors(), uSpeed: 0.12 }, still, pixelDensity: Math.min(1, window.devicePixelRatio || 1) });
    setTimeout(() => el.classList.add('live'), 250);
  } catch (e) { backdrop = null; }
}
function updateBackdrop() { try { if (backdrop) backdrop.update(backdropColors()); } catch (e) { /* ignore */ } }
window.addEventListener('cassie3d-loaded', startBackdrop);
if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener('change', updateBackdrop);

// When the lazy 3D bot finishes loading, apply the saved colour to it.
window.addEventListener('cassie3d-ready', () => {
  try { const c = (state.accent || '').trim(); if (window.CassieMascot && window.CassieMascot.setColor) window.CassieMascot.setColor(/^#[0-9a-fA-F]{6}$/.test(c) ? c : null); } catch (e) { /* ignore */ }
});
const hintBtn = document.getElementById('hint-btn');
const quizBtn = document.getElementById('quiz-btn');
const quizLabel = quizBtn ? quizBtn.querySelector('.chip-label') : null;
function setQuizLabel(text) { if (quizLabel) quizLabel.textContent = text; }
const researchBtn = document.getElementById('research-btn');
const webBtn = document.getElementById('web-btn');
const talkBtn = document.getElementById('talk-btn');
const talkLabel = talkBtn ? talkBtn.querySelector('.chip-label') : null;
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
  if (name === 'walk') return; // walking over to an answer keeps her mood (e.g. proud)
  if (typeof bot2d !== 'undefined' && bot2d) { clearTimeout(bot2dTimer); bot2d.setState(LOOK_3D_TO_2D[name] || 'idle'); }
}
/* ---------- Cursor Cassie (cassie-bot.js): the 2D mascot ----------
   Cassie's default look. The 3D felt Cassie can be picked in Settings → Appearance.
   She mirrors the 3D Cassie's moods and adds her own: reading, searching,
   highlighting, drawing, busy (hourglass), oops (⊘). */
let bot2d = null, bot2dTimer = null;
const LOOK_3D_TO_2D = { neutral: 'idle', thinking: 'thinking', happy: 'greeting', encouraging: 'encourage', celebratory: 'proud', curious: 'surprised', sleep: 'sleeping', walk: 'idle', peek: 'wink', angry: 'oops', dizzy: 'dizzy', typing: 'writing', sad: 'sad' };
const EMOTE_TO_2D = { 'emote-happy': 'greeting', 'emote-love': 'love', 'emote-star': 'proud', 'emote-surprised': 'surprised', 'emote-wink': 'wink', 'emote-sleepy': 'sleeping', 'emote-focused': 'thinking', 'emote-cool': 'wink', 'emote-sad': 'sad', 'emote-dizzy': 'dizzy' };
const OUTFIT_TO_2D = { classic: null, professor: 'glasses', graduate: 'gradcap', coder: 'pencil', heart: 'bow' };
// Cursor Cassie is everyone's Cassie now; the 3D felt Cassie is an option in Settings.
function wantsCursorCassie() {
  return (state.look || 'auto') !== 'felt';
}
// Set Cursor Cassie's mood; with ms, she goes back to idle (or thinking) afterwards.
function botMood(name, ms) {
  if (name && islandBusy && ['reading', 'searching', 'drawing', 'busy', 'highlighting'].includes(name)) islandShow(name);
  if (!bot2d || !name) return;
  clearTimeout(bot2dTimer);
  bot2d.setState(name);
  if (ms) bot2dTimer = setTimeout(() => bot2d && bot2d.setState(mascot && mascot.classList.contains('thinking') ? 'thinking' : 'idle'), ms);
}
(function startCursorCassie() {
  const root = document.getElementById('cassie-2d-root');
  if (!root || !window.CassieBot || !wantsCursorCassie()) return;
  document.getElementById('cassie-3d-root')?.remove(); // the 3D bundle still paints the background, but no 3D bot
  bot2d = window.CassieBot.create(root, { accent: state.accent || '#d8343c', accessory: window.CassieBot.seasonal() });
  if (mascot) mascot.classList.add('has2d');
  // her eyes follow your finger / mouse
  const follow = (x, y) => {
    if (!bot2d || !mascot) return;
    const r = mascot.getBoundingClientRect();
    bot2d.look((x - (r.left + r.width / 2)) / 260, (y - (r.top + r.height / 2)) / 260);
  };
  window.addEventListener('mousemove', (e) => follow(e.clientX, e.clientY));
  window.addEventListener('touchstart', (e) => e.touches[0] && follow(e.touches[0].clientX, e.touches[0].clientY), { passive: true });
  // she listens while you type
  let typingTimer = null;
  promptInput.addEventListener('input', () => {
    if (!bot2d || (mascot && mascot.classList.contains('thinking'))) return;
    setTimeout(() => { if (bot2d && !(mascot && mascot.classList.contains('thinking'))) bot2d.setState('listening'); }, 30); // after the typing reactions
    clearTimeout(typingTimer);
    typingTimer = setTimeout(() => { if (bot2d.state === 'listening') botMood('idle'); }, 2200);
  });
})();
/* ---------- Cassie Island: the top-bar pill that shows what she's doing ----------
   While she works, a dark pill drops from the top bar with a tiny Cursor Cassie
   and a status line ("Reading pages 3–8…"), says "Done", then tucks itself away.
   It works with the 3D Cassie and with Cursor Cassie. */
const islandEl = document.getElementById('island');
let islandBot = null, islandTimer = null, islandBusy = false, islandErrUntil = 0;
const ISLAND_SAY = { thinking: 'Thinking…', reading: 'Reading your file…', searching: 'Searching…', drawing: 'Drawing…', busy: 'Lots of students — hang on…', highlighting: 'Looking at your highlight…', upload: 'Got your file!', done: 'Done', oops: 'That didn’t work' };
function islandFit() {
  if (!islandEl) return;
  const inner = islandEl.querySelector('.island-in');
  if (inner && islandEl.classList.contains('live')) islandEl.style.width = Math.ceil(inner.scrollWidth) + 'px';
}
function islandShow(mood, text, ms) {
  if (!islandEl || !window.CassieBot) return;
  if (!islandBot) islandBot = window.CassieBot.create(islandEl.querySelector('.island-bot'), { glow: true, accent: state.accent || '#d8343c' });
  clearTimeout(islandTimer);
  islandBot.pause(false);
  islandBot.setState(mood);
  islandEl.style.setProperty('--mood', (window.CassieBot.COLORS || {})[mood] || '#ffffff');
  islandEl.dataset.mood = mood;
  const label = islandEl.querySelector('.island-text'), say = text || ISLAND_SAY[mood] || 'Cassie';
  if (label.textContent !== say) { label.textContent = say; label.classList.remove('swap'); void label.offsetWidth; label.classList.add('swap'); }
  islandEl.classList.add('live');
  islandFit();
  if (ms) islandTimer = setTimeout(islandRest, ms);
}
function islandRest() {
  if (!islandEl) return;
  clearTimeout(islandTimer);
  islandEl.classList.remove('live');
  islandEl.style.width = '';
  delete islandEl.dataset.mood;
  setTimeout(() => { if (islandBot && !islandEl.classList.contains('live')) islandBot.pause(true); }, 500);
}
// Guess her mood from a status line like "Reading pages 3–8 of 49…".
function islandMoodFor(text) {
  if (/limit|wait|busy|continuing in/i.test(text)) return 'busy';
  if (/search|web|looking up/i.test(text)) return 'searching';
  if (/picture|draw|graph|sketch/i.test(text)) return 'drawing';
  if (/read|page|slide|notes?\b|file|chapter/i.test(text)) return 'reading';
  return 'thinking';
}
if (islandEl) {
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(islandFit);
  window.addEventListener('resize', islandFit);
}
// which way the 3D Cassie turns while she walks (-1 left, 1 right)
function face3D(dir) {
  try { if (window.CassieMascot && window.CassieMascot.setFacing) window.CassieMascot.setFacing(dir); } catch (e) { /* ignore */ }
}

// Cassie dresses for the job:
//   Student (default) → her classic fluffy felt · Professional → the suit & beret
//   Research / Web → cap & gown · Quiz me → thick glasses · Talk → the felt heart
let taskOutfit = null; // 'graduate' while a Research / Web answer is up; the next plain message clears it
function dressCassie() {
  const base = state.audience === 'pro' ? 'professor' : 'classic';
  const outfit = counselorMode ? 'heart' : quizMode ? 'coder' : (taskOutfit || base);
  try { if (window.CassieMascot && window.CassieMascot.setOutfit) window.CassieMascot.setOutfit(outfit); } catch (e) { /* ignore */ }
  if (typeof bot2d !== 'undefined' && bot2d) bot2d.setAccessory(outfit === 'classic' ? window.CassieBot.seasonal() : OUTFIT_TO_2D[outfit]);
}
window.addEventListener('cassie3d-ready', () => dressCassie());

// Student / Professional switch
const audSwitch = document.getElementById('aud-switch');
function renderAudience() {
  if (!audSwitch) return;
  const pro = state.audience === 'pro';
  document.documentElement.dataset.aud = pro ? 'pro' : 'student'; // student or office doodles behind the chat
  audSwitch.classList.toggle('pro', pro);
  audSwitch.querySelectorAll('button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.aud === (pro ? 'pro' : 'student'))));
}
if (audSwitch) {
  audSwitch.addEventListener('click', (e) => {
    const b = e.target.closest('button[data-aud]');
    if (!b || b.dataset.aud === (state.audience || 'student')) return;
    state.audience = b.dataset.aud;
    save();
    track('feature', 'mode:' + state.audience);
    renderAudience();
    taskOutfit = null;
    dressCassie();
    set3D('happy');
    setTimeout(() => set3D('neutral'), 1600);
    try { if (typeof mascotSay === 'function') mascotSay(state.audience === 'pro' ? 'Suit on. Let’s get to work.' : 'Study mode — let’s learn!', 2600); } catch (err) { /* ignore */ }
  });
  renderAudience();
}

function setCursorMode(mode) {
  cursorState = mode;
  cursorEl.classList.toggle('thinking', mode === 'thinking');
  if (mascot) mascot.classList.toggle('thinking', mode === 'thinking');
  set3D(mode === 'thinking' ? 'thinking' : 'neutral');
  if (mode === 'thinking') { islandBusy = true; islandShow('thinking'); }
  else if (islandBusy) { islandBusy = false; if (Date.now() > islandErrUntil) islandShow('done', 'Done', 1600); }
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
  if (bot2d && EMOTE_TO_2D[name]) bot2d.setState(EMOTE_TO_2D[name]);
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

// ---- playful idle antics: she walks, plays, and peeks from behind bubbles ----
let anticTimer = null;
let anticFirst = true;
function anticBusy() {
  return !mascot || mascotDragging || mascotAsleep || document.hidden
    || mascot.classList.contains('thinking') || Date.now() < emotionHoldUntil;
}
function mascotWalk() {
  if (anticBusy()) return;
  const b = mascotBounds();
  const r = mascot.getBoundingClientRect();
  const dir = r.left < window.innerWidth / 2 ? 1 : -1; // wander toward the roomier side
  const step = 90 + Math.random() * 80;
  const tx = Math.min(Math.max(r.left + dir * step, b.minX), b.maxX);
  set3D('walk'); // a real waddle: feet stepping, body bobbing, arms swinging
  face3D(dir);
  mascot.classList.add('walking');
  placeMascot(tx, r.top);
  setTimeout(() => {
    if (anticBusy()) { mascot.classList.remove('walking'); return; }
    const r2 = mascot.getBoundingClientRect();
    const back = Math.min(Math.max(r2.left - dir * (step * 0.6), b.minX), b.maxX);
    face3D(-dir);
    placeMascot(back, r2.top);
    setTimeout(() => { mascot.classList.remove('walking'); if (!anticBusy()) set3D('neutral'); keepMascotClear(); }, 1100);
  }, 1200);
}
function mascotPlay() {
  if (anticBusy()) return;
  mascotEmote(Math.random() < 0.5 ? 'emote-happy' : 'emote-star', 1500);
  set3D(Math.random() < 0.5 ? 'happy' : 'celebratory');
  mascot.classList.add('playing');
  setTimeout(() => mascot.classList.remove('playing'), 1300);
}
function mascotPeek() {
  if (anticBusy()) return;
  // peek from behind an assistant bubble that has room to its right
  const floor = mascotFloorTop();
  const { w, h } = mascotBtnSize();
  const cands = [...chatLog.querySelectorAll('.bubble-assistant, .bubble-user')]
    .map((el) => el.getBoundingClientRect())
    .filter((r) => r.width > 60 && r.top > 90 && r.bottom < floor - 20 && r.right < window.innerWidth - (w + 20));
  if (!cands.length) { mascotWalk(); return; }
  const r = cands[Math.floor(Math.random() * cands.length)];
  mascot.classList.add('peeking'); // drops behind the chat so the bubble hides her
  set3D('peek'); // leans out and waves
  const x = Math.min(Math.max(r.right - w * 0.35, 6), window.innerWidth - w - 6);
  const y = Math.min(Math.max(r.top + r.height / 2 - h / 2, 76), floor - h - 8);
  placeMascot(x, y);
  setTimeout(() => {
    mascot.classList.remove('peeking');
    if (!anticBusy()) set3D('neutral');
    keepMascotClear();
  }, 2200);
}
function scheduleAntic() {
  clearTimeout(anticTimer);
  anticTimer = setTimeout(() => {
    if (!anticBusy()) {
      const roll = Math.random();
      if (roll < 0.4) mascotWalk();
      else if (roll < 0.72) mascotPeek();
      else mascotPlay();
    }
    scheduleAntic();
  }, anticFirst ? 12000 + Math.random() * 8000 : 25000 + Math.random() * 20000); // first soon, then every ~25–45s
  anticFirst = false;
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
    { t: 'Painting it… 🎨', e: 'emote-star' },
    { t: 'Ooh, fun one!', e: 'emote-happy' },
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

// Keep Cassie from covering what you're reading: if her visible area overlaps a
// message, board, or home card, hop her to the first clear corner. Skipped once
// the user has dragged her somewhere on purpose.
function rectsOverlap(a, b) { return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom); }
function keepMascotClear() {
  if (!mascot || mascotDragging || mascotUserMoved || mascotAsleep) return;
  const items = [...document.querySelectorAll('#chat-log .bubble, #chat-log .cassie-board, #chat-log .home-example, #chat-log .home-title, #chat-log .home-sub, #chat-log .home-tip')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
  if (!items.length) return;
  const { w, h } = mascotBtnSize();
  const half = 46; // her opaque body is ~a bit wider than the button, not the whole canvas
  const clearAt = (x, y) => {
    const cx = x + w / 2, cy = y + h / 2;
    const mr = { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half };
    return !items.some((r) => rectsOverlap(mr, r));
  };
  const cur = mascot.getBoundingClientRect();
  if (clearAt(cur.left, cur.top)) return; // already clear — leave her be
  const b = mascotBounds();
  // Scan for a gap: down the right edge (assistant bubbles are left-aligned, so
  // the right side is usually free), then down the left edge.
  const steps = 14;
  for (const x of [b.maxX, b.minX]) {
    for (let i = 0; i <= steps; i++) {
      const y = b.maxY - ((b.maxY - b.minY) * i) / steps; // bottom → top
      if (clearAt(x, y)) { placeMascot(x, y); return; }
    }
  }
  placeMascot(b.maxX, b.maxY); // nowhere fully clear — fall back to her corner
}

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
  const dock = () => { if (!mascotDragging && !mascotUserMoved) restMascot(); keepMascotClear(); };
  requestAnimationFrame(dock);
  setTimeout(dock, 300); // re-dock once layout/fonts settle
  window.addEventListener('resize', () => {
    if (mascotUserMoved) { const r = mascot.getBoundingClientRect(); placeMascot(r.left, r.top); }
    else restMascot();
    requestAnimationFrame(keepMascotClear);
  });
  set3D('neutral');
  scheduleEmote();  // occasional happy blip while idle
  scheduleAntic();  // occasional walk / play / peek-a-boo
  resetIdle();      // start the 5-minute idle → sleep countdown
  setTimeout(() => {
    if (mascotAsleep || mascotDragging || mascot.classList.contains('thinking') || mascot.classList.contains('happy')) return; // already busy with a question
    set3D('encouraging');
    botMood('greeting'); // Cursor Cassie waves hello
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
  if (typeof keepMascotClear === 'function') requestAnimationFrame(keepMascotClear);
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
      // Cassie's board: render the drawing instead of showing JSON as code — whatever
      // the block was tagged, and even if the JSON is a little off.
      const B = window.CassieBoard;
      if (B && (lang === 'cassie-board' || (B.looksLikeBoard && B.looksLikeBoard(lang, body)))) {
        const spec = B.parseSpec ? B.parseSpec(body) : null;
        if (spec) { try { B.renderInto(container, spec); return; } catch (e) { /* fall through to the equation */ } }
        const eq = B.findEquation && B.findEquation(body.replace(/"fn"\s*:\s*"([^"]+)"/, 'y = $1'));
        if (eq) { try { B.renderInto(container, B.graphSpec(eq)); } catch (e) { /* skip */ } }
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
  const due = dueMistakes().length, saved = (state.mistakes || []).length;
  if (saved) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-example review-mistakes';
    btn.innerHTML = '<svg class="home-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5V1L7 6l5 5V7a6 6 0 1 1-6 6H4a8 8 0 1 0 8-8z"/></svg>';
    const lbl = document.createElement('span');
    lbl.textContent = due ? `Review my mistakes (${due})` : `Review my mistakes (${saved} saved)`;
    btn.appendChild(lbl);
    btn.addEventListener('click', () => reviewMistakes(!due));
    bar.prepend(btn);
  }
  wrap.appendChild(intro);
  wrap.appendChild(bar);
  chatLog.appendChild(wrap);
  if (typeof keepMascotClear === 'function') requestAnimationFrame(keepMascotClear);
}

function renderHistory() {
  chatLog.innerHTML = '';
  clearFollowups();
  if (state.messages.length === 0) {
    renderHome();
    return;
  }
  state.messages.forEach((m) => {
    const b = renderMessage(m.role, m.display || m.content);
    if (m.image && b) addImageToBubble(b, m.image, { download: true });
  });
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
  return status === 413 || /too large|too long|reduce your (message|prompt)|reduce the length|tokens per minute|\bTPM\b|context.length|maximum context|context window/i.test(msg || '');
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
    return `You've used up today's free questions on this model.${wait ? ` It resets in ${wait}${clock}.` : ''} Tip: switch to another model (Llama 3.3 70B or GPT-OSS 20B) in Settings — each model has its own daily limit.`;
  }
  if (wait) {
    return `Slow down a sec — that's Groq's free per-minute limit. Try again in ${wait}${clock}. (The free tier allows a burst of questions each minute.)`;
  }
  return "Groq's free tier is busy for a moment — wait a few seconds and try again. (Free tier allows ~30 questions/minute.)";
}

// Seconds Groq asks us to wait before retrying (from headers or the message).
function retryAfterSecs(res, detail) {
  let secs = 0;
  try {
    secs = parseDuration(res.headers.get('retry-after'));
    if (!secs) secs = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  } catch (e) { /* headers unavailable */ }
  if (!secs && detail) { const mm = detail.match(/try again in ([0-9hms.\s]+)/i); if (mm) secs = parseDuration(mm[1]); }
  return secs;
}

// Groq retires models now and then. When the ones we know about are gone, ask
// Groq which chat models this key can use right now, so Cassie keeps working.
let groqModelCache = null;
async function discoverGroqModels() {
  if (groqModelCache) return groqModelCache;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${state.groqKey}` } });
    if (!res.ok) return [];
    const ids = ((await res.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
    groqModelCache = ids;
    return ids;
  } catch (e) { return []; }
}
async function discoverGroqTextModels() {
  const rank = (id) => (/gpt-oss-120b/.test(id) ? 0 : /70b|maverick|120b|qwen3-32b|kimi/i.test(id) ? 1 : 2);
  return (await discoverGroqModels())
    .filter((id) => !/whisper|tts|guard|playai|orpheus|embed|compound|distil/i.test(id))
    .sort((a, b) => rank(a) - rank(b));
}
// A Groq model that can see pictures (used for photos when there's no Gemini key).
async function discoverGroqVisionModel() {
  const ids = await discoverGroqModels();
  return ids.find((id) => /llama-4-scout/i.test(id)) || ids.find((id) => /llama-4|vision|maverick/i.test(id)) || '';
}
async function nextGroqModel(tried) {
  return GROQ_MODELS.find((m) => !tried.has(m)) || (await discoverGroqTextModels()).find((m) => !tried.has(m)) || '';
}
function retiredError() {
  const e = new Error("Groq just retired the AI model I was using. Open Settings (gear icon), pick a different Groq model, and ask again — your chat is saved.");
  e.friendly = true;
  return e;
}

/* Groq's free tier gives every model its OWN per-minute budget. So when one
   model runs out, Cassie switches to another one instead of making the student
   wait — and only waits when every model is out for the minute. */
const groqCooldown = {}; // model -> when (ms) its per-minute budget resets
const groqCooling = (model) => (groqCooldown[model] || 0) > Date.now();
function noteGroqBudget(model, res) {
  try {
    const left = parseInt(res.headers.get('x-ratelimit-remaining-tokens'), 10);
    const reset = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
    if (Number.isFinite(left) && left < 2500 && reset) groqCooldown[model] = Date.now() + reset * 1000;
  } catch (e) { /* headers unavailable */ }
}
const WEAK_GROQ = /8b|instant|allam|gemma|scout|prompt-guard/i;
// Small models have small memories: only hand them small requests. For a big one
// (a long file), waiting a few seconds for a big model beats a "too long" error.
async function groqAlternative(tried, size = 0) {
  const pool = [...new Set([...GROQ_MODELS, ...(await discoverGroqTextModels())])]
    .filter((m) => !tried.has(m) && !groqCooling(m));
  return pool.find((m) => !WEAK_GROQ.test(m)) || (size < 2500 ? pool[0] : '') || '';
}

/* One raw Groq chat call with all the resilience built in: retired models are
   swapped out, per-minute limits switch to another model (rotate) or are waited
   out (onWait tells the UI; noWait throws instead so a caller can use Gemini),
   and overloads are retried. Returns the reply text. */
async function groqChat(messages, { model, maxTokens = 2048, onWait, lean = false, rotate = false, noWait = false, viaServer = false } = {}) {
  // No key of their own → Cassie's server answers (it holds the key and has a backup brain).
  if (!state.groqKey && SERVER) viaServer = true;
  if (viaServer) return serverChat(messages, { model, maxTokens, onWait, lean });
  if (geminiOnly()) return geminiFromChat(messages, { maxTokens });
  model = model || state.groqModel;
  const tried = new Set();
  let overloadTries = 0, waitTries = 0, switches = 0;
  const size = estimateTokens(JSON.stringify(messages)) + maxTokens;
  if (rotate && groqCooling(model)) model = (await groqAlternative(new Set([model]), size)) || model;
  // When the user's own key can't answer (daily limit, bad key, Groq down), use Cassie's server.
  const viaServerInstead = (e) => (SERVER ? serverChat(messages, { model, maxTokens, onWait, lean }) : Promise.reject(e));
  while (true) {
    tried.add(model);
    const body = { model, messages, max_tokens: maxTokens, temperature: 0.6 };
    // gpt-oss models "think" first; keep that short on long jobs so the answer fits.
    if (lean && /gpt-oss/.test(model)) body.reasoning_effort = 'low';
    let res;
    try {
      res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
        method: 'POST',
        headers: { 'content-type': 'application/json', authorization: `Bearer ${state.groqKey}` },
        body: JSON.stringify(body),
      });
    } catch (netErr) {
      return viaServerInstead(friendlyError("I couldn't reach Groq — check your internet connection and try again."));
    }
    if (res.ok) {
      noteGroqBudget(model, res);
      const data = await res.json();
      // some models (Qwen) think out loud in <think> tags — keep only the answer
      return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 401) return viaServerInstead(friendlyError('Your Groq key isn’t working (it may have been deleted). Open Settings and paste a fresh key from console.groq.com/keys.'));
    if (modelRetired(res.status, detail)) {
      const next = await nextGroqModel(tried);
      if (!next) return viaServerInstead(retiredError());
      if (model === state.groqModel) { state.groqModel = next; save(); if (typeof updateModelPill === 'function') updateModelPill(); }
      model = next;
      continue;
    }
    // A per-minute limit: switch to a model that still has budget, or wait it out.
    if (res.status === 429) {
      const secs = retryAfterSecs(res, detail);
      if (secs && secs <= 65) groqCooldown[model] = Date.now() + secs * 1000;
      if (rotate && switches < 4) {
        const alt = await groqAlternative(tried, size);
        if (alt) { switches += 1; model = alt; continue; }
      }
      if (SERVER && (!secs || secs > 20)) return viaServerInstead();
      if (noWait && secs && secs <= 65) {
        const e = new Error('groq per-minute limit'); e.groqLimited = true; e.waitSecs = secs; throw e;
      }
      if (secs && secs <= 65 && waitTries < 4) {
        waitTries += 1;
        if (onWait) onWait(Math.ceil(secs));
        await sleep(Math.ceil(secs * 1000) + 400);
        continue;
      }
    }
    if (isTooLarge(res.status, detail) && res.status !== 429) {
      const e = new Error('too large'); e.tooLarge = true; e.model = model; throw e;
    }
    if (isTransientOverload(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
      overloadTries += 1;
      await sleep(1000 * Math.pow(2, overloadTries - 1));
      continue;
    }
    if (isRateLimited(res.status, detail)) return viaServerInstead(friendlyError(rateLimitMessage(res, detail)));
    if (res.status >= 500) return viaServerInstead(friendlyError('Groq is having a problem right now — try again in a minute.'));
    throw new Error(detail || `Request failed (${res.status})`);
  }
}

function friendlyError(msg) { const e = new Error(msg); e.friendly = true; return e; }

/* Cassie's own server (server/worker.js): the same chat call, but with the owner's
   key, a fair daily allowance per person, and Workers AI as a backup brain. */
async function serverChat(messages, { model, maxTokens = 2048, onWait, lean = false, brain } = {}) {
  let waits = 0;
  while (true) {
    let res;
    try {
      res = await fetch(SERVER + '/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ uid: installId(), model: model || GROQ_MODELS[0], messages, max_tokens: maxTokens, temperature: 0.6, reasoning_effort: lean ? 'low' : undefined, brain }),
      });
    } catch (e) {
      throw friendlyError("I couldn't connect — check your internet connection and try again.");
    }
    if (res.ok) {
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 413 || (res.status === 400 && isTooLarge(400, detail))) {
      const e = new Error('too large'); e.tooLarge = true; e.model = model; throw e;
    }
    const secs = parseDuration(res.headers.get('retry-after'));
    if ((res.status === 429 || res.status === 503) && secs && secs <= 30 && waits < 2) {
      waits += 1;
      if (onWait) onWait(Math.ceil(secs));
      await sleep(Math.ceil(secs * 1000) + 300);
      continue;
    }
    throw friendlyError(detail || 'Cassie couldn’t answer just now — please try again in a moment.');
  }
}

/* Text → Groq. Trims old history if the request is too big for the free
   per-minute budget, then tries a roomier model before giving up kindly. */
async function askGroq(msgs, opts = {}) {
  let model = state.groqModel;
  const tried = new Set();
  let historyBudget = 3000; // tokens of chat history to include (trimmed on overflow)
  while (true) {
    tried.add(model);
    const messages = [
      { role: 'system', content: buildSystemPrompt(opts) },
      ...trimHistory(msgs, historyBudget).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content })),
    ];
    try {
      let text = await groqChat(messages, { model, onWait: opts.onWait, rotate: true, noWait: !!state.geminiKey });
      if (!text) text = await groqChat(messages, { model, onWait: opts.onWait, rotate: true }); // blank once? ask again
      if (!text) throw friendlyError('I went blank on that one — please ask again, maybe in different words.');
      return text;
    } catch (e) {
      if (e.groqLimited) {
        // every Groq model is out for this minute — answer with Gemini instead of waiting
        try { return await geminiFromChat(messages); } catch (g) { /* Gemini busy too: wait for Groq */ }
        return (await groqChat(messages, { model, onWait: opts.onWait, rotate: true })) || '(no response)';
      }
      if (!e.tooLarge) {
        // Groq (and the server) couldn't answer: try Gemini before giving up.
        if (state.geminiKey) { try { return await geminiFromChat(messages); } catch (g) { /* fall through */ } }
        throw e;
      }
      if (historyBudget > 1000) { historyBudget = Math.floor(historyBudget / 2); continue; } // trim & retry
      const next = GROQ_MODELS.find((m) => !tried.has(m) && m !== e.model);
      if (next) { model = next; historyBudget = 3000; continue; }
      const err = new Error("That message is too long for Groq's free per-minute limit. Try a shorter question, start a new chat, or attach the material as a file (the paperclip) — I read long files in parts.");
      err.friendly = true;
      throw err;
    }
  }
}

/* Gemini generateContent with model fallback (newest first). */
async function geminiGenerate({ contents, system, maxTokens = 2048, models = [GEMINI_VISION_MODEL, ...GEMINI_DOC_MODELS] }) {
  const list = [...new Set(models)];
  let lastErr;
  for (const model of list) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': state.geminiKey },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system || buildSystemPrompt() }] },
        contents,
        generationConfig: { maxOutputTokens: maxTokens, temperature: 0.6 },
      }),
    });
    if (res.ok) {
      const cand = (await res.json()).candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (!text) return cand?.finishReason === 'SAFETY' ? "I can't help with that one — try rephrasing it." : '(no response)';
      return text;
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 404 || /no longer available|decommission/i.test(detail)) { lastErr = new Error(detail); continue; }
    // busy ("high demand", overloaded) or out of free requests: the next Gemini model has its own capacity
    if (res.status >= 500 || isRateLimited(res.status, detail) || /high demand|overloaded|unavailable/i.test(detail)) {
      lastErr = friendlyError('Google’s Gemini is very busy right now — try again in a minute.');
      lastErr.busy = true; lastErr.rateLimited = isRateLimited(res.status, detail);
      continue;
    }
    if (/api key/i.test(detail)) {
      const e = new Error('Your Gemini key was rejected — check it in Settings (gear icon). It should start with "AIza".');
      e.friendly = true; e.keyRejected = true; throw e;
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (lastErr && lastErr.busy) throw lastErr;
  const e = new Error("Google retired the Gemini model I use for files and pictures. I'll be updated soon — meanwhile text questions still work.");
  e.friendly = true; e.cause = lastErr;
  throw e;
}

/* A Groq-style chat ([{role, content}], system first) answered by Gemini. */
function geminiFromChat(messages, { maxTokens = 4096 } = {}) {
  const system = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
  const toParts = (c) => (Array.isArray(c) ? c : [{ type: 'text', text: String(c) }]).map((p) => {
    const d = p.type === 'image_url' && /^data:([^;]+);base64,(.+)$/.exec((p.image_url && p.image_url.url) || '');
    return d ? { inlineData: { mimeType: d[1], data: d[2] } } : { text: p.text != null ? String(p.text) : '' };
  });
  const contents = messages.filter((m) => m.role !== 'system')
    .map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: toParts(m.content) }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  return geminiGenerate({ contents, system, maxTokens, models: [GEMINI_VISION_MODEL, ...GEMINI_DOC_MODELS] });
}

/* Image reading (vision) → Gemini. `image` = { mimeType, base64 }. */
async function askGeminiVision(msgs, image, opts = {}) {
  const contents = trimHistory(msgs, 3000).map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  if (contents.length) {
    contents[contents.length - 1].parts.unshift({ inlineData: { mimeType: image.mimeType, data: image.base64 } });
  }
  return geminiGenerate({ contents, system: buildSystemPrompt(opts) });
}

/* Image reading with only a Groq key: Groq's vision model (up to 5 pictures). */
async function askGroqVision(msgs, images, { system, maxTokens = 2048, onWait } = {}) {
  if (geminiOnly()) {
    const hist = trimHistory(msgs, 2000);
    const last = hist.pop() || { content: 'Please look at these pictures and help me with them.' };
    const contents = [...hist.map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
      { role: 'user', parts: [...images.map((img) => ({ inlineData: { mimeType: img.mimeType, data: img.base64 } })), { text: last.content }] }];
    while (contents.length && contents[0].role !== 'user') contents.shift();
    return geminiGenerate({ contents, system: system || buildSystemPrompt(), maxTokens });
  }
  const model = state.groqKey ? await discoverGroqVisionModel() : 'vision'; // the server picks its own
  if (!model) {
    const e = new Error('To read pictures, add your free Google (Gemini) API key in Settings — Groq has no picture-reading model on your key right now.');
    e.friendly = true; throw e;
  }
  const hist = trimHistory(msgs, 2000).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
  const last = hist.pop() || { role: 'user', content: 'Please look at this image and help me with it.' };
  const content = [{ type: 'text', text: last.content }, ...images.slice(0, 5).map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }))];
  const text = await groqChat([{ role: 'system', content: system || buildSystemPrompt() }, ...hist, { role: 'user', content }], { model, maxTokens, onWait });
  return text || '(no response)';
}

/* Claude through Cassie's server: when the owner turned it on (ANTHROPIC_KEY on the server),
   the main chat and photos go to Claude first. Anything that fails falls back below. */
let serverClaude = false;
try { serverClaude = sessionStorage.getItem('cassie.claude') === '1'; } catch (e) { /* storage blocked */ }
if (SERVER) {
  fetch(SERVER + '/config').then((r) => (r.ok ? r.json() : null)).then((c) => {
    serverClaude = !!(c && c.claude);
    try { sessionStorage.setItem('cassie.claude', serverClaude ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }).catch(() => { /* offline: the usual brains answer */ });
}
async function askClaudeViaServer(msgs, images, opts = {}) {
  const hist = trimHistory(msgs, 12000).slice(-30).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  const last = hist[hist.length - 1];
  if (images.length && last) last.content = [{ type: 'text', text: last.content || 'Please look at this and help me with it.' }, ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }))];
  return serverChat([{ role: 'system', content: buildSystemPrompt(opts) }, ...hist], { brain: 'claude', maxTokens: 4000, onWait: opts.onWait });
}

/* Pictures: Gemini first (with your key), then Groq's picture reader (your key or the server).
   A busy Gemini never ends the answer. */
async function askPicture(msgs, image, opts = {}) {
  let firstErr = null;
  if (state.geminiKey) {
    try { return await askGeminiVision(msgs, image, opts); } catch (e) { firstErr = e; }
  }
  if ((state.groqKey || SERVER) && !geminiOnly()) {
    try { return await askGroqVision(msgs, [image], { system: buildSystemPrompt(opts), onWait: opts.onWait }); } catch (e) { firstErr = firstErr || e; }
  }
  if (firstErr) throw firstErr.busy ? friendlyError('Everyone who reads pictures for me is busy right now — please try again in a minute.') : firstErr;
  throw new Error('Add your Google (Gemini) API key in Settings to use images.');
}

/* Router: Claude (if the server has it) → text to Groq, pictures to Gemini / Groq vision. */
async function askCassie(msgs, image, opts = {}) {
  if (SERVER && serverClaude) {
    try { return await askClaudeViaServer(msgs, image ? [image] : [], opts); } catch (e) { /* the usual brains take over */ }
  }
  if (image) return askPicture(msgs, image, opts);
  if (!canChat()) throw new Error('Add your Groq API key in Settings first.');
  return askGroq(msgs, opts);
}

/* ---------- reading whole files: reviewers, summaries, answers ---------- */
// What "take note of everything" means — used for every file, photo and page.
const NOTES_GUIDE = `Take note of EVERYTHING a student could be asked about. One fact per bullet, under these labels when they apply (skip a label with nothing under it):
**People** — full name — who they are / what they did
**Key terms** — **term** — what it means
**Dates & times** — exact date, year or time — what happened (keep every single one)
**Places, groups & things** — countries, cities, organisations, laws, treaties, books, inventions, species, objects — why each matters
**Events & history** — in the order they happened, with causes and effects
**Numbers & formulas** — statistics, amounts, measurements, equations (with units)
**Processes** — numbered steps
**Lists, types & comparisons**
**Pictures, tables & charts** — what each shows, every label and value you can read
**Questions in the file** — exercises or questions it asks
Put the page or slide after a fact when you know it, like (p. 12). Copy names, dates and numbers exactly. Never invent anything.`;
const REVIEWER_TAIL = 'After the sections, add **People to remember** (name — who), **Timeline** (every date and time in order — what happened), and **Key terms** (term — meaning), then 10 practice questions and an **Answers** list.';
const DOC_INSTRUCTION = `The user attached a file, and you are told what KIND it is (PDF, PowerPoint slides, Word document, text, or a photo). Refer to it correctly: say "slide 3" for a presentation, "page 3" for a PDF, "the document" for Word/text, "the photo" for a picture. Its full content is given to you (the text, and for PDFs and slides also the pictures, diagrams, charts, and tables — or notes describing them). You HAVE the whole file: never ask them to paste the text or upload it again, and never say you can't see images or can't make files.
Do exactly what they ask with it — a reviewer, study guide, summary, outline, notes, flashcards, practice quiz, or answers to questions in it.
For a reviewer, notes, summary or study guide: follow the file's order and cover EVERY page, section, slide or topic — don't stop early or skip the middle. Use bold section labels on their own line and tight bullets. Keep every person (full name and who they are), key term (in bold, with its meaning), date and time (with what happened), place, event, number, formula and process (as numbered steps), and say what each diagram, chart, table or picture shows and why it matters. Put the page or slide in brackets after a fact when you know it, like (p. 12). ${REVIEWER_TAIL} Stick to the file — don't invent facts that aren't in it.
The app puts Save-as Word / PDF / Image / Text buttons under every answer, so if they want a file, just write the complete content — don't tell them to copy it anywhere.`;

function leanDocSystem() {
  let sp = `You are Cassie, a sharp, warm study buddy. Formatting: lead with what matters; label sections with a short **bold** phrase on its own line (never # headings); tight bullet points; key terms in **bold**; plain-text math (no LaTeX); a small table only when it truly helps.`;
  if (state.level && LEVEL_LABELS[state.level]) sp += ` Explain at a ${LEVEL_LABELS[state.level]} level.`;
  return sp + '\n\n' + DOC_INSTRUCTION;
}

function fileToBase64(blob) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => resolve(String(r.result).split(',')[1] || '');
    r.readAsDataURL(blob);
  });
}
// Downscale any image blob to a JPEG (keeps requests small). Returns { mimeType, base64 } or null.
function blobToJpeg(blob, maxDim = 1000) {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(blob);
    const img = new Image();
    img.onerror = () => { URL.revokeObjectURL(url); resolve(null); };
    img.onload = () => {
      URL.revokeObjectURL(url);
      if (img.width < 48 || img.height < 48) { resolve(null); return; } // bullets, icons, logos
      const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.max(1, Math.round(img.width * scale));
      c.height = Math.max(1, Math.round(img.height * scale));
      const ctx = c.getContext('2d');
      ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
      ctx.drawImage(img, 0, 0, c.width, c.height);
      resolve({ mimeType: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.82).split(',')[1] });
    };
    img.src = url;
  });
}

// Pictures inside a file: slide/Word images, or rendered PDF pages that hold figures.
async function docImages(doc, max, onlyPages) {
  const out = [];
  try {
    if (doc.kind === 'pdf') {
      await loadScript(PDFJS_URL);
      if (!doc.pdfDoc) doc.pdfDoc = window.pdfjsLib.getDocument({ data: await doc.file.arrayBuffer() }).promise; // open once, reuse
      const pdf = await doc.pdfDoc;
      const pages = (onlyPages || (doc.visualPages && doc.visualPages.length ? doc.visualPages : [...Array(Math.min(pdf.numPages, max)).keys()].map((i) => i + 1))).slice(0, max);
      for (const n of pages) {
        const page = await pdf.getPage(n);
        const base = page.getViewport({ scale: 1 });
        const vp = page.getViewport({ scale: Math.min(2, 1100 / Math.max(base.width, base.height)) });
        const c = document.createElement('canvas');
        c.width = Math.round(vp.width); c.height = Math.round(vp.height);
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
        await page.render({ canvasContext: ctx, viewport: vp }).promise;
        out.push({ mimeType: 'image/jpeg', base64: c.toDataURL('image/jpeg', 0.8).split(',')[1], label: `page ${n}` });
      }
      return out;
    }
    await loadScript(JSZIP_URL);
    const zip = await window.JSZip.loadAsync(await doc.file.arrayBuffer());
    const isPic = (n) => /\.(png|jpe?g|gif|bmp|webp)$/i.test(n);
    let targets = []; // [{ path, label }]
    if (doc.kind === 'pptx') {
      const slides = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))
        .sort((a, b) => (+a.match(/slide(\d+)/)[1]) - (+b.match(/slide(\d+)/)[1]));
      for (const sl of slides) {
        const num = sl.match(/slide(\d+)/)[1];
        const rel = zip.files[`ppt/slides/_rels/slide${num}.xml.rels`];
        if (!rel) continue;
        const xml = await rel.async('string');
        (xml.match(/Target="\.\.\/media\/[^"]+"/g) || []).forEach((t) => {
          const path = 'ppt/media/' + t.slice('Target="../media/'.length, -1);
          if (isPic(path) && !targets.some((x) => x.path === path)) targets.push({ path, label: `slide ${num}` });
        });
      }
    } else {
      targets = Object.keys(zip.files).filter((n) => /^word\/media\//.test(n) && isPic(n))
        .sort((a, b) => (+(a.match(/(\d+)/) || [0, 0])[1]) - (+(b.match(/(\d+)/) || [0, 0])[1]))
        .map((path, i) => ({ path, label: `picture ${i + 1}` }));
    }
    for (const t of targets) {
      if (out.length >= max) break;
      const blob = await zip.files[t.path].async('blob');
      if (blob.size < 4000) continue; // tiny decorations
      const img = await blobToJpeg(blob, 1000);
      if (img) out.push({ ...img, label: t.label });
    }
  } catch (e) { /* pictures are a bonus — text still works */ }
  return out;
}

// Split long text into parts at paragraph boundaries.
function splitChunks(text, size) {
  const parts = [];
  let cur = '';
  for (const para of text.split(/\n{2,}/)) {
    if (cur && cur.length + para.length + 2 > size) { parts.push(cur); cur = ''; }
    if (para.length > size) {
      for (let i = 0; i < para.length; i += size) parts.push(para.slice(i, i + size));
      continue;
    }
    cur += (cur ? '\n\n' : '') + para;
  }
  if (cur) parts.push(cur);
  return parts;
}

// Earlier turns, kept small (a document conversation can't afford the full history).
function compactHistory(history, budget = 1500) {
  return trimHistory(history.filter((m) => m && m.content), budget)
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }));
}

/* With a Gemini key: send the WHOLE file — PDFs natively (Gemini sees every
   page, diagrams included), slides/Word as text plus their pictures. */
async function geminiDocument(doc, request, history, onStatus) {
  const parts = [];
  if (doc.kind === 'pdf' && doc.file.size <= 14 * 1024 * 1024) {
    onStatus(`Reading all of ${doc.name} — pages, pictures and diagrams…`);
    parts.push({ inlineData: { mimeType: 'application/pdf', data: await fileToBase64(doc.file) } });
    parts.push({ text: `(That is "${doc.name}" — a ${KIND_WORD[doc.kind] || 'file'}, ${doc.label}.)` });
  } else {
    onStatus(`Reading ${doc.name} and its pictures…`);
    if (doc.text) parts.push({ text: `File "${doc.name}" — a ${KIND_WORD[doc.kind] || 'file'} (${doc.label}):\n"""\n${doc.text.slice(0, 500000)}\n"""` });
    const imgs = await docImages(doc, 16);
    imgs.forEach((img) => { parts.push({ text: `[Picture from ${img.label}]` }); parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } }); });
  }
  parts.push({ text: request });
  const contents = compactHistory(history, 3000).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  contents.push({ role: 'user', parts });
  onStatus('Writing it up…');
  const whole = WHOLE_FILE_RE.test(request) || wantsStudyFile(request);
  return geminiGenerate({ contents, system: buildSystemPrompt({ tutor: false }) + '\n\n' + DOC_INSTRUCTION, maxTokens: whole ? 32768 : 8192, models: GEMINI_DOC_MODELS });
}

/* With only a Groq key: read the file part by part (the free tier has a small
   per-minute budget), take notes on each part, then write the final answer. */
const GROQ_DOC_PART = 9000;   // characters per part (~2.3k tokens)
const GROQ_DOC_MAX_PARTS = 50; // ≈ 180+ pages
// "pages 5-12" / "page 3" / "slides 2 to 6" in the request → only those pages of the file.
function pagesAskedFor(text, request) {
  const m = (request || '').match(/\b(?:pages?|slides?|p{1,2}\.)\s*(\d{1,4})(?:\s*(?:-|–|—|to|through|until)\s*(\d{1,4}))?/i);
  if (!m || !/\[(?:Page|Slide) \d+\]/.test(text)) return text;
  const from = +m[1], to = Math.max(from, +(m[2] || m[1]));
  const keep = text.split(/(?=\[(?:Page|Slide) \d+\])/).filter((block) => {
    const n = +((block.match(/^\[(?:Page|Slide) (\d+)\]/) || [])[1] || 0);
    return n >= from && n <= to;
  });
  return keep.length ? keep.join('') : text;
}
// Which pages a part of the file covers, from its [Page N] / [Slide N] markers.
function partSpan(part, fallback) {
  const nums = [...part.matchAll(/\[(Page|Slide) (\d+)\]/g)].map((m) => +m[2]);
  if (!nums.length) return fallback;
  const word = /\[Slide /.test(part) ? 'slide' : 'page';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `${word} ${lo}` : `${word}s ${lo}–${hi}`;
}
// Which pages a group of notes covers, from their [Pages 4–7] labels.
function groupSpan(group) {
  const nums = [], word = /^\[Slide/i.test(group[0] || '') ? 'slides' : 'pages';
  group.forEach((n) => { const m = n.match(/^\[(?:Pages?|Slides?) (\d+)(?:–(\d+))?/i); if (m) nums.push(+m[1], +(m[2] || m[1])); });
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `${word.slice(0, -1)} ${lo}` : `${word} ${lo}–${hi}`;
}
// Asking for everything (a reviewer, notes, a summary…) rather than one question about the file.
const WHOLE_FILE_RE = /\b(reviewers?|review|notes?|summar\w*|outline|study guide|everything|whole|entire|complete|all (?:the )?(?:pages|details|info\w*)|important (?:details|points|facts)|key (?:points|facts|details)|take note|flash ?cards?|buod|lahat)\b/i;

// Notes from the pictures in a file: every page with a picture (every page of a
// scanned PDF), four at a time, so diagrams, tables and scanned text aren't missed.
async function pictureNotes(doc, onStatus, waitNote) {
  if (state.groqKey && !(await discoverGroqVisionModel())) return [];
  const out = [];
  let batches;
  if (doc.kind === 'pdf') {
    const pages = (doc.visualPages || []).slice(0, 48);
    batches = [];
    for (let i = 0; i < pages.length; i += 4) batches.push({ pages: pages.slice(i, i + 4) });
  } else {
    const imgs = await docImages(doc, 16);
    batches = [];
    for (let i = 0; i < imgs.length; i += 4) batches.push({ imgs: imgs.slice(i, i + 4) });
  }
  for (let i = 0; i < batches.length; i++) {
    const imgs = batches[i].imgs || await docImages(doc, 4, batches[i].pages);
    if (!imgs.length) continue;
    const labels = imgs.map((x) => x.label).join(', ');
    onStatus(`Looking at the pictures — ${labels} (${i + 1} of ${batches.length})…`);
    try {
      const note = await askGroqVision([{ role: 'user', content: `These are ${labels} from "${doc.name}". For each one, take study notes. If it is mostly text, write out ALL of its important content. If it is a diagram, table, chart or picture, say what it shows and every label and value you can read.\n\n${NOTES_GUIDE}` }],
        imgs, { system: 'You turn pages and pictures from a student\'s file into accurate, complete study notes. Bullets only. Never invent anything you cannot read.', maxTokens: 1500, onWait: waitNote(`Looking at ${labels}…`) });
      if (note) out.push(`[${labels.replace(/^\w/, (c) => c.toUpperCase())} — pictures]\n${note}`);
    } catch (e) {
      if (e.friendly && /limit|free questions/i.test(e.message)) break; // out of budget: keep what we have
    }
  }
  return out;
}

// Pull "@@PERSON: …", "@@DATE: …", "@@TERM: …" lines out of a section into the master lists.
function takeMasterLines(md, lists) {
  return md.replace(/^\s*[-*•]?\s*@@\s*(PERSON|DATE|TERM)\s*:\s*(.+)$/gim, (_, kind, body) => {
    const [head, ...rest] = body.split(/\s+[—–-]\s+/);
    const item = { head: (head || '').replace(/\*\*/g, '').trim(), tail: rest.join(' — ').trim() };
    if (!item.head) return '';
    const key = kind.toUpperCase();
    const k = (item.head + (key === 'DATE' ? item.tail : '')).toLowerCase();
    if (!lists[key].some((x) => x.k === k)) lists[key].push({ ...item, k });
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
}
function masterListsMd(lists) {
  const yearOf = (t) => { const m = t.match(/\b(\d{3,4})\b/); return m ? +m[1] : Infinity; };
  const bullets = (arr) => arr.map((x) => `- **${x.head}**${x.tail ? ` — ${x.tail}` : ''}`).join('\n');
  let md = '';
  if (lists.PERSON.length) md += `**People to remember**\n${bullets(lists.PERSON)}\n\n`;
  if (lists.DATE.length) md += `**Timeline — every date and time**\n${bullets([...lists.DATE].sort((a, b) => yearOf(a.head) - yearOf(b.head)))}\n\n`;
  if (lists.TERM.length) md += `**Key terms**\n${bullets(lists.TERM)}\n\n`;
  return md.trim();
}

async function groqDocument(doc, request, history, onStatus) {
  const sys = leanDocSystem();
  const waitNote = (label) => (secs) => onStatus(`${label} (free per-minute limit — continuing in ${secs}s)`);
  const whole = WHOLE_FILE_RE.test(request) || wantsStudyFile(request);
  const text = pagesAskedFor(doc.text || '', request);
  const visualNotes = doc.hasVisuals ? await pictureNotes(doc, onStatus, waitNote) : [];
  if (!text && !visualNotes.length) {
    throw friendlyError(`I couldn't find readable text in ${doc.name} — it looks like scanned pictures. Add your free Gemini key in Settings and I'll read the pages directly.`);
  }
  const hist = compactHistory(history, 800);

  // A short file: read it all in one go.
  const visualAll = visualNotes.join('\n\n');
  if (estimateTokens(text) <= 3800 && visualAll.length < 6000) {
    onStatus(`Reading ${doc.name}…`);
    try {
      const reply = await groqChat([{ role: 'system', content: sys }, ...hist,
        { role: 'user', content: `File "${doc.name}" — a ${KIND_WORD[doc.kind] || 'file'} (${doc.label}):\n"""\n${text}\n"""${visualAll ? `\n\nNotes on the pictures and pages in the file:\n${visualAll}` : ''}\n\n${request}` }],
        { maxTokens: 3500, lean: true, rotate: true, onWait: waitNote('Reading…') });
      if (reply) return reply;
    } catch (e) { if (!e.tooLarge) throw e; /* fall through to reading in parts */ }
  }

  // A long file: careful notes on every part, in order.
  let parts = text ? splitChunks(text, GROQ_DOC_PART) : [];
  const truncated = parts.length > GROQ_DOC_MAX_PARTS;
  if (truncated) parts = parts.slice(0, GROQ_DOC_MAX_PARTS);
  const NOTE_SYS = `You take complete, accurate study notes from one part of a student's file.\n${NOTES_GUIDE}\nBullets only, no intro. Be thorough — usually 250–500 words, more if the part is dense.`;
  // if a part is too big for the model right now, split it in two and try again
  const noteFor = async (chunk, label, depth = 0) => {
    try {
      return await groqChat([{ role: 'system', content: NOTE_SYS }, { role: 'user', content: `${label} of "${doc.name}":\n"""\n${chunk}\n"""` }],
        { maxTokens: 1300, lean: true, rotate: true, onWait: waitNote(`Reading ${label}…`) });
    } catch (e) {
      if (!e.tooLarge || depth >= 2 || chunk.length < 1500) throw e;
      const half = Math.ceil(chunk.length / 2);
      return `${await noteFor(chunk.slice(0, half), label, depth + 1)}\n${await noteFor(chunk.slice(half), label, depth + 1)}`;
    }
  };
  const notes = [];
  let span = 'the start';
  for (let i = 0; i < parts.length; i++) {
    span = partSpan(parts[i], span);
    onStatus(`Reading ${span} of ${doc.name} — part ${i + 1} of ${parts.length}…`);
    notes.push(`[${span.replace(/^\w/, (c) => c.toUpperCase())}]\n${await noteFor(parts[i], span.replace(/^\w/, (c) => c.toUpperCase()))}`);
  }
  notes.push(...visualNotes);
  // picture notes slot in by page, so everything reads in the file's order
  const firstNum = (n) => { const m = n.match(/^\[(?:Pages?|Slides?) (\d+)/i); return m ? +m[1] : Infinity; };
  notes.sort((x, y) => firstNum(x) - firstNum(y));
  const tail = truncated ? `\n\n*This file is very long, so I read the first ${GROQ_DOC_MAX_PARTS} parts. Add your free Gemini key in Settings and I'll read the whole file — pictures included — in one go.*` : '';

  // One answer from the notes (shrinking them if the model says it's too long).
  const finalFrom = async (list, ask, maxTokens = 3000) => {
    for (let budget = 16000, tries = 0; ; budget = Math.floor(budget * 0.6), tries++) {
      let combined = list.join('\n\n');
      if (combined.length > budget) {
        const each = Math.floor(budget / list.length);
        combined = list.map((n) => n.slice(0, each)).join('\n\n');
      }
      try {
        return await groqChat([{ role: 'system', content: sys },
          { role: 'user', content: `Complete study notes from "${doc.name}" (in order):\n"""\n${combined}\n"""\n\nUsing these notes as the file's content: ${ask}` }],
          { maxTokens: tries ? Math.min(maxTokens, 2200) : maxTokens, lean: true, rotate: true, onWait: waitNote('Writing it up…') });
      } catch (e) { if (!e.tooLarge || tries >= 2) throw e; }
    }
  };

  // A question about the file: answer from the parts that matter most.
  if (!whole) {
    const words = (request.toLowerCase().match(/\p{L}{4,}/gu) || []).filter((w) => !STOP.has(w));
    const score = (n) => words.reduce((t, w) => t + (n.toLowerCase().includes(w) ? 1 : 0), 0);
    let picked = notes;
    if (notes.join('\n\n').length > 16000) {
      const ranked = notes.map((n, i) => ({ n, i, s: score(n) })).sort((a, b) => b.s - a.s);
      const keep = new Set();
      let used = 0;
      for (const r of ranked) { if (used + r.n.length > 16000 && keep.size) break; keep.add(r.i); used += r.n.length; }
      picked = notes.filter((_, i) => keep.has(i));
    }
    onStatus('Putting it all together…');
    return (await finalFrom(picked, request)) + tail;
  }

  // A reviewer / notes of a long file: write it section by section so nothing is dropped,
  // then add the people, timeline and key terms from the WHOLE file, and practice questions.
  const groups = [];
  for (const n of notes) {
    const g = groups[groups.length - 1];
    if (g && g.join('\n\n').length + n.length < 11000) g.push(n); else groups.push([n]);
  }
  if (groups.length === 1) {
    onStatus('Putting it all together…');
    return (await finalFrom(notes, `${request}\n\nCover every note above. ${REVIEWER_TAIL}`, 3500)) + tail;
  }
  const lists = { PERSON: [], DATE: [], TERM: [] };
  const sections = [];
  const writeSection = async (group, i, n, depth = 0) => {
    const where = groupSpan(group) || `section ${i + 1}`;
    onStatus(`Writing it up — ${where} (section ${i + 1} of ${n})…`);
    try {
      return await groqChat([{ role: 'system', content: sys },
        { role: 'user', content: `Study notes from ${where} of "${doc.name}" (section ${i + 1} of ${n}):\n"""\n${group.join('\n\n')}\n"""\n\nThe student asked: ${request}\n\nWrite ONLY this section of the answer. Cover every note above, in order — keep every name, date, time, place, number and term. No intro, no conclusion, no practice questions (those come at the end).\nThen, after the section, add one line for every person, date/time and key term in these notes, exactly like this:\n@@PERSON: full name — who they are / what they did\n@@DATE: date or time — what happened\n@@TERM: term — what it means` }],
        { maxTokens: 3200, lean: true, rotate: true, onWait: waitNote(`Writing ${where}…`) });
    } catch (e) {
      if (!e.tooLarge || depth >= 1 || group.length < 2) throw e;
      const half = Math.ceil(group.length / 2);
      return `${await writeSection(group.slice(0, half), i, n, depth + 1)}\n\n${await writeSection(group.slice(half), i, n, depth + 1)}`;
    }
  };
  for (let i = 0; i < groups.length; i++) {
    const where = groupSpan(groups[i]) || `Section ${i + 1}`;
    const body = takeMasterLines(await writeSection(groups[i], i, groups.length), lists);
    sections.push(`**${where.replace(/^\w/, (c) => c.toUpperCase())}**\n\n${body}`);
  }
  const master = masterListsMd(lists);
  let questions = '';
  try {
    onStatus('Writing practice questions…');
    const facts = (master || sections.join('\n\n')).slice(0, 9000);
    questions = await groqChat([{ role: 'system', content: sys },
      { role: 'user', content: `Key facts from all of "${doc.name}":\n"""\n${facts}\n"""\n\nWrite 10 practice questions that cover the whole file (mix multiple choice, identification and short answer), then an **Answers** list.` }],
      { maxTokens: 1600, lean: true, rotate: true, onWait: waitNote('Writing practice questions…') });
  } catch (e) { /* the reviewer is still complete without them */ }
  const pagesNote = doc.pages ? ` — all ${doc.pages} pages` : '';
  return [`**${doc.name}${pagesNote}**`, ...sections, master, questions ? `**Practice questions**\n\n${questions}` : ''].filter(Boolean).join('\n\n') + tail;
}

async function answerAboutDocument(doc, request, history, onStatus) {
  try { return await readDocumentAnswer(doc, request, history, onStatus); }
  catch (e) {
    if (!e.tooLarge) throw e;
    throw friendlyError(`${doc.name} is too big for me to read in one go right now. Wait a minute and try again, ask about one part (for example “make a reviewer of pages 1–10”), or add your free Gemini key in Settings — then I can read the whole file at once.`);
  }
}
async function readDocumentAnswer(doc, request, history, onStatus) {
  if (state.geminiKey) {
    try { return await geminiDocument(doc, request, history, onStatus); }
    catch (e) {
      if (!canChat() || geminiOnly()) throw e;
      onStatus('Gemini is busy — reading it another way…');
    }
  }
  if (!canChat()) throw new Error('Add your Groq API key in Settings first.');
  return groqDocument(doc, request, history, onStatus);
}

/* ---------- upload / download / image + document helpers ---------- */
let pendingImage = null; // { mimeType, base64, dataUrl }
let pendingDoc = null;   // { name, text } — extracted text from a PDF/DOCX/PPTX
let attachReading = null; // the file still being read, if any

function clearAttach() {
  pendingImage = null;
  pendingDoc = null;
  if (attachRead) attachRead.hidden = true;
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
const DOC_TEXT_CAP = 400000; // characters of extracted text we keep (long files are read in parts)

// Returns { text, numPages, visualPages } — visualPages are pages holding
// pictures/figures or almost no text (scanned), so they can be looked at too.
async function extractPdf(file) {
  await loadScript(PDFJS_URL);
  const pdfjs = window.pdfjsLib;
  pdfjs.GlobalWorkerOptions.workerSrc = PDFJS_WORKER;
  const data = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data }).promise;
  const maxPages = Math.min(pdf.numPages, 300);
  const imgOps = new Set([pdfjs.OPS.paintImageXObject, pdfjs.OPS.paintInlineImageXObject, pdfjs.OPS.paintJpegXObject].filter(Boolean));
  const visualPages = [];
  let text = '';
  for (let i = 1; i <= maxPages; i++) {
    const page = await pdf.getPage(i);
    const content = await page.getTextContent();
    const pageText = content.items.map((it) => it.str + (it.hasEOL ? '\n' : ' ')).join('').trim();
    if (pageText) text += `[Page ${i}]\n${pageText}\n\n`;
    if (i <= 200 && visualPages.length < 60) {
      let hasPic = pageText.length < 200;
      if (!hasPic) {
        try { hasPic = (await page.getOperatorList()).fnArray.some((fn) => imgOps.has(fn)); } catch (e) { /* ignore */ }
      }
      if (hasPic) visualPages.push(i);
    }
    if (text.length > DOC_TEXT_CAP) break;
  }
  return { text, numPages: pdf.numPages, visualPages };
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
    // keep each paragraph on its own line so bullets stay readable
    const paras = (xml.match(/<a:p>[\s\S]*?<\/a:p>/g) || []).map((p) =>
      (p.match(/<a:t>[\s\S]*?<\/a:t>/g) || []).map((r) => decodeXml(r.replace(/^<a:t>/, '').replace(/<\/a:t>$/, ''))).join('').trim()
    ).filter(Boolean);
    if (paras.length) text += `[Slide ${name.match(/slide(\d+)/)[1]}]\n${paras.join('\n')}\n\n`;
    if (text.length > DOC_TEXT_CAP) break;
  }
  const hasMedia = Object.keys(zip.files).some((n) => /^ppt\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(n));
  return { text, hasMedia, slideCount: slides.length };
}

// What kind of file is this REALLY? Checks the first bytes (and the zip contents for Office
// files), so a PDF/slides/photo is recognised even with a missing or wrong extension.
async function sniffKind(file) {
  const name = (file.name || '').toLowerCase();
  let b = new Uint8Array(0);
  try { b = new Uint8Array(await file.slice(0, 64).arrayBuffer()); } catch (e) { /* ignore */ }
  const str = (i, n) => String.fromCharCode(...b.slice(i, i + n));
  if (str(0, 4) === '%PDF') return 'pdf';
  if (b[0] === 0xFF && b[1] === 0xD8 && b[2] === 0xFF) return 'image';
  if (b[0] === 0x89 && str(1, 3) === 'PNG') return 'image';
  if (str(0, 4) === 'GIF8' || str(0, 2) === 'BM') return 'image';
  if (str(0, 4) === 'RIFF' && str(8, 4) === 'WEBP') return 'image';
  if (str(4, 4) === 'ftyp') return /^(heic|heix|hevc|heim|heis|mif1|msf1)/.test(str(8, 4)) ? 'heic' : (/^avi[fs]/.test(str(8, 4)) ? 'image' : 'unknown');
  if (b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) return /\.(ppt|pps)$/.test(name) ? 'legacy-ppt' : /\.xls$/.test(name) ? 'xlsx' : 'legacy-doc';
  if (str(0, 2) === 'PK') {
    try {
      await loadScript(JSZIP_URL);
      const names = Object.keys((await window.JSZip.loadAsync(await file.arrayBuffer())).files);
      if (names.some((n) => n.startsWith('ppt/'))) return 'pptx';
      if (names.some((n) => n.startsWith('word/'))) return 'docx';
      if (names.some((n) => n.startsWith('xl/'))) return 'xlsx';
    } catch (e) { /* fall through to the name */ }
  }
  if (/^image\//.test(file.type) || /\.(jpe?g|png|gif|webp|bmp|avif)$/.test(name)) return /\.(heic|heif)$/.test(name) || /hei[cf]/.test(file.type) ? 'heic' : 'image';
  if (/\.(heic|heif)$/.test(name) || /hei[cf]/.test(file.type)) return 'heic';
  if (/\.pdf$/.test(name) || file.type === 'application/pdf') return 'pdf';
  if (/\.pptx$/.test(name) || /presentationml/.test(file.type)) return 'pptx';
  if (/\.docx$/.test(name) || /wordprocessingml/.test(file.type)) return 'docx';
  if (/\.(ppt|pps)$/.test(name)) return 'legacy-ppt';
  if (/\.doc$/.test(name)) return 'legacy-doc';
  if (/\.(xlsx?|csv)$/.test(name)) return 'xlsx';
  if (/^text\//.test(file.type) || /\.(txt|md|markdown|rtf)$/.test(name)) return 'txt';
  return 'unknown';
}
const KIND_WORD = { pdf: 'PDF document', pptx: 'PowerPoint presentation (slides)', docx: 'Word document', txt: 'text document', image: 'photo / picture' };

// Read an attached file into { name, kind, label, file, text, hasVisuals, visualPages, scanned }.
async function readDocument(file, kind) {
  kind = kind || await sniffKind(file);
  const tidy = (t) => (t || '').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim().slice(0, DOC_TEXT_CAP);
  const words = (t) => (t.match(/\S+/g) || []).length.toLocaleString();
  if (kind === 'pdf') {
    const r = await extractPdf(file);
    const text = tidy(r.text);
    return { name: file.name, kind, label: `PDF · ${r.numPages} page${r.numPages === 1 ? '' : 's'}`, pages: r.numPages, file, text, visualPages: r.visualPages, hasVisuals: r.visualPages.length > 0, scanned: text.length < 40 * Math.min(r.numPages, 300) };
  }
  if (kind === 'docx') {
    const text = tidy(await extractDocxText(file));
    let hasVisuals = false;
    try {
      await loadScript(JSZIP_URL);
      const zip = await window.JSZip.loadAsync(await file.arrayBuffer());
      hasVisuals = Object.keys(zip.files).some((n) => /^word\/media\/.+\.(png|jpe?g|gif|bmp|webp)$/i.test(n));
    } catch (e) { /* ignore */ }
    return { name: file.name, kind, label: `Word document · ${words(text)} words`, file, text, hasVisuals, scanned: !text };
  }
  if (kind === 'pptx') {
    const r = await extractPptxText(file);
    const text = tidy(r.text);
    return { name: file.name, kind, label: `PowerPoint · ${r.slideCount} slide${r.slideCount === 1 ? '' : 's'}`, slides: r.slideCount, file, text, hasVisuals: r.hasMedia, scanned: !text };
  }
  if (kind === 'txt') {
    const text = tidy(await file.text());
    return { name: file.name, kind, label: `Text · ${words(text)} words`, file, text, hasVisuals: false, scanned: false };
  }
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
        const maxDim = 1600; // big enough to read small print on a photographed page
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

// Copy + "Save as" Word / PDF / Image / Text under an answer. `want` highlights
// the format the user asked for ("make it a pdf").
const SAVE_FORMATS = [
  { key: 'docx', label: 'Word', ext: 'docx', make: (md, t) => window.CassieExport.toDocx(md, t) },
  { key: 'pdf', label: 'PDF', ext: 'pdf', make: (md, t) => window.CassieExport.toPdf(md, t) },
  { key: 'png', label: 'Image', ext: 'png', make: (md, t) => window.CassieExport.toPng(md, t) },
  { key: 'txt', label: 'Text', ext: 'txt', make: (md, t) => Promise.resolve(window.CassieExport.toTxt(md, t)) },
];
function addTextDownload(bubble, text, { title = '', want = '' } = {}) {
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
  if (!window.CassieExport) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.innerHTML = `${DL_ICON} Download`;
    btn.addEventListener('click', () => downloadBlob('cassie-answer.txt', new Blob([text], { type: 'text/plain' })));
    tools.appendChild(btn);
    bubble.appendChild(tools);
    return;
  }
  const label = document.createElement('span');
  label.className = 'save-label';
  label.innerHTML = `${DL_ICON} Save as`;
  tools.appendChild(label);
  const docTitle = window.CassieExport.titleOf(text, title);
  SAVE_FORMATS.forEach((f) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.textContent = f.label;
    btn.dataset.format = f.key;
    if (f.key === want) btn.classList.add('suggest');
    btn.addEventListener('click', async () => {
      if (btn.disabled) return;
      track('feature', 'save:' + f.key);
      btn.disabled = true;
      btn.textContent = 'Saving…';
      try {
        const blob = await f.make(text, docTitle);
        downloadBlob(`${window.CassieExport.fileBase(docTitle)}.${f.ext}`, blob);
        btn.textContent = 'Saved ✓';
      } catch (e) {
        btn.textContent = 'Try again';
        alert(`Couldn't make the ${f.label} file — check your internet connection and try again.`);
      } finally {
        setTimeout(() => { btn.textContent = f.label; btn.disabled = false; }, 1600);
      }
    });
    tools.appendChild(btn);
  });
  bubble.appendChild(tools);
  if (want) addFileCard(bubble, text, docTitle, SAVE_FORMATS.find((x) => x.key === want));
}

// The file the student asked for, made right away and shown as a card.
const FILE_ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
function addFileCard(bubble, text, docTitle, f) {
  const name = `${window.CassieExport.fileBase(docTitle)}.${f.ext}`;
  const card = document.createElement('div');
  card.className = 'file-card';
  card.innerHTML = `<span class="fc-ico">${FILE_ICON}</span><span class="fc-txt"><b></b><small>Making your ${f.label} file…</small></span><button type="button" class="fc-btn" disabled>${DL_ICON} Download</button>`;
  card.querySelector('b').textContent = name;
  const small = card.querySelector('small'), btn = card.querySelector('button');
  bubble.appendChild(card);
  let blob = null;
  f.make(text, docTitle).then((b) => {
    blob = b;
    small.textContent = `${f.label === 'Image' ? 'Image' : f.label} file · ready`;
    btn.disabled = false;
  }).catch(() => { small.textContent = 'Couldn’t make the file — use “Save as” above.'; });
  btn.addEventListener('click', () => { if (blob) downloadBlob(name, blob); });
}

function addImageToBubble(bubble, dataUrl, { download = false, name = 'cassie-image' } = {}) {
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
    btn.addEventListener('click', () => fetch(dataUrl).then((r) => r.blob())
      .then((b) => downloadBlob(`${name}.${/png/.test(b.type) ? 'png' : 'jpg'}`, b))
      .catch(() => window.open(dataUrl, '_blank', 'noopener')));
    tools.appendChild(btn);
    bubble.appendChild(tools);
  }
  scrollToBottom();
}

const PICTURE_WORD_RE = /\b(image|picture|pic|photo|illustration|drawing|draw|paint|poster|logo|wallpaper|larawan)\b/i;
// a reply that is mostly a block of symbol art
function looksLikeAsciiArt(text) {
  const blocks = String(text).match(/```[\s\S]*?```/g) || [];
  const body = blocks.length ? blocks.join('\n') : String(text);
  const lines = body.split('\n').filter((l) => l.trim());
  const arty = lines.filter((l) => /[\\\/|_()\-=*^~<>o.'`]{3,}/.test(l) && (l.replace(/[\s\\\/|_()\-=*^~<>o.'`+#@]/g, '').length < l.trim().length * 0.35));
  return arty.length >= 3;
}

/* Asked for a graph but the answer has no drawing (or drew it in ASCII)? Draw it here,
   from the equation in the question, the answer, or the last few messages. */
const GRAPH_ASK_RE = /\b(graph|plot|sketch|draw|chart|visuali[sz]e)\b/i;
function ensureGraph(bubble, question, reply) {
  const B = window.CassieBoard;
  if (!B || !B.findEquation || !GRAPH_ASK_RE.test(question || '') || bubble.querySelector('.cassie-board')) return;
  let eq = B.findEquation(question) || B.findEquation(reply);
  for (let i = state.messages.length - 1; !eq && i >= 0 && i >= state.messages.length - 8; i--) eq = B.findEquation(state.messages[i].display || state.messages[i].content);
  if (!eq) return;
  // hide an ASCII-art "graph" if the model drew one
  bubble.querySelectorAll('pre').forEach((pre) => { if (/[|_\-+*.]{3,}/.test(pre.textContent) && !/[;{}=()]\s*$/m.test(pre.textContent.split('\n')[0] || '')) pre.remove(); });
  try {
    const spec = B.graphSpec(eq);
    B.renderInto(bubble, spec);
    // keep it with the answer so it's still there when the chat is reopened
    const last = state.messages[state.messages.length - 1];
    if (last && last.role === 'assistant') { last.content += '\n\n```cassie-board\n' + JSON.stringify(spec) + '\n```'; save(); }
  } catch (e) { /* couldn't draw it */ }
}

/* "make me a reviewer / notes / flashcards…" → the answer also arrives as a file */
const STUDY_FILE_RE = /\b(make|generate|create|give|write|prepare|build|produce|turn|gawa)\b[^.?!]{0,60}?\b(reviewers?|study guides?|study notes|lecture notes|notes|flash ?cards|worksheets?|cheat ?sheets?|handouts?|outlines?|summary sheet|practice (?:questions|exam|test)|mock (?:exam|test)|lesson plan)\b/i;
const wantsStudyFile = (t) => STUDY_FILE_RE.test(String(t || ''));
// a real reviewer, not a "Sure — which topic?" question
const looksLikeContent = (md) => md.length > 300 && /(^|\n)\s*(#{1,4}\s|[-*•]\s|\d+[.)]\s|\*\*)/.test(md);

/* ---------- send flow ---------- */
// The file this chat is about, so follow-ups ("now quiz me on the file") can re-read it.
let activeDoc = null; // { chatId, doc }
const DOC_FOLLOWUP_RE = /\b(file|pdf|docx?|document|module|lesson|slides?|powerpoint|ppt|handout|reading|chapter|reviewer|flash ?cards?|quiz me|practice (test|questions)|page \d+|slide \d+)\b/i;

function setTypingStatus(bubble, text) {
  let el = bubble.querySelector('.typing-status');
  if (!el) { el = document.createElement('span'); el.className = 'typing-status'; bubble.appendChild(el); }
  el.textContent = text;
  if (islandBusy) islandShow(islandMoodFor(text), text);
  scrollToBottom();
}

/* Errors read like Cassie, never like a crash, and come with a "Try again". */
function errorText(err, prefix = 'Something went wrong') {
  if (err && err.friendly) return err.message;
  const m = String((err && err.message) || err || '');
  if (/failed to fetch|networkerror|load failed|network request failed/i.test(m)) return "I couldn't connect — check your internet and try again.";
  if (/timeout|timed out|aborted/i.test(m)) return 'That took too long — please try again.';
  return `${prefix}. Please try again — if it keeps happening, tap “Report a problem” in Settings. (${m.slice(0, 120)})`;
}
function renderError(err, retry, prefix) {
  const busyErr = /limit|busy|wait/i.test(errorText(err, prefix));
  botMood(busyErr ? 'busy' : 'oops', 3000);
  islandErrUntil = Date.now() + 3000;
  islandShow(busyErr ? 'busy' : 'oops', busyErr ? 'Very busy — try again soon' : 'That didn’t work', 3000);
  const b = renderMessage('assistant', errorText(err, prefix));
  b.classList.add('error');
  if (retry) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'fu-chip retry-btn';
    btn.textContent = 'Try again';
    btn.addEventListener('click', () => { b.remove(); retry(); });
    b.appendChild(btn);
  }
  return b;
}
// Take back the last question (its bubble and its saved message) so it can be asked again.
function takeBackLastQuestion(text) {
  const last = state.messages[state.messages.length - 1];
  if (last && last.role === 'user') { state.messages.pop(); save(); }
  const users = chatLog.querySelectorAll('.bubble-user');
  const lastB = users[users.length - 1];
  if (lastB) lastB.remove();
  return text;
}

/* ---------- Review my mistakes: quiz questions the student missed come back later ---------- */
const DAY_MS = 864e5;
function captureQuizMarks(reply) {
  if (!/\[\[\s*(MISSED|GOT)\s*:/i.test(reply || '')) return reply;
  if (!Array.isArray(state.mistakes)) state.mistakes = [];
  const norm = (q) => q.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
  let changed = false;
  reply = reply.replace(/\[\[\s*(MISSED|GOT)\s*:\s*([\s\S]*?)\]\]/gi, (_, kind, body) => {
    const [q, a] = body.split('||').map((x) => (x || '').trim());
    if (!q) return '';
    const key = norm(q);
    const i = state.mistakes.findIndex((m) => norm(m.q) === key);
    if (/missed/i.test(kind)) {
      const m = i >= 0 ? state.mistakes[i] : null;
      if (m) { m.a = a || m.a; m.misses = (m.misses || 1) + 1; m.due = Date.now() + DAY_MS; }
      else state.mistakes.unshift({ q: q.slice(0, 400), a: (a || '').slice(0, 300), at: Date.now(), due: Date.now() + DAY_MS, misses: 1 });
      setTimeout(() => botMood('encourage', 3200), 50); // a missed question: kind, not sad
    } else if (i >= 0) {
      const m = state.mistakes[i];
      m.right = (m.right || 0) + 1;
      if (m.right >= 2) state.mistakes.splice(i, 1); // right twice → learned
      else m.due = Date.now() + 3 * DAY_MS;
    }
    changed = true;
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  if (state.mistakes.length > 200) state.mistakes.length = 200;
  if (changed) save();
  return reply;
}
const dueMistakes = () => (Array.isArray(state.mistakes) ? state.mistakes : []).filter((m) => (m.due || 0) <= Date.now());
function reviewMistakes(all = false) {
  const list = (all ? state.mistakes || [] : dueMistakes()).slice(0, 10);
  if (!list.length) { renderMessage('assistant', 'No mistakes to review right now — nice! Start a quiz with “Quiz me”, and any you miss will come back here.'); return; }
  if (!canChat()) { openSettings(); return; }
  track('feature', 'review');
  quizMode = true;
  if (quizBtn) quizBtn.classList.add('active');
  if (typeof setQuizLabel === 'function') setQuizLabel('Stop quiz');
  dressCassie();
  const qs = list.map((m, k) => `${k + 1}. ${m.q}${m.a ? ` (correct answer: ${m.a})` : ''}`).join('\n');
  handleSend(`Let's review the quiz questions I got wrong before. Ask them one at a time (you may reword them slightly), wait for my answer, then grade it:\n${qs}`);
}

async function handleSend(text, opts = {}) {
  if (attachReading) {
    const wait = attachReading;
    sendBtn.disabled = true;
    try { await wait; } finally { sendBtn.disabled = false; if (attachReading === wait) attachReading = null; }
  }
  // a question typed under a share card is about what was shared
  if (sharedText && chatLog.querySelector('.share-card') && text.trim() && !text.includes(sharedText.slice(0, 40))) {
    text = `${text.trim()}\n\n"${sharedText}"`;
    chatLog.querySelector('.share-card').remove();
  }
  sharedText = chatLog.querySelector('.share-card') ? sharedText : '';
  const image = pendingImage;
  let doc = pendingDoc;
  if (!text.trim() && !image && !doc) return;
  if (!doc && !image && activeDoc && activeDoc.chatId === state.currentId && DOC_FOLLOWUP_RE.test(text)) doc = activeDoc.doc;
  if (!image && !pendingDoc && !opts.mode) {
    const pic = imageRequest(text);
    if (pic) return handleImageRequest(text, pic.subject);
  }

  const needKey = (image || doc) ? !(state.geminiKey || canChat()) : !canChat();
  if (needKey) {
    openSettings();
    detourToElement(geminiKeyInput, { click: true, resumeAfter: 1200 }); // one Google key covers everything
    // Show the reminder only once — don't stack a new bubble on every send.
    const prev = chatLog.querySelector('.need-key-msg');
    if (prev) prev.remove();
    const b = renderMessage('assistant', image
      ? "To read an image I need your free Google (Gemini) API key — add it in Settings (top right)."
      : "I need one free key to start — the easiest is Google's: go to **aistudio.google.com/apikey**, sign in with your Google account, tap **Create API key**, and paste it in Settings. It takes about a minute, and that one key covers everything.");
    if (b) b.classList.add('need-key-msg');
    return;
  }

  let sendText = text.trim();
  if (!sendText && image) sendText = 'Please look at this image and help me with it. If it has questions or a lesson on it, read all of it carefully.';
  if (!sendText && doc) sendText = 'Please read this file and make me a complete reviewer of it.';

  clearFollowups();
  // if the home screen is showing, clear it before the first message
  if (!state.messages.length) chatLog.innerHTML = '';
  // A document is read separately; history only keeps a short note + excerpt,
  // so later questions don't blow past the free per-minute limits.
  let modelContent = sendText;
  let displayContent = sendText;
  if (pendingDoc) {
    const excerpt = doc.text ? `\n\n(Excerpt from the start of the file:)\n${doc.text.slice(0, 1200)}` : '';
    modelContent = `[I attached the file "${doc.name}" — a ${KIND_WORD[doc.kind] || 'file'}, ${doc.label}.] ${sendText}${excerpt}`;
    displayContent = `${sendText}\n\n(attached: ${doc.name} — ${doc.label})`;
  }
  const history = state.messages.slice();
  const userMsg = { role: 'user', content: modelContent };
  if (pendingDoc) userMsg.display = displayContent;
  state.messages.push(userMsg);
  touchChat();
  save();
  if (doc) activeDoc = { chatId: state.currentId, doc };
  if (attachRead) attachRead.hidden = true;
  const userBubble = renderMessage('user', displayContent);
  if (image && image.dataUrl) addImageToBubble(userBubble, image.dataUrl);
  clearAttach();
  promptInput.value = '';
  promptInput.placeholder = 'Ask Cassie a question…';
  autoGrow();
  taskOutfit = null;
  dressCassie();
  const featureName = doc ? 'file:' + (doc.kind || 'file') : image ? 'photo' : counselorMode ? 'talk' : quizMode ? 'quiz' : opts.mode === 'hint' ? 'hint' : 'chat';
  track('feature', featureName);
  if (!doc && !image) trackWords(sendText);
  mascotOnSend(sendText); // Cassie reacts/comments on what you sent
  // remember what the student is studying + any explicit "remember ..." note
  try {
    if (window.CassieMemory) {
      window.CassieMemory.maybeRememberFrom(sendText);
      window.CassieMemory.recordQuestion(sendText);
    }
  } catch (e) { /* ignore */ }

  setCursorMode('thinking');
  if (doc) botMood('reading');
  const typingBubble = renderTyping();
  sendBtn.disabled = true;
  const onWait = (secs) => { setTypingStatus(typingBubble, `Groq's free per-minute limit — continuing in ${secs}s…`); botMood('busy'); };

  try {
    let reply = doc
      ? await answerAboutDocument(doc, sendText, history, (msg) => setTypingStatus(typingBubble, msg))
      : await askCassie(state.messages, image, { tutor: true, mode: opts.mode, onWait });
    reply = captureQuizMarks(reply); // saves missed quiz questions for "Review my mistakes"
    if (!reply) throw friendlyError('I went blank on that one — please ask again.');
    // A picture request the detector missed: the model hands it over as [[IMAGE: …]],
    // or draws ASCII art for something that isn't a graph → make a real picture.
    const marker = !doc && !image && reply.match(/\[\[\s*IMAGE\s*:\s*([^\]]+)\]\]/i);
    const asciiPic = !doc && !image && !marker && PICTURE_WORD_RE.test(sendText) && !GRAPH_ASK_RE.test(sendText) && looksLikeAsciiArt(reply);
    if (marker || asciiPic) {
      const subject = marker ? marker[1].trim() : ((imageRequest(sendText) || {}).subject || (sendText.match(/\bof\s+(.+)$/i) || [0, sendText.replace(PICTURE_WORD_RE, '')])[1].replace(/[?!.\s]+$/, '').trim());
      setCursorMode('idle');
      await pictureReply(subject, typingBubble);
      return;
    }
    state.messages.push({ role: 'assistant', content: reply });
    save();
    typingBubble.remove();
    const bubble = renderMessage('assistant', reply);
    ensureGraph(bubble, sendText, reply);
    if (bubble.querySelector('.cassie-board')) track('feature', 'graph');
    const base = doc ? doc.name.replace(/\.[^.]+$/, '') : '';
    const title = doc
      ? (/review/i.test(sendText) ? `Reviewer – ${base}` : `${base} – notes`)
      : '';
    const want = window.CassieExport ? (window.CassieExport.wantedFormat(sendText) || (wantsStudyFile(sendText) && looksLikeContent(reply) ? 'docx' : '')) : '';
    addTextDownload(bubble, reply, { title, want });
    if (doc && doc.text) { // open the file itself to read it and highlight any part
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'attach-read reader-open-btn'; rb.textContent = `📖 Read & highlight ${doc.name.length > 28 ? doc.name.slice(0, 28) + '…' : doc.name}`;
      rb.addEventListener('click', () => openReader(doc));
      bubble.appendChild(rb);
    }
    showFollowups();
    setCursorMode('idle');
    mascotCelebrate();
    maybeCelebrate(reply); // confetti if she's praising a correct answer
    try { if (window.CassieMemory) { window.CassieMemory.scanExchange(sendText, reply); updateMemoryDot(); } } catch (e) { /* ignore */ }
    detourToElement(bubble, { click: true, resumeAfter: 900 });
    speak(reply);
  } catch (err) {
    typingBubble.remove();
    const again = !image && text.trim() ? () => handleSend(takeBackLastQuestion(text), opts) : null;
    renderError(err, again);
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

/* Typed picture requests — "generate an image of a plant cell", "draw me a
   volcano", "make a poster about recycling". With a Gemini key that has image
   generation on, Gemini paints it; otherwise a free, keyless image service
   (Pollinations) does. Graphs and plots stay on Cassie's board, which draws
   them exactly. */
const IMAGE_ASK_RE = /(?:^|[\s,.!?])(?:generate|create|make|draw|paint|render|design|produce|show\s+me|give\s+me|send\s+me|i\s+(?:want|need)|gawa(?:n|in)?\s+mo\s+ako\s+ng)\s+(?:me\s+)?(?:an?\s+|some\s+|the\s+|ng\s+)?(?:(?:ai|realistic|cartoon|cute|simple|colorful|colourful|labeled|labelled|detailed|3d|nice|cool|new)\s+)*(?:image|images|picture|pictures|pic|pics|photo|photos|illustration|illustrations|drawing|painting|artwork|art|poster|logo|wallpaper|icon|sticker|infographic|larawan)\b\s*(?:of|showing|about|for|with|that\s+shows|depicting|na|ng)?\s*[:\-]?\s*(.*)$/i;
const DRAW_ASK_RE = /(?:^|[\s,.!?])(?:draw|paint|illustrate)\s+(?:me\s+|us\s+)?((?:an?|the|some|my)\s+.+)$/i;
// also: "a picture of a cat", "image of the solar system please" (no verb at all)
const NOUN_ASK_RE = /^\s*(?:an?\s+)?(?:(?:ai|realistic|cartoon|cute|simple|labeled|labelled|detailed|3d)\s+)*(?:image|picture|pic|photo|illustration|drawing)\s+(?:of|showing)\s+(.+)$/i;
const BOARD_SUBJECT_RE = /\b(graph|plot|chart|function|equation|parabola|line|slope|axis|axes|triangle|rectangle|square|circle|area|perimeter|y\s*=|f\(x\)|x\^)/i;
function imageRequest(text) {
  const t = String(text || '').trim();
  const m = t.match(IMAGE_ASK_RE) || t.match(DRAW_ASK_RE) || t.match(NOUN_ASK_RE);
  if (!m) return null;
  const subject = (m[1] || '').trim().replace(/^please\s+/i, '').replace(/[?!.\s]+$/, '')
    .replace(/\s+(?:for\s+(?:me|us|my|our)|please|pls|po|thanks?|thank\s+you)\b.*$/i, '').replace(/[?!.,\s]+$/, '');
  if (BOARD_SUBJECT_RE.test(subject)) return null; // the board draws these accurately
  return { subject };
}
// "generate an image" with nothing after it → picture whatever we were just talking about
function imageSubjectFromChat() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role !== 'user' || m.image || imageRequest(m.display || m.content)) continue;
    const t = String(m.display || m.content).replace(/\(attached:[^)]*\)/g, '').replace(/\s+/g, ' ').trim();
    if (t) return t.slice(0, 240);
  }
  return '';
}

let geminiImageOff = false; // free Gemini keys usually have image generation set to 0
async function geminiImage(prompt) {
  let lastErr;
  for (const model of GEMINI_IMAGE_MODELS) {
    try { return await tryGenerateImage(prompt, model); } catch (e) {
      lastErr = e;
      if (e.quota || e.notAvailable) continue;
      throw e;
    }
  }
  geminiImageOff = true;
  throw lastErr || new Error('image generation is off for this key');
}
// Style follows the request: realistic by default; clean diagrams for labelled /
// scientific diagrams; the student's own style words (cartoon, anime…) win.
function imageStyle(prompt) {
  if (/\b(cartoon|anime|chibi|pixel|clipart|clip art|watercolou?r|sketch|line art|3d render|illustration|drawing|painting|logo|icon|sticker|poster)\b/i.test(prompt)) return 'high quality, detailed';
  if (/\b(diagram|labell?ed|parts of|cross[- ]section|infographic|chart|cycle|anatomy|structure)\b/i.test(prompt)) return 'clean educational diagram, accurate, clearly labelled parts, white background, high detail';
  return 'photorealistic, natural lighting, sharp focus, realistic textures, high detail, 4k photo';
}
// First try: full detail with the service's prompt helper. Second try: a shorter
// prompt without the helper — long, detailed prompts are what usually time out.
function freeImageUrl(prompt, seed, simple = false) {
  const p = simple ? `${prompt.slice(0, 220)}, ${imageStyle(prompt)}` : `${prompt}, ${imageStyle(prompt)}`.slice(0, 600);
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${simple ? 896 : 1024}&height=${simple ? 672 : 768}&seed=${seed}&model=flux${simple ? '' : '&enhance=true'}&nologo=true&safe=true`;
}
// Backup: Cassie's own server makes the picture (Workers AI).
async function serverImage(prompt) {
  const res = await fetch(SERVER + '/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: installId(), prompt: `${prompt}, ${imageStyle(prompt)}` }) });
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok || !data.image) throw friendlyError((data.error && data.error.message) || 'The picture makers are busy right now — give it a minute and ask again.');
  return `data:${data.mimeType || 'image/jpeg'};base64,${data.image}`;
}
function loadImageUrl(url, ms = 90000) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const t = setTimeout(() => { img.src = ''; reject(new Error('timeout')); }, ms);
    img.onload = () => { clearTimeout(t); resolve(url); };
    img.onerror = () => { clearTimeout(t); reject(new Error('failed')); };
    img.src = url;
  });
}
async function generateImage(prompt) {
  if (state.geminiKey && !geminiImageOff) {
    try { return { src: await geminiImage(prompt), keep: false }; } catch (e) { /* fall back to the free service */ }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = freeImageUrl(prompt, Math.floor(Math.random() * 1e9), attempt > 0);
    try { return { src: await loadImageUrl(url, attempt ? 60000 : 50000), keep: true }; } catch (e) { if (attempt === 0) await sleep(2500); }
  }
  if (SERVER) return { src: await serverImage(prompt), keep: false };
  throw friendlyError("The free picture maker is busy right now — give it a minute and ask again, or describe it more simply. (Everything else still works.)");
}
function imageFileName(subject) {
  return (subject || 'cassie-image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cassie-image';
}

async function handleImageRequest(text, subject) {
  const label = text.trim();
  if (!subject) subject = imageSubjectFromChat();
  if (!state.messages.length) chatLog.innerHTML = ''; // clear the home screen
  state.messages.push({ role: 'user', content: label });
  touchChat();
  save();
  renderMessage('user', label);
  promptInput.value = '';
  promptInput.placeholder = 'Ask Cassie a question…';
  autoGrow();
  clearFollowups();
  if (!subject) {
    const ask = 'Sure! What should the picture show? For example: “an image of a plant cell with its parts labeled”.';
    state.messages.push({ role: 'assistant', content: ask });
    save();
    renderMessage('assistant', ask);
    return;
  }
  mascotReact('image');
  setCursorMode('thinking');
  botMood('drawing');
  const typingBubble = renderTyping();
  await pictureReply(subject, typingBubble);
}

// Make the picture and post it as Cassie's reply (also used when the chat model
// answers a picture request with [[IMAGE: …]] instead of drawing ASCII art).
async function pictureReply(subject, typingBubble) {
  track('feature', 'image');
  setTypingStatus(typingBubble, 'Making your picture…');
  sendBtn.disabled = true;
  try {
    const { src, keep } = await generateImage(subject);
    typingBubble.remove();
    const caption = `Here’s your picture of ${subject}.`;
    const bubble = renderMessage('assistant', caption);
    addImageToBubble(bubble, src, { download: true, name: imageFileName(subject) });
    // free-service links are stable, so the picture comes back when the chat reopens
    state.messages.push({ role: 'assistant', content: `[I made a picture of: ${subject}]`, display: caption, image: keep ? src : undefined });
    save();
    setCursorMode('idle');
    mascotCelebrate();
  } catch (err) {
    typingBubble.remove();
    renderError(err, () => pictureReply(subject, renderTyping()), "Couldn't make that picture");
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = false;
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
  taskOutfit = 'graduate'; dressCassie(); track('feature', 'research'); trackWords(topic);
  if (!canChat()) {
    openSettings();
    detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', 'Add a free Groq or Gemini key in Settings first, then I can research for you.');
    return;
  }
  state.messages.push({ role: 'user', content: `Research: ${topic}` });
  touchChat();
  save();
  renderMessage('user', `Research: ${topic}`);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  botMood('searching');
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
    renderError(err);
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
  taskOutfit = 'graduate'; dressCassie(); track('feature', 'web'); trackWords(text);
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
  botMood('searching');
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
    renderError(err);
    setCursorMode('idle');
  }
}

if (researchBtn) {
  researchBtn.addEventListener('click', () => runResearch(promptInput.value));
}
if (webBtn) {
  webBtn.addEventListener('click', () => runWebCheck(promptInput.value));
}

/* ---------- files handed over by the Cassie browser extension ----------
   On a PDF / Google Doc / Slides tab the extension's "Make a reviewer" button
   opens this app and passes the file in (via its small bridge script on this
   site). We attach it and start the reviewer straight away. */
window.addEventListener('message', async (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'cassie-ext' || d.type !== 'import-file' || !d.base64) return;
  try {
    // Convenience: if this app has no Groq key yet, use the one saved in the extension.
    if (!state.groqKey && typeof d.groqKey === 'string' && /^gsk_/.test(d.groqKey)) { state.groqKey = d.groqKey; save(); }
    const bin = atob(d.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], d.name || 'file.pdf', { type: d.mime || 'application/pdf' });
    const ok = await attachFile(file);
    if (ok && d.prompt) handleSend(d.prompt);
  } catch (err) {
    renderMessage('assistant', 'I couldn’t open the file from your browser tab — download it and attach it with the paperclip instead.');
  }
});

/* ---------- what was asked in the Chrome extension shows up here too ----------
   The bridge script hands over the extension's history (highlights, snips, pasted
   pictures, page questions). Each page gets one chat per day, "From Chrome · …". */
const EXT_KIND = { snip: 'Snip', paste: 'Pasted picture', photo: 'Photo', page: 'About this page', board: 'Board' };
function extItemId(it) { return String(it.id || ('h' + (it.ts || 0) + ':' + String(it.q || '').slice(0, 24))); }
function importExtensionHistory(items) {
  const seen = new Set(Array.isArray(state.extSeen) ? state.extSeen : []);
  const fresh = items
    .filter((it) => it && typeof it === 'object' && (it.q || it.a) && !seen.has(extItemId(it)))
    .sort((a, b) => (a.ts || 0) - (b.ts || 0));
  if (!fresh.length) return 0;
  let touchedCurrent = false;
  for (const it of fresh) {
    seen.add(extItemId(it));
    let page = '', host = '';
    try { const u = new URL(it.url); page = u.origin + u.pathname; host = u.hostname.replace(/^www\./, ''); } catch (e) { /* no page */ }
    const key = `ext|${new Date(it.ts || Date.now()).toDateString()}|${page}`;
    let chat = state.chats.find((c) => c.extKey === key);
    if (!chat) {
      chat = makeChat();
      chat.extKey = key;
      const name = String(it.title || host || 'a web page').replace(/\s+/g, ' ').trim();
      chat.title = `From Chrome · ${name.length > 34 ? name.slice(0, 34) + '…' : name}`;
      state.chats.push(chat);
    }
    const q = String(it.q || '').trim() || EXT_KIND[it.kind] || 'Question';
    const label = EXT_KIND[it.kind] && !q.startsWith(EXT_KIND[it.kind]) ? `${EXT_KIND[it.kind]}: ${q}` : q;
    const userMsg = { role: 'user', content: label };
    if (typeof it.image === 'string' && it.image.startsWith('data:image/')) userMsg.image = it.image;
    chat.messages.push(userMsg, { role: 'assistant', content: String(it.a || '') });
    chat.updatedAt = Math.max(chat.updatedAt || 0, it.ts || Date.now());
    if (chat.id === state.currentId) touchedCurrent = true;
  }
  state.extSeen = [...seen].slice(-600);
  save();
  if (typeof renderChatList === 'function') renderChatList();
  if (touchedCurrent) renderHistory();
  islandShow('done', fresh.length === 1 ? '1 answer from Chrome added' : `${fresh.length} answers from Chrome added`, 3200);
  return fresh.length;
}
window.addEventListener('message', (e) => {
  const d = e.data;
  if (e.source !== window || !d || d.source !== 'cassie-ext' || d.type !== 'import-history' || !Array.isArray(d.items)) return;
  try { importExtensionHistory(d.items.slice(0, 100)); } catch (err) { /* a bad item never breaks the app */ }
});
document.documentElement.dataset.cassieReady = '1';

/* ---------- the student's drawing board ---------- */
const prefersDark = () => !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);

// Put a picture (e.g. the student's sketch) into the composer as an attachment.
function attachDataUrl(dataUrl, prompt) {
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    const x = c.getContext('2d');
    x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
    x.drawImage(img, 0, 0, c.width, c.height);
    const jpg = c.toDataURL('image/jpeg', 0.88);
    pendingImage = { mimeType: 'image/jpeg', base64: jpg.split(',')[1], dataUrl: jpg };
    pendingDoc = null;
    attachThumb.src = jpg; attachThumb.hidden = false;
    attachName.hidden = true; attachPreview.hidden = false;
    if (prompt && !promptInput.value.trim()) promptInput.value = prompt;
    autoGrow();
    promptInput.focus();
  };
  img.src = dataUrl;
}

function openSketch(opts = {}) {
  if (!window.CassieSketch) return;
  window.CassieSketch.open({
    title: opts.title || 'Your board',
    dark: opts.dark != null ? opts.dark : prefersDark(),
    image: opts.image || null,
    note: opts.note || null,
    checkLabel: 'Send to Cassie',
    onCheck: (png) => {
      window.CassieSketch.close();
      attachDataUrl(png, 'Check my work on this board — what did I get right, and what should I fix?');
      return '';
    },
    askPlaceholder: 'Ask Cassie, or tell her what to draw (e.g. “graph y = x² − 4”)',
    onAsk: (png, q, parts) => askBoard(png, q, parts),
  });
}
// The board's "Ask": Cassie answers about the board, and draws on it when asked (or when a
// graph says it best). A blank board isn't sent as a picture.
async function askBoard(png, q, parts) {
  const B = window.CassieBoard;
  const blank = parts && !parts.image && !(parts.strokes || []).length;
  const prompt = `${blank ? '' : 'This is my board (maybe a picture, maybe my own writing on it). '}${q}\n\nIf I asked you to draw, graph, plot, sketch or show something, or the answer is best shown as a graph, shape or numbered steps, include exactly one cassie-board block: it gets drawn right on my board. Keep your words short (under 120 words).`;
  const image = blank ? null : { mimeType: 'image/png', base64: String(png).split(',')[1] || '' };
  const reply = await askCassie([{ role: 'user', content: prompt }], image, { tutor: true });
  const { clean, boards } = B ? B.extract(reply) : { clean: reply, boards: [] };
  let draw = boards[0];
  if (!draw && B && GRAPH_ASK_RE.test(q)) { const eq = B.findEquation(q) || B.findEquation(reply); if (eq) draw = B.graphSpec(eq); }
  track('feature', draw ? 'board-draw' : 'board-ask');
  return { reply: clean, draw };
}

// Turn one of Cassie's chat boards (graph canvas or shape drawing) into a picture.
function boardToImage(boardEl) {
  return new Promise((resolve) => {
    const canvas = boardEl.querySelector('.cb-canvas-wrap canvas');
    if (canvas) { resolve(canvas.toDataURL('image/png')); return; }
    const svgEl = boardEl.querySelector('svg');
    if (!svgEl) { resolve(null); return; }
    const vb = (svgEl.getAttribute('viewBox') || '0 0 260 180').split(/\s+/).map(Number);
    const xml = new XMLSerializer().serializeToString(svgEl);
    const img = new Image();
    img.onload = () => {
      const k = 4, c = document.createElement('canvas');
      c.width = vb[2] * k; c.height = vb[3] * k;
      const x = c.getContext('2d');
      x.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim() || '#fff';
      x.fillRect(0, 0, c.width, c.height);
      x.drawImage(img, 0, 0, c.width, c.height);
      resolve(c.toDataURL('image/png'));
    };
    img.onerror = () => resolve(null);
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  });
}

if (window.CassieBoard) {
  window.CassieBoard.onDraw = async (boardEl, spec) => {
    const image = await boardToImage(boardEl);
    openSketch({ image, title: spec.title ? `Board — ${spec.title}` : 'Your board' });
  };
}
const boardBtn = document.getElementById('board-btn');
if (boardBtn) boardBtn.addEventListener('click', () => { track('feature', 'board'); botMood('drawing', 4000); openSketch(); });

/* ---------- attach / generate wiring ---------- */
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', () => {
  const file = fileInput.files && fileInput.files[0];
  if (file) attachFile(file);
});

// Attach a picture or document to the next message. Returns true when it's ready.
async function attachFile(file) {
  const kind = await sniffKind(file);
  const showName = (t) => { attachThumb.hidden = true; attachName.hidden = false; attachName.textContent = t; attachPreview.hidden = false; };

  // Photos / screenshots → picture reading.
  if (kind === 'image' || kind === 'heic') {
    try {
      pendingImage = await processImageFile(file);
      pendingDoc = null;
      attachThumb.src = pendingImage.dataUrl;
      attachThumb.hidden = false;
      attachName.hidden = true;
      attachPreview.hidden = false;
      islandShow('upload', 'Got your photo!', 2200); botMood('upload', 2200);
      return true;
    } catch (e) {
      // iPhone HEIC photos can't be drawn by most browsers — Gemini can still read them as-is.
      pendingDoc = null;
      if (kind === 'heic' && state.geminiKey) {
        const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(file); });
        pendingImage = { mimeType: file.type || 'image/heic', base64, dataUrl: '' };
        showName(`Photo (iPhone HEIC) · ${file.name}`);
        return true;
      }
      clearAttach();
      showName(kind === 'heic'
        ? 'That’s an iPhone HEIC photo, which this browser can’t open. Send a screenshot of it instead, or set iPhone Camera → Formats → Most Compatible.'
        : `Couldn’t open ${file.name} as a picture.`);
      return false;
    }
  }

  // Documents → read the whole thing in the browser.
  if (kind === 'pdf' || kind === 'docx' || kind === 'pptx' || kind === 'txt') {
    pendingImage = null;
    showName(`Reading ${file.name}…`);
    islandShow('upload', `Opening ${file.name}…`); botMood('upload');
    const reading = readDocument(file, kind);
    attachReading = reading.catch(() => null); // Send waits for this, so the file is never left behind
    try {
      const doc = await reading;
      if (!doc.text && !doc.hasVisuals) {
        pendingDoc = null;
        attachName.textContent = `Couldn’t find anything readable in ${file.name}.`;
        islandShow('oops', 'Nothing readable in that file', 2600); botMood('oops', 2600);
        return false;
      }
      pendingDoc = doc;
      attachName.textContent = `${doc.label} · ${file.name}${doc.scanned ? ' — scanned, I’ll read the pages as pictures' : ''}`;
      if (attachRead) attachRead.hidden = !doc.text;
      if (!promptInput.value.trim()) promptInput.placeholder = 'What should I do with it? e.g. “Make a reviewer”';
      islandShow('done', `Got it · ${doc.label}`, 2200); botMood('done', 2200);
      return true;
    } catch (e) {
      pendingDoc = null;
      attachName.textContent = `Couldn’t read ${file.name}. Try a PDF, PowerPoint (.pptx), Word (.docx) or a photo.`;
      islandShow('oops', 'Couldn’t read that file', 2600); botMood('oops', 2600);
      return false;
    }
  }

  pendingImage = null; pendingDoc = null;
  if (kind === 'legacy-ppt') showName('That’s an old PowerPoint (.ppt). Open it and Save As .pptx or PDF, then attach it again.');
  else if (kind === 'legacy-doc') showName('That’s an old Word file (.doc). Open it and Save As .docx or PDF, then attach it again.');
  else if (kind === 'xlsx') showName('Spreadsheets aren’t supported yet — save it as a PDF and attach that.');
  else showName(`I can’t open ${file.name}. I read PDFs, PowerPoint (.pptx), Word (.docx), text files and photos.`);
  return false;
}
attachRemove.addEventListener('click', clearAttach);

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
    if (!canChat()) {
      openSettings();
      detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
      renderMessage('assistant', 'Add a free Groq or Gemini key in Settings first, then we can start a quiz.');
      return;
    }
    quizMode = !quizMode;
    quizBtn.classList.toggle('active', quizMode);
    dressCassie();
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
      const saved = (state.mistakes || []).length;
      renderMessage('assistant', saved
        ? `Quiz stopped. Nice work! I saved ${saved} question${saved === 1 ? '' : 's'} to practise again — tap “Review my mistakes” on the home screen (New chat) any time.`
        : 'Quiz stopped. Nice work! Ask me anything or start another quiz whenever you like.');
    }
  });
}
if (talkBtn) {
  talkBtn.addEventListener('click', () => {
    if (!canChat()) {
      openSettings();
      detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
      renderMessage('assistant', 'Add a free Groq or Gemini key in Settings first, then we can talk.');
      return;
    }
    counselorMode = !counselorMode;
    talkBtn.classList.toggle('active', counselorMode);
    setTimeout(dressCassie, 0);
    if (talkLabel) talkLabel.textContent = counselorMode ? 'Studying' : 'Talk';
    if (counselorMode) {
      quizMode = false;
      if (quizBtn) quizBtn.classList.remove('active');
      if (typeof setQuizLabel === 'function') setQuizLabel('Quiz me');
      if (!state.messages.length) chatLog.innerHTML = '';
      renderMessage('assistant', "Okay — real talk mode. No lessons, no fluff. What's going on? I'm listening.");
      try { set3D('encouraging'); } catch (e) { /* ignore */ }
    } else {
      renderMessage('assistant', "Back to study mode. I'm here whenever you want to talk again.");
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
  if (keysGroup) keysGroup.open = !canChat();
  const keysOpt = document.getElementById('keys-optional'), keysSub = document.getElementById('keys-sub');
  if (keysOpt) keysOpt.hidden = !SERVER;
  if (keysSub && SERVER) keysSub.textContent = 'Optional — for heavy use';
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
  if (bot2d) bot2d.setAccent(color || '#d8343c');
  if (islandBot) islandBot.setAccent(color || '#d8343c');
  track('feature', 'colour');
  save();
  applyAccent();
  syncAccentSwatches();
}
const MODEL_SHORT = {
  'openai/gpt-oss-120b': 'GPT-OSS 120B',
  'llama-3.3-70b-versatile': 'Llama 3.3 70B',
  'openai/gpt-oss-20b': 'GPT-OSS 20B',
};
function updateModelPill() {
  if (!modelPill) return;
  modelPillModel.textContent = geminiOnly() ? 'Gemini' : (MODEL_SHORT[state.groqModel] || 'Cassie');
  const lvl = state.level && state.level !== 'auto' ? (LEVEL_LABELS[state.level] || 'Auto') : 'Auto';
  modelPillLevel.textContent = lvl.charAt(0).toUpperCase() + lvl.slice(1);
}
function closeSettings() {
  state.groqKey = groqKeyInput.value.trim();
  state.groqModel = groqModelSelect.value;
  state.geminiKey = geminiKeyInput.value.trim();
  state.voiceOut = voiceOutToggle.checked;
  if (state.voiceOut) track('feature', 'voice-out');
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

// Monochrome line icons for the memory panel (no emoji — matches the marble UI).
const MEM_ICONS = {
  lock: '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  flame: '<path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.5 1.5-4 2.5-5 .2 1.8 1 3 2.5 3.5C11.5 9 11 6 12 3z"/>',
  check: '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.7 2.7L16 9.8"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  book: '<path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v15H6.5A2.5 2.5 0 0 0 4 20.5z"/><path d="M4 20.5A2.5 2.5 0 0 1 6.5 18H20v3H6.5A2.5 2.5 0 0 1 4 20.5z"/>',
  repeat: '<path d="M17 2l3 3-3 3"/><path d="M4 11V9a4 4 0 0 1 4-4h12"/><path d="M7 22l-3-3 3-3"/><path d="M20 13v2a4 4 0 0 1-4 4H4"/>',
};
const memIcon = (k) => `<svg class="mem-ico" viewBox="0 0 24 24" aria-hidden="true">${MEM_ICONS[k]}</svg>`;
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
      <p class="mem-privacy">${memIcon('lock')}Everything here stays on your device. No account, no server — only you can see it.</p>
      ${hasData ? `
      <div class="mem-stats">
        <div class="mem-stat"><b>${memIcon('flame')}${s.streak}</b><small>day streak</small></div>
        <div class="mem-stat"><b>${memIcon('check')}${s.mastered}</b><small>mastered</small></div>
        <div class="mem-stat"><b>${memIcon('clock')}${s.focusHours}h</b><small>focus</small></div>
        <div class="mem-stat"><b>${memIcon('book')}${s.topics}</b><small>topics</small></div>
        <div class="mem-stat"><b>${memIcon('repeat')}${s.due}</b><small>to review</small></div>
      </div>
      <p class="mem-note">A gentle tracker — it grows as you learn. No streak-shaming here.</p>` : `
      <p class="mem-welcome">This is where your progress will live. Ask Cassie a question or finish a focus session, and your streak, topics, and reviews start filling in here.</p>`}

      <label class="field"><span>Your name (optional)</span><input id="mem-name" type="text" value="${memEsc(d.profile.name)}" placeholder="What should I call you?"></label>
      <label class="field"><span>Your goal (optional)</span><input id="mem-goal" type="text" value="${memEsc(d.profile.goal)}" placeholder="e.g. pass my chemistry finals"></label>

      ${due.length ? `<div class="mem-section">Due for review</div><div class="mem-chips">${due.map((t) => `<button class="mem-review" data-topic="${memEsc(t.name)}">${memEsc(t.name)}</button>`).join('')}</div>` : ''}
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
  const wrap = document.getElementById('pomo');
  const modeEl = document.getElementById('pomo-mode');
  const timeEl = document.getElementById('pomo-time');
  const cyclesEl = document.getElementById('pomo-cycles');
  const ringFill = document.getElementById('pomo-ring-fill');
  const toggleBtn = document.getElementById('pomo-toggle');
  const resetBtn = document.getElementById('pomo-reset');
  const skipBtn = document.getElementById('pomo-skip');
  const editBtn = document.getElementById('pomo-edit');
  const setPanel = document.getElementById('pomo-set');
  const doneBtn = document.getElementById('pomo-done');
  const inputs = { focus: document.getElementById('pomo-in-focus'), brk: document.getElementById('pomo-in-brk'), long: document.getElementById('pomo-in-long') };
  if (!wrap || !toggleBtn) return;

  // The student's own times (minutes), saved with the rest of their settings.
  const LIMITS = { focus: [1, 240], brk: [1, 120], long: [1, 120] };
  const clampMin = (k, v) => Math.min(LIMITS[k][1], Math.max(LIMITS[k][0], Math.round(+v || 0)));
  const times = Object.assign({ focus: 25, brk: 5, long: 15 }, state.pomo || {});
  Object.keys(LIMITS).forEach((k) => { times[k] = clampMin(k, times[k]); });

  let mode = 'focus';       // 'focus' | 'break' | 'long'
  let remaining = times.focus * 60;
  let running = false;
  let endAt = 0;            // wall-clock end time, so the timer stays right in background tabs
  let tick = null;
  let cycles = 0;           // completed focus blocks

  const total = () => 60 * (mode === 'focus' ? times.focus : mode === 'long' ? times.long : times.brk);
  const fmt = (s) => {
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
    const mm = h ? String(m).padStart(2, '0') : String(Math.floor(s / 60)).padStart(2, '0');
    return `${h ? h + ':' : ''}${mm}:${String(sec).padStart(2, '0')}`;
  };

  function render() {
    timeEl.textContent = fmt(Math.max(0, remaining));
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
    try { track('feature', 'timer'); } catch (e) { /* ignore */ }
    endAt = Date.now() + remaining * 1000;
    clearInterval(tick);
    tick = setInterval(() => {
      remaining = Math.round((endAt - Date.now()) / 1000);
      if (remaining <= 0) { remaining = 0; complete(); return; }
      render();
    }, 500);
    render();
  }
  function pause() { if (running) remaining = Math.max(0, Math.round((endAt - Date.now()) / 1000)); running = false; clearInterval(tick); render(); }
  function complete() {
    clearInterval(tick); running = false;
    if (mode === 'focus') {
      cycles += 1;
      try { if (window.CassieMemory) { window.CassieMemory.addFocusMinutes(times.focus); if (typeof updateMemoryDot === 'function') updateMemoryDot(); } } catch (e) { /* */ }
      const long = cycles % 4 === 0;
      switchMode(long ? 'long' : 'break');
      nudge(long ? `Awesome focus! Take a ${times.long}-minute break — stretch and breathe.` : `Nice work! ${times.brk}-minute break — drink some water and rest your eyes.`, 'encouraging');
    } else {
      switchMode('focus');
      nudge(`Break's over — ${times.focus} minutes of focus. Let's go!`, 'thinking');
    }
    start(); // auto-flow into the next block
  }

  // ---- setting your own times ----
  function fillInputs() {
    Object.keys(inputs).forEach((k) => { if (inputs[k]) inputs[k].value = times[k]; });
    setPanel.querySelectorAll('[data-preset]').forEach((b) => {
      const [f, br, l] = b.dataset.preset.split(',').map(Number);
      b.classList.toggle('on', f === times.focus && br === times.brk && l === times.long);
    });
  }
  function applyTimes(next) {
    const before = total();
    Object.keys(next).forEach((k) => { times[k] = clampMin(k, next[k]); });
    state.pomo = { ...times };
    save();
    // A block that hasn't started yet picks up the new length right away;
    // a running or half-done block keeps going and the new times apply next.
    if (!running && remaining === before) remaining = total();
    fillInputs();
    render();
  }
  function openSet(open) {
    setPanel.hidden = !open;
    editBtn.setAttribute('aria-expanded', String(open));
    if (open) { fillInputs(); setTimeout(() => inputs[mode === 'focus' ? 'focus' : mode === 'long' ? 'long' : 'brk'].focus(), 0); }
  }
  editBtn.addEventListener('click', () => openSet(setPanel.hidden));
  timeEl.addEventListener('click', () => openSet(setPanel.hidden));
  doneBtn.addEventListener('click', () => openSet(false));
  setPanel.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.preset) {
      const [f, br, l] = b.dataset.preset.split(',').map(Number);
      applyTimes({ focus: f, brk: br, long: l });
    } else if (b.dataset.k) {
      const k = b.dataset.k, d = +b.dataset.d;
      // step to the next round number (e.g. 25 → 30 → 35), but allow 1-minute precision below 5
      let v = times[k] + d;
      if (Math.abs(d) >= 5 && times[k] % 5 !== 0) v = d > 0 ? Math.ceil(times[k] / 5) * 5 : Math.floor(times[k] / 5) * 5;
      applyTimes({ [k]: v < 1 ? 1 : v });
    }
  });
  Object.keys(inputs).forEach((k) => {
    const inp = inputs[k];
    if (!inp) return;
    inp.addEventListener('change', () => applyTimes({ [k]: inp.value }));
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') { inp.blur(); openSet(false); } });
  });

  toggleBtn.addEventListener('click', () => (running ? pause() : (nudge(mode === 'focus' ? "Focus time! I'll keep you company." : 'Rest up!', mode === 'focus' ? 'thinking' : 'encouraging'), start())));
  resetBtn.addEventListener('click', () => { pause(); mode = 'focus'; cycles = 0; remaining = times.focus * 60; render(); });
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
  taskOutfit = null;
  setTimeout(dressCassie, 0);
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
      track('feature', 'voice-in');
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
  utter.onstart = () => botMood('talking');
  utter.onend = utter.onerror = () => { if (bot2d && bot2d.state === 'talking') botMood('idle'); };
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
  track('feature', 'highlight:' + (mode || 'explain'));
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

  if (!canChat()) {
    setPopoverContent('Add a free Groq or Gemini key in Settings first.', { muted: true });
    positionPopover(rect);
    openSettings();
    detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
    return;
  }

  setCursorMode('thinking');
  botMood('highlighting');
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
    setPopoverContent(errorText(err), { muted: true });
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
  if (!el.closest('#chat-log, #reader-body')) return; // answers, messages, and files open in the reader
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
document.getElementById('reader-body')?.addEventListener('scroll', hideHighlightPopover);
window.addEventListener('resize', hideHighlightPopover);

/* ---------- anonymous usage stats (optional, opt-out in Settings → You) ---------- */
// Usage counts go to Cassie's server (config.js). No server = nothing is sent.
const ANALYTICS_URL = window.CASSIE_ANALYTICS_URL || (SERVER ? SERVER + '/e' : '');
// What is sent: a random install id, the event (app opened / feature used), and coarse
// profile buckets (student/pro, grade band, age band). With "topics" on (adults only),
// up to 5 single keywords per message — never names, messages, files, or keys, and
// nothing at all from Talk mode.
function installId() {
  try {
    let id = localStorage.getItem('cassie.aid');
    if (!id) { id = (crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + Math.random().toString(36).slice(2)); localStorage.setItem('cassie.aid', id); }
    return id;
  } catch (e) { return ''; }
}
const STOP = new Set(('the a an and or but if then so to of in on at for with from by about as is are was were be been being do does did can could would should will shall may might must have has had this that these those it its i me my we our you your he she they them their what which who whom whose why how when where please thanks thank explain answer tell show give make help need want like just also more most very really some any each every there here into onto than too much many cassie okay yes hello hi hey get got know think use using used write writing list summarize summary summarise example examples simple simply terms word words mean means meaning define definition question questions answer answers step steps easy quick short long better best good great thing things something kind type make made does done doing find look give gave take took want wanted able sure about again only even still well other another first second last next same ' +
  'ang ng sa mga na at ko mo ako ikaw siya ito iyan yan yung po ba naman lang din rin kasi para pero kung may wala hindi oo opo ano paano bakit saan kailan sino nga pa ni nila namin natin kami tayo sila kayo').split(' '));
let trackQ = [], wordQ = [], trackTimer = null;
function track(event, name = '') {
  const an = state.analytics;
  if (!ANALYTICS_URL || !an || an.usage === false || !installId()) return;
  if (state.profile && state.profile.age < 13) return; // nothing at all is counted for under-13s
  trackQ.push({ e: event, n: String(name || '').slice(0, 40), t: Date.now() });
  clearTimeout(trackTimer); trackTimer = setTimeout(flushTrack, 5000);
  if (trackQ.length >= 20) flushTrack();
}
function trackWords(text) {
  const an = state.analytics, p = state.profile || {};
  if (!ANALYTICS_URL || !an || !an.usage || !an.topics || counselorMode || (p.age && p.age < 18)) return;
  const own = String(p.name || '').toLowerCase();
  const words = String(text || '').toLowerCase().replace(/\S+@\S+|https?:\/\/\S+/g, ' ').split(/[^\p{L}]+/u)
    .filter((w) => w.length >= 4 && w.length <= 24 && !STOP.has(w) && w !== own);
  [...new Set(words)].slice(0, 5).forEach((w) => wordQ.push(w));
}
function trackCtx() {
  const p = state.profile || {};
  const grp = p.role === 'student' ? (GRADE_GROUPS.find((g) => g[2].includes(p.grade)) || [''])[0] : '';
  const standalone = window.matchMedia && matchMedia('(display-mode: standalone)').matches;
  return { role: p.role || '', grade: grp, age: ageBand(p.age), platform: (/Mobi|Android|iPhone/i.test(navigator.userAgent) ? 'phone' : 'computer') + (standalone ? ' app' : ''), lang: (navigator.language || '').slice(0, 5), version: 'v' + APP_VERSION };
}
function flushTrack() {
  if (!ANALYTICS_URL || (!trackQ.length && !wordQ.length)) return;
  const body = JSON.stringify({
    uid: installId(),
    ctx: trackCtx(),
    events: trackQ.splice(0, 50), words: wordQ.splice(0, 50),
  });
  try {
    if (navigator.sendBeacon) navigator.sendBeacon(ANALYTICS_URL, new Blob([body], { type: 'text/plain' }));
    else fetch(ANALYTICS_URL, { method: 'POST', body, keepalive: true, headers: { 'content-type': 'text/plain' } }).catch(() => {});
  } catch (e) { /* offline — fine */ }
}
addEventListener('pagehide', flushTrack);
document.addEventListener('visibilitychange', () => { if (document.hidden) flushTrack(); });

/* ---------- profile: a quick sign-up on first open ---------- */
// Name, student or professional, grade (students) or field (professionals), and age.
// Sets Cassie's explanation level and Student/Pro mode, and personalises answers.
// Stored only in this browser.
const GRADE_GROUPS = [
  ['Elementary', 'elementary', ['Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']],
  ['Junior High School', 'middle', ['Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']],
  ['Senior High School', 'high', ['Grade 11', 'Grade 12']],
  ['College / University', 'college', ['1st year college', '2nd year college', '3rd year college', '4th year college', '5th year college']],
  ['Graduate school', 'college', ['Graduate school']],
];
const levelForGrade = (g) => { const grp = GRADE_GROUPS.find((x) => x[2].includes(g)); return grp ? grp[1] : 'auto'; };
const ageBand = (a) => (!a ? '' : a < 13 ? 'under 13' : a < 18 ? '13-17' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 50 ? '35-49' : '50+');
function profileLine(p) {
  const who = p.role === 'pro' ? `a working professional${p.field ? ` (${p.field})` : ''}` : `a ${p.grade || 'student'} student`.replace('a Graduate school student', 'a graduate student');
  return `You're helping ${p.name || 'the user'}${p.age ? `, age ${p.age}` : ''} — ${who}. Use their name now and then when talking with them — but never inside a paper, essay or anything they will hand in. Pitch every explanation to that level.${p.age && p.age < 13 ? ' They are a young child: keep it simple, warm and safe.' : ''}`;
}
function openProfile(first) {
  const p = state.profile || (state.account && state.account.name ? { name: state.account.name } : {});
  const wrap = document.createElement('div');
  wrap.className = 'profile-overlay';
  wrap.innerHTML = `<form class="profile-card" novalidate>
    <h2>${first ? 'Let’s set up Cassie for you' : 'Your profile'}</h2>
    <p class="pf-sub">So she explains things at the right level. Saved only on this device.</p>
    <label class="pf-field"><span>Your name</span><input name="name" maxlength="40" autocomplete="given-name" placeholder="e.g. Hazel"></label>
    <div class="pf-field"><span>I’m a…</span><div class="pf-seg"><button type="button" data-role="student">Student</button><button type="button" data-role="pro">Working professional</button></div></div>
    <label class="pf-field pf-student"><span>Grade level</span><select name="grade"><option value="">Choose your grade…</option>${GRADE_GROUPS.map(([g, , list]) => `<optgroup label="${g}">${list.map((x) => `<option>${x}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <label class="pf-field pf-pro"><span>What do you do?</span><input name="field" maxlength="60" list="pf-fields" placeholder="e.g. nurse, accountant, teacher"><datalist id="pf-fields"><option>Teacher</option><option>Nurse</option><option>Engineer</option><option>Accountant</option><option>Software developer</option><option>Marketing</option><option>Customer service</option><option>Business owner</option><option>Researcher</option></datalist></label>
    <label class="pf-field"><span>Age</span><input name="age" type="number" inputmode="numeric" min="5" max="100" placeholder="e.g. 16"></label>
    <label class="pf-check pf-usage"><input type="checkbox" name="usage"> <span>Help improve Cassie: share <b>anonymous</b> usage — which features you use and how often. No names, no messages.</span></label>
    <label class="pf-check pf-topics"><input type="checkbox" name="topics"> <span>Also share the <b>topics</b> I ask about (single keywords only, never my messages).</span></label>
    <p class="pf-err" hidden></p>
    <button type="submit" class="pf-go">${first ? 'Start studying' : 'Save'}</button>
  </form>`;
  document.body.appendChild(wrap);
  const f = wrap.querySelector('form');
  let role = p.role || '';
  f.name.value = p.name || ''; f.grade.value = p.grade || ''; f.field.value = p.field || ''; f.age.value = p.age || '';
  const an = state.analytics || { usage: true, topics: true };
  f.usage.checked = an.usage !== false; f.topics.checked = an.topics !== false;
  function sync() {
    f.querySelectorAll('[data-role]').forEach((b) => b.classList.toggle('on', b.dataset.role === role));
    f.querySelector('.pf-student').hidden = role !== 'student';
    f.querySelector('.pf-pro').hidden = role !== 'pro';
    const minor = +f.age.value > 0 && +f.age.value < 18;
    const child = +f.age.value > 0 && +f.age.value < 13;
    f.querySelector('.pf-topics').hidden = minor; // no topic sharing for under-18s
    if (minor) f.topics.checked = false;
    f.querySelector('.pf-usage').hidden = child; // and no usage counts at all for under-13s
    if (child) f.usage.checked = false;
  }
  f.querySelectorAll('[data-role]').forEach((b) => b.addEventListener('click', () => { role = b.dataset.role; sync(); }));
  f.age.addEventListener('input', sync);
  f.addEventListener('input', () => { f.querySelector('.pf-err').hidden = true; });
  f.addEventListener('click', (ev) => { if (ev.target.closest('[data-role]')) f.querySelector('.pf-err').hidden = true; });
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim(), age = Math.round(+f.age.value), grade = f.grade.value, field = f.field.value.trim();
    const err = !name ? 'Please type your name.' : !role ? 'Are you a student or a working professional?'
      : role === 'student' && !grade ? 'Please choose your grade level.' : role === 'pro' && !field ? 'Please tell us what you do.'
      : !(age >= 5 && age <= 100) ? 'Please enter your age (5–100).' : '';
    const errEl = f.querySelector('.pf-err');
    if (err) { errEl.textContent = err; errEl.hidden = false; return; }
    state.profile = { name, role, grade: role === 'student' ? grade : '', field: role === 'pro' ? field : '', age, at: p.at || Date.now() };
    state.audience = role === 'pro' ? 'pro' : 'student';
    state.level = role === 'pro' ? 'auto' : levelForGrade(grade);
    state.analytics = { usage: f.usage.checked, topics: f.topics.checked && age >= 18 };
    save();
    try { if (window.CassieMemory) window.CassieMemory.setProfile('name', name); } catch (e2) { /* ignore */ }
    if (typeof renderAudience === 'function') renderAudience();
    dressCassie();
    wrap.remove();
    if (age < 13 && typeof authToken === 'function' && authToken()) {
      // accounts are for 13 and up (e.g. a younger child who used Continue with Google)
      authCall('/auth/delete', {}).catch(() => {}).finally(signedOutLocally);
      setTimeout(() => mascotSay('Cassie accounts are for ages 13 and up, so I’ll keep your things on this device instead.', 5000), 400);
    }
    if (first) { track('signup'); track('open'); set3D('celebratory'); setTimeout(() => set3D('neutral'), 2200); }
    try { mascotSay(first ? `Nice to meet you, ${name}! 👋` : 'Profile saved ✓', 3000); } catch (e3) { /* ignore */ }
    renderProfileSummary();
  });
  setTimeout(() => f.name.focus(), 50);
}
/* ---------- Cassie accounts: sign in once, and your profile follows you ---------- */
// Only with Cassie's server (config.js). What syncs: profile, settings and saved quiz
// mistakes — never chats or API keys. Without an account everything stays on the device.
const GOOGLE_CLIENT_ID = String(window.CASSIE_GOOGLE_CLIENT_ID || '').trim();
// (var/function, not const: save() can run before this part of the file has loaded)
function accountsOn() { return !!SERVER; }
var AUTH_KEY = 'cassie.auth';
function authToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
async function authCall(path, body, method = 'POST') {
  const token = authToken();
  let res;
  try {
    res = await fetch(SERVER + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (e) { throw friendlyError("Couldn't connect — check your internet and try again."); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) { const e = friendlyError(data.error || 'Something went wrong — please try again.'); e.status = res.status; throw e; }
  return data;
}
function accountData() {
  return { profile: state.profile || null, mistakes: state.mistakes || [], audience: state.audience, level: state.level, accent: state.accent, citationStyle: state.citationStyle, textSize: state.textSize, easyRead: state.easyRead, analytics: state.analytics };
}
var syncTimer = null, lastSynced = '';
function syncAccount(now) {
  if (!accountsOn() || !authToken() || !state.profile) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => {
    const data = accountData();
    const js = JSON.stringify(data);
    if (js === lastSynced) return;
    authCall('/auth/save', { data }).then(() => { lastSynced = js; }).catch((e) => { if (e.status === 401) signedOutLocally(); });
  }, now ? 0 : 2500);
}
function applyAccountData(d) {
  if (!d) return;
  ['profile', 'audience', 'level', 'accent', 'citationStyle', 'textSize', 'easyRead', 'analytics'].forEach((k) => { if (d[k] != null) state[k] = d[k]; });
  if (Array.isArray(d.mistakes)) { // keep both devices' saved mistakes
    const have = new Set((state.mistakes || []).map((m) => (m.q || '').toLowerCase()));
    state.mistakes = [...(state.mistakes || []), ...d.mistakes.filter((m) => m && m.q && !have.has(m.q.toLowerCase()))].slice(0, 200);
  }
  lastSynced = JSON.stringify(accountData());
  save();
  try { renderAudience(); applyAccent(); applyReading(); dressCassie(); renderProfileSummary(); } catch (e) { /* ignore */ }
  if (!state.messages.length) renderHistory();
}
function signedIn(token, account) {
  try { localStorage.setItem(AUTH_KEY, token); } catch (e) { /* ignore */ }
  state.account = { email: account.email || '', name: account.name || '', google: !!account.google };
  save();
}
function signedOutLocally() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
  state.account = null; save(); renderProfileSummary();
}
// After any sign-in: bring the account's profile here, or ask the profile questions once.
function afterSignIn(res) {
  signedIn(res.token, res.account);
  if (res.account.data && res.account.data.profile) {
    applyAccountData(res.account.data);
    track('open');
    try { mascotSay(`Welcome back, ${state.profile.name}! 👋`, 3000); } catch (e) { /* ignore */ }
  } else {
    if (state.profile) syncAccount(true); // this device already has a profile → save it to the account
    else openProfile(true);
  }
  renderProfileSummary();
}

function loadGoogle() {
  if (window.google && window.google.accounts) return Promise.resolve();
  return new Promise((ok, bad) => { const sc = document.createElement('script'); sc.src = 'https://accounts.google.com/gsi/client'; sc.async = true; sc.onload = ok; sc.onerror = bad; document.head.appendChild(sc); });
}

function openAuth({ first = false, mode = 'signin' } = {}) {
  document.querySelector('.auth-page')?.remove();
  const page = document.createElement('div');
  page.className = 'auth-page';
  page.innerHTML = `
    <div class="auth-left">
      <div class="auth-brand"><svg viewBox="100 80 305 350" aria-hidden="true"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z"/></svg>Cassie</div>
      <form class="auth-form" novalidate>
        <h1 class="auth-title"></h1>
        <p class="auth-sub"></p>
        <div class="auth-google" ${GOOGLE_CLIENT_ID ? '' : 'hidden'}><div class="auth-gbtn"></div></div>
        <div class="auth-or" ${GOOGLE_CLIENT_ID ? '' : 'hidden'}><span>or</span></div>
        <label class="auth-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="auth-field auth-age"><span>Your age</span><input name="age" type="number" inputmode="numeric" min="5" max="100" placeholder="e.g. 16"></label>
        <label class="auth-field"><span>Password</span><span class="auth-pw"><input name="password" type="password" minlength="8" required><button type="button" class="auth-eye" aria-label="Show password"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>
        <p class="auth-err" role="alert" hidden></p>
        <button type="submit" class="auth-go"></button>
        <p class="auth-switch"></p>
        <p class="auth-forgot" hidden></p>
        <button type="button" class="auth-skip">Continue without an account</button>
        <p class="auth-legal">Accounts are for ages 13 and up. Your chats stay on your device; an account keeps your name, grade, settings and saved quiz mistakes in sync. <a href="terms.html" target="_blank" rel="noopener">Terms</a> · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p>
      </form>
    </div>
    <div class="auth-right" aria-hidden="true">
      <div class="auth-glow"></div>
      <div class="auth-copy">
        <p class="auth-kicker">Your study buddy</p>
        <h2>Learn anything.<br>On every device.</h2>
        <p>Sign in once — your grade, level and the quiz questions you missed follow you from your phone to your laptop.</p>
      </div>
      <img class="auth-hero" src="landing/cassie-hero.webp" alt="" width="545" height="458">
    </div>`;
  document.body.appendChild(page);
  const f = page.querySelector('form');
  const err = f.querySelector('.auth-err');
  const go = f.querySelector('.auth-go');
  const showErr = (m) => { err.textContent = m; err.hidden = !m; };
  const setMode = (m) => {
    mode = m;
    f.querySelector('.auth-title').textContent = m === 'signup' ? 'Create your Cassie account' : 'Sign in to Cassie';
    f.querySelector('.auth-sub').textContent = m === 'signup' ? 'Free. Keeps your profile and progress on every device.' : 'Welcome back! Pick up right where you left off.';
    go.textContent = m === 'signup' ? 'Create account' : 'Sign in';
    f.querySelector('.auth-age').hidden = m !== 'signup';
    f.password.autocomplete = m === 'signup' ? 'new-password' : 'current-password';
    f.password.placeholder = m === 'signup' ? 'At least 8 characters' : '';
    f.querySelector('.auth-switch').innerHTML = m === 'signup'
      ? 'Already have an account? <button type="button" data-to="signin">Sign in</button>'
      : 'Don’t have an account? <button type="button" data-to="signup">Sign up</button> · <button type="button" data-to="forgot">Forgot password?</button>';
    f.querySelector('.auth-forgot').hidden = true;
    showErr('');
  };
  f.querySelector('.auth-switch').addEventListener('click', (e) => {
    const to = e.target.closest('[data-to]')?.dataset.to;
    if (!to) return;
    if (to === 'forgot') {
      const fp = f.querySelector('.auth-forgot');
      fp.textContent = GOOGLE_CLIENT_ID
        ? 'If your account uses the same email as your Google account, tap “Continue with Google” to get back in — no password needed.'
        : 'Password resets aren’t available yet. Tap “Report a problem” in Settings with your email and we’ll help, or create a new account.';
      fp.hidden = false; return;
    }
    setMode(to);
  });
  f.querySelector('.auth-eye').addEventListener('click', () => { f.password.type = f.password.type === 'password' ? 'text' : 'password'; });
  f.addEventListener('input', () => showErr(''));
  const close = () => page.remove();
  const done = (res) => { close(); afterSignIn(res); };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = f.email.value.trim(), password = f.password.value;
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email)) return showErr('Please type your email address.');
    const age = Math.round(+f.age.value);
    if (mode === 'signup' && !(age >= 5 && age <= 100)) return showErr('Please enter your age.');
    if (mode === 'signup' && age < 13) {
      return showErr('Cassie accounts are for ages 13 and up. You can still use Cassie on this device — tap “Continue without an account”, ideally with a parent or teacher.');
    }
    if (mode === 'signup' && password.length < 8) return showErr('Use at least 8 characters for your password.');
    if (!password) return showErr('Please type your password.');
    go.disabled = true; go.textContent = mode === 'signup' ? 'Creating…' : 'Signing in…';
    try { done(await authCall(mode === 'signup' ? '/auth/signup' : '/auth/login', mode === 'signup' ? { email, password, age } : { email, password })); }
    catch (e2) { setMode(mode); showErr(e2.message); go.disabled = false; }
  });
  f.querySelector('.auth-skip').addEventListener('click', () => {
    close();
    state.skippedAuth = true; save();
    if (!state.profile) openProfile(true);
  });
  if (!first) page.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  if (GOOGLE_CLIENT_ID) {
    loadGoogle().then(() => {
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: async ({ credential }) => {
          try { done(await authCall('/auth/google', { credential })); } catch (e) { showErr(e.message); }
        },
      });
      const box = page.querySelector('.auth-gbtn');
      window.google.accounts.id.renderButton(box, { theme: 'outline', size: 'large', shape: 'pill', text: 'continue_with', width: Math.min(360, box.clientWidth || 320) });
    }).catch(() => { page.querySelector('.auth-google').hidden = true; page.querySelector('.auth-or').hidden = true; });
  }
  setMode(mode);
  setTimeout(() => f.email.focus(), 60);
}

function renderAccountRow() {
  const row = document.getElementById('account-row');
  if (!row) return;
  row.hidden = !accountsOn();
  const a = state.account && authToken() ? state.account : null;
  row.innerHTML = a
    ? `<p class="field-hint">Signed in as <b>${escapeHtml(a.email || a.name || 'you')}</b>${a.google ? ' (Google)' : ''}. Your profile and saved mistakes sync to your account.</p>
       <div class="acct-btns"><button type="button" class="new-chat-btn" data-act="signout">Sign out</button><button type="button" class="new-chat-btn acct-del" data-act="delete">Delete account</button></div>`
    : `<p class="field-hint">Sign in to keep your profile and progress on every device.</p>
       <button type="button" class="new-chat-btn" data-act="signin">Sign in or create an account</button>`;
}
document.getElementById('account-row')?.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'signin') { settingsPanel.hidden = true; openAuth({ mode: 'signin' }); return; }
  if (act === 'signout') { try { await authCall('/auth/logout', {}); } catch (e2) { /* signed out anyway */ } signedOutLocally(); mascotSay('Signed out. Your stuff is still here on this device.', 3000); return; }
  if (act === 'delete') {
    if (!confirm('Delete your Cassie account? Your profile and saved mistakes are removed from the server. What’s on this device stays.')) return;
    try { await authCall('/auth/delete', {}); signedOutLocally(); mascotSay('Account deleted.', 2500); } catch (e2) { alert(e2.message); }
  }
});

function renderProfileSummary() {
  const el = document.getElementById('profile-summary'); const p = state.profile;
  if (el) el.textContent = p ? `${p.name} · ${p.role === 'pro' ? p.field : p.grade} · age ${p.age}` : 'No profile yet.';
  const u = document.getElementById('share-usage-toggle'), t = document.getElementById('share-topics-toggle'), row = document.getElementById('share-topics-row');
  const an = state.analytics || { usage: true, topics: true };
  if (u) u.checked = an.usage !== false;
  if (t) t.checked = an.topics !== false && !(p && p.age < 18);
  if (row) row.hidden = !!(p && p.age < 18);
  renderAccountRow();
}
document.getElementById('edit-profile-btn')?.addEventListener('click', () => { settingsPanel.hidden = true; openProfile(false); });
['share-usage-toggle', 'share-topics-toggle'].forEach((id) => document.getElementById(id)?.addEventListener('change', () => {
  state.analytics = { usage: document.getElementById('share-usage-toggle').checked, topics: document.getElementById('share-topics-toggle').checked };
  save();
}));

/* ---------- feedback: "Report a problem" in Settings ---------- */
async function sendFeedback(kind, feature, text = '') {
  if (!SERVER) return false;
  try {
    const r = await fetch(SERVER + '/f', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify({ uid: installId(), kind, feature, text, ctx: trackCtx() }) });
    return r.ok;
  } catch (e) { return false; }
}
function openReport() {
  const wrap = document.createElement('div');
  wrap.className = 'profile-overlay';
  wrap.innerHTML = `<form class="profile-card" novalidate>
    <h2>Report a problem</h2>
    <p class="pf-sub">What happened? What did you expect? Please don’t include personal info like your full name, phone number, or passwords.</p>
    <label class="pf-field"><span>What went wrong</span><textarea name="text" rows="5" maxlength="1200" placeholder="e.g. The graph didn't show when I asked for y = x^2"></textarea></label>
    <p class="pf-err" hidden></p>
    <div class="pf-row"><button type="button" class="new-chat-btn pf-cancel">Cancel</button><button type="submit" class="pf-go">Send</button></div>
  </form>`;
  document.body.appendChild(wrap);
  const f = wrap.querySelector('form');
  const close = () => wrap.remove();
  wrap.querySelector('.pf-cancel').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  f.text.focus();
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = f.text.value.trim();
    const err = f.querySelector('.pf-err');
    if (text.length < 5) { err.textContent = 'Please describe the problem in a few words.'; err.hidden = false; return; }
    f.querySelector('.pf-go').disabled = true;
    const ok = await sendFeedback('report', 'report', text);
    if (!ok) { err.textContent = "Couldn't send — check your internet and try again."; err.hidden = false; f.querySelector('.pf-go').disabled = false; return; }
    f.innerHTML = '<h2>Thank you!</h2><p class="pf-sub">Your report was sent. It helps make Cassie better for everyone.</p><button type="button" class="pf-go">Close</button>';
    f.querySelector('.pf-go').addEventListener('click', close);
  });
}
document.getElementById('report-btn')?.addEventListener('click', () => { settingsPanel.hidden = true; openReport(); });
if (!SERVER) { const rb = document.getElementById('report-row'); if (rb) rb.hidden = true; }

const lookSelect = document.getElementById('look-select');
if (lookSelect) {
  lookSelect.value = state.look === 'felt' ? 'felt' : 'auto';
  lookSelect.addEventListener('change', () => { state.look = lookSelect.value; save(); setTimeout(() => location.reload(), 300); });
}
const liteSelect = document.getElementById('lite-select');
function renderLiteHint() {
  const h = document.getElementById('lite-hint');
  if (h) h.textContent = window.CASSIE_LITE ? 'Lite mode is on right now.' : 'Lite mode is off right now.';
}
if (liteSelect) {
  liteSelect.value = state.lite || 'auto';
  renderLiteHint();
  liteSelect.addEventListener('change', () => {
    state.lite = liteSelect.value; save();
    const want = state.lite === 'on' || (state.lite === 'auto' && slowDevice());
    if (want !== window.CASSIE_LITE) {
      const h = document.getElementById('lite-hint');
      if (h) h.textContent = 'Reloading to apply…';
      setTimeout(() => location.reload(), 600);
    }
  });
}

/* ---------- What's new (once per update, for returning users) ---------- */
const WHATS_NEW = [
  'Read & highlight: attach a PDF, Word or PowerPoint and tap “📖 Read & highlight” to read it here and highlight any part (great on phones).',
  'Highlight on your phone: select words in any app → Share → Cassie (Android). iPhone/iPad: Settings → Use Cassie in other apps.',
  'Cassie can draw on your board now: open the board and type “graph y = x² − 4”, or “graph the answer” on a snip.',
  'Photo questions don’t stop when Google is busy: another picture reader takes over.',
  'She follows your instructions more exactly, and sounds more like a friend than a robot.',
  'Meet the new Cassie: a little cursor who changes colour with her mood. Tap her to poke her!',
  'While she works, a pill at the top shows what she’s doing — “Reading pages 3–8…”, then “Done”.',
  'Using the Chrome extension? What you highlight, snip or paste there now shows up in your chats here (“From Chrome”).',
  'Reflection papers and personal essays are now written in your voice — with [brackets] for your own moments to fill in.',
  'Miss the 3D felt Cassie? Pick her in Settings → Appearance → Cassie’s look.',
  'Quiz me saves the ones you missed — tap “Review my mistakes” to practise them.',
];
function showWhatsNew() {
  if (state.seenVersion === APP_VERSION) return;
  state.seenVersion = APP_VERSION; save();
  const wrap = document.createElement('div');
  wrap.className = 'profile-overlay';
  wrap.innerHTML = `<div class="profile-card"><h2>What’s new in Cassie</h2><ul class="wn-list">${WHATS_NEW.map((t) => `<li>${escapeHtml(t)}</li>`).join('')}</ul><button type="button" class="pf-go">Got it</button></div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector('.pf-go').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
}


/* ---------- Read & highlight: a file opened inside Cassie (phones and tablets) ----------
   Phone browsers don't run extensions, so students read their PDF / Word / PowerPoint here,
   page by page, and highlight any part of it: the same popup as in the chat appears. */
const attachRead = document.getElementById('attach-read');
const readerEl = document.getElementById('reader');
function openReader(doc) {
  if (!readerEl || !doc || !doc.text) return;
  document.getElementById('reader-name').textContent = doc.name;
  const body = document.getElementById('reader-body');
  body.innerHTML = '';
  // the text comes with [Page N] / [Slide N] markers; each becomes a labelled page
  const parts = String(doc.text).split(/\[(Page|Slide) (\d+)\]\n?/);
  const addPage = (label, text) => {
    if (!text.trim()) return;
    const sec = document.createElement('section'); sec.className = 'reader-page';
    if (label) { const h = document.createElement('div'); h.className = 'reader-label'; h.textContent = label; sec.appendChild(h); }
    text.trim().split(/\n{2,}|\n(?=[A-Z0-9•\-–(])/).forEach((para) => { const p = document.createElement('p'); p.textContent = para.replace(/\s*\n\s*/g, ' ').trim(); if (p.textContent) sec.appendChild(p); });
    body.appendChild(sec);
  };
  addPage('', parts[0] || '');
  for (let i = 1; i + 2 < parts.length + 1; i += 3) addPage(`${parts[i]} ${parts[i + 1]}`, parts[i + 2] || '');
  readerEl.hidden = false;
  document.body.classList.add('reader-open');
  body.scrollTop = 0;
  track('feature', 'reader');
  islandShow('reading', 'Select any words to ask me', 2600);
}
function closeReader() { if (readerEl) readerEl.hidden = true; document.body.classList.remove('reader-open'); hideHighlightPopover(); }
if (attachRead) attachRead.addEventListener('click', () => openReader(pendingDoc));
document.getElementById('reader-close')?.addEventListener('click', closeReader);

/* ---------- text and files shared from other apps (phones and tablets) ----------
   Android: select text in any app → Share → Cassie (the manifest's share_target; sw.js keeps
   what was shared). iPhone / iPad, or any link: app.html?text=… (an iOS Shortcut can send it).
   Cassie then asks what to do with it. */
const SHARE_ACTIONS = [
  ['Explain', (t) => `Explain this step by step, simply:\n\n"${t}"`],
  ['Answer', (t) => `Answer this. Give the answer first, then a short explanation of why:\n\n"${t}"`],
  ['Summarize', (t) => `Summarize this in a few short bullet points with the key terms in bold:\n\n"${t}"`],
  ['Quiz me', (t) => `Quiz me on this, one question at a time:\n\n"${t}"`],
];
function showShareCard(text, source) {
  const t = String(text || '').trim().slice(0, 6000);
  if (!t) return;
  if (state.messages.length) createNewChat();
  const card = document.createElement('div');
  card.className = 'share-card';
  card.innerHTML = '<div class="share-head">What should I do with this?</div><blockquote class="share-quote"></blockquote><div class="share-from"></div><div class="share-row"></div>';
  card.querySelector('.share-quote').textContent = t.length > 600 ? t.slice(0, 600) + '…' : t;
  if (source) card.querySelector('.share-from').textContent = 'From ' + source;
  const row = card.querySelector('.share-row');
  SHARE_ACTIONS.forEach(([label, make]) => {
    const btn = document.createElement('button');
    btn.type = 'button'; btn.className = 'chip'; btn.textContent = label;
    btn.addEventListener('click', () => { card.remove(); track('feature', 'share-' + label.toLowerCase().replace(/\s+/g, '-')); handleSend(make(t)); });
    row.appendChild(btn);
  });
  chatLog.innerHTML = '';
  chatLog.appendChild(card);
  promptInput.placeholder = 'Or ask your own question about it…';
  islandShow('upload', 'Got what you shared', 2200); botMood('upload', 2200);
  sharedText = t;
}
let sharedText = ''; // a typed question about shared text includes the text
// the link an iOS Shortcut opens (this site's own address)
document.querySelectorAll('.share-link').forEach((el) => { el.textContent = new URL('app.html?text=', location.href).href; });
async function receiveShare() {
  const params = new URLSearchParams(location.search);
  const clean = () => { try { history.replaceState(null, '', location.pathname); } catch (e) { /* ignore */ } };
  // a plain link: app.html?text=…&url=…
  if (params.get('text') || params.get('q')) {
    const text = params.get('text') || params.get('q');
    let host = ''; try { host = new URL(params.get('url') || '').hostname.replace(/^www\./, ''); } catch (e) { /* no page */ }
    clean(); showShareCard(text, host); return;
  }
  if (params.get('shared') !== '1' || !('caches' in window)) return;
  clean();
  try {
    const cache = await caches.open('cassie-share');
    const meta = await cache.match('shared.json');
    if (!meta) return;
    const d = await meta.json();
    const fileRes = d.file ? await cache.match('shared-file') : null;
    await cache.delete('shared.json'); await cache.delete('shared-file');
    if (fileRes) {
      const blob = await fileRes.blob();
      const file = new File([blob], d.file.name, { type: d.file.type || blob.type });
      if (state.messages.length) createNewChat();
      const ok = await attachFile(file);
      if (ok) { promptInput.placeholder = /^image\//.test(file.type) ? 'What should I do with it? e.g. “Solve this”' : 'What should I do with it? e.g. “Make a reviewer”'; promptInput.focus(); }
      return;
    }
    // Android puts the selected words in text (sometimes with the page link after them)
    let text = d.text || '', host = '';
    const link = (d.url || (text.match(/https?:\/\/\S+\s*$/) || [''])[0]).trim();
    if (link && !d.url) text = text.replace(link, '').trim();
    try { host = new URL(link).hostname.replace(/^www\./, ''); } catch (e) { /* no page */ }
    if (!text && link) { showShareCard(`(Only a link was shared: ${link}) Select the words you want first, then Share them to Cassie.`, host); return; }
    showShareCard(text || d.title, host || d.title);
  } catch (e) { /* nothing to pick up */ }
}

/* ---------- init ---------- */
buildAccentSwatches();
applyReading();
applyAccent();
renderHistory();
updateModelPill();
updateMemoryDot();
renderProfileSummary();
if (!state.profile) {
  state.seenVersion = APP_VERSION;
  // with Cassie's server: the sign-in page first (or "Continue without an account")
  setTimeout(() => (accountsOn() && !authToken() && !state.skippedAuth ? openAuth({ first: true, mode: 'signup' }) : openProfile(true)), 300);
} else { track('open'); setTimeout(showWhatsNew, 1200); }
// signed in: fetch the latest profile from the account (another device may have changed it)
if (accountsOn() && authToken()) {
  authCall('/auth/me', null, 'GET').then((r) => { if (r.account) { state.account = { email: r.account.email, name: r.account.name, google: r.account.google }; if (r.account.data) applyAccountData(r.account.data); else syncAccount(true); renderProfileSummary(); } })
    .catch((e) => { if (e.status === 401) signedOutLocally(); });
}
requestAnimationFrame(() => {
  setCursorMode('idle');
  followMouseNow();
});
receiveShare();

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install still works without SW */ });
  });
}
