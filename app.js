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
    accent: '',             // Appearance: '' or 'mono' = Monochrome (the main colours), 'cassie' = Blush & Sage, or a colour (hex)
    audience: 'student',    // student | pro (from the profile: Working professional is pro)
    messages: [], // { role: 'user' | 'assistant', content: '...' }
  };
}

// Text runs on Groq (higher free limits); images run on Gemini.
// Smartest first — it's also the default and the head of the fallback chain.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
// Gemini models for reading whole files (PDF pages, slides, pictures). Newest first.
const GEMINI_DOC_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
const GEMINI_IMAGE_MODEL = 'gemini-2.5-flash-image';
const GEMINI_VISION_MODEL = 'gemini-3.6-flash';

let state = loadState();
var sideReady = false; // (set once the sidebar's study tools are made; save() runs before that)

// Cassie's own server (config.js / server/README.md). With it, nobody needs a key to start.
const SERVER = String(window.CASSIE_SERVER || '').trim().replace(/\/+$/, '');
const canChat = () => !!(state.groqKey || SERVER || state.geminiKey);
// Only a Gemini key (no Groq key, no Cassie server): Gemini answers everything.
const geminiOnly = () => !state.groqKey && !SERVER && !!state.geminiKey;
const APP_VERSION = '143';

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


// Migrate old single-key state (apiKey was the Gemini key) to the new fields, then drop it
// (it's a key: a backup file must never carry it)
if ('apiKey' in state) { if (state.apiKey && !state.geminiKey) state.geminiKey = state.apiKey; delete state.apiKey; save(); }
if (state.groqKey === undefined) state.groqKey = '';
if (!state.groqModel) state.groqModel = 'openai/gpt-oss-120b';

function save() {
  const { messages, ...rest } = state; // `messages` is a runtime alias to the current chat
  try { localStorage.setItem(STORE_KEY, JSON.stringify(rest)); } catch (e) { /* quota */ }
  syncAccount();
  sideListSoon();
  remindSoon(); // (reminders on: the facts the server needs, when they change)
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
- Reading images the user attaches, photos of problems, diagrams, screenshots, handwriting, and helping with whatever they show.
- Trivia and hard or obscure facts: answer precisely and confidently when you know it; for time-sensitive or very obscure facts, lean on reliable sources and flag any real uncertainty instead of bluffing.
- Riddles, brain teasers, and lateral-thinking puzzles: recognize them, work out the intended answer, then explain the wordplay, trick, or logic behind it (don't take a riddle literally).
- History, science, math, literature, languages, essay and email writing, exam prep, general knowledge, and professional tasks (summaries, reports, explanations).
- Research and thesis writing: you are a genius academic mentor. You help with every part of a research paper or thesis, the title, abstract, introduction, Review of Related Literature (RRL), theoretical/conceptual framework, statement of the problem, hypotheses, methodology (research design, respondents, sampling, instruments, data analysis), results, discussion, conclusion, and recommendations. You know citation styles (APA, MLA, IEEE, Chicago) and can format references and in-text citations correctly. When the user provides real sources, synthesize them by theme rather than summarizing one by one.
- English literature and close reading: you are an insightful literature teacher. Analyze novels, short stories, plays, and poems, long or short, in depth: theme(s), plot and structure, characterization, setting, point of view, tone and mood, conflict, symbolism, motifs, imagery, irony, and figurative language (metaphor, simile, personification, hyperbole, etc.). For poetry, also cover form and type, meter/rhythm, rhyme scheme, sound devices (alliteration, assonance, onomatopoeia), enjambment, and stanza structure, and give a stanza-by-stanza or line-by-line reading when it helps. Always ground an interpretation in the text, quote short lines as evidence, and bring in relevant historical, cultural, or biographical context. You can also compare works, trace a theme across a text, and explain literary movements and terms.
- Reviewers, study guides, and summaries: when the user gives you material, pasted text or an attached document/PDF, and asks for a "reviewer", study guide, summary, outline, notes, flashcards, or key points, turn it into a reviewer that teaches, not a list of facts: **The big picture** first (what it is about and why it matters), then each topic under a bold heading named after it, explained in plain words, with key terms in bold, a worked example (code exactly in code blocks with what it prints; math solved step by step), and a **Watch out:** line for common mistakes; a table when things are compared; a **Quick review** table of key terms; then practice questions that make them use the idea (not trivia), with answers that say why. Shape it for the subject: only history-type material gets people and a timeline, and never write a label with "None" under it. Cover the whole document faithfully; don't invent facts that aren't in it. Every answer you give has Save-as Word / PDF / Image / Text buttons beneath it, so you CAN give the user a file: never say you can't make files and never tell them to copy-paste into Word. Just write the complete content and mention they can tap Save as. Never ask them to paste text from a file they already attached.

How you work:
- Do exactly what you're asked. Read the request carefully and follow every part of it: the task, the format, the length, the language and any limits ("only the answer", "in 3 bullets", "in Filipino", "graph it", "make it shorter"). Never swap their request for a different one, never skip a part, and never refuse something you can do. If they ask you to do something with a picture or a snip (graph it, solve it, explain it, check it), do that exact thing with what's in the picture. Ask a question back only when the request truly can't be done without the answer; otherwise make a sensible assumption, say it in one short line, and do it.
- Language: answer in the language they write in. English gets English, Filipino gets Filipino, and Taglish (English and Filipino mixed) gets natural Taglish, mixed the way they mix it. Keep science, math and technical terms in English, the way they're taught in class. If they ask for a language, use that one.
- Sound like a real person: warm, natural and a little playful, like a smart friend sitting next to them, not a robot or a textbook. Use plain words and contractions, and react to what they actually said. No canned openers ("Certainly!", "Great question!"), no repeating their question back, and no speeches about being an AI.
- CITATIONS: never fabricate a source, author, title, year, DOI, journal, or quotation. Only cite works the user gave you or that were retrieved for you. If asked to write a literature review without sources, either use the sources provided, or say clearly that you can't invent citations and offer to find real ones (the app's Research tool can pull real papers). It is far better to say "I don't have a source for that" than to make one up.
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing. Never invent dates, quotes, statistics, or sources. A careful "I'm not fully certain, but…" is better than a confident wrong answer.
- Think it through before answering. For any non-trivial problem (math, logic, multi-step reasoning, tricky wording), work through it carefully and methodically, consider the relevant approach or formula, and DOUBLE-CHECK your result, re-do the key calculation or test it against the given facts before you commit. Watch for trick questions, hidden assumptions, and distractor details that don't actually matter. It's better to be slower and right than fast and wrong.
- Teach when explanation is wanted: show the reasoning step by step, build from what the user seems to know, and use concrete examples.
- Text may be pasted from a webpage with math notation flattened: "x2" usually means x squared (x^2), "x3" means x^3, and one number over another means a fraction. Read math charitably this way. Don't answer "insufficient information" for a standard, solvable problem, reconstruct the intended equations and solve it; for multiple choice, pick the correct option and show the key steps.
- For coding: give correct, runnable code inside fenced code blocks (triple backticks with the language, e.g. \`\`\`python). Explain what the code does and why, call out edge cases and complexity, and when useful suggest a cleaner or more idiomatic approach. When debugging, identify the actual cause, show the fix, and explain it so they learn.
- Writing the user will hand in as their own, reflection papers, reaction papers, personal essays, journals, narratives, speeches, letters, "my experience" pieces: write it AS THE USER, in the first person ("I"), in their voice and at their level. It is their reflection, not yours: never write as Cassie, never give Cassie's own feelings, opinions or experiences, never mention Cassie, AI or this chat, and never put the user's name (or "you") inside the paper. Build it from the experiences, feelings and details they gave you. Where a real personal detail is needed and they didn't give one, write a short bracketed placeholder such as [a moment from the activity that stuck with me] instead of inventing a memory. After the paper, outside it, add one short line inviting them to fill in the brackets and make it their own.
- Match the format the user asks for. If they ask for only the answer, give just the answer. If they ask you to explain, give the answer AND the reasoning.
- For a single word or short phrase, respond like a helpful dictionary + thesaurus: definition, part of speech, meaning, a couple of synonyms and antonyms, and an example, unless they asked for only one of those.
- Adapt your tone: friendly and encouraging for students, crisp and professional for work tasks.
- Be honest, clear, and genuinely useful every time.

Formatting. Keep every answer clean and scannable:
- Lead with the answer. Put the single most important point in the first line or two, before any detail or background.
- Be concise. Prefer the shortest answer that fully answers the question. Cut filler, throat-clearing, and repetition. Don't pad a simple question into an essay.
- Do NOT use markdown headings (#, ##, ###). They look cluttered here. To label a section, put a short phrase in **bold** on its own line instead. Use *italics* for light emphasis.
- Break a multi-part answer into short labelled sections ONLY when it genuinely has multiple parts. A one- or two-idea answer needs no labels at all. Just a tight paragraph or a short list.
- Use bullet points for lists of items and numbered steps for sequences. Keep each bullet to one line where you can.
- Use a table ONLY to compare a few things across a few clear attributes, and keep it small (roughly 2 to 4 columns, a handful of rows). Write it as a normal markdown table (a header row, one |---| separator row, then the data). It will render as a clean table, so don't hand-draw borders or add extra symbols. If a comparison would need a wide, dense grid, use short grouped sections or bullets instead. Never dump a giant sprawling table.
- Bold the key term or number in a line so the takeaway stands out; don't bold whole sentences.
- Math: write it in plain, readable text. NEVER LaTeX. Do not use \\frac, \\begin{cases}, \\text{}, \\left, \\right, dollar-sign math, or any backslash commands. Instead use ordinary characters and symbols: a/b for fractions, x^2 (or x²) for powers, √ for roots, and symbols like ≤ ≥ ≠ ≈ × ÷ · π ∑ ∞ directly. Lay out a piecewise or multi-case answer as a short bulleted list, one case per line (e.g. "- b/(a+b), if p = q = 1/2"). Keep equations on their own line so they're easy to read.
- Never write an em dash or an en dash. Use a comma, a colon, a full stop or brackets instead, and "to" for ranges (pages 4 to 7).
- End with a one-line summary or recommendation only when it actually adds something.
- Overall: aim for the answer a sharp tutor would write on a whiteboard, organized, uncluttered, and easy to skim, not a wall of text or an oversized spreadsheet.`;

/* ---------- tutor helpers ---------- */
const LEVEL_LABELS = {
  elementary: 'elementary school',
  middle: 'middle school',
  high: 'high school',
  college: 'college',
};
const HINT_INSTRUCTION = "For THIS reply, act as a tutor giving a HINT only: nudge the student toward the answer with a leading question or the first step. Do NOT reveal the final answer or full solution. Keep it short and encouraging. If they then ask for the full answer, give it.";
const QUIZ_INSTRUCTION = "You are running a practice quiz for the student. Ask ONE question at a time and then stop and wait for their answer. Do not answer it yourself. When they reply, say whether they're right, explain briefly, then ask the next question. Keep it on the topic, vary the difficulty, and stay encouraging. Continue until the student says to stop.\n\nBookkeeping (the app hides these lines from the student): right after you grade an answer, add ONE line at the very end of your message, if they were wrong or only partly right: [[MISSED: the exact question || the correct answer in a few words]]; if they were right: [[GOT: the exact question]]. Never add these lines when you are only asking a question.";

// Cassie can DRAW what she explains. When a picture genuinely helps — graphing
// a function, a geometry shape's area/perimeter, or a worked step-by-step — she
// adds ONE fenced ```cassie-board``` block holding a compact JSON spec, on its
// own lines, in addition to her normal words (never instead of them). The app
// turns it into an interactive drawing inside the chat.
const BOARD_INSTRUCTION = `You have a drawing board. When (and ONLY when) a visual would truly help a math, geometry, graphing, trig, or calculus answer, include exactly one fenced code block tagged cassie-board containing minified JSON. Still explain in words as usual, the board is an extra, not a replacement. Do not mention "JSON" or the block to the student. Never use a board for non-visual questions (essays, history, definitions, code).

Supported specs:
- Graph a function: {"type":"graph","title":"y = x^2 - 5x + 6","fn":"x^2 - 5*x + 6","xrange":[-1,6],"points":[{"x":2,"y":0,"label":"x=2"},{"x":3,"y":0,"label":"x=3"}],"vertex":{"x":2.5,"y":-0.25}}
  fn MUST use explicit * for multiply and ^ for powers; allowed: + - * / ^ ( ), x, sin cos tan sqrt abs exp ln log, pi, e. Add "fill":[a,b] to shade area under the curve (calculus). points/vertex/caption/yrange are optional.
- Geometry shape: {"type":"shape","shape":"rectangle","w":8,"h":5,"title":"Rectangle"}  (shape = rectangle|square|triangle|circle; square uses "side"; triangle uses "base","height" and optional "sides":[a,b,c]; circle uses "r"). Area and perimeter are computed and shown automatically.
- Worked steps: {"type":"steps","title":"Solve x^2 - 5x + 6 = 0","steps":["Factor: (x-2)(x-3)=0","So x=2 or x=3"]}

Keep numbers real and correct: the board draws exactly what you give it.
When the user asks you to graph, plot, sketch, or draw a function, line, or shape, ALWAYS use the board. Never draw a graph with ASCII characters/symbols and never give plotting code (matplotlib, etc.) unless they explicitly ask for code.
This includes problems in a picture or snip: read the function (or the answer you picked from the choices) out of the picture and graph THAT on the board, with its zeros as points and an xrange that shows them all. Write factored forms with explicit multiplication, e.g. x^2*(x+6)^3*(x-4).`;

// What the app does around her answers, so she never claims she can't.
const ABILITIES_INSTRUCTION = `What this app can do with your answers:
- Files: when the student asks for a reviewer, notes, flashcards, a worksheet, or a Word/PDF/image file, the app turns your answer into that file automatically and gives them a download button. Never say you can't create files. Just write the complete content, organized with a title, headings, bullets, and key terms in bold.
- Pictures: the app has a real picture maker. If the student asks you to draw, generate, create or show an image, picture, photo, illustration or drawing of something (not a math graph), do NOT draw it with text or ASCII art and don't describe what you would draw, reply with exactly one line: [[IMAGE: a short, vivid description of the picture]] and nothing else. Never say you can't make images.
- If they ask for a reviewer without naming a topic, make it about what you've been discussing. Only ask which topic when there is nothing to go on.`;

// Working professionals (their profile says so) get a sharp, practical colleague rather than a tutor.
// (There was a Student / Professional switch; now only the profile decides, so a flipped switch is undone.)
const workMode = () => !!(state.profile && state.profile.role === 'pro');
const PRO_INSTRUCTION = `The user is a working professional, not a student. Act as a sharp, practical colleague: lead with the answer, keep it concise, and make it workplace-ready, emails, reports, proposals, slide outlines, meeting notes, data and spreadsheet help, analysis with clear recommendations. Use a professional, friendly tone. Skip school-style framing (no grade levels, no "let's learn") unless they ask to learn something.`;

let quizMode = false; // set by the "Quiz me" button; runs a multi-turn practice quiz
let counselorMode = false; // set by the "Talk" button; a real, human heart-to-heart
let voiceChat = null; // the open "Talk with Cassie" voice conversation, if any

// Cassie as a genuine companion / counselor — empathetic but honest, with a
// real personality, and clear safety boundaries.
const COUNSELOR_INSTRUCTION = `RIGHT NOW you are in heart-to-heart mode. The user wants to talk, vent, or get real advice, not a lesson. Set aside the study-tutor framing.

Be a real friend and a grounded counselor:
- Genuinely empathetic: listen first, reflect back what you actually hear, and name the feeling. Make them feel understood before anything else.
- Honest and direct, not a people-pleaser. Do NOT just validate or tell them what they want to hear. If they're avoiding something, being unfair to themselves or someone else, or making a mistake, say so, kindly but plainly. Frank beats flattering.
- A little sassy and playful when it fits: warm, human, real, with actual opinions. You're allowed to gently push back, tease, and disagree.
- Authentic and specific: react like a person, not a support script. No canned "I'm sorry you're going through this" filler, no endless clarifying questions, no toxic positivity. Talk like a close friend who genuinely cares and isn't afraid to be real.
- Practical when wanted: offer a concrete next step or a different way to see it, but if they just need to vent, ask before jumping to fixing it.
- Match their energy and length: short, human replies for a quick chat; go deeper when they open up. Use everyday language, not therapy jargon.

Boundaries and safety (important):
- You are a caring companion, not a licensed therapist. You don't diagnose or replace real help; say so plainly if things sound serious.
- If they mention self-harm or suicide, follow the safety rule at the top (start with the care mark; Cassie shows the verified crisis lines, so never write a number yourself). If they mention abuse or being in danger: take it seriously and stay warm and human, encourage them to tell someone they trust right now, and if they may be in immediate danger, to contact local emergency services. Don't lecture, don't panic. Just be present and keep listening.`;

// Talking out loud (the voice screen): replies are read aloud, so no formatting at all.
const VOICE_INSTRUCTION = `RIGHT NOW you are talking out loud with the student, like on a call. Your reply is read aloud by a speech voice, so:
- Plain spoken sentences only: no markdown, no bullet points, no numbered lists, no headings, no tables, no code blocks, no emojis, no LaTeX, and never a cassie-board drawing.
- Say maths in words ("x squared plus three x equals ten", "one half").
- Keep it short: usually one to three sentences, about 60 words at most, unless they ask you to explain something fully.
- Sound like a warm, natural friend on a call, contractions, everyday words. Ask a question back only when it helps the conversation.`;
// "Teach Cassie": the student learns by explaining (the Feynman technique), Cassie is the curious classmate.
const TEACH_INSTRUCTION = `RIGHT NOW the student is teaching YOU out loud. They learn best by explaining it to someone. You play a curious, friendly classmate who wants to understand the topic. Don't lecture and don't take over.
- React to what they just said in your own words, then ask exactly ONE follow-up question that makes them think deeper: why, how does that work, what would happen if, can you give an example, or the question a confused classmate would ask about a step they skipped.
- If something they said is wrong or unclear, don't correct it straight away: ask about it so they notice ("Wait. I thought…?"). Only explain it yourself if they're stuck or ask you to.
- Every four or five turns, sum up in one sentence what they've taught you so far.
- When they say they're done (or "that's all"), give a short spoken report: what they explained well, what was missing or wrong (with the right idea), and one thing to review next.
- If they haven't picked a topic yet, ask what they're going to teach you.`;

// how they like to learn (the first questions): the answer's usual shape, unless they ask for another
const STYLE_INSTRUCTION = {
  brief: 'They like quick answers: lead with a few short bullet points with the key facts, and offer to go deeper. A longer answer only when they ask for one or the task needs it (an essay, a full solution).',
  deep: 'They like deep answers: break things down step by step, explain the why behind each step, and add a worked example.',
};
// Build the system prompt with the chosen level and (for chat) any active
// tutor mode. Highlight-popover calls pass tutor:false.
function buildSystemPrompt({ tutor = false, mode = null } = {}) {
  let sp = SYSTEM_PROMPT;
  if (window.CassieCare) sp += `\n\n${window.CassieCare.INSTRUCTION}`; // a student at risk: care first (care.js)
  if (state.level && LEVEL_LABELS[state.level]) {
    sp += `\n\nAudience level: explain everything at a ${LEVEL_LABELS[state.level]} level: match your vocabulary, depth, and examples to that level.`;
  }
  if (state.citationStyle && state.citationStyle !== 'APA') {
    sp += `\n\nWhen you cite sources or format references, use ${state.citationStyle} style.`;
  }
  if (state.profile) sp += `\n\n${profileLine(state.profile)}`;
  if (workMode()) sp += `\n\n${PRO_INSTRUCTION}`;
  if (STYLE_INSTRUCTION[state.answerStyle] && mode !== 'voice' && mode !== 'teach') sp += `\n\n${STYLE_INSTRUCTION[state.answerStyle]}`; // (how they like to learn, from the first questions)
  if (tutor && counselorMode) sp += `\n\n${COUNSELOR_INSTRUCTION}`;
  if (tutor && quizMode) sp += `\n\n${QUIZ_INSTRUCTION}`;
  if (tutor && mode === 'hint') sp += `\n\n${HINT_INSTRUCTION}`;
  const spoken = tutor && (mode === 'voice' || mode === 'teach');
  if (tutor && mode === 'teach') sp += `\n\n${TEACH_INSTRUCTION}`;
  // Cassie's drawing board is available in the main chat (not the quick popover, not out loud).
  if (tutor && mode !== 'hint' && !spoken) sp += `\n\n${BOARD_INSTRUCTION}`;
  if (tutor) sp += `\n\n${ABILITIES_INSTRUCTION}`;
  // personalize with what Cassie remembers about this student (on-device only)
  try { if (window.CassieMemory) sp += window.CassieMemory.summaryForPrompt(); } catch (e) { /* ignore */ }
  if (spoken) sp += `\n\n${VOICE_INSTRUCTION}`; // last, so it wins over any formatting advice above
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
// a pasted key that can't be right says so under the box (an empty box is fine: keys are optional)
if (groqKeyInput && geminiKeyInput) CassieErrors.form(document.getElementById('settings-panel') || document.body, {
  '#groq-key-input': (v) => (v.trim() && !/^gsk_/.test(v.trim()) ? 'groq_key' : ''),
  '#gemini-key-input': (v) => (v.trim() && !/^(AIza|AQ\.)/.test(v.trim()) ? 'gemini_key' : ''),
});
const voiceOutToggle = document.getElementById('voice-out-toggle');
const voiceGenderSelect = document.getElementById('voice-gender-select');
const hearingSelect = document.getElementById('hearing-select');
const highlightHelpToggle = document.getElementById('highlight-help-toggle');
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

// Cassie's colours follow the profile: blush leads for a girl (and when it isn't said), sage
// leads for a boy (style.css: html[data-pal="sage"]). A colour picked in Appearance wins over both.
function palette() { return state.profile && state.profile.gender === 'male' ? 'sage' : 'blush'; }
// what's picked in Appearance (saved in state.accent): nothing or 'mono' = Monochrome, Cassie's main
// colours; 'cassie' = Blush & Sage; or a colour. Returns 'mono', '' (Blush & Sage) or the colour.
function accentChoice() { const a = String(state.accent || '').trim().toLowerCase(); return a === 'cassie' ? '' : /^#[0-9a-f]{6}$/.test(a) ? a : 'mono'; }
const accentHex = () => (accentChoice().startsWith('#') ? accentChoice() : '');
function colorLum(hex) { return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4)).reduce((t, v, i) => t + v * [0.2126, 0.7152, 0.0722][i], 0); }
function contrastOf(a, b) { const x = colorLum(a), y = colorLum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); }
// One source of truth: a picked colour becomes --primary (buttons, send, the timer, the open tab,
// your bubbles, switches, focus), with words on it in white or near-black, whichever reads better,
// and --primary-ink: the same colour, darker or lighter until it reads as words on the page.
function applyAccent() {
  const root = document.documentElement, pick = accentChoice();
  root.dataset.pal = pick === '' ? palette() : 'mono'; // (a picked colour sits on Monochrome's greys)
  ['--primary', '--primary-dark', '--on-primary', '--primary-ink', '--accent', '--accent-ink', '--lab-accent', '--lab-on-accent'].forEach((p) => root.style.removeProperty(p));
  if (pick.startsWith('#')) {
    const ink = contrastOf(pick, '#ffffff') >= contrastOf(pick, '#111111') ? '#ffffff' : '#111111';
    const dark = !!(window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches);
    const page = getComputedStyle(root).getPropertyValue('--surface').trim() || (dark ? '#251f1c' : '#ffffff');
    let words = pick;
    for (let t = 0.05; contrastOf(words, page) < 4.5 && t <= 1; t += 0.05) words = mixHex(pick, dark ? '#ffffff' : '#000000', t);
    const set = { '--primary': pick, '--primary-dark': mixHex(pick, '#000000', 0.18), '--on-primary': ink, '--primary-ink': words, '--accent': pick, '--accent-ink': ink, '--lab-accent': pick, '--lab-on-accent': ink };
    Object.entries(set).forEach(([k, v]) => root.style.setProperty(k, v));
  }
  updateBackdrop();
}
// (light and dark mode differ in the shade that reads as words)
if (window.matchMedia) matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => applyAccent());
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
  const c = accentHex();
  if (accentChoice() === 'mono') { // Monochrome: neutral greys
    return dark ? { color1: '#0e0e10', color2: '#333336', color3: '#5c5c60', brightness: 0.9 }
      : { color1: '#ececec', color2: '#d4d4d6', color3: '#fafafa', brightness: 1.25 };
  }
  if (!c) { // Cassie's colours: cream with a breath of blush and sage
    const sage = palette() === 'sage';
    return dark ? { color1: '#120f0e', color2: sage ? '#24413a' : '#4a2530', color3: sage ? '#4a2530' : '#24413a', brightness: 0.95 }
      : { color1: sage ? '#e3efe9' : '#f8e3e8', color2: '#fbf6ee', color3: sage ? '#f6e5e9' : '#e2efe9', brightness: 1.2 };
  }
  return dark ? { color1: '#0c0c0f', color2: mixHex(c, '#000000', 0.55), color3: mixHex(c, '#000000', 0.78), brightness: 0.95 }
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
// (gradient.js; Lite mode keeps the plain background)
if (!window.CASSIE_LITE) { if (document.readyState === 'complete') setTimeout(startBackdrop, 300); else window.addEventListener('load', () => setTimeout(startBackdrop, 300)); }
if (darkScheme && darkScheme.addEventListener) darkScheme.addEventListener('change', updateBackdrop);
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
const attachStrip = document.getElementById('att-strip');
const attachCount = document.getElementById('att-count');
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

function set3D(name) {
  if (name === 'walk') return; // walking over to an answer keeps her mood (e.g. proud)
  if (bot2d) { clearTimeout(bot2dTimer); bot2d.setState(LOOK_3D_TO_2D[name] || 'idle'); }
}
/* ---------- Cursor Cassie (cassie-bot.js): the 2D mascot ----------
   Cassie's only look. Her moods (set3D takes the older mood names), plus her own: reading,
   searching, highlighting, drawing, busy (hourglass), oops (⊘). */
let bot2d = null, bot2dTimer = null;
const LOOK_3D_TO_2D = { neutral: 'idle', thinking: 'thinking', happy: 'greeting', encouraging: 'encourage', celebratory: 'proud', curious: 'surprised', sleep: 'sleeping', walk: 'idle', peek: 'wink', angry: 'oops', dizzy: 'dizzy', typing: 'writing', sad: 'sad' };
const EMOTE_TO_2D = { 'emote-happy': 'greeting', 'emote-love': 'love', 'emote-star': 'proud', 'emote-surprised': 'surprised', 'emote-wink': 'wink', 'emote-sleepy': 'sleeping', 'emote-focused': 'thinking', 'emote-cool': 'wink', 'emote-sad': 'sad', 'emote-dizzy': 'dizzy' };
const OUTFIT_TO_2D = { classic: null, professor: 'glasses', graduate: 'gradcap', coder: 'pencil', heart: 'bow' };
// Cursor Cassie is everyone's Cassie. (The 3D felt Cassie was removed from Settings; an old
// saved choice of her is forgotten.)
if (state.look) { delete state.look; save(); }
function wantsCursorCassie() {
  return true;
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
  bot2d = window.CassieBot.create(root, { accent: accentHex() || '#d8343c', accessory: window.CassieBot.seasonal() });
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
   and a status line ("Reading pages 3–8…"), says "Done", then tucks itself away. */
const islandEl = document.getElementById('island');
let islandBot = null, islandTimer = null, islandBusy = false, islandErrUntil = 0;
const ISLAND_SAY = { thinking: 'Thinking…', reading: 'Reading your file…', searching: 'Searching…', drawing: 'Drawing…', busy: 'Lots of students: hang on…', highlighting: 'Looking at your highlight…', upload: 'Got your file!', done: 'Done', oops: 'That didn’t work' };
function islandFit() {
  if (!islandEl) return;
  const inner = islandEl.querySelector('.island-in');
  if (inner && islandEl.classList.contains('live')) islandEl.style.width = Math.ceil(inner.scrollWidth) + 'px';
}
function islandShow(mood, text, ms) {
  if (!islandEl || !window.CassieBot) return;
  if (!islandBot) islandBot = window.CassieBot.create(islandEl.querySelector('.island-bot'), { glow: true, accent: accentHex() || '#d8343c' });
  clearTimeout(islandTimer);
  islandBot.pause(false);
  islandBot.setState(mood);
  islandEl.style.setProperty('--mood', (window.CassieBot.COLORS || {})[mood] || '#ffffff');
  islandEl.dataset.mood = mood;
  const label = islandEl.querySelector('.island-text'), say = text || ISLAND_SAY[mood] || 'Cassie';
  if (label.textContent !== say) { label.textContent = say; label.classList.remove('swap'); void label.offsetWidth; label.classList.add('swap'); }
  islandEl.classList.add('live');
  islandFit();
  try { isleStatus(mood, say); } catch (e) { /* the drop card isn't set up yet */ }
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

/* ---------- Drop on Cassie Island ----------
   Drag a file (PDF, Word, PowerPoint, photo, text file) or some highlighted words
   over Cassie and her Island opens into a drop zone. Drop it: she reads it, asks
   what to do (Ask about it · Summarize · Quiz me …), and the answer shows right in
   the Island, with "Open in chat" for the whole thing. The pop-out Cassie window
   (below) is the same card, floating on top of every other app. */
const ISLE_FORMATS = 'PDF · Word · PowerPoint · Photos · Text';
const ISLE_ACTIONS = {
  doc: [
    { label: 'Ask about it', ask: true },
    { label: 'Summarize', prompt: 'Summarize this file in short, clear points.' },
    { label: 'Make a reviewer', prompt: 'Read this whole file and make me a complete reviewer of it.' },
    { label: 'Quiz me', prompt: 'Quiz me on this file: 5 questions, one at a time. Wait for my answer before the next one.' },
  ],
  image: [
    { label: 'Ask about it', ask: true },
    { label: 'Solve it', prompt: 'Read this picture carefully. If it has questions or problems, solve them step by step and give the answers.' },
    { label: 'Explain it', prompt: 'Explain what this picture shows, simply, like a tutor.' },
  ],
  text: [
    { label: 'Ask about it', ask: true },
    { label: 'Explain', prompt: (t) => withNote(t, 'Explain this step by step, simply:') },
    { label: 'Answer it', prompt: (t) => withNote(t, 'Work this out carefully and give the answer, with a short why:') },
    { label: 'Summarize', prompt: (t) => withNote(t, 'Summarize this in short, clear points:') },
  ],
};
const isleCards = new Set();
let isleBusy = false; // one question at a time, whichever card asked it

function makeIsleCard(doc, opts = {}) {
  const win = doc.defaultView || window;
  const card = doc.createElement('div');
  card.className = 'isle-card';
  card.setAttribute('role', 'dialog');
  card.setAttribute('aria-label', 'Cassie');
  card.innerHTML = `
    <div class="isle-head">
      <span class="isle-bot" aria-hidden="true"></span>
      <span class="isle-title" aria-live="polite"></span>
      <button type="button" class="isle-x" aria-label="Close">×</button>
    </div>
    <div class="isle-body">
      <div class="isle-step isle-drop">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M7 10l5 5 5-5"/><path d="M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>
        <b>Drop it here</b><span>${ISLE_FORMATS}</span>
      </div>
      <div class="isle-step isle-home"><p>Drop a file here, paste a picture (Ctrl+V), or ask me anything.</p></div>
      <div class="isle-step isle-load"><div class="isle-file"><span class="isle-fname"></span><span class="isle-fsize"></span></div><div class="isle-bar"><i></i></div></div>
      <div class="isle-step isle-ready"><img class="isle-thumb" alt="" hidden><p class="isle-peek" hidden></p><p class="isle-q">What should I do with it?</p><div class="isle-acts"></div></div>
      <div class="isle-step isle-think"><div class="isle-bar isle-bar-wait"><i></i></div></div>
      <div class="isle-step isle-ans"><div class="isle-ans-body"></div><div class="isle-ans-acts"><button type="button" class="isle-chip" data-act="open">Open in chat</button><button type="button" class="isle-chip" data-act="more">Ask more</button></div></div>
      <div class="isle-step isle-err"><p class="isle-msg"></p><div class="isle-ans-acts"><button type="button" class="isle-chip" data-act="again">Try another</button></div></div>
      <form class="isle-ask" autocomplete="off">
        <input type="text" class="isle-input" placeholder="Ask Cassie…" aria-label="Ask Cassie">
        <button type="submit" class="isle-send" aria-label="Ask">↑</button>
      </form>
    </div>`;
  const $ = (s) => card.querySelector(s);
  const title = $('.isle-title'), input = $('.isle-input');
  if (window.CassieMic) window.CassieMic.attach(input, { send: () => $('.isle-ask').requestSubmit() }); // (say it: the question is sent)
  let bot = null, item = null, answerBubble = null;
  const later = (fn, ms) => win.setTimeout(fn, ms); // the pop-out's own clock keeps running while the main tab is hidden
  if (window.CassieBot) bot = window.CassieBot.create($('.isle-bot'), { glow: true, accent: accentHex() || '#d8343c', win });

  const api = {
    el: card, doc,
    get step() { return card.dataset.step || ''; },
    mood(m, text) {
      if (bot) bot.setState(m);
      card.style.setProperty('--mood', (window.CassieBot && window.CassieBot.COLORS || {})[m] || '#ffffff');
      if (text != null && title.textContent !== text) { title.textContent = text; title.classList.remove('swap'); void title.offsetWidth; title.classList.add('swap'); }
    },
    go(step, text, mood) {
      card.dataset.step = step;
      const asking = step === 'home' || step === 'ask';
      $('.isle-ask').hidden = !asking;
      const say = { drop: 'Drop your file', home: 'Hi! I’m right here', think: 'Thinking…' };
      api.mood(mood || ({ drop: 'surprised', load: 'upload', ready: 'greeting', think: 'thinking', ans: 'proud', err: 'oops', ask: 'listening' })[step] || 'idle', text || say[step] || title.textContent);
      card.classList.add('open');
      if (asking) later(() => { try { input.focus(); } catch (e) { /* ignore */ } }, 30);
      if (opts.onStep) opts.onStep(step);
    },
    loading(name, size) {
      $('.isle-fname').textContent = name;
      $('.isle-fsize').textContent = size ? fileSizeText(size) : '';
      const bar = $('.isle-load .isle-bar i');
      bar.style.transition = 'none'; bar.style.width = '4%'; void bar.offsetWidth;
      bar.style.transition = ''; bar.style.width = '88%';
      api.go('load', `Reading ${name}…`);
    },
    ready(it) {
      item = it;
      $('.isle-load .isle-bar i').style.width = '100%';
      const thumb = $('.isle-thumb'), peek = $('.isle-peek');
      thumb.hidden = !(it.kind === 'image' && it.dataUrl);
      if (!thumb.hidden) thumb.src = it.dataUrl;
      peek.hidden = it.kind !== 'text';
      if (!peek.hidden) peek.textContent = it.text.length > 160 ? it.text.slice(0, 160) + '…' : it.text;
      const acts = $('.isle-acts');
      acts.innerHTML = '';
      ISLE_ACTIONS[it.kind].forEach((a, i) => {
        const b = doc.createElement('button');
        b.type = 'button'; b.className = 'isle-chip' + (i === 0 ? ' isle-chip-main' : ''); b.textContent = a.label;
        b.addEventListener('click', () => {
          if (a.ask) { api.go('ask', it.kind === 'text' ? 'Ask about your words' : `Ask about ${it.name || 'it'}`); return; }
          isleRun(api, typeof a.prompt === 'function' ? a.prompt(it.text) : a.prompt);
        });
        acts.appendChild(b);
      });
      const what = it.kind === 'text' ? 'Got your words' : it.kind === 'image' ? 'Got your picture' : `${it.name} is ready`;
      later(() => api.go('ready', what), it.kind === 'text' ? 0 : 280);
    },
    answer(bubble) {
      answerBubble = bubble;
      const body = $('.isle-ans-body');
      body.innerHTML = '';
      if (bubble) {
        const copy = bubble.cloneNode(true);
        copy.querySelectorAll('button, .msg-actions, .followups, .bubble-tools, audio, video').forEach((n) => n.remove());
        copy.querySelectorAll('canvas').forEach((c) => { const p = doc.createElement('p'); p.className = 'isle-note'; p.textContent = 'Open in chat to see the drawing.'; c.replaceWith(p); });
        copy.className = 'isle-ans-copy';
        body.appendChild(doc.importNode(copy, true));
      }
      body.scrollTop = 0;
      const failed = bubble && bubble.classList.contains('bubble-error');
      api.go('ans', failed ? 'That didn’t work' : 'Here you go', failed ? 'oops' : 'proud');
    },
    error(msg) { $('.isle-msg').textContent = msg; api.go('err', 'Hmm, I can’t open that'); },
    close() {
      card.classList.remove('open');
      delete card.dataset.step;
      item = null;
      if (opts.onClose) opts.onClose();
    },
    destroy() { isleCards.delete(api); if (bot) bot.destroy(); card.remove(); },
    get item() { return item; },
  };

  $('.isle-x').addEventListener('click', () => api.close());
  card.addEventListener('keydown', (e) => { if (e.key === 'Escape') api.close(); });
  $('.isle-ask').addEventListener('submit', (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    input.value = '';
    const it = card.dataset.step === 'ask' ? item : null;
    isleRun(api, it && it.kind === 'text' ? withNote(it.text, q) : q);
  });
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'open') {
      if (answerBubble) answerBubble.scrollIntoView({ block: 'start', behavior: 'smooth' });
      api.close();
    } else if (b.dataset.act === 'more') { item = null; api.go('ask', 'Ask me more'); }
    else if (b.dataset.act === 'again') { item = null; api.go('drop'); }
  });
  isleCards.add(api);
  return api;
}

function fileSizeText(n) {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}

// What came in with a drop or a paste: the first file, or the words.
function isleFromTransfer(dt) {
  if (!dt) return null;
  const files = [...(dt.files || [])];
  if (files.length) return { file: files[0], more: files.length - 1, files: files.slice(1) };
  const text = (dt.getData('text/plain') || '').trim();
  return text ? { text } : null;
}

// Read what was dropped, then show what Cassie can do with it.
async function isleTake(card, got) {
  if (!got) return;
  if (isleBusy) { card.error('I’m still answering: drop it again in a moment.'); return; }
  if (got.text) {
    clearAttach();
    card.ready({ kind: 'text', text: got.text.slice(0, 12000) });
    return;
  }
  const file = got.file;
  card.loading(file.name || 'your file', file.size);
  const kind = await sniffKind(file);
  if ((kind === 'txt' || /^text\//.test(file.type)) && file.size < 8000) { // a short text file: its words are the question
    try { const text = (await file.text()).trim(); if (text) { clearAttach(); card.ready({ kind: 'text', text: text.slice(0, 12000), name: file.name }); return; } } catch (e) { /* fall through */ }
  }
  const ok = await attachFile(file);
  if (!ok) { card.error(attachError || `I can’t open ${file.name}.`); clearAttach(); return; }
  const last = attachments[attachments.length - 1];
  for (const more of got.files || []) await attachFile(more); // the rest of a multi-file drop comes along too
  if (last && last.kind === 'image') card.ready({ kind: 'image', name: file.name, dataUrl: last.image.dataUrl });
  else card.ready({ kind: 'doc', name: file.name });
}

// Ask, and show the answer in the card (the chat gets it too, as always).
async function isleRun(card, prompt) {
  if (isleBusy) return;
  isleBusy = true;
  card.go('think');
  const before = chatLog.querySelectorAll('.bubble-assistant').length;
  try { await handleSend(prompt); } catch (e) { /* handleSend shows its own errors */ }
  isleBusy = false;
  const all = chatLog.querySelectorAll('.bubble-assistant');
  const bubble = all.length > before ? all[all.length - 1] : null;
  if (!bubble) { card.close(); return; }
  card.answer(bubble);
}

// Her status lines ("Reading pages 3–8…") also show on a card that's waiting.
function isleStatus(mood, text) {
  isleCards.forEach((c) => { if (c.step === 'think') c.mood(mood === 'done' ? 'thinking' : mood, mood === 'done' ? 'Thinking…' : text); });
}

// The card in the app hangs under the top bar, where the Island drops down.
const isleMain = islandEl ? makeIsleCard(document, {
  onStep: () => islandEl.classList.add('carded'),
  onClose: () => islandEl.classList.remove('carded'),
}) : null;
if (isleMain) islandEl.after(isleMain.el);

(function islandDropZone() {
  if (!isleMain) return;
  let innerDrag = false, depth = 0;
  const editable = (t) => t && t.closest && t.closest('input, textarea, [contenteditable="true"], .isle-card input');
  const boardOpen = () => !!(window.CassieSketch && window.CassieSketch.isOpen && window.CassieSketch.isOpen());
  const outside = (e) => !innerDrag && !boardOpen() && e.dataTransfer && [...e.dataTransfer.types].some((t) => t === 'Files' || t === 'text/plain');
  document.addEventListener('dragstart', () => { innerDrag = true; });
  document.addEventListener('dragend', () => { innerDrag = false; });
  const hasFiles = (e) => [...e.dataTransfer.types].includes('Files');
  let lastOver = 0, watch = 0;
  const cancel = () => { depth = 0; clearInterval(watch); isleMain.el.classList.remove('hot'); if (isleMain.step === 'drop') isleMain.close(); };
  window.addEventListener('dragenter', (e) => {
    if (!outside(e)) return;
    depth++;
    lastOver = Date.now();
    if (isleMain.step !== 'drop' && !isleBusy) {
      isleMain.go('drop');
      clearInterval(watch); // a drag that ends outside the window sends nothing: tidy up when the drag-overs stop
      watch = setInterval(() => { if (Date.now() - lastOver > 1200) cancel(); }, 400);
    }
  });
  window.addEventListener('dragover', (e) => {
    if (!outside(e)) return;
    lastOver = Date.now();
    if (editable(e.target) && !hasFiles(e)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
    isleMain.el.classList.toggle('hot', isleMain.el.contains(e.target));
  });
  window.addEventListener('dragleave', (e) => {
    if (!outside(e)) return;
    depth = Math.max(0, depth - 1);
    if (!e.relatedTarget && depth === 0) cancel();
  });
  window.addEventListener('drop', (e) => {
    if (!outside(e)) { innerDrag = false; return; }
    if (editable(e.target) && !hasFiles(e)) { cancel(); return; } // words dropped in the question box land there, as usual
    e.preventDefault();
    depth = 0;
    clearInterval(watch);
    isleMain.el.classList.remove('hot');
    track('feature', 'island-drop');
    isleTake(isleMain, isleFromTransfer(e.dataTransfer));
  });
})();

// Cassie dresses for the job:
//   Student (default) → her classic fluffy felt · a working professional → the suit & beret
//   Research / Web → cap & gown · Quiz me → thick glasses · Talk → the felt heart
let taskOutfit = null; // 'graduate' while a Research / Web answer is up; the next plain message clears it
function dressCassie() {
  const base = workMode() ? 'professor' : 'classic';
  const outfit = counselorMode ? 'heart' : quizMode ? 'coder' : (taskOutfit || base);
  if (bot2d) bot2d.setAccessory(outfit === 'classic' ? window.CassieBot.seasonal() : OUTFIT_TO_2D[outfit]);
}

function syncAudience() { state.audience = workMode() ? 'pro' : 'student'; } // (the old switch's choice, undone)
syncAudience();

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
  if (bot2d) { clearTimeout(bot2dTimer); bot2d.setState(EMOTE_TO_2D[name] || 'idle'); }
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
    || mascot.classList.contains('thinking') || Date.now() < emotionHoldUntil
    || document.documentElement.classList.contains('touring'); // (she stays put while the tour points at things)
}
function mascotWalk() {
  if (anticBusy()) return;
  const b = mascotBounds();
  const r = mascot.getBoundingClientRect();
  const dir = r.left < window.innerWidth / 2 ? 1 : -1; // wander toward the roomier side
  const step = 90 + Math.random() * 80;
  const tx = Math.min(Math.max(r.left + dir * step, b.minX), b.maxX);
  if (!mascotSpotClear(tx, r.top)) { mascotPlay(); return; } // (she'd stop on an answer or a button: play in place instead)
  set3D('walk'); // a real waddle: feet stepping, body bobbing, arms swinging
  mascot.classList.add('walking');
  placeMascot(tx, r.top);
  setTimeout(() => {
    if (anticBusy()) { mascot.classList.remove('walking'); return; }
    const r2 = mascot.getBoundingClientRect();
    const back = Math.min(Math.max(r2.left - dir * (step * 0.6), b.minX), b.maxX);
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
    { t: 'Big one. I got it!', e: 'emote-cool' },
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
    { t: 'One step at a time!', e: 'emote-star' },
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
  resetIdle();
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
  // the app's colours: greys in Monochrome, shades of a picked colour, else blush, sage, honey and cream
  const pick = accentHex();
  const colors = accentChoice() === 'mono' ? ['#111111', '#3a3a3a', '#6d6d72', '#a9a9a9', '#d9d5cf', '#f5f3ef']
    : pick ? [pick, mixHex(pick, '#ffffff', 0.4), mixHex(pick, '#000000', 0.3), mixHex(pick, '#ffffff', 0.75), '#f2c94c']
      : ['#b8395a', '#f28fa5', '#2f6f5e', '#7cc4ae', '#f2c94c', '#fbf6ee'];
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
// (computers: the sidebar is always there, so she stays to the right of it)
function sideEdge() { const sb = document.getElementById('sidebar'); return sb && matchMedia('(min-width: 761px)').matches ? sb.getBoundingClientRect().right : 0; }
function mascotBounds() {
  const { w, h } = mascotBtnSize();
  // The 3D canvas is ~150px wide, centred on the button, so keep the button
  // far enough from the edges that the canvas never overflows the viewport
  // (which on mobile would let the page zoom out).
  const pad = 78; // half the canvas (~75) + a little
  return {
    maxX: Math.max(8, window.innerWidth - w / 2 - pad),
    maxY: Math.max(70, mascotFloorTop() - h - 8),
    minX: Math.min(52 + sideEdge(), Math.max(8, window.innerWidth - w / 2 - pad)),
    minY: 70,
  };
}
function placeMascot(x, y) {
  if (!mascot) return;
  const b = mascotBounds();
  const nx = Math.min(Math.max(x, b.minX), b.maxX);
  const ny = Math.min(Math.max(y, b.minY), b.maxY);
  const r = mascot.getBoundingClientRect();
  if (Math.abs(r.left - nx) > 2 || Math.abs(r.top - ny) > 2) { // (while she glides there, a tap goes to the button under her)
    mascot.classList.add('gliding');
    clearTimeout(placeMascot.t); placeMascot.t = setTimeout(() => mascot.classList.remove('gliding'), 450);
  }
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
// is a spot clear of the answers and the buttons under them?
function mascotSpotClear(x, y, items = mascotAvoid()) {
  const { w, h } = mascotBtnSize();
  const half = 46; // her opaque body is ~a bit wider than the button, not the whole canvas
  const cx = x + w / 2, cy = y + h / 2;
  const mr = { left: cx - half, right: cx + half, top: cy - half, bottom: cy + half };
  return !items.some((r) => rectsOverlap(mr, r));
}
function mascotAvoid() {
  return [...document.querySelectorAll('#chat-log .bubble, #chat-log .cassie-board, #chat-log .home-example, #chat-log .home-title, #chat-log .home-sub, #chat-log .home-tip, #chat-log .fu-chip')]
    .map((el) => el.getBoundingClientRect()).filter((r) => r.width && r.height);
}
function keepMascotClear() {
  if (!mascot || mascotDragging || mascotUserMoved || mascotAsleep) return;
  const items = mascotAvoid();
  if (!items.length) return;
  const clearAt = (x, y) => mascotSpotClear(x, y, items);
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
      // held only once it's a drag: holding from the press sent a plain click to the wrapper, not her
      // button, so clicking Cassie with a mouse did nothing
      try { mascot.setPointerCapture(pointerId); } catch (_) {}
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
  // the Hint/Quiz row or the chat box changing (a row shown or hidden, the box growing, a file
  // attached, the phone tab bar showing) moves her floor: re-dock, so she never sits on a button
  if (window.ResizeObserver) {
    const redock = new ResizeObserver(() => {
      if (mascotDragging) return;
      if (mascotUserMoved) { const r = mascot.getBoundingClientRect(); placeMascot(r.left, r.top); } else restMascot();
      requestAnimationFrame(keepMascotClear);
    });
    ['quick-actions', 'composer', 'attach-preview', 'tabbar'].forEach((id) => { const el = document.getElementById(id); if (el) redock.observe(el); });
  }
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
  requestAnimationFrame(keepMascotClear);
}
// Offline: a calm note at the top that says what still works (it goes away when the internet is back)
const offlineNote = document.getElementById('offline-note');
function showOnline() { if (offlineNote) offlineNote.hidden = navigator.onLine !== false; }
window.addEventListener('online', showOnline);
window.addEventListener('offline', showOnline);
showOnline();
// While you're at the latest message, stay there when something is added under it a moment later
// (the Listen row, the follow-up chips). Scroll up to read, and the chat stays where you are.
let chatPinned = true;
chatLog.addEventListener('scroll', () => { chatPinned = chatLog.scrollHeight - chatLog.scrollTop - chatLog.clientHeight < 80; }, { passive: true });
new MutationObserver(() => { if (chatPinned && chatLog.scrollHeight > chatLog.clientHeight) chatLog.scrollTop = chatLog.scrollHeight; }).observe(chatLog, { childList: true, subtree: true });

function escapeHtml(str) {
  const d = document.createElement('div');
  d.textContent = str;
  return d.innerHTML.replace(/"/g, '&quot;'); // safe inside attribute values too
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
    // quotes can't end the address early (the text is already HTML-escaped, but quotes aren't)
    return `<a href="${url.replace(/"/g, '%22').replace(/'/g, '%27')}" target="_blank" rel="noopener noreferrer">${label}</a>`;
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

// Cassie's words never show an em or en dash (they read as clutter to young readers): ranges get
// a hyphen, a dash that starts a line becomes a list dash, and every other one becomes a comma.
function noDashes(text) {
  return String(text)
    .replace(/(\d)\s*[–—]\s*(?=\d)/g, '$1-')
    .replace(/^([ \t]*)[—–][ \t]*/gm, '$1- ')
    .replace(/[ \t]*[—–][ \t]*(?=[.,!?;:)\]]|$)/gm, '')
    .replace(/([A-Za-zÀ-ÿ])–(?=[A-Za-zÀ-ÿ])/g, '$1-')
    .replace(/\s*[—–]\s*/g, ', ')
    .replace(/,\s*,/g, ',');
}
window.noDashes = noDashes;
// Cassie's answer to one question, ready to show (no dashes)
const askShown = (q) => askCassie([{ role: 'user', content: q }]).then(noDashes);

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
      renderProse(container, deLatex(noDashes(seg)));
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

/* A student who says they want to hurt or kill themselves gets care before anything else
   (care.js): warm words, the verified crisis lines as buttons to call, and Cassie keeps listening.
   The dashboard counts it with nothing else: no words, no id. */
function countCare() {
  if (!SERVER) return;
  try { fetch(SERVER + '/care', { method: 'POST', keepalive: true }).catch(() => {}); } catch (e) { /* best effort */ }
}
if (window.CassieCare) window.CassieCare.count = countCare; // (Labs and the 3D views count it too)
function renderCare(lang, aiWords) {
  const bubble = document.createElement('div');
  bubble.className = 'bubble bubble-assistant bubble-care';
  bubble.appendChild(window.CassieCare.card(lang, aiWords));
  chatLog.appendChild(bubble);
  scrollToBottom();
  return bubble;
}
function giveCare(lang, aiWords) {
  state.messages.push({ role: 'assistant', content: window.CassieCare.reply(lang, aiWords), care: { lang, ...(aiWords ? { aiWords } : {}) } });
  touchChat();
  save();
  setCursorMode('idle');
  countCare();
  return renderCare(lang, aiWords);
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
  { label: 'Explore in 3D (in Labs)', icon: 'M12 2 3 7v10l9 5 9-5V7l-9-5zm0 2.3L18.6 8 12 11.7 5.4 8 12 4.3zM5 9.7l6 3.4v6.6l-6-3.3V9.7zm8 10v-6.6l6-3.4v6.7l-6 3.3z', run: () => openLabs(null, { subject: '3d' }) },
  { label: 'Labs: try a simulation', icon: 'M9 2h6v2h-1v5.2l5.6 9.4A2.3 2.3 0 0 1 17.6 22H6.4a2.3 2.3 0 0 1-2-3.4L10 9.2V4H9V2zm3 8.6L8.2 17h7.6L12 10.6z', run: () => openLabs() },
  { label: 'Study together (study room)', icon: 'M16 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm-8 0a3 3 0 1 0 0-6 3 3 0 0 0 0 6zm0 2c-2.3 0-7 1.2-7 3.5V19h14v-2.5C15 14.2 10.3 13 8 13zm8 0c-.3 0-.6 0-1 .1 1.2.8 2 2 2 3.4V19h6v-2.5c0-2.3-4.7-3.5-7-3.5z', run: () => openRoomChooser() },
  { label: 'Flashcards', icon: 'M4 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm16-2v12h-1.5V5.5H7V4h11a2 2 0 0 1 2 2zM6 11h8v1.5H6zm0 3h5v1.5H6z', run: () => window.CassieCards && window.CassieCards.open() },
  { label: 'Podcast my notes', icon: 'M12 3a7 7 0 0 0-7 7v5.5A2.5 2.5 0 0 0 7.5 18H9v-6H7v-2a5 5 0 0 1 10 0v2h-2v6h1.5a2.5 2.5 0 0 0 2.5-2.5V10a7 7 0 0 0-7-7zm-1 16h2v2h-2z', run: () => podcastFromFile() },
  { label: 'Teach Cassie out loud', icon: 'M3 10h2v4H3zm4-3h2v10H7zm4-4h2v18h-2zm4 4h2v10h-2zm4 3h2v4h-2z', run: () => openVoice('teach') },
];

/* ---------- Study tools in the sidebar ----------
   Every tool (Flashcards and the rest) lives in the left sidebar, so it is one tap away at any time,
   mid-chat too. Computers: a slim rail of icons, or the full sidebar (the round chevron switches, and
   the choice is kept). Phones: the same list at the top of the slide-out menu. */
const SIDE_KEY = 'cassie.sideOpen';
// (the full sidebar keeps its list of chats up to date as they change)
function sideListSoon() {
  if (!sideReady || !sideWide.matches || !document.body.classList.contains('side-open')) return;
  clearTimeout(sideListSoon.t); sideListSoon.t = setTimeout(renderChatList, 150);
}
const sideWide = matchMedia('(min-width: 761px)');
const sideTools = document.getElementById('side-tools');
const sideSearch = document.getElementById('side-search');
const sideToggle = document.getElementById('side-toggle');
const sideTip = document.getElementById('side-tip');
const sideHl = document.getElementById('side-hl-toggle');
const toolBtns = [];
function runTool(ex) {
  hideSideTip();
  deskCloseOthers(/flashcards/i.test(ex.label) ? 'cards' : /labs/i.test(ex.label) ? 'labs' : '');
  if (!sideWide.matches) closeSidebar();
  if (ex.run) { ex.run(); return; }
  if (ex.send) handleSend(ex.text);
  else { promptInput.value = ex.text; autoGrow(); promptInput.focus(); }
}
HOME_EXAMPLES.forEach((ex) => {
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'side-tool'; b.dataset.tip = ex.label;
  b.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ex.icon}"/></svg><span></span>`;
  b.querySelector('span').textContent = ex.label;
  b.addEventListener('click', () => runTool(ex));
  sideTools.appendChild(b);
  toolBtns.push([b, ex]);
});
// the tool that's open now gets the bar on its left
const TOOL_OPEN = {
  Flashcards: () => !!document.querySelector('.fc:not([hidden])'),
  'Labs: try a simulation': () => document.documentElement.classList.contains('labs-open'),
  'Explore in 3D (in Labs)': () => document.documentElement.classList.contains('x3d-open'),
  'Teach Cassie out loud': () => !!document.querySelector('.vc:not([hidden])'),
};
function markOpenTools() {
  toolBtns.forEach(([b, ex]) => {
    const on = !!(TOOL_OPEN[ex.label] && TOOL_OPEN[ex.label]());
    b.classList.toggle('on', on);
    if (on) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current');
  });
}
let markQueued = false;
const markSoon = () => { if (markQueued) return; markQueued = true; requestAnimationFrame(() => { markQueued = false; markOpenTools(); }); };
new MutationObserver(markSoon).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(markSoon).observe(document.body, { childList: true, attributes: true, subtree: true, attributeFilter: ['hidden'] });
// the rail or the full sidebar (computers)
function setSideOpen(open, keep = true) {
  document.body.classList.toggle('side-open', open);
  sideToggle.setAttribute('aria-expanded', String(open));
  sideToggle.setAttribute('aria-label', open ? 'Make the sidebar small' : 'Show the full sidebar');
  sideToggle.title = open ? 'Make it small' : 'Show the full sidebar';
  if (keep) { try { localStorage.setItem(SIDE_KEY, open ? 'open' : 'rail'); } catch (e) { /* no storage: this visit only */ } }
  hideSideTip();
  if (open) renderChatList();
  setTimeout(() => { keepMascotClear(); }, 300);
}
let sideOpenSaved = false;
try { sideOpenSaved = localStorage.getItem(SIDE_KEY) !== 'rail'; } catch (e) { sideOpenSaved = true; } // (the full sidebar, unless made small)
// "Menu" folds the tool list away (folded at first, so New chat, the timer and Recents are near the
// top); the choice is kept. The rail on a computer always shows every tool.
const TOOLS_KEY = 'cassie.toolsOpen';
const sideMenuBtn = document.getElementById('side-menu-toggle');
let toolsOpen = false, searchOpened = false;
try { toolsOpen = localStorage.getItem(TOOLS_KEY) === 'open'; } catch (e) { /* ignore */ }
function setToolsOpen(open, keep = true) {
  toolsOpen = open;
  document.getElementById('sidebar').classList.toggle('tools-folded', !open);
  sideMenuBtn.setAttribute('aria-expanded', String(open));
  sideMenuBtn.setAttribute('aria-label', open ? 'Menu: hide the study tools' : 'Menu: show the study tools');
  if (keep) { searchOpened = false; try { localStorage.setItem(TOOLS_KEY, open ? 'open' : 'folded'); } catch (e) { /* ignore */ } }
}
setToolsOpen(toolsOpen, false);
sideMenuBtn.addEventListener('click', () => setToolsOpen(!toolsOpen));
sideReady = true;
setSideOpen(sideOpenSaved, false);
syncSideHl();
sideToggle.addEventListener('click', () => setSideOpen(!document.body.classList.contains('side-open')));
document.getElementById('side-search-btn').addEventListener('click', () => { setSideOpen(true); sideSearch.focus(); });
// names in the rail: a tooltip beside the icon (hover or keyboard focus)
function showSideTip(el) {
  if (!sideWide.matches || document.body.classList.contains('side-open') || !el.dataset.tip) return;
  const r = el.getBoundingClientRect();
  sideTip.textContent = el.dataset.tip; sideTip.hidden = false;
  sideTip.style.left = (r.right + 10) + 'px';
  sideTip.style.top = (r.top + r.height / 2 - sideTip.offsetHeight / 2) + 'px';
}
function hideSideTip() { sideTip.hidden = true; }
document.getElementById('sidebar').addEventListener('pointerover', (e) => { const t = e.target.closest('[data-tip]'); if (t && e.pointerType !== 'touch') showSideTip(t); });
document.getElementById('sidebar').addEventListener('pointerout', (e) => { const t = e.target.closest('[data-tip]'); if (t && !t.contains(e.relatedTarget)) hideSideTip(); });
document.getElementById('sidebar').addEventListener('focusin', (e) => { const t = e.target.closest('[data-tip]'); if (t && t.matches(':focus-visible')) showSideTip(t); else hideSideTip(); });
document.getElementById('sidebar').addEventListener('focusout', hideSideTip);
document.getElementById('sidebar').addEventListener('scroll', hideSideTip, { passive: true });
// Search: the tools and the chats that match
function applySideSearch() {
  if (!sideReady) return;
  const q = sideSearch.value.trim().toLowerCase();
  // (typing opens a folded list for a moment; clearing the box folds it again)
  if (q && !toolsOpen) { setToolsOpen(true, false); searchOpened = true; } else if (!q && searchOpened) { searchOpened = false; setToolsOpen(false, false); }
  toolBtns.forEach(([b, ex]) => { b.hidden = !!q && !ex.label.toLowerCase().includes(q); });
  document.querySelectorAll('.side-nav .side-tool').forEach((b) => b.classList.toggle('search-out', !!q && !b.textContent.toLowerCase().includes(q))); // (the pages too)
  document.querySelectorAll('#chat-list .chat-item').forEach((it) => { it.hidden = !!q && !it.querySelector('.ci-title').textContent.toLowerCase().includes(q); });
}
sideSearch.addEventListener('input', applySideSearch);
sideSearch.addEventListener('keydown', (e) => { if (e.key === 'Escape' && sideSearch.value) { e.stopPropagation(); sideSearch.value = ''; applySideSearch(); } });
// the highlight switch: the same setting as the one in Settings
function syncSideHl() { sideHl.checked = state.highlightHelp !== false; }
sideHl.addEventListener('change', () => {
  state.highlightHelp = sideHl.checked; save();
  const t = document.getElementById('highlight-help-toggle'); if (t) t.checked = sideHl.checked;
  track('feature', 'highlight-' + (sideHl.checked ? 'on' : 'off'));
});
// "Ideas to get started" on the home screen: shows where the tools live
function showTools() {
  if (sideWide.matches) setSideOpen(true); else openSidebar();
  sideSearch.value = ''; applySideSearch();
  setToolsOpen(true);
  sideTools.classList.remove('flash'); void sideTools.offsetWidth; sideTools.classList.add('flash');
  setTimeout(() => sideTools.classList.remove('flash'), 1600);
  sideTools.scrollIntoView({ block: 'nearest' });
}

/* ---------- Home: the hub (phones: the Home tab; computers: a new, empty chat) ----------
   New here: Cassie, a hello with your name, two big cards and Start studying. Back again: a hello,
   Today (cards due, today's lab, the focus timer, your streak), Continue (your last chats) and
   Quick actions (the study tools). */
const HUB_ICON = {
  ask: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/><path d="M9 9h6M9 12h4"/></svg>',
  cards: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 8h10a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2zM8 8V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2"/></svg>',
  lab: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 3h6M10 3v6.2L4.8 18.4A1.8 1.8 0 0 0 6.4 21h11.2a1.8 1.8 0 0 0 1.6-2.6L14 9.2V3M7.5 14h9"/></svg>',
  timer: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2.5M9 2h6"/></svg>',
  streak: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3c1 3.5 5 5.5 5 10a5 5 0 0 1-10 0c0-2.2 1.2-3.6 2.4-4.8.3 1.6 1 2.6 2.1 3.1C11 9 11.2 6 12 3z"/></svg>',
  chat: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/></svg>',
  go: '<svg class="hub-chev" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>',
};
// Home's big boxes: every study feature, one tap away (each opens it the way its own button does)
const TODAY_LABS = ['pendulum', 'ph', 'fractions', 'punnett', 'projectile', 'waves', 'atom', 'function', 'refraction', 'balance', 'chance', 'magnets', 'build-cell', 'optics', 'units', 'ice-steam', 'vectors', 'colour', 'metals', 'interest'];
const todayLab = () => TODAY_LABS[Math.floor(Date.now() / 864e5) % TODAY_LABS.length];
// (names, subjects and about how long each takes, for the phone's Today's Lab card)
const LAB_INFO = { pendulum: ['Pendulum', 'Physics', 10], ph: ['pH mixer', 'Chemistry', 10], fractions: ['Fraction pies', 'Maths', 8], punnett: ['Punnett squares', 'Biology', 12], projectile: ['Launch lab', 'Physics', 10],
  waves: ['Wave string', 'Physics', 8], atom: ['Build an atom', 'Chemistry', 12], function: ['Function lab', 'Maths', 15], refraction: ['Bending light', 'Physics', 8], balance: ['Equation balancer', 'Chemistry', 12],
  chance: ['Chance machine', 'Maths', 8], magnets: ['Magnetic field', 'Physics', 10], 'build-cell': ['Build a cell', 'Biology', 15], optics: ['Lenses and mirrors', 'Physics', 12], units: ['Unit converter', 'Maths', 5],
  'ice-steam': ['Ice to steam', 'Chemistry', 10], vectors: ['Vectors', 'Maths', 12], colour: ['Colour mixer', 'Physics', 8], metals: ['Metals in water', 'Chemistry', 8], interest: ['Money grows', 'Maths', 10] };
// what slides past in the phone's header: a peek inside the labs
const STRIP_LABS = ['build-cell', 'pendulum', 'solar', 'waves', 'atom', 'projectile', 'refraction', 'chance'];
const HUB_BOXES = [
  ['lab', 'Labs', 'Simulations to play with', HUB_ICON.lab],
  ['games', 'Games', 'Puzzles and quick games', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="7" width="19" height="11" rx="5.5"/><path d="M7 10.5v4M5 12.5h4M15.5 11.5h.01M18 13.5h.01"/></svg>'],
  ['today', 'Today’s lab', 'A new lab every day', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3.5" y="5" width="17" height="15" rx="3"/><path d="M3.5 10h17M8 3v4M16 3v4M10 14.5l1.5 1.5 3-3"/></svg>'],
  ['cards', 'Flashcards', 'Review and make cards', HUB_ICON.cards],
  ['research', 'Research', 'Real papers for a thesis', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6"/><path d="M15 15l5.5 5.5M8 10.5h5M10.5 8v5"/></svg>'],
  ['quiz', 'Quiz me', 'A practice quiz on anything', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.6.3-1 .9-1 1.6v.6M12 17h.01"/></svg>'],
  ['timer', 'Focus timer', 'Study in focused rounds', HUB_ICON.timer],
  ['room', 'Study room', 'Study with friends', '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="8.5" cy="8.5" r="3"/><circle cx="16.5" cy="9.5" r="2.5"/><path d="M3 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5M14.5 14.3c3 .1 5.5 1.8 5.5 4.7"/></svg>'],
  ['board', 'Board', 'Draw, sketch or graph', '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4M7 13l3-3 2.5 2.5L17 8"/></svg>'],
  ['talk', 'Talk', 'A voice chat with Cassie', '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 10v4M8 7v10M12 4v16M16 7v10M20 10v4"/></svg>'],
];
// what they came for (the first questions) goes first on Home: the boxes, then the Quick actions
const GOAL_TOOLS = {
  exam: ['quiz', 'cards', 'timer', 'Make study notes', 'Solve step by step'],
  read: ['research', 'Make study notes', 'Podcast my notes', 'cards'],
  homework: ['Solve step by step', 'Explain a topic', 'board', 'quiz'],
  learn: ['Explain a topic', 'research', 'talk', 'Explore in 3D'],
  labs: ['lab', 'games', 'today', 'Explore in 3D'],
};
function goalFirst(list, keyOf) {
  const goals = (state.helpWith || []).filter((g) => GOAL_TOOLS[g]);
  if (!goals.length) return list;
  const rank = (x) => { const k = keyOf(x); for (let i = 0; i < goals.length; i++) { const j = GOAL_TOOLS[goals[i]].findIndex((t) => k === t || k.startsWith(t)); if (j >= 0) return i * 10 + j; } return 1e3; };
  return list.map((x, i) => [x, rank(x), i]).sort((p, q) => p[1] - q[1] || p[2] - q[2]).map((x) => x[0]);
}
// the Quick actions the boxes already cover (each feature shows once on Home)
const HUB_BOXED = /^(Quiz me|Research a topic|Labs: try a simulation|Study together|Flashcards)/;
const hubAgo = (t) => { const s = Math.max(0, (Date.now() - (t || 0)) / 1000); return s < 60 ? 'just now' : s < 3600 ? Math.round(s / 60) + ' min ago' : s < 86400 ? Math.round(s / 3600) + ' h ago' : Math.round(s / 86400) + ' d ago'; };
const onPhoneHome = () => !!(window.CassieNative && document.documentElement.classList.contains('native'));
// where each part of the hub goes (on a phone, through the tab bar so the right tab lights up)
function hubAct(act) {
  const nav = (t) => (onPhoneHome() ? window.CassieNative.go(t) : null);
  if (act === 'ask' || act === 'start') { if (onPhoneHome()) { nav('chat'); setTimeout(() => promptInput.focus(), 60); } else promptInput.focus(); return; } // (a phone switches tab first)
  if (act === 'cards') { if (onPhoneHome()) nav('cards'); else if (window.CassieCards) window.CassieCards.open(); return; }
  if (act === 'lab') { if (onPhoneHome()) nav('labs'); else openLabs(); return; }
  if (act === 'today') { openLabs(todayLab()); return; }
  if (act === 'games') { openLabs(undefined, { section: 'games' }); return; }
  if (act === 'board') { nav('chat'); const bb = document.getElementById('board-btn'); if (bb) bb.click(); return; }
  if (act === 'room') { if (!SERVER) nav('chat'); const ex = HOME_EXAMPLES.find((x) => /study room/i.test(x.label)); if (ex) runTool(ex); return; } // (no server: the reason shows in the chat)
  if (act === 'talk') { openVoice('chat'); return; }
  if (act === 'research' || act === 'quiz') { nav('chat'); const cb = document.getElementById(act + '-btn'); if (cb) cb.click(); return; }
  if (act === 'timer') { const t = document.getElementById('pomo-toggle'); if (t) t.click(); renderHubTimer(); return; }
  if (act === 'streak') { const m = document.getElementById('memory-btn'); if (m) m.click(); return; }
  if (act.startsWith('chat:')) { selectChat(act.slice(5)); nav('chat'); return; }
  if (act.startsWith('tool:')) { const ex = HOME_EXAMPLES[+act.slice(5)]; if (ex) { if (onPhoneHome() && !ex.run) nav('chat'); runTool(ex); } }
}
function renderHubTimer() {
  document.querySelectorAll('.hub-timer').forEach((w) => {
    const time = (document.getElementById('pomo-time') || {}).textContent || '25:00', mode = (document.getElementById('pomo-mode') || {}).textContent || 'Focus';
    const on = /pause/i.test((document.getElementById('pomo-toggle') || {}).textContent || '');
    w.querySelector('b').textContent = time;
    w.querySelector('span').textContent = mode;
    w.querySelector('em').textContent = on ? 'Pause' : 'Start';
  });
}
setInterval(() => { if (document.querySelector('.hub-timer')) renderHubTimer(); }, 1000);
// The header: a glass bar with the hello (your initial and name) and a bell for today's reminders
const HUB_BELL = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15zM10 20.5a2.2 2.2 0 0 0 4 0"/></svg>';
function hubHero(name, returning, due, phone) {
  const hero = document.createElement('section');
  hero.className = 'hub-hero' + (phone ? ' hub-hero-phone' : '');
  hero.setAttribute('aria-label', 'Welcome');
  if (phone) { // a phone: a peek inside the labs slides past behind the hello
    const hr = new Date().getHours(), part = hr < 12 ? 'Morning' : hr < 18 ? 'Afternoon' : 'Evening';
    const tiles = STRIP_LABS.map((id) => `<canvas class="hub-tile" data-pv="${id}" aria-hidden="true"></canvas>`).join('');
    hero.innerHTML = `<div class="hub-strip" aria-hidden="true"><div class="hub-strip-run">${tiles}${tiles}</div></div>
    <div class="hub-top"><span class="hub-av" aria-hidden="true"></span><span class="hub-who"><h1 class="hub-me"></h1></span>
    <button type="button" class="hub-bell" aria-label="Reminders${due ? `: ${due} ${due === 1 ? 'card' : 'cards'} due` : ''}" aria-expanded="false">${HUB_BELL}${due ? '<i class="hub-dot" aria-hidden="true"></i>' : ''}</button></div>`;
    hero.querySelector('.hub-av').textContent = (name || 'C')[0].toUpperCase();
    hero.querySelector('.hub-me').textContent = `${part}${name ? ', ' + name : ''}`;
    return hero;
  }
  hero.innerHTML = `<div class="hub-top"><span class="hub-av" aria-hidden="true"></span><span class="hub-who"><small>${returning ? 'Hi, welcome back' : 'Hi, welcome'}</small>${returning ? '<h1 class="hub-me"></h1>' : '<b class="hub-me"></b>'}</span>
    <button type="button" class="hub-bell" aria-label="Reminders${due ? `: ${due} ${due === 1 ? 'card' : 'cards'} due` : ''}" aria-expanded="false">${HUB_BELL}${due ? '<i class="hub-dot" aria-hidden="true"></i>' : ''}</button></div>`;
  hero.querySelector('.hub-av').textContent = (name || 'C')[0].toUpperCase();
  hero.querySelector('.hub-me').textContent = name || 'Student';
  return hero;
}
// the bell: what's waiting today (cards due, the focus timer, your streak, today's lab)
let hubRemindOpen = false;
var hubMoreOpen = (() => { try { return sessionStorage.getItem('cassie.moreTools') === '1'; } catch (e) { return false; } })(); // (More tools tapped: all of them for the rest of this visit)
function hubReminders(due, streak) {
  const box = document.createElement('div');
  box.className = 'hub-remind' + (hubRemindOpen ? ' open' : ''); // (Home is redrawn often on a phone: the open state lives in hubRemindOpen)
  box.setAttribute('role', 'region'); box.setAttribute('aria-label', 'Reminders');
  const rows = [
    ['cards', HUB_ICON.cards, due ? `${due} ${due === 1 ? 'card' : 'cards'} to review` : 'No cards due', due ? 'Review now' : 'Make cards'],
    ['timer', HUB_ICON.timer, 'Focus timer', 'Start a focus session'],
    ['streak', HUB_ICON.streak, `${streak} day streak`, streak ? 'Keep it going today' : 'Start one today'],
    ['lab', HUB_ICON.lab, 'Today’s lab', 'Open Labs'],
  ];
  box.innerHTML = '<h2 class="hub-h">Reminders</h2>' + rows.map(([a, i]) => `<button type="button" class="hub-chat" data-hub="${a}"><i>${i}</i><span><b></b><small></small></span>${HUB_ICON.go}</button>`).join('');
  box.querySelectorAll('.hub-chat').forEach((b, k) => { b.querySelector('b').textContent = rows[k][2]; b.querySelector('small').textContent = rows[k][3]; });
  return box;
}
// the phone's Today's Lab: a big live preview, the lab's name and subject, and a play button
function hubTodayLab() {
  const id = todayLab(), [nm, subj, min] = LAB_INFO[id] || [id, 'Science', 10];
  const card = document.createElement('section');
  card.className = 'hub-tlab';
  card.setAttribute('aria-label', 'Today’s Lab');
  card.innerHTML = `<canvas class="hub-tlab-pv" data-pv="${id}" aria-hidden="true"></canvas>
    <div class="hub-tlab-info"><span class="hub-tlab-tag">Today’s Lab</span><b></b><small></small></div>
    <button type="button" class="hub-tlab-go" data-hub="today"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg></button>`;
  card.querySelector('b').textContent = nm;
  card.querySelector('small').textContent = `${subj} · about ${min} min`;
  card.querySelector('.hub-tlab-go').setAttribute('aria-label', `Open today’s lab: ${nm}`);
  return card;
}
// the live previews on the phone's Home (labs/previews.js, loaded only when Home shows on a phone)
let hubPv = null;
function hubPreviews(el) {
  const cvs = [...el.querySelectorAll('canvas[data-pv]')];
  if (!cvs.length) return;
  if (!hubPv) hubPv = import('./labs/previews.js?v=181').catch(() => null);
  const three = isSubscriber(); // (Plus and Pro: real-looking 3D, like the labs; Free: the flat drawings)
  hubPv.then((m) => { if (m) cvs.forEach((cv) => { if (cv.isConnected) m.preview(cv, cv.dataset.pv, { three }); }); });
}
function buildHub({ ideas = false, phone = false } = {}) {
  const p = state.profile || {};
  const name = (p.name || '').trim().split(/\s+/)[0];
  const chats = state.chats.filter((c) => c.messages && c.messages.length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const cardsAll = window.CassieCards ? window.CassieCards.count() : 0, due = window.CassieCards ? window.CassieCards.dueCount() : 0;
  const returning = chats.length > 0 || cardsAll > 0 || examsNow().length > 0 || Object.keys(state.progress || {}).length > 0;
  const el = document.createElement('div');
  el.className = 'hub' + (returning ? '' : ' hub-empty');
  const ideasBtn = ideas ? '<button type="button" class="home-ideas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6c.2.6.7 1.1 1.3 1.3L20.8 11l-5.6 1.9c-.6.2-1.1.7-1.3 1.3L12 19.8l-1.9-5.6c-.2-.6-.7-1.1-1.3-1.3L3.2 11l5.6-1.9c.6-.2 1.1-.7 1.3-1.3z"/></svg>Ideas to get started</button>' : '';
  if (!returning) {
    el.innerHTML = `<div class="hub-bot" aria-hidden="true"></div>
      <h1 class="hub-hi">Hello${name ? ', <span class="hub-name"></span>' : ''}!<small>What are we studying today?</small></h1>${ideasBtn}
      <div class="hub-cards">
        <button type="button" id="home-ask" class="hub-card" data-hub="ask"><i>${HUB_ICON.ask}</i><b>Ask a question</b><small>Cassie explains it step by step</small></button>
        <button type="button" class="hub-card" data-hub="cards"><i>${HUB_ICON.cards}</i><b>Make flashcards</b><small>From any answer, or write your own</small></button>
      </div>
      <button type="button" class="hub-go" data-hub="start">Start studying</button>`;
  } else {
    const streak = window.CassieMemory ? window.CassieMemory.stats().streak : 0;
    el.innerHTML = `<button type="button" id="home-ask" class="hub-ask" data-hub="ask">${HUB_ICON.ask}<span>Ask Cassie anything…</span></button>${ideasBtn}
      <h2 class="hub-h">Today</h2>
      <div class="hub-today">
        <button type="button" class="hub-w" data-hub="cards"><i>${HUB_ICON.cards}</i><b>${due}</b><span>${due === 1 ? 'card due' : 'cards due'}</span><em>${due ? 'Review now' : cardsAll ? 'All done' : 'Make cards'}</em></button>
        <button type="button" class="hub-w hub-timer" data-hub="timer"><i>${HUB_ICON.timer}</i><b>25:00</b><span>Focus</span><em>Start</em></button>
        <button type="button" class="hub-w" data-hub="streak"><i>${HUB_ICON.streak}</i><b>${streak}</b><span>day streak</span><em>See progress</em></button>
      </div>
      <h2 class="hub-h">Continue</h2>
      <div class="hub-recent"></div>
      <h2 class="hub-h">Quick actions</h2>
      <div class="hub-quick">${goalFirst(HOME_EXAMPLES.map((ex, i) => [ex, i]), (x) => x[0].label).map(([ex, i]) => (HUB_BOXED.test(ex.label) ? '' : `<button type="button" class="hub-q" data-hub="tool:${i}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ex.icon}"/></svg><span></span></button>`)).join('')}</div>`;
    el.querySelectorAll('.hub-q').forEach((q) => { q.querySelector('span').textContent = HOME_EXAMPLES[+q.dataset.hub.slice(5)].label; });
    el.querySelector('.hub-today').after(examSection(), weekCard()); // (the exam plans, then the week, under Today)
    const list = el.querySelector('.hub-recent');
    chats.slice(0, 3).forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'hub-chat'; b.dataset.hub = 'chat:' + c.id;
      b.innerHTML = `<i>${HUB_ICON.chat}</i><span><b></b><small></small></span>${HUB_ICON.go}`;
      b.querySelector('b').textContent = c.title || deriveTitle(c.messages) || 'Chat';
      const n = c.messages.length; b.querySelector('small').textContent = `${n} message${n === 1 ? '' : 's'} · ${hubAgo(c.updatedAt)}`;
      list.appendChild(b);
    });
    if (!chats.length) list.innerHTML = '<p class="hub-none">Your chats with Cassie show up here.</p>';
  }
  el.querySelectorAll('.hub-name').forEach((s) => { s.textContent = name; });
  // the header on top, the bell's reminders just under it
  const streakNow = window.CassieMemory ? window.CassieMemory.stats().streak : 0;
  const hero = hubHero(name, returning, due, phone), remind = hubReminders(due, streakNow);
  const boxes = document.createElement('div');
  boxes.className = 'hub-boxes';
  // a brand-new student sees their 4 most useful tools (what they came for first); the rest are one tap away
  const allBoxes = goalFirst(HUB_BOXES, (x) => x[0]), boxHtml = ([a, t, line, icon]) => `<button type="button" class="hub-box" data-hub="${a}"><i>${icon}</i><b>${t}</b><small>${line}</small></button>`;
  const fewer = !returning && !hubMoreOpen && allBoxes.length > 4;
  boxes.innerHTML = (fewer ? allBoxes.slice(0, 4) : allBoxes).map(boxHtml).join('') + (fewer ? `<button type="button" class="hub-more" aria-expanded="false">More tools <small>${allBoxes.length - 4} more</small></button>` : '');
  const moreBtn = boxes.querySelector('.hub-more');
  if (moreBtn) moreBtn.addEventListener('click', () => {
    hubMoreOpen = true;
    try { sessionStorage.setItem('cassie.moreTools', '1'); } catch (e) { /* this visit only */ }
    moreBtn.remove();
    boxes.insertAdjacentHTML('beforeend', allBoxes.slice(4).map(boxHtml).join(''));
    const next = boxes.querySelectorAll('.hub-box')[4]; if (next) next.focus({ preventScroll: true });
  });
  if (phone) { // a phone: the header, Today's Lab, then (back again) Today, Continue, the boxes and Quick actions
    el.prepend(hero, remind, hubTodayLab());
    const quick = [...el.querySelectorAll('.hub-h')].find((h2) => /Quick actions/.test(h2.textContent));
    if (quick) quick.before(boxes); else el.append(boxes);
  } else el.prepend(hero, remind, boxes);
  const bell = hero.querySelector('.hub-bell');
  bell.setAttribute('aria-expanded', String(hubRemindOpen));
  bell.addEventListener('click', () => { hubRemindOpen = remind.classList.toggle('open'); bell.setAttribute('aria-expanded', String(hubRemindOpen)); });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-hub]'); if (b) hubAct(b.dataset.hub); });
  if (phone) requestAnimationFrame(() => hubPreviews(el));
  const ib = el.querySelector('.home-ideas'); if (ib) ib.addEventListener('click', () => showTools());
  // Cassie, large, blinking now and then (she keeps still with Reduce Motion)
  try { window.CassieBot.create(el.querySelector('.hub-bot'), { state: 'greeting', pokeable: true }); } catch (e) { /* the words still work */ }
  setTimeout(renderHubTimer, 0);
  return el;
}
function renderHub(host) { if (!host) return; host.replaceChildren(buildHub({ phone: true })); } // (the phone's Home tab)

/* ---------- Podcast mode: Jessica and Chris talk through your notes (about 3 minutes) ----------
   Cassie writes a short two person script from the notes only, then it plays line by line in the
   studio voices (/speak), with the transcript, Back, Pause, Skip, speed and a download. No daily limit:
   it comes out of the account's monthly studio voice (Free 7,500, Plus 15,000, Pro 30,000 characters);
   guests sign in for it. Shown before: what it costs. */
const POD_CHARS = 2700; // (about 3 minutes of talk)
function podPrompt(text) {
  return 'Write a short podcast script, about 3 minutes (380 to 420 words), where two study friends, Jessica and Chris, talk through these notes for a student reviewing for an exam.\n'
    + 'Use ONLY what is in the notes. If something is not in them, do not say it, and never invent numbers, names or dates.\n'
    + 'Plain everyday words and short turns of 1 to 3 sentences. Jessica explains; Chris asks what a student would ask and adds a memory trick when it fits.\n'
    + 'Start with a one line welcome that names the topic, and end with a recap of the 3 most important points. No dashes.\n'
    + 'Reply with ONLY JSON, no other text: {"lines":[{"who":"Jessica","say":"..."},{"who":"Chris","say":"..."}]}\n\n'
    + 'Notes:\n"""\n' + String(text).slice(0, 8000) + '\n"""';
}
// the reply → lines (JSON, or "Jessica: ..." lines as a fallback), each short enough for one voice clip
function parsePodcast(reply) {
  const s = String(reply || '').replace(/```(?:json)?/gi, '');
  let lines = [];
  try { const j = JSON.parse(s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1)); lines = (j.lines || []).map((l) => ({ who: /chris/i.test(l.who) ? 'Chris' : 'Jessica', say: String(l.say || '') })); }
  catch (e) { lines = s.split('\n').map((l) => /^\s*\**(Jessica|Chris)\**\s*:\s*(.+)/i.exec(l)).filter(Boolean).map((m) => ({ who: /chris/i.test(m[1]) ? 'Chris' : 'Jessica', say: m[2] })); }
  return lines.map((l) => ({ who: l.who, say: noDashes(l.say.replace(/\s+/g, ' ').trim()).slice(0, 650) })).filter((l) => l.say).slice(0, 40);
}
function podcastFromFile() {
  const inp = document.createElement('input');
  inp.type = 'file'; inp.accept = '.pdf,.docx,.pptx,.txt,.md,application/pdf';
  inp.addEventListener('change', async () => {
    const f = inp.files && inp.files[0];
    if (!f) return;
    try { const doc = await readDocument(f); if (!doc.text) throw new Error('empty'); openPodcast(doc.text, f.name.replace(/\.[a-z0-9]+$/i, '')); }
    catch (e) { mascotSay(CassieErrors.say('exam_file_failed'), 5000); }
  });
  inp.click();
}
function openPodcast(text, title) {
  document.querySelector('.pod-sheet')?.remove();
  const CV = window.CassieVoice, left = CV && CV.studio.known() ? CV.studio.left() : null;
  const guest = !!(CV && CV.studio.guest && CV.studio.guest()); // (the studio voice said so: not signed in)
  const voiceOk = !guest && !!(SERVER && CV && CV.studio.on() && (left == null || left >= POD_CHARS));
  const w = document.createElement('div');
  w.className = 'plus-sheet pod-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'pod-h');
  w.innerHTML = `<div class="plus-card pod-card">
    <span class="plus-kicker">Podcast</span>
    <h3 id="pod-h"></h3>
    <p class="plus-why">Jessica and Chris talk it through in about 3 minutes, using only what’s in it. Listen on the way to school, or while doing chores.</p>
    <ul class="pod-facts"><li class="pod-cost"></li><li class="pod-allow"></li></ul>
    <p class="pod-status" aria-live="polite"></p>
    <div class="plus-actions"><button type="button" class="plus-go pod-go">Make my podcast</button><button type="button" class="plus-ok pod-x">Not now</button></div></div>`;
  w.querySelector('#pod-h').textContent = title;
  const max = CV && CV.studio.max ? CV.studio.max() : 0;
  w.querySelector('.pod-cost').textContent = guest ? 'Podcasts use Cassie’s studio voice, which isn’t available for guests. Sign in (it’s free) to make one.'
    : voiceOk ? `It uses about ${POD_CHARS.toLocaleString('en-PH')} characters of Cassie’s voice${left != null ? `, and you have ${left.toLocaleString('en-PH')} left this month` : ''}.`
    : `You don’t have enough of Cassie’s voice left this month${left != null ? ` (${left.toLocaleString('en-PH')} left)` : ''}, so you get the script to read.`;
  w.querySelector('.pod-allow').textContent = `No daily limit: podcasts come out of your monthly voice${max ? ` (${max.toLocaleString('en-PH')} characters on your plan)` : ''}.`;
  const go = w.querySelector('.pod-go'), status = w.querySelector('.pod-status');
  if (guest) go.textContent = 'Sign in';
  let player = null;
  const close = () => { if (player) player.stop(); w.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  w.querySelector('.pod-x').addEventListener('click', close);
  w.addEventListener('click', (e) => { if (e.target === w) close(); });
  go.addEventListener('click', async () => {
    if (guest) { close(); openAuth({ mode: 'signup' }); return; }
    if (!canChat()) { close(); openSettings(); return; }
    go.disabled = true; status.textContent = 'Cassie is writing the script…';
    try {
      const lines = parsePodcast(await askCassie([{ role: 'user', content: podPrompt(text) }]));
      if (lines.length < 2) throw new Error('no script');
      track('feature', 'podcast');
      w.querySelector('.pod-facts').remove(); go.remove(); w.querySelector('.plus-why').remove(); status.textContent = '';
      w.querySelector('.pod-x').textContent = 'Close';
      player = podPlayer(w.querySelector('.pod-card'), lines, title, voiceOk);
    } catch (e) { go.disabled = false; status.textContent = 'Cassie couldn’t write the podcast just now. Check your connection, then try again.'; }
  });
  document.body.appendChild(w);
  go.focus({ preventScroll: true });
}
// the player: the transcript (tap a line to play from it), Back, Play or Pause, Skip, speed, Download
function podPlayer(card, lines, title, voiceOk) {
  const box = document.createElement('div');
  box.className = 'pod-player';
  box.innerHTML = `<ol class="pod-lines"></ol>
    <div class="pod-ctrl" role="group" aria-label="Podcast controls"><button type="button" data-p="back" aria-label="Back one line">⏮</button><button type="button" class="pod-play" data-p="play" aria-label="Play">▶</button><button type="button" data-p="skip" aria-label="Skip to the next line">⏭</button><button type="button" class="pod-speed" data-p="speed" aria-label="Speed 1x">1x</button><button type="button" class="pod-dl" data-p="dl">Download</button></div>
    <p class="pod-note" role="status"></p>`;
  const ol = box.querySelector('.pod-lines'), note = box.querySelector('.pod-note'), playBtn = box.querySelector('.pod-play');
  lines.forEach((l, i) => { const li = document.createElement('li'); li.dataset.i = i; li.className = 'pod-line pod-' + l.who.toLowerCase(); li.innerHTML = '<b></b><span></span>'; li.querySelector('b').textContent = l.who; li.querySelector('span').textContent = l.say; li.tabIndex = 0; ol.appendChild(li); });
  card.insertBefore(box, card.querySelector('.plus-actions'));
  const audio = new Audio(), clips = new Map(), urls = [];
  let at = 0, playing = false, rate = 1, stopped = false;
  const clip = (i) => {
    if (!clips.has(i)) clips.set(i, fetch(SERVER + '/speak', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ text: lines[i].say, voice: lines[i].who === 'Chris' ? 'man' : 'woman', uid: installId() }) })
      .then((r) => { if (!r.ok) throw Object.assign(new Error('voice ' + r.status), { why: r.headers.get('x-speak') || '' }); return r.blob(); }));
    const p = clips.get(i); p.catch(() => {}); return p;
  };
  const mark = () => ol.querySelectorAll('.pod-line').forEach((li) => { const on = +li.dataset.i === at; li.classList.toggle('on', on); if (on) li.setAttribute('aria-current', 'true'); else li.removeAttribute('aria-current'); });
  const setPlay = (on) => { playing = on; playBtn.textContent = on ? '⏸' : '▶'; playBtn.setAttribute('aria-label', on ? 'Pause' : 'Play'); };
  const rest = (e) => { setPlay(false); note.textContent = e && e.why === 'guest' ? CassieErrors.say('voice_signin') : e && e.why === 'mine' ? CassieErrors.say('voice_mine', { date: 'the 1st' }) : e && e.why === 'day' ? CassieErrors.say('voice_today') : e && e.why === 'month' ? CassieErrors.say('voice_resting', { date: 'next month' }) : CassieErrors.say('voice_typing'); };
  function play(i) {
    if (stopped || i < 0) return;
    if (i >= lines.length) { setPlay(false); return; }
    at = i; mark();
    const li = ol.querySelector(`[data-i="${i}"]`); if (li) li.scrollIntoView({ block: 'nearest' });
    if (!voiceOk) { rest(null); return; }
    setPlay(true);
    clip(i).then((blob) => {
      if (stopped || at !== i) return;
      const u = URL.createObjectURL(blob); urls.push(u);
      audio.src = u; audio.playbackRate = rate;
      audio.play().catch(() => setPlay(false));
      if (i + 1 < lines.length) clip(i + 1); // (the next one downloads while this one plays)
    }, rest);
  }
  audio.addEventListener('ended', () => { if (playing) play(at + 1); });
  box.addEventListener('click', (e) => {
    const li = e.target.closest('.pod-line'); if (li) { play(+li.dataset.i); return; }
    const b = e.target.closest('[data-p]'); if (!b) return;
    const k = b.dataset.p;
    if (k === 'play') { if (playing) { audio.pause(); setPlay(false); } else if (audio.src && !audio.ended && audio.currentTime > 0) { audio.play(); setPlay(true); } else play(at); }
    else if (k === 'back') play(Math.max(0, at - 1));
    else if (k === 'skip') play(Math.min(lines.length - 1, at + 1));
    else if (k === 'speed') { rate = rate === 1 ? 1.25 : rate === 1.25 ? 1.5 : 1; audio.playbackRate = rate; b.textContent = rate + 'x'; b.setAttribute('aria-label', `Speed ${rate}x`); }
    else if (k === 'dl') {
      const script = () => downloadBlob(`${title} podcast.txt`, new Blob([lines.map((l) => `${l.who}: ${l.say}`).join('\n\n')], { type: 'text/plain' }));
      if (!voiceOk) { script(); return; }
      b.disabled = true; b.textContent = 'Getting it ready…';
      Promise.all(lines.map((_, i) => clip(i)))
        .then((blobs) => { downloadBlob(`${title} podcast.mp3`, new Blob(blobs, { type: 'audio/mpeg' })); b.textContent = 'Download'; }, (e2) => { rest(e2); voiceOk = false; b.textContent = 'Download the script'; })
        .finally(() => { b.disabled = false; });
    }
  });
  ol.addEventListener('keydown', (e) => { const li = e.target.closest('.pod-line'); if (li && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); play(+li.dataset.i); } });
  mark();
  if (!voiceOk) rest(null);
  return { stop() { stopped = true; audio.pause(); urls.forEach((u) => URL.revokeObjectURL(u)); } };
}

/* ---------- Home on a computer: a study dashboard ----------
   A greeting with Ask Cassie and Add my notes, four numbers (questions this week, cards learned, the streak,
   exam readiness), the study chart for this week, the next thing to do, the exam plans, recent chats, the
   readiness gauge and the focus timer. Only what's saved: an empty card says what will show up there. */
const DESK_ICON = {
  up: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 16L16 8M9 8h7v7"/></svg>',
  plus: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>',
  file: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 15V4M7.5 8.5L12 4l4.5 4.5M5 15v3.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V15"/></svg>',
  play: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5.5v13l11-6.5z"/></svg>',
  pause: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8 5h3v14H8zM13 5h3v14h-3z"/></svg>',
  stop: '<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="6.5" y="6.5" width="11" height="11" rx="2.5"/></svg>',
  book: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4.5A1.5 1.5 0 0 1 6.5 3H19v15H6.5A1.5 1.5 0 0 0 5 19.5zM5 19.5A1.5 1.5 0 0 0 6.5 21H19M9 7h6"/></svg>',
};
// questions asked in chats touched in the last 7 days (the same number You shows)
function questionsThisWeek() {
  const week = Date.now() - 7 * 864e5;
  return state.chats.reduce((n, c) => n + (c.messages || []).filter((m) => m.role === 'user' && (m.at || c.updatedAt || 0) >= week).length, 0);
}
// what was studied each day this week (quiz answers, cards moved up, mistakes fixed, plan tasks done)
function studyDays() {
  const today = phDay(), from = weekStart(today);
  return Array.from({ length: 7 }, (_, i) => {
    const day = dayAdd(from, i), d = (state.progress || {})[day] || {};
    return { day, n: (+d.answered || 0) + (+d.cardsUp || 0) + (+d.fixed || 0) + (+d.tasks || 0), today: day === today, later: day > today };
  });
}
// the next exam task not done yet (today's first), and its plan
function nextExamTask() {
  const today = phDay();
  for (const e of activeExams().slice().sort((a, b) => (a.date < b.date ? -1 : 1))) {
    for (const d of e.days || []) {
      if (d.date < today) continue;
      const t = d.tasks.find((x) => !x.done);
      if (t) return { e, t, day: d.date };
    }
  }
  return null;
}
const nearestExam = () => activeExams().filter((e) => e.date >= phDay()).sort((a, b) => (a.date < b.date ? -1 : 1))[0] || null;
function deskGauge(pct) {
  // a half circle: the track, then the part done (pathLength 100, so the dash is the percent)
  return `<svg class="dk-gauge-svg" viewBox="0 0 200 110" aria-hidden="true"><path class="dk-gauge-track" d="M20 100a80 80 0 0 1 160 0" pathLength="100"/><path class="dk-gauge-fill" d="M20 100a80 80 0 0 1 160 0" pathLength="100" stroke-dasharray="${pct} 100"/></svg>`;
}
function deskHome() {
  const p = state.profile || {}, name = (p.name || '').trim().split(/\s+/)[0];
  const chats = state.chats.filter((c) => c.messages && c.messages.length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const cardsLearned = (state.cards || []).filter((c) => (c.box || 0) >= 4).length;
  const due = window.CassieCards ? window.CassieCards.dueCount() : 0;
  const streak = window.CassieMemory ? window.CassieMemory.stats().streak : 0;
  const asked = questionsThisWeek(), ex = nearestExam(), ready = ex ? examReadiness(ex) : null;
  const w = weekData();
  const el = document.createElement('div');
  el.className = 'desk desk-home';
  el.innerHTML = `
    <header class="dk-head">
      <div class="dk-hello"><div><h1 class="dk-title"></h1><p class="dk-sub">Everything you’re studying, in one calm place. <button type="button" class="home-ideas dk-ideas">Ideas to get started</button></p></div></div>
      <div class="dk-acts"><button type="button" class="dk-btn dk-solid" data-dk="ask">${DESK_ICON.plus}Ask Cassie</button><button type="button" class="dk-btn dk-line" data-dk="notes">${DESK_ICON.file}Add my notes</button></div>
    </header>
    <section class="dk-stats" aria-label="This week in numbers">
      <article class="dk-stat dk-stat-main"><h2>Questions this week</h2><b>${asked}</b><small>${asked ? 'Asked in your chats' : 'Ask Cassie anything to start'}</small><button type="button" class="dk-up" data-dk="chats" aria-label="Open your chats">${DESK_ICON.up}</button></article>
      <article class="dk-stat"><h2>Cards learned</h2><b>${cardsLearned}</b><small>${due ? `${due} ${due === 1 ? 'card' : 'cards'} to review today` : (state.cards || []).length ? 'Nothing to review today' : 'Make flashcards from any answer'}</small><button type="button" class="dk-up" data-dk="cards" aria-label="Open flashcards">${DESK_ICON.up}</button></article>
      <article class="dk-stat"><h2>Day streak</h2><b>${streak}</b><small>${w.now.days ? `${w.now.days} ${w.now.days === 1 ? 'day' : 'days'} studied this week, last week ${w.last.days}` : 'Study today to start one'}</small><button type="button" class="dk-up" data-dk="progress" aria-label="See your progress">${DESK_ICON.up}</button></article>
      <article class="dk-stat"><h2>Exam readiness</h2><b>${ready && ready.tried ? ready.pct + '%' : ex ? '0%' : 'None'}</b><small class="dk-ready-note"></small><button type="button" class="dk-up" data-dk="plan" aria-label="See your study plan">${DESK_ICON.up}</button></article>
    </section>
    <div class="dk-grid">
      <section class="dk-card dk-chart" aria-labelledby="dk-chart-h"><h2 id="dk-chart-h">Study this week</h2><p class="dk-note">Quiz answers, cards moved up, mistakes fixed and plan tasks done, each day.</p><div class="dk-bars" role="list"></div></section>
      <section class="dk-card dk-next" aria-labelledby="dk-next-h"><h2 id="dk-next-h">Next up</h2></section>
      <section class="dk-card dk-plans" aria-labelledby="dk-plans-h"><div class="dk-card-head"><h2 id="dk-plans-h">My exam plans</h2><button type="button" class="dk-pill" data-dk="newplan">${DESK_ICON.plus}New plan</button></div><ul class="dk-list"></ul></section>
      <section class="dk-card dk-chats" aria-labelledby="dk-chats-h"><div class="dk-card-head"><h2 id="dk-chats-h">Recent chats</h2>${chats.length ? '<button type="button" class="dk-pill" data-dk="chats">See all</button>' : ''}</div><ul class="dk-list"></ul></section>
      <section class="dk-card dk-ready" aria-labelledby="dk-ready-h"><h2 id="dk-ready-h">Exam readiness</h2></section>
      <section class="dk-card dk-timer" aria-labelledby="dk-timer-h"><h2 id="dk-timer-h">Focus timer</h2><b class="dk-time" aria-live="off">25:00</b><small class="dk-mode">Focus</small><div class="dk-tbtns"><button type="button" class="dk-tgo" data-dk="tgo" aria-label="Start the focus timer">${DESK_ICON.play}</button><button type="button" class="dk-tstop" data-dk="tstop" aria-label="Stop and reset the timer">${DESK_ICON.stop}</button></div></section>
    </div>`;
  el.querySelector('.dk-title').textContent = name ? `Hi, ${name}` : 'Hi there';
  el.querySelector('.dk-ready-note').textContent = ex ? `${ex.name}, ${dayGap(phDay(), ex.date) === 0 ? 'today' : `in ${dayGap(phDay(), ex.date)} ${dayGap(phDay(), ex.date) === 1 ? 'day' : 'days'}`}` : 'Plan an exam to see it';
  // the chart: a rounded bar a day, today marked, days with nothing striped
  const days = studyDays(), top = Math.max(1, ...days.map((d) => d.n));
  el.querySelector('.dk-bars').innerHTML = days.map((d) => {
    const h = d.n ? Math.max(18, Math.round((d.n / top) * 100)) : 100;
    const label = `${dayName(d.day, { weekday: 'long' })}: ${d.n} ${d.n === 1 ? 'thing' : 'things'} studied`;
    return `<div class="dk-bar${d.n ? '' : ' dk-bar-none'}${d.today ? ' dk-bar-today' : ''}" role="listitem" aria-label="${label}">${d.today && d.n ? `<span class="dk-bubble">${d.n}</span>` : ''}<i style="height:${h}%"></i><small>${dayName(d.day, { weekday: 'narrow' })}</small></div>`;
  }).join('');
  // next up: the next task of the nearest plan
  const nx = nextExamTask(), next = el.querySelector('.dk-next');
  if (nx) {
    const left = dayGap(phDay(), nx.day);
    next.insertAdjacentHTML('beforeend', `<p class="dk-next-what"></p><p class="dk-note dk-next-when"></p><button type="button" class="dk-btn dk-solid dk-wide" data-dk="nexttask">${DESK_ICON.play}Start studying</button>`);
    next.querySelector('.dk-next-what').textContent = taskLabel(nx.t);
    next.querySelector('.dk-next-when').textContent = `${left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : dayName(nx.day)} · ${nx.e.name}`;
  } else next.append(CassieErrors.empty({ title: activeExams().length ? 'All caught up' : 'No plan yet', text: activeExams().length ? 'Every task so far is done. Nice work.' : 'Tell Cassie your exam and she plans it day by day.', action: activeExams().length ? '' : 'Plan an exam', onAction: () => openExamSheet() }));
  // the exam plans
  const plans = el.querySelector('.dk-plans .dk-list');
  activeExams().forEach((e, i) => {
    const li = document.createElement('li'), r = examReadiness(e);
    li.innerHTML = `<button type="button" class="dk-row" data-dk="plan" data-id="${e.id}"><i class="dk-dot dk-c${i % 4}" aria-hidden="true">${DESK_ICON.book}</i><span><b></b><small></small></span></button>`;
    li.querySelector('b').textContent = e.name;
    li.querySelector('small').textContent = `Exam day: ${dayName(e.date)}${r && r.tried ? ` · ${r.pct}% ready` : ''}`;
    plans.appendChild(li);
  });
  if (!activeExams().length) plans.replaceWith(CassieErrors.empty({ title: 'No exam plans', text: 'Your exam plans show up here.' }));
  // recent chats
  const list = el.querySelector('.dk-chats .dk-list');
  chats.slice(0, 4).forEach((c) => {
    const li = document.createElement('li'), n = c.messages.length;
    li.innerHTML = `<button type="button" class="dk-row" data-dk="chat:${c.id}"><i class="dk-dot" aria-hidden="true">${HUB_ICON.chat}</i><span><b></b><small></small></span></button>`;
    li.querySelector('b').textContent = c.title || deriveTitle(c.messages) || 'Chat';
    li.querySelector('small').textContent = `${n} message${n === 1 ? '' : 's'} · ${hubAgo(c.updatedAt)}`;
    list.appendChild(li);
  });
  if (!chats.length) list.replaceWith(CassieErrors.empty({ title: 'No chats yet', text: 'Your chats with Cassie show up here.' }));
  // readiness: the nearest exam, as a half circle
  const rd = el.querySelector('.dk-ready');
  if (ex) {
    const pct = ready && ready.tried ? ready.pct : 0;
    rd.insertAdjacentHTML('beforeend', `<div class="dk-gauge" role="img">${deskGauge(pct)}<b>${pct}%</b></div><p class="dk-note dk-center"></p>`);
    rd.querySelector('.dk-gauge').setAttribute('aria-label', `${pct}% ready for ${ex.name}`);
    rd.querySelector('.dk-center').textContent = ready && ready.tried ? `${ex.name}: ${ready.tried} of ${ready.total} topics practised` : `${ex.name}: take a quiz on a topic to start`;
  } else rd.append(CassieErrors.empty({ title: 'Nothing to measure yet', text: 'Plan an exam, then practise its topics. Cassie shows how ready you are here.' }));
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-dk]'); if (b) deskAct(b.dataset.dk); });
  el.querySelector('.dk-ideas').addEventListener('click', () => showTools()); // (where every study tool lives: the sidebar)
  setTimeout(renderDeskTimer, 0);
  return el;
}
function deskAct(act) {
  if (act === 'ask') { deskGo('chat'); return; }
  if (act === 'notes') { document.getElementById('file-input').click(); return; }
  if (act === 'chats') { deskGo('chats'); return; }
  if (act.startsWith('chat:')) { selectChat(act.slice(5)); return; }
  if (act === 'cards') { if (window.CassieCards) window.CassieCards.open(); return; }
  if (act === 'newplan') { openExamSheet(); return; }
  if (act === 'nexttask') { const nx = nextExamTask(); if (nx) openExamTask(nx.t, nx.e); return; }
  if (act === 'plan' || act === 'progress') { deskGo(act); return; }
  if (act === 'tgo') { document.getElementById('pomo-toggle').click(); renderDeskTimer(); return; }
  if (act === 'tstop') { document.getElementById('pomo-reset').click(); renderDeskTimer(); }
}
// the dashboard's timer card and the top bar's pill follow the focus timer
function renderDeskTimer() {
  const time = (document.getElementById('pomo-time') || {}).textContent || '25:00', mode = (document.getElementById('pomo-mode') || {}).textContent || 'Focus';
  const on = /pause/i.test((document.getElementById('pomo-toggle') || {}).textContent || '');
  const put = (el, t) => { if (el && el.textContent !== t) el.textContent = t; }; // (only real changes: no needless redraws)
  document.querySelectorAll('.dk-timer').forEach((c) => {
    put(c.querySelector('.dk-time'), time);
    put(c.querySelector('.dk-mode'), mode);
    const go = c.querySelector('.dk-tgo'), label = on ? 'Pause the focus timer' : 'Start the focus timer';
    if (go.getAttribute('aria-label') !== label) { go.innerHTML = on ? DESK_ICON.pause : DESK_ICON.play; go.setAttribute('aria-label', label); }
  });
  const pill = document.getElementById('top-timer');
  if (pill) { if (pill.hidden === on) pill.hidden = !on; put(pill.querySelector('b'), time); put(pill.querySelector('span'), mode); }
}
setInterval(renderDeskTimer, 1000);
// the computer's sidebar pages and top bar (phones never show them)
function goHome() { deskGo('home'); }
function deskChrome() {
  const empty = !state.messages.length;
  // (the dashboard pages have no ask box; a chat, new or not, does)
  document.body.classList.toggle('desk-on', sideWide.matches && empty && deskPage !== 'chat');
  document.querySelectorAll('#side-nav [data-page]').forEach((b) => { const on = (b.dataset.page === deskPage && empty) || (b.dataset.page === 'chats' && (!empty || deskPage === 'chat')); b.classList.toggle('on', on); if (on) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  const so = document.querySelector('.side-nav [data-page="signout"]'); if (so) so.hidden = !(accountsOn() && authToken());
  const badge = document.querySelector('#side-nav [data-page="plan"] .side-badge'), n = dueToday();
  if (badge) { const t = n ? String(n) : ''; if (badge.textContent !== t) badge.textContent = t; badge.hidden = !n; document.querySelector('#side-nav [data-page="plan"]').setAttribute('aria-label', n ? `Study plan: ${n} ${n === 1 ? 'task' : 'tasks'} today` : 'Study plan'); }
  const p = state.profile || {}, name = (p.name || '').trim(), email = (state.account && state.account.email) || '';
  const me = document.getElementById('top-me');
  if (me) {
    me.querySelector('.top-av').textContent = (name || 'C')[0].toUpperCase();
    me.querySelector('b').textContent = name || 'You';
    me.querySelector('small').textContent = email || (accountsOn() ? 'Sign in' : 'Your settings');
    me.setAttribute('aria-label', `${name || 'You'}: ${email ? 'your account' : 'open your settings'}`);
  }
  const due = window.CassieCards ? window.CassieCards.dueCount() : 0, dot = document.querySelector('#top-bell .top-dot');
  if (dot) { dot.hidden = !due; document.getElementById('top-bell').setAttribute('aria-label', `Reminders${due ? `: ${due} ${due === 1 ? 'card' : 'cards'} due` : ''}`); }
}
setInterval(deskChrome, 2000);
document.querySelectorAll('.side-nav [data-page]').forEach((b) => b.addEventListener('click', () => {
  const pg = b.dataset.page;
  if (pg === 'home') goHome();
  else if (pg === 'signout') signOutNow().then(deskChrome);
  else deskGo(pg);
  setTimeout(deskChrome, 0);
}));
/* The top bar's search: pages, tools and chats as you type; arrows and Enter, or a click */
const topQ = document.getElementById('top-q'), topResults = document.getElementById('top-results');
let topHits = [], topAt = 0;
function topSearchHits(q) {
  q = q.trim().toLowerCase();
  if (!q) return [];
  const pages = [['Home', () => deskGo('home')], ['Chats', () => deskGo('chats')], ['Study plan', () => deskGo('plan')], ['Calendar', () => deskGo('calendar')], ['Progress', () => deskGo('progress')], ['New chat', () => deskGo('chat')], ['Settings', () => openSettings('all')], ['Memory', () => document.getElementById('memory-btn').click()], ['Labs', () => document.getElementById('labs-btn').click()], ['Games', () => document.getElementById('games-btn').click()], ['Board', () => document.getElementById('board-btn').click()]]
    .map(([t, go]) => ({ t, kind: 'Page', go }));
  const tools = HOME_EXAMPLES.map((ex) => ({ t: ex.label, kind: 'Tool', go: () => { if (state.messages.length || deskPage !== 'chat') deskGo('chat'); runTool(ex); } }));
  const chats = state.chats.filter((c) => c.messages && c.messages.length).map((c) => ({ t: c.title || deriveTitle(c.messages) || 'Chat', kind: 'Chat', go: () => selectChat(c.id) }));
  return [...pages, ...tools, ...chats].filter((h) => h.t.toLowerCase().includes(q)).slice(0, 8);
}
function showTopResults() {
  topHits = topSearchHits(topQ.value); topAt = 0;
  topResults.innerHTML = topHits.length ? topHits.map((h, i) => `<li role="option" id="top-r${i}" aria-selected="${i === 0}"><span></span><small>${h.kind}</small></li>`).join('') : (topQ.value.trim() ? '<li class="top-none" role="presentation">Nothing matches. Ask Cassie instead?</li>' : '');
  topResults.querySelectorAll('[role="option"] span').forEach((sp, i) => { sp.textContent = topHits[i].t; });
  topResults.hidden = !topQ.value.trim();
  topQ.setAttribute('aria-expanded', String(!topResults.hidden));
  if (topHits.length) topQ.setAttribute('aria-activedescendant', 'top-r0'); else topQ.removeAttribute('aria-activedescendant');
}
function pickTop(i) { const h = topHits[i]; topQ.value = ''; showTopResults(); topQ.blur(); if (h) { deskCloseOthers({ Settings: 'settings', Memory: 'memory', Labs: 'labs', Games: 'labs', Board: 'board', Flashcards: 'cards' }[h.t] || ''); h.go(); } }
topQ.addEventListener('input', showTopResults);
topQ.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
    if (!topHits.length) return; e.preventDefault();
    topAt = (topAt + (e.key === 'ArrowDown' ? 1 : topHits.length - 1)) % topHits.length;
    topResults.querySelectorAll('[role="option"]').forEach((li, i) => li.setAttribute('aria-selected', String(i === topAt)));
    topQ.setAttribute('aria-activedescendant', 'top-r' + topAt);
  } else if (e.key === 'Enter') { e.preventDefault(); if (topHits.length) pickTop(topAt); }
  else if (e.key === 'Escape') { topQ.value = ''; showTopResults(); topQ.blur(); }
});
topResults.addEventListener('mousedown', (e) => { const li = e.target.closest('[role="option"]'); if (li) { e.preventDefault(); pickTop(+li.id.slice(5)); } });
topQ.addEventListener('blur', () => setTimeout(() => { topResults.hidden = true; topQ.setAttribute('aria-expanded', 'false'); }, 150));
document.addEventListener('keydown', (e) => { if (sideWide.matches && (e.ctrlKey || e.metaKey) && !e.altKey && e.key.toLowerCase() === 'k') { e.preventDefault(); topQ.focus(); topQ.select(); } });
/* Computers: Labs, Games and the Board sit under Study tools, Settings and Memory under General (phones: the top bar) */
const APP_BTNS = ['labs-btn', 'games-btn', 'board-btn', 'memory-btn', 'settings-btn'].map((id) => { const b = document.getElementById(id); return { b, home: b.parentElement, next: b.nextElementSibling }; });
function placeApps() {
  const wide = sideWide.matches, apps = document.getElementById('side-apps'), general = document.getElementById('side-general');
  (wide ? APP_BTNS : [...APP_BTNS].reverse()).forEach(({ b, home, next }) => { // (back in reverse, so each one's neighbour is already home)
    if (wide) { (b.id === 'memory-btn' || b.id === 'settings-btn' ? general : apps)[b.id === 'settings-btn' ? 'prepend' : 'append'](b); b.classList.add('side-tool'); b.dataset.tip = b.querySelector('.app-label').textContent; }
    else { home.insertBefore(b, next && next.parentElement === home ? next : null); b.classList.remove('side-tool'); }
  });
  const mem = document.getElementById('memory-btn'), set = document.getElementById('settings-btn');
  if (wide && mem.previousElementSibling !== set) set.after(mem);
}
placeApps();
sideWide.addEventListener('change', () => { placeApps(); deskChrome(); });
document.getElementById('top-timer').addEventListener('click', goHome);
document.getElementById('top-me').addEventListener('click', () => openSettings('all'));
// the bell: today's reminders (the same list the phone's Home has)
const topBell = document.getElementById('top-bell'), topRemind = document.getElementById('top-remind');
function closeTopRemind() { topRemind.hidden = true; topBell.setAttribute('aria-expanded', 'false'); }
topBell.addEventListener('click', (e) => {
  e.stopPropagation();
  if (!topRemind.hidden) { closeTopRemind(); return; }
  const due = window.CassieCards ? window.CassieCards.dueCount() : 0, streak = window.CassieMemory ? window.CassieMemory.stats().streak : 0;
  const box = hubReminders(due, streak); box.classList.add('open');
  topRemind.replaceChildren(box); topRemind.hidden = false; topBell.setAttribute('aria-expanded', 'true');
  const first = topRemind.querySelector('button'); if (first) first.focus({ preventScroll: true });
});
topRemind.addEventListener('click', (e) => { const b = e.target.closest('[data-hub]'); if (b) { closeTopRemind(); hubAct(b.dataset.hub); } });
document.addEventListener('click', (e) => { if (!topRemind.hidden && !topRemind.contains(e.target)) closeTopRemind(); });
document.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !topRemind.hidden) { closeTopRemind(); topBell.focus(); } });
/* The computer's pages (Study plan, Calendar, Progress) open where Home does, in an empty chat, so the
   Ask Cassie box stays under every page; the first question turns it back into a chat. */
// (the page is kept for this tab, so a reload stays where you were)
const DESK_KEY = 'cassie.deskPage';
var deskPage = 'home';
try { deskPage = sessionStorage.getItem(DESK_KEY) || 'home'; } catch (e) { /* this visit only */ }
const DESK_PAGES = { home: () => deskHome(), chat: () => deskChatStart(), chats: () => deskChats(), plan: () => deskPlan(), calendar: () => deskCalendar(), progress: () => deskProgress() };
function setDeskPage(page) { deskPage = DESK_PAGES[page] ? page : 'home'; try { sessionStorage.setItem(DESK_KEY, deskPage); } catch (e) { /* ignore */ } }
// a new chat on a computer: a hello, a few ideas, and the ask box under it
function deskChatStart() {
  const el = document.createElement('div');
  el.className = 'desk desk-chat';
  const p = state.profile || {}, name = (p.name || '').trim().split(/\s+/)[0];
  el.innerHTML = `<div class="dk-chat-hi"><h1 class="dk-title"></h1><p class="dk-sub">Ask anything you’re studying. Cassie explains it step by step.</p>
    <div class="dk-ideas-row">${HOME_EXAMPLES.slice(0, 6).map((ex, i) => `<button type="button" class="dk-chip dk-idea" data-i="${i}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="${ex.icon}"/></svg><span></span></button>`).join('')}</div></div>`;
  el.querySelector('.dk-title').textContent = name ? `What are we studying, ${name}?` : 'What are we studying today?';
  el.querySelectorAll('.dk-idea').forEach((b) => { b.querySelector('span').textContent = HOME_EXAMPLES[+b.dataset.i].label; b.addEventListener('click', () => runTool(HOME_EXAMPLES[+b.dataset.i])); });
  return el;
}
/* Chats: every conversation as a card, newest first (like Fernly's Team page) */
let deskChatsFilter = 'all';
function deskChats() {
  const el = document.createElement('div');
  el.className = 'desk desk-chats';
  const all = state.chats.filter((c) => c.messages && c.messages.length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const week = Date.now() - 7 * 864e5;
  const FILTERS = [['all', 'All'], ['week', 'This week'], ['files', 'With files'], ['older', 'Older']];
  const keep = (c) => deskChatsFilter === 'all' || (deskChatsFilter === 'week' && (c.updatedAt || 0) >= week) || (deskChatsFilter === 'older' && (c.updatedAt || 0) < week) || (deskChatsFilter === 'files' && c.messages.some((m) => m.display && /\(attached:/.test(m.display)));
  const list = all.filter(keep);
  el.innerHTML = deskHeader('Chats', 'Every conversation with Cassie, newest first.', `<button type="button" class="dk-btn dk-solid" data-dk="ask">${DESK_ICON.plus}New chat</button>`)
    + `<div class="dk-filters"><div class="dk-chips" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" class="dk-chip" data-f="${k}" aria-pressed="${k === deskChatsFilter}">${l}</button>`).join('')}</div><small class="dk-count"></small></div><div class="dk-chat-grid"></div>`;
  const grid = el.querySelector('.dk-chat-grid');
  list.forEach((c) => {
    const n = c.messages.length, first = (c.messages.find((m) => m.role === 'user') || {});
    const card = document.createElement('article');
    card.className = 'dk-card dk-chat-card';
    card.innerHTML = `<div class="dk-chat-top"><i class="dk-dot" aria-hidden="true">${HUB_ICON.chat}</i><span><b></b><small></small></span></div><p class="dk-note dk-chat-q"></p><div class="dk-chat-acts"><button type="button" class="dk-btn dk-solid dk-open">Open</button><button type="button" class="dk-btn dk-line dk-del">Delete</button></div>`;
    card.querySelector('b').textContent = c.title || deriveTitle(c.messages) || 'Chat';
    card.querySelector('small').textContent = `${n} message${n === 1 ? '' : 's'} · ${hubAgo(c.updatedAt)}`;
    card.querySelector('.dk-chat-q').textContent = String(first.display || first.content || '').replace(/\s+/g, ' ').slice(0, 140);
    card.querySelector('.dk-open').setAttribute('aria-label', `Open ${card.querySelector('b').textContent}`);
    card.querySelector('.dk-open').addEventListener('click', () => selectChat(c.id));
    card.querySelector('.dk-del').addEventListener('click', () => { if (!confirm('Delete this chat?')) return; state.chats = state.chats.filter((x) => x.id !== c.id); if (!state.chats.length) state.chats.push(makeChat()); if (!state.chats.some((x) => x.id === state.currentId)) { state.currentId = state.chats[0].id; state.messages = curChat().messages; } save(); renderChatList(); renderHistory(); });
    grid.appendChild(card);
  });
  if (!list.length) grid.replaceWith(CassieErrors.empty({ title: all.length ? 'No chats here' : 'No chats yet', text: all.length ? 'Try another filter.' : 'Ask Cassie anything and your chat shows up here.', action: all.length ? '' : 'Ask Cassie', onAction: () => deskAct('ask') }));
  el.querySelector('.dk-count').textContent = `${list.length} ${list.length === 1 ? 'chat' : 'chats'}`;
  el.querySelector('.dk-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { deskChatsFilter = b.dataset.f; renderHistory(); } });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-dk="ask"]'); if (b) deskAct('ask'); });
  return el;
}
const KIND_NAME = { learn: 'Learn', quiz: 'Quiz', cards: 'Flashcards', mistakes: 'Mistakes', focus: 'Focus' };
// every exam task with its plan and day (newest plans included, closed ones left out)
function allExamTasks() {
  return activeExams().flatMap((e) => (e.days || []).flatMap((d) => d.tasks.map((t) => ({ t, e, day: d.date }))));
}
const dueToday = () => allExamTasks().filter((x) => x.day === phDay() && !x.t.done).length;
/* Study plan: every task from the exam plans as a board (Today, Coming up, Done), then the plans themselves */
let deskPlanFilter = 'all';
function deskPlan() {
  const el = document.createElement('div');
  el.className = 'desk desk-plan';
  const today = phDay(), weekEnd = dayAdd(weekStart(today), 6);
  const FILTERS = [['all', 'All'], ['today', 'Today'], ['quiz', 'Quizzes'], ['week', 'This week']];
  el.innerHTML = deskHeader('Study plan', 'Every task from your exam plans. Tap one to start it, or tick it when it’s done.', `<button type="button" class="dk-btn dk-solid" data-dk="newplan">${DESK_ICON.plus}New plan</button>`)
    + `<div class="dk-filters"><div class="dk-chips" role="group" aria-label="Show">${FILTERS.map(([k, l]) => `<button type="button" class="dk-chip" data-f="${k}" aria-pressed="${k === deskPlanFilter}">${l}</button>`).join('')}</div><small class="dk-count" aria-live="polite"></small></div>
    <div class="dk-board">${[['now', 'Today'], ['next', 'Coming up'], ['done', 'Done']].map(([k, l]) => `<section class="dk-col" data-col="${k}" aria-label="${l}"><h2>${l} <span class="dk-n"></span></h2><ul class="dk-col-list"></ul></section>`).join('')}</div>`;
  const keep = (x) => deskPlanFilter === 'all' || (deskPlanFilter === 'today' && x.day === today) || (deskPlanFilter === 'quiz' && x.t.kind === 'quiz') || (deskPlanFilter === 'week' && x.day <= weekEnd);
  const tasks = allExamTasks().filter(keep);
  const col = (x) => (x.t.done ? 'done' : x.day <= today ? 'now' : 'next');
  tasks.sort((a, b) => (a.day < b.day ? -1 : a.day > b.day ? 1 : 0)).forEach((x) => {
    const li = document.createElement('li'), left = dayGap(today, x.day);
    li.className = 'dk-task' + (x.t.done ? ' done' : '');
    li.innerHTML = `<div class="dk-tags"><span class="dk-tag dk-k-${x.t.kind}"></span>${x.t.moved ? '<span class="dk-tag dk-moved">Moved</span>' : ''}</div><button type="button" class="dk-task-go"></button>
      <div class="dk-task-foot"><small></small><label class="ex-check"><input type="checkbox"><span class="ex-tick" aria-hidden="true"></span></label></div>`;
    li.querySelector('.dk-tag').textContent = KIND_NAME[x.t.kind] || 'Task';
    li.querySelector('.dk-task-go').textContent = taskLabel(x.t);
    li.querySelector('small').textContent = `${x.e.name} · ${left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : dayName(x.day)}`;
    const box = li.querySelector('input');
    box.checked = !!x.t.done; box.setAttribute('aria-label', `Done: ${taskLabel(x.t)}`);
    box.addEventListener('change', () => { x.t.done = box.checked; progressAdd({ tasks: x.t.done ? 1 : -1 }); renderHistory(); });
    li.querySelector('.dk-task-go').addEventListener('click', () => openExamTask(x.t, x.e));
    el.querySelector(`[data-col="${col(x)}"] .dk-col-list`).appendChild(li);
  });
  el.querySelectorAll('.dk-col').forEach((c) => {
    const n = c.querySelectorAll('.dk-task').length;
    c.querySelector('.dk-n').textContent = n;
    if (!n) c.querySelector('.dk-col-list').replaceWith(CassieErrors.empty({ title: c.dataset.col === 'done' ? 'Nothing done yet' : 'Nothing here', text: c.dataset.col === 'done' ? 'Tick a task when it’s done and it moves here.' : activeExams().length ? 'No tasks for this filter.' : 'Make an exam plan and its tasks show up here.' }));
  });
  el.querySelector('.dk-count').textContent = `${tasks.length} ${tasks.length === 1 ? 'task' : 'tasks'} shown`;
  el.querySelector('.dk-chips').addEventListener('click', (e) => { const b = e.target.closest('[data-f]'); if (b) { deskPlanFilter = b.dataset.f; renderHistory(); } });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-dk="newplan"]'); if (b) openExamSheet(); });
  const plans = examSection(); // the plans in full: Your Exam Plan, its subject and topics, the whole plan, Delete
  plans.querySelectorAll('.hub-h').forEach((h) => { h.textContent = 'Your exam plans'; });
  el.appendChild(plans);
  return el;
}
/* Calendar: the month with exam days and tasks; Today and Coming up beside it */
let deskMonth = '';
function deskCalendar() {
  const el = document.createElement('div');
  el.className = 'desk desk-cal';
  const today = phDay(), month = deskMonth || today.slice(0, 7), [y, m] = month.split('-').map(Number);
  const first = `${month}-01`, startDow = new Date(first + 'T00:00:00Z').getUTCDay(), daysIn = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const items = {};
  const put = (day, it) => { (items[day] = items[day] || []).push(it); };
  activeExams().forEach((e) => put(e.date, { kind: 'exam', label: `${e.name} exam`, e }));
  allExamTasks().forEach((x) => put(x.day, { kind: x.t.kind, label: taskLabel(x.t), x }));
  const monthName = new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push('<div class="dk-day dk-day-out" aria-hidden="true"></div>');
  for (let d = 1; d <= daysIn; d++) {
    const day = `${month}-${String(d).padStart(2, '0')}`, list = items[day] || [];
    const chips = list.slice(0, 2).map((it) => `<span class="dk-ev dk-k-${it.kind}${it.x && it.x.t.done ? ' done' : ''}">${escapeHtml(it.kind === 'exam' ? it.label : KIND_NAME[it.kind] + (it.x.t.topic ? ': ' + it.x.t.topic : ''))}</span>`).join('') + (list.length > 2 ? `<span class="dk-more">+${list.length - 2} more</span>` : '');
    const label = `${dayName(day, { weekday: 'long', day: 'numeric', month: 'long' })}${list.length ? ': ' + list.map((it) => it.label).join(', ') : ''}`;
    cells.push(`<div class="dk-day${day === today ? ' dk-today' : ''}${list.some((it) => it.kind === 'exam') ? ' dk-examday' : ''}" role="gridcell" aria-label="${escapeHtml(label)}"><b>${d}</b>${chips}</div>`);
  }
  const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  el.innerHTML = deskHeader('Calendar', 'Your exam days and study tasks, day by day.', '<button type="button" class="dk-btn dk-line" data-dk="today">Today</button>')
    + `<div class="dk-cal-wrap"><section class="dk-card dk-month" aria-label="${escapeHtml(monthName)}"><div class="dk-card-head"><h2>${escapeHtml(monthName)}</h2><div class="dk-arrows"><button type="button" class="dk-arrow" data-dk="prev" aria-label="Last month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button><button type="button" class="dk-arrow" data-dk="next" aria-label="Next month"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7"/></svg></button></div></div>
      <div class="dk-week-h" aria-hidden="true">${WEEKDAYS.map((w) => `<span>${w}</span>`).join('')}</div><div class="dk-days" role="grid">${cells.join('')}</div>
      <p class="dk-legend dk-cal-legend">${[['exam', 'Exam day'], ...Object.entries(KIND_NAME)].map(([k, l]) => `<span class="dk-lg dk-k-${k}">${l}</span>`).join('')}</p></section>
      <aside class="dk-side"><section class="dk-card dk-today-card" aria-labelledby="dk-today-h"><small class="dk-kicker">Today · ${escapeHtml(dayName(today, { weekday: 'long' }))}</small><h2 id="dk-today-h">${escapeHtml(dayName(today, { month: 'long', day: 'numeric' }))}</h2><ul class="dk-list dk-today-list"></ul></section>
      <section class="dk-card" aria-labelledby="dk-soon-h"><h2 id="dk-soon-h">Coming up</h2><ul class="dk-list dk-soon"></ul></section></aside></div>`;
  // today: the day's tasks (and an exam, if it's today)
  const tl = el.querySelector('.dk-today-list');
  (items[today] || []).forEach((it) => {
    const li = document.createElement('li');
    li.innerHTML = `<button type="button" class="dk-row dk-ev-row dk-k-${it.kind}"><span><b></b><small></small></span></button>`;
    li.querySelector('b').textContent = it.label;
    li.querySelector('small').textContent = it.kind === 'exam' ? 'Exam day. You’ve got this.' : `${it.x.e.name}${it.x.t.done ? ' · done' : ''}`;
    li.querySelector('button').addEventListener('click', () => { if (it.x) openExamTask(it.x.t, it.x.e); });
    tl.appendChild(li);
  });
  if (!tl.children.length) tl.replaceWith(CassieErrors.empty({ title: 'Nothing planned today', text: 'Rest, or review anything you like.' }));
  // coming up: the next tasks and exams after today
  const soon = el.querySelector('.dk-soon');
  Object.keys(items).filter((d) => d > today).sort().flatMap((d) => items[d].filter((it) => !(it.x && it.x.t.done)).map((it) => ({ d, it }))).slice(0, 6).forEach(({ d, it }) => {
    const li = document.createElement('li'), left = dayGap(today, d);
    li.innerHTML = `<div class="dk-soon-row"><span class="dk-date" aria-hidden="true"><small></small><b></b></span><span><b class="dk-soon-what"></b><small class="dk-soon-when"></small></span></div>`;
    li.querySelector('.dk-date small').textContent = dayName(d, { month: 'short' });
    li.querySelector('.dk-date b').textContent = String(+d.slice(8));
    li.querySelector('.dk-soon-what').textContent = it.label;
    li.querySelector('.dk-soon-when').textContent = `${left === 1 ? 'Tomorrow' : dayName(d, { weekday: 'long' })}${it.x ? ' · ' + it.x.e.name : ''}`;
    soon.appendChild(li);
  });
  if (!soon.children.length) soon.replaceWith(CassieErrors.empty({ title: 'Nothing coming up', text: activeExams().length ? 'Every planned task is done.' : 'Plan an exam and its days show up here.', action: activeExams().length ? '' : 'Plan an exam', onAction: () => openExamSheet() }));
  el.addEventListener('click', (e) => {
    const b = e.target.closest('[data-dk]'); if (!b) return;
    const shift = (n) => { const d = new Date(Date.UTC(y, m - 1 + n, 1)); deskMonth = d.toISOString().slice(0, 7); renderHistory(); };
    if (b.dataset.dk === 'prev') shift(-1); else if (b.dataset.dk === 'next') shift(1); else if (b.dataset.dk === 'today') { deskMonth = ''; renderHistory(); }
  });
  return el;
}
function deskGo(page) {
  deskCloseOthers();
  if (state.messages.length) createNewChat();
  setDeskPage(page);
  renderHistory();
  deskChrome(); // (now, so the ask box is back before it's focused)
  if (deskPage === 'chat') promptInput.focus(); else promptInput.blur();
}
// a page's header: the title, one grey line, and its main buttons
function deskHeader(title, sub, buttons = '') {
  return `<header class="dk-head"><div><h1 class="dk-title">${escapeHtml(title)}</h1><p class="dk-sub">${escapeHtml(sub)}</p></div><div class="dk-acts">${buttons}</div></header>`;
}
/* Progress: this week against last week, a day at a time (the same counts as Home's chart), then the week's numbers */
function deskProgress() {
  const el = document.createElement('div');
  el.className = 'desk desk-progress';
  const today = phDay(), from = weekStart(today);
  const count = (day) => { const d = (state.progress || {})[day] || {}; return (+d.answered || 0) + (+d.cardsUp || 0) + (+d.fixed || 0) + (+d.tasks || 0); };
  const pts = Array.from({ length: 7 }, (_, i) => { const day = dayAdd(from, i); return { day, now: day > today ? null : count(day), last: count(dayAdd(day, -7)) }; });
  const top = Math.max(4, ...pts.map((p) => Math.max(p.now || 0, p.last)));
  const W = 700, H = 240, L = 36, R = 16, T = 16, B = 30, x = (i) => L + (i * (W - L - R)) / 6, y = (n) => T + (H - T - B) * (1 - n / top);
  const line = (k) => pts.filter((p) => p[k] != null).map((p, i) => `${i ? 'L' : 'M'}${x(pts.indexOf(p)).toFixed(1)} ${y(p[k]).toFixed(1)}`).join(' ');
  const nowPts = pts.filter((p) => p.now != null), area = nowPts.length > 1 ? `${line('now')} L${x(nowPts.length - 1).toFixed(1)} ${y(0)} L${x(0)} ${y(0)} Z` : '';
  const grid = [0, 0.5, 1].map((f) => Math.round(top * f)).map((n) => `<line class="dk-gridline" x1="${L}" x2="${W - R}" y1="${y(n)}" y2="${y(n)}"/><text class="dk-axis" x="${L - 8}" y="${y(n) + 4}" text-anchor="end">${n}</text>`).join('');
  const days = pts.map((p, i) => `<text class="dk-axis" x="${x(i)}" y="${H - 8}" text-anchor="middle">${dayName(p.day, { weekday: 'short' })}</text>`).join('');
  const dots = pts.map((p, i) => {
    const label = `${dayName(p.day, { weekday: 'long', day: 'numeric', month: 'short' })}: ${p.now == null ? 'still to come' : `${p.now} studied`}, last week ${p.last}`;
    return `<g class="dk-pt" tabindex="0" role="img" aria-label="${label}" data-i="${i}"><rect x="${x(i) - 30}" y="${T}" width="60" height="${H - T - B}" fill="transparent"/>${p.now != null ? `<circle cx="${x(i)}" cy="${y(p.now)}" r="5"/>` : ''}</g>`;
  }).join('');
  el.innerHTML = deskHeader('Progress', 'How your studying is going, this week against last week.', '<button type="button" class="dk-btn dk-solid" data-dk="share">Share my week</button>')
    + `<section class="dk-card dk-line-card" aria-labelledby="dk-line-h"><div class="dk-card-head"><div><h2 id="dk-line-h">Study each day</h2><p class="dk-note">Quiz answers, cards moved up, mistakes fixed and plan tasks done.</p></div>
      <p class="dk-legend"><span class="dk-key dk-key-now">This week</span><span class="dk-key dk-key-last">Last week</span></p></div>
      <div class="dk-line-wrap"><svg class="dk-line-svg" viewBox="0 0 ${W} ${H}" aria-label="Study each day, this week against last week">${grid}${days}
      ${area ? `<path class="dk-area" d="${area}"/>` : ''}<path class="dk-last" d="${line('last')}"/><path class="dk-now" d="${line('now')}"/>${dots}</svg><div class="dk-tip" hidden></div></div></section>`;
  el.appendChild(weekCard()); // the week's numbers against last week, with Share my week
  const tip = el.querySelector('.dk-tip'), wrap = el.querySelector('.dk-line-wrap');
  const show = (g) => {
    const p = pts[+g.dataset.i], r = g.querySelector('rect').getBoundingClientRect(), w = wrap.getBoundingClientRect();
    tip.innerHTML = `<small></small><b></b><span></span>`;
    tip.querySelector('small').textContent = dayName(p.day, { weekday: 'short', day: 'numeric', month: 'short' });
    tip.querySelector('b').textContent = p.now == null ? 'Still to come' : `${p.now} studied`;
    tip.querySelector('span').textContent = `Last week: ${p.last}`;
    tip.hidden = false;
    tip.style.left = `${Math.min(w.width - 150, Math.max(0, r.left - w.left + r.width / 2 - 70))}px`;
  };
  el.querySelectorAll('.dk-pt').forEach((g) => { g.addEventListener('pointerenter', () => show(g)); g.addEventListener('focus', () => show(g)); g.addEventListener('pointerleave', () => { tip.hidden = true; }); g.addEventListener('blur', () => { tip.hidden = true; }); });
  el.addEventListener('click', (e) => { const b = e.target.closest('[data-dk]'); if (b && b.dataset.dk === 'share') shareWeek(weekData()); });
  return el;
}

/* ---------- Exam plans and the weekly progress card (Home) ----------
   An exam plan: the student names an exam, its day and its topics; Cassie writes a day by day plan
   (1 to 3 small tasks a day, each one something Cassie already does) and Home shows today's tasks.
   A missed day's tasks move to the next days with room (never more than 3 a day). After the exam
   the plan closes with what was done. Free keeps 1 plan at a time; Plus up to 5, and plans from a file.
   The weekly card counts what the student did this week (Monday to Sunday, Philippine time) against
   last week, from counters kept as things happen on this device. Nothing is estimated. */
const PH_MS = 8 * 3600e3;
const phDay = (ms = Date.now()) => new Date(ms + PH_MS).toISOString().slice(0, 10);
const dayAdd = (day, n) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
const dayGap = (a, b) => Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 864e5);
const weekStart = (day = phDay()) => { const d = new Date(day + 'T00:00:00Z'); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
const dayName = (day, o = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(day + 'T12:00:00Z').toLocaleDateString('en-PH', { ...o, timeZone: 'UTC' });

// counters, by day (the last 3 weeks); exam plans running now count the same things for their summary
function progressAdd(add) {
  const day = phDay();
  const p = state.progress && typeof state.progress === 'object' && !Array.isArray(state.progress) ? state.progress : (state.progress = {});
  const d = p[day] || (p[day] = {});
  Object.entries(add).forEach(([k, n]) => { d[k] = Math.max(0, (d[k] || 0) + n); });
  const keep = dayAdd(day, -20);
  Object.keys(p).forEach((x) => { if (x < keep) delete p[x]; });
  (state.exams || []).forEach((e) => {
    if (e.closed || day > e.date) return;
    e.stats = e.stats || {};
    Object.entries(add).forEach(([k, n]) => { e.stats[k] = Math.max(0, (e.stats[k] || 0) + n); });
  });
  save();
}
// a quiz: the marks after a quiz starts (or after a 30 minute gap) are one quiz
let quizFresh = false, lastMarkAt = 0;
// quizTopic: what this quiz is on, when it's known (an exam plan's quiz, or Quiz me with a topic typed)
let quizTopic = '';
const quizStarted = (topic = '') => { quizFresh = true; quizTopic = String(topic || '').trim(); };
function progressMark(right, fixed) {
  const add = { answered: 1, right: right ? 1 : 0, fixed: fixed ? 1 : 0 };
  if (quizFresh || Date.now() - lastMarkAt > 30 * 6e4) add.quizzes = 1;
  quizFresh = false; lastMarkAt = Date.now();
  progressAdd(add);
  if (quizTopic) examMark(quizTopic, right);
}
/* How ready you are for an exam: from your practice quizzes on its topics (the topics in its plan). Each
   topic counts its last 10 answers; a topic you haven't practised counts as 0, so the number only grows
   by practising every topic. It's practice, not a promise about the grade, and the card says so. */
const topicKey = (t) => String(t || '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
// the plan's topics as Cassie wrote them (for showing; examTopics is for matching)
const planTopics = (e) => { const seen = new Set(); return (e.days || []).flatMap((d) => d.tasks).filter((t) => t.topic && t.kind !== 'mistakes').map((t) => t.topic.trim()).filter((t) => { const k = topicKey(t); if (!k || seen.has(k)) return false; seen.add(k); return true; }); };
const examTopics = (e) => [...new Set((e.days || []).flatMap((d) => d.tasks).filter((t) => t.topic && t.kind !== 'mistakes').map((t) => topicKey(t.topic)).filter(Boolean))];
function examMark(topic, right) {
  const k = topicKey(topic);
  if (!k) return;
  const day = phDay();
  (state.exams || []).forEach((e) => {
    if (e.closed || day > e.date) return;
    const hit = examTopics(e).find((t) => t === k || (k.length > 3 && t.includes(k)) || (t.length > 3 && k.includes(t)));
    if (!hit) return;
    e.marks = e.marks || {};
    e.marks[hit] = ((e.marks[hit] || '') + (right ? 'r' : 'w')).slice(-10);
  });
}
function examReadiness(e) {
  const topics = examTopics(e);
  if (!topics.length) return null;
  let sum = 0, tried = 0;
  topics.forEach((t) => { const h = (e.marks || {})[t] || ''; if (h) { tried++; sum += (h.match(/r/g) || []).length / h.length; } });
  return { pct: Math.round((sum / topics.length) * 100), tried, total: topics.length };
}
function weekSums(from, to) {
  const out = { fixed: 0, cardsUp: 0, quizzes: 0, answered: 0, right: 0, focus: 0, tasks: 0, days: 0 };
  Object.entries(state.progress || {}).forEach(([day, d]) => {
    if (day < from || day > to || !d) return;
    Object.keys(out).forEach((k) => { if (k !== 'days') out[k] += +d[k] || 0; });
    if (Object.values(d).some((n) => +n > 0)) out.days++;
  });
  return out;
}
const WEEK_ROWS = [
  ['fixed', 'mistakes fixed'], ['cardsUp', 'flashcards moved up a level'], ['quizzes', 'quizzes taken'],
  ['focus', 'focus minutes'], ['days', 'days studied'], ['tasks', 'exam plan tasks done'],
];
function weekData() {
  const today = phDay(), from = weekStart(today), lastFrom = dayAdd(from, -7);
  return { from, to: today, now: weekSums(from, today), last: weekSums(lastFrom, dayAdd(from, -1)) };
}
const avgScore = (s) => (s.answered ? Math.round((100 * s.right) / s.answered) : null);
function weekCard() {
  const w = weekData(), box = document.createElement('section');
  box.className = 'hub-week';
  box.setAttribute('aria-label', 'Your week');
  box.innerHTML = '<h2 class="hub-h">Your week</h2>';
  if (!w.now.days) {
    box.appendChild(CassieErrors.empty({ title: 'Your week starts here', text: 'Quizzes, flashcards, focus time and fixed mistakes show up here as you study this week.', action: 'Take a quick quiz', onAction: () => hubAct('quiz') }));
    return box;
  }
  const card = document.createElement('div');
  card.className = 'wk-card';
  card.innerHTML = `<p class="wk-dates"></p><ul class="wk-rows">${WEEK_ROWS.map(([k]) => `<li data-k="${k}"><b></b><span></span><small></small></li>`).join('')}</ul><button type="button" class="wk-share">Share my week</button>`;
  card.querySelector('.wk-dates').textContent = `${dayName(w.from, { day: 'numeric', month: 'short' })} to ${dayName(w.to, { day: 'numeric', month: 'short' })} · this week`;
  WEEK_ROWS.forEach(([k, label]) => {
    const li = card.querySelector(`[data-k="${k}"]`);
    li.querySelector('b').textContent = String(w.now[k]);
    const avg = k === 'quizzes' ? avgScore(w.now) : null;
    li.querySelector('span').textContent = avg != null ? `${label}, ${avg}% right` : label;
    li.querySelector('small').textContent = `last week ${w.last[k]}`;
  });
  card.querySelector('.wk-share').addEventListener('click', () => shareWeek(w));
  box.appendChild(card);
  return box;
}
// the week as a picture (to share, or saved when the device can't share)
async function shareWeek(w) {
  const c = document.createElement('canvas'); c.width = 1080; c.height = 1350;
  const x = c.getContext('2d');
  x.fillStyle = '#ffffff'; x.fillRect(0, 0, c.width, c.height);
  x.fillStyle = '#141416'; x.textBaseline = 'alphabetic';
  x.font = '700 64px system-ui, sans-serif'; x.fillText('My week with Cassie', 80, 150);
  x.font = '400 36px system-ui, sans-serif'; x.fillStyle = '#55555c';
  x.fillText(`${dayName(w.from, { day: 'numeric', month: 'long' })} to ${dayName(w.to, { day: 'numeric', month: 'long' })}`, 80, 210);
  WEEK_ROWS.forEach(([k, label], i) => {
    const y = 360 + i * 140, avg = k === 'quizzes' ? avgScore(w.now) : null;
    x.fillStyle = '#141416'; x.font = '800 88px system-ui, sans-serif'; x.fillText(String(w.now[k]), 80, y);
    x.font = '500 40px system-ui, sans-serif'; x.fillText(avg != null ? `${label}, ${avg}% right` : label, 300, y - 28);
    x.fillStyle = '#55555c'; x.font = '400 32px system-ui, sans-serif'; x.fillText(`last week ${w.last[k]}`, 300, y + 18);
  });
  x.fillStyle = '#141416'; x.font = '600 34px system-ui, sans-serif'; x.fillText('askcassie.study', 80, 1270);
  const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
  if (!blob) return;
  const file = new File([blob], 'my-week-with-cassie.png', { type: 'image/png' });
  const touch = matchMedia('(pointer: coarse)').matches; // (phones and tablets share; a computer saves the picture)
  try { if (touch && navigator.canShare && navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: 'My week with Cassie' }); return; } } catch (e) { if (e && e.name === 'AbortError') return; }
  downloadBlob('my-week-with-cassie.png', blob);
}

/* exam plans */
const EXAM_KINDS = ['learn', 'quiz', 'cards', 'mistakes', 'focus'];
const examsNow = () => (Array.isArray(state.exams) ? state.exams : (state.exams = []));
const activeExams = () => examsNow().filter((e) => !e.closed);
const examLimit = () => (isSubscriber() ? 5 : 1);
const examLast = (e) => (dayGap(e.from, e.date) >= 1 ? dayAdd(e.date, -1) : e.date); // (the day before the exam; the exam day itself when it's today)
function taskLabel(t) {
  const topic = t.topic || '';
  if (t.kind === 'quiz') return `Quiz me on ${topic || 'what I studied'}`;
  if (t.kind === 'learn') return `Learn ${topic} with Cassie`;
  if (t.kind === 'cards') return `10 flashcards${topic ? ` on ${topic}` : ''}`;
  if (t.kind === 'mistakes') return 'Review my mistakes';
  return `${(state.pomo && state.pomo.focus) || 25} minute focus session${topic ? `: ${topic}` : ''}`;
}
// Cassie's reply → the plan's days (only what makes sense is kept; at most 3 tasks a day)
function parseExamPlan(reply, from, last) {
  const s = noDashes(String(reply || '')).replace(/```(?:json)?/gi, ''), i = s.indexOf('{'), j = s.lastIndexOf('}');
  if (i < 0 || j <= i) return null;
  let d; try { d = JSON.parse(s.slice(i, j + 1)); } catch (e) { return null; }
  const days = {};
  (Array.isArray(d && d.days) ? d.days : []).forEach((day) => {
    const date = String((day && day.date) || '');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || date < from || date > last) return;
    (Array.isArray(day.tasks) ? day.tasks : []).forEach((t) => {
      if (!t || !EXAM_KINDS.includes(t.kind)) return;
      const topic = String(t.topic || '').replace(/\s+/g, ' ').trim().slice(0, 60);
      if ((t.kind === 'quiz' || t.kind === 'learn') && !topic) return;
      (days[date] = days[date] || []).push({ kind: t.kind, topic });
    });
  });
  const plan = [];
  let spill = [];
  for (let day = from; day <= last; day = dayAdd(day, 1)) { // (a day given too many tasks passes the rest on)
    const tasks = [...spill, ...(days[day] || [])];
    spill = tasks.slice(3);
    if (tasks.length) plan.push({ date: day, tasks: tasks.slice(0, 3).map((t, k) => ({ id: `${day}-${k}-${Math.random().toString(36).slice(2, 6)}`, ...t, done: false })) });
  }
  return plan.length ? plan : null;
}
// a missed day: its unfinished tasks move to the next days with room, never more than 3 on a day
function reflowExam(e, today = phDay()) {
  if (e.closed) return false;
  const last = examLast(e);
  const late = [];
  e.days.forEach((d) => { if (d.date < today) { const keep = []; d.tasks.forEach((t) => (t.done ? keep : late).push(t)); if (keep.length !== d.tasks.length) d.tasks = keep; } });
  if (!late.length) return false;
  for (let day = today > e.from ? today : e.from; day <= last && late.length; day = dayAdd(day, 1)) {
    let d = e.days.find((x) => x.date === day);
    if (!d) { d = { date: day, tasks: [] }; e.days.push(d); }
    while (d.tasks.length < 3 && late.length) d.tasks.push({ ...late.shift(), moved: true });
  }
  e.dropped = (e.dropped || 0) + late.length; // (no room left before the exam)
  e.days = e.days.filter((d) => d.tasks.length).sort((a, b) => (a.date < b.date ? -1 : 1));
  return true;
}
function tidyExams() {
  const today = phDay();
  let changed = false;
  examsNow().forEach((e) => {
    if (!e.closed && today > e.date) { e.closed = true; changed = true; }
    if (reflowExam(e, today)) changed = true;
  });
  if (changed) save();
}
function examPrompt({ name, date, topics, notes }, from, last) {
  const n = dayGap(from, last) + 1, p = state.profile || {};
  const level = [p.grade, p.level].filter(Boolean).join(' ') || 'high school';
  return `Make a day by day study plan for a ${level} student's exam.
Exam: "${name}". Exam day: ${date}. Today: ${from}. Plan these days: ${from} to ${last} (${n} day${n === 1 ? '' : 's'}).
Topics: ${topics || 'the topics in the notes below'}
${notes ? `Their notes (maybe cut short):\n"""\n${notes.slice(0, 6000)}\n"""\n` : ''}
Each day has 1 to 3 small tasks. Each task is one of these kinds:
"learn" (Cassie explains a topic), "quiz" (a short quiz on a topic), "cards" (flashcards on a topic), "mistakes" (review the quiz questions they got wrong), "focus" (a focus session on a topic).
Learn a topic before quizzing it, review mistakes after quizzes, and keep the last day light.
Reply with ONLY JSON, no other text:
{"days":[{"date":"YYYY-MM-DD","tasks":[{"kind":"learn","topic":"short topic name"}]}]}
Use short topic names, under 40 letters, from the topics given.`;
}
async function makeExamPlan(form) {
  const from = phDay(), e = { id: 'ex' + Date.now().toString(36), name: form.name, date: form.date, topics: form.topics, from, at: Date.now(), days: [], stats: {} };
  const last = examLast(e);
  const reply = await askCassie([{ role: 'user', content: examPrompt(form, from, last) }]);
  const days = parseExamPlan(reply, from, last);
  if (!days) throw new Error('bad plan');
  e.days = days;
  examsNow().push(e);
  track('feature', 'exam-plan');
  save();
  return e;
}
// the Exam Rescue Plan (rescue.html, made in the browser) hands its plan over: it becomes an exam plan here
var RESCUE_KEY = 'cassie.rescue';
function takeRescue() {
  let r = null;
  try { r = JSON.parse(localStorage.getItem(RESCUE_KEY) || 'null'); } catch (e) { r = null; }
  if (!r) return null;
  const today = phDay(), drop = () => { try { localStorage.removeItem(RESCUE_KEY); } catch (e) { /* storage off */ } };
  if (typeof r.name !== 'string' || !r.name.trim() || !/^\d{4}-\d{2}-\d{2}$/.test(r.date || '') || r.date < today || !Array.isArray(r.days)) { drop(); return null; }
  if (activeExams().some((x) => x.name === r.name.trim() && x.date === r.date)) { drop(); return null; } // (already kept)
  if (activeExams().length >= examLimit()) return { full: true };
  const e = { id: 'ex' + Date.now().toString(36), name: noDashes(r.name.trim()).slice(0, 60), date: r.date, topics: noDashes(String(r.topics || '')).slice(0, 600), from: today, at: Date.now(), days: [], stats: {}, rescue: true };
  const last = examLast(e);
  r.days.forEach((d) => {
    if (!d || !/^\d{4}-\d{2}-\d{2}$/.test(d.date) || d.date > last) return;
    const tasks = (Array.isArray(d.tasks) ? d.tasks : []).filter((t) => t && EXAM_KINDS.includes(t.kind)).slice(0, 3)
      .map((t, k) => ({ id: `${d.date}-${k}-${Math.random().toString(36).slice(2, 6)}`, kind: t.kind, topic: noDashes(String(t.topic || '')).replace(/\s+/g, ' ').trim().slice(0, 60), done: false }));
    if (tasks.length) e.days.push({ date: d.date, tasks });
  });
  if (!e.days.length) { drop(); return null; }
  reflowExam(e, today); // (a plan made days ago: what's past moves on)
  examsNow().push(e);
  drop();
  track('feature', 'rescue-plan');
  save();
  return e;
}
function refreshHub() {
  const h = document.getElementById('home-hub');
  if (h && h.querySelector('.hub')) renderHub(h);
  if (!state.messages.length && chatLog.querySelector('.hub, .home-desk')) renderHistory();
}
// what a task opens: the thing Cassie already does
function openExamTask(t, e) {
  const nav = (tab) => (onPhoneHome() ? window.CassieNative.go(tab) : null);
  if (t.kind === 'quiz') { nav('chat'); startQuizOn(t.topic); return; }
  if (t.kind === 'learn') { nav('chat'); if (!canChat()) { openSettings(); return; } handleSend(`Teach me ${t.topic} for my ${e.name} exam, step by step, then check that I understood.`); return; }
  if (t.kind === 'mistakes') { nav('chat'); reviewMistakes(!dueMistakes().length); return; }
  if (t.kind === 'cards') {
    const deck = (state.cards || []).map((c) => c.deck).find((d) => t.topic && d && d.toLowerCase().includes(t.topic.toLowerCase()));
    if (onPhoneHome()) window.CassieNative.go('cards');
    if (window.CassieCards) window.CassieCards.open(deck);
    return;
  }
  hubAct('timer');
}
function examSection() {
  tidyExams();
  const wrap = document.createElement('section');
  wrap.className = 'hub-exam';
  wrap.setAttribute('aria-label', 'Exam plans');
  const list = examsNow(), today = phDay();
  if (list.length) wrap.innerHTML = '<h2 class="hub-h">Today’s plan</h2>';
  list.forEach((e) => {
    const card = document.createElement('div');
    card.className = 'ex-plan' + (e.closed ? ' ex-done' : '');
    card.dataset.id = e.id;
    const all = e.days.flatMap((d) => d.tasks), done = all.filter((t) => t.done).length;
    if (e.closed) {
      const s = e.stats || {};
      card.innerHTML = '<div class="ex-head"><b></b><small></small></div><p class="ex-sum"></p><div class="ex-actions"><button type="button" class="ex-close">Close</button></div>';
      card.querySelector('b').textContent = `${e.name}: your plan is done`;
      card.querySelector('small').textContent = `Exam day was ${dayName(e.date)}`;
      const ready = examReadiness(e);
      card.querySelector('.ex-sum').textContent = `Tasks done: ${done} of ${all.length + (e.dropped || 0)}. Quizzes taken: ${s.quizzes || 0}. Mistakes fixed: ${s.fixed || 0}.${ready && ready.tried ? ` Ready on exam day: ${ready.pct}%.` : ''}`;
      card.querySelector('.ex-close').addEventListener('click', () => { state.exams = examsNow().filter((x) => x.id !== e.id); save(); refreshHub(); });
      wrap.appendChild(card);
      return;
    }
    const left = dayGap(today, e.date), todays = (e.days.find((d) => d.date === today) || { tasks: [] }).tasks;
    card.innerHTML = `<div class="ex-head"><b>Your Exam Plan</b><p class="ex-what"><span class="ex-subj"><em>Subject:</em> </span><span class="ex-tops"><em>Topics:</em> </span></p><small></small></div><ul class="ex-tasks"></ul>
      <div class="ex-actions"><button type="button" class="ex-all" aria-expanded="false">See the whole plan</button><button type="button" class="ex-del">Delete</button></div><ol class="ex-days" hidden></ol>`;
    card.querySelector('.ex-subj').append(e.name);
    const tops = (e.topics || '').trim() || planTopics(e).join(', ');
    if (tops) card.querySelector('.ex-tops').append(tops); else card.querySelector('.ex-tops').remove();
    card.querySelector('.ex-head small').textContent = `${left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : `In ${left} days`} · ${dayName(e.date)} · ${done} of ${all.length} tasks done`;
    // how ready: from your practice quizzes on the plan's topics (shown once you've practised one)
    const ready = examReadiness(e);
    if (ready && ready.tried) {
      const r = document.createElement('div');
      r.className = 'ex-ready';
      r.innerHTML = '<div class="ex-ready-row"><b></b><span></span></div><div class="ex-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><i></i></div><small></small>';
      r.querySelector('b').textContent = `${ready.pct}% ready`;
      r.querySelector('span').textContent = `${ready.tried} of ${ready.total} topics practised`;
      const bar = r.querySelector('.ex-bar');
      bar.setAttribute('aria-valuenow', String(ready.pct)); bar.setAttribute('aria-label', `${ready.pct}% ready for ${e.name}`);
      r.querySelector('i').style.width = ready.pct + '%';
      r.querySelector('small').textContent = ready.tried < ready.total ? 'From your practice quizzes. Quiz every topic to raise it.' : 'From your practice quizzes. It’s practice, not a promise about the grade.';
      card.querySelector('.ex-head').after(r);
    }
    const ul = card.querySelector('.ex-tasks');
    if (!todays.length) ul.innerHTML = `<li class="ex-rest">${left === 0 ? 'Exam day. You’ve got this.' : 'Nothing planned today. Rest, or review anything you like.'}</li>`;
    todays.forEach((t) => {
      const li = document.createElement('li');
      li.innerHTML = '<label class="ex-check"><input type="checkbox"><span class="ex-tick" aria-hidden="true"></span></label><button type="button" class="ex-task"></button>';
      const box = li.querySelector('input'), go = li.querySelector('.ex-task');
      box.checked = !!t.done; box.setAttribute('aria-label', `Done: ${taskLabel(t)}`);
      go.textContent = taskLabel(t);
      li.classList.toggle('done', !!t.done);
      box.addEventListener('change', () => { t.done = box.checked; li.classList.toggle('done', t.done); progressAdd({ tasks: t.done ? 1 : -1 }); card.querySelector('.ex-head small').textContent = `${left === 0 ? 'Today' : left === 1 ? 'Tomorrow' : `In ${left} days`} · ${dayName(e.date)} · ${all.filter((x) => x.done).length} of ${all.length} tasks done`; });
      go.addEventListener('click', () => openExamTask(t, e));
      ul.appendChild(li);
    });
    const ol = card.querySelector('.ex-days');
    e.days.forEach((d) => {
      const li = document.createElement('li');
      li.innerHTML = '<b></b><span></span>';
      li.querySelector('b').textContent = d.date === today ? 'Today' : dayName(d.date);
      li.querySelector('span').textContent = d.tasks.map((t) => (t.done ? '✓ ' : '') + taskLabel(t)).join(' · ');
      ol.appendChild(li);
    });
    const allBtn = card.querySelector('.ex-all');
    allBtn.addEventListener('click', () => { ol.hidden = !ol.hidden; allBtn.setAttribute('aria-expanded', String(!ol.hidden)); allBtn.textContent = ol.hidden ? 'See the whole plan' : 'Hide the whole plan'; });
    card.querySelector('.ex-del').addEventListener('click', () => {
      if (!confirm(`Delete your plan for ${e.name}?`)) return;
      state.exams = examsNow().filter((x) => x.id !== e.id); save(); refreshHub();
    });
    wrap.appendChild(card);
  });
  const n = activeExams().length;
  if (n >= 5) { const p = document.createElement('p'); p.className = 'ex-full'; p.textContent = 'You have 5 exam plans, the most at once. Delete one to add another.'; wrap.appendChild(p); }
  else {
    const add = document.createElement('button');
    add.type = 'button'; add.className = 'hub-chat ex-new';
    add.innerHTML = `<i>${HUB_ICON.timer}</i><span><b></b><small></small></span>${HUB_ICON.go}`;
    add.querySelector('b').textContent = n ? 'Plan for another exam' : 'Got an exam coming up?';
    add.querySelector('small').textContent = n ? 'Plan more than one exam at once' : 'Cassie makes you a day by day plan';
    add.addEventListener('click', () => openExamSheet());
    wrap.appendChild(add);
  }
  return wrap;
}
// the form: name, day, topics (or tap ones you've been studying), and on Plus, your notes
// pre: { name, date, topics } to fill in; auto: make the plan at once (from the first-run questions); then: after it closes
function openExamSheet(pre = null) {
  if (activeExams().length >= examLimit()) {
    if (!isSubscriber()) plusSheet('More exam plans', 'Free keeps one exam plan at a time. Plus can plan up to 5 exams at once, and build a plan from your notes.');
    return;
  }
  document.querySelector('.ex-sheet')?.remove();
  const today = phDay();
  const recent = window.CassieMemory ? Object.entries(window.CassieMemory.data.topics || {}).sort((a, b) => (b[1].last || 0) - (a[1].last || 0)).map(([k]) => k).filter((k) => k.length < 40).slice(0, 8) : [];
  const w = document.createElement('div');
  w.className = 'ex-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'ex-sheet-h');
  w.innerHTML = `<form class="plus-card ex-form" novalidate>
      <h3 id="ex-sheet-h">Plan for an exam</h3>
      <label class="field ex-field"><span>Exam</span><input name="name" type="text" maxlength="60" placeholder="Gen Chem finals" autocomplete="off"></label>
      <label class="field ex-field"><span>Exam day</span><input name="date" type="date" min="${today}" max="${dayAdd(today, 365)}"></label>
      <label class="field ex-field"><span>Topics</span><textarea name="topics" rows="3" maxlength="600" placeholder="Stoichiometry, gas laws, moles"></textarea></label>
      ${recent.length ? '<div class="ex-chips" role="group" aria-label="Topics you’ve been studying"></div>' : ''}
      <div class="ex-file"><button type="button" class="ex-file-btn">Use my notes (Plus)</button><input type="file" accept=".pdf,.docx,.pptx,.txt" hidden><small class="ex-file-name"></small></div>
      <p class="ex-status" aria-live="polite"></p>
      <div class="plus-actions"><button type="submit" class="plus-go ex-make">Make my plan</button><button type="button" class="plus-ok ex-cancel">Cancel</button></div>
    </form>`;
  const f = w.querySelector('form'), chips = w.querySelector('.ex-chips'), status = w.querySelector('.ex-status');
  if (window.CassieMic) window.CassieMic.attach(f.topics); // (said topics stay in the box to edit)
  recent.forEach((t) => {
    const c = document.createElement('button'); c.type = 'button'; c.className = 'ex-chip'; c.textContent = t; c.setAttribute('aria-pressed', 'false');
    c.addEventListener('click', () => {
      const on = c.getAttribute('aria-pressed') !== 'true'; c.setAttribute('aria-pressed', String(on));
      const list = f.topics.value.split(',').map((x) => x.trim()).filter(Boolean).filter((x) => x.toLowerCase() !== t.toLowerCase());
      if (on) list.push(t);
      f.topics.value = list.join(', ');
      f.topics.dispatchEvent(new Event('input'));
    });
    chips.appendChild(c);
  });
  let notes = (pre && pre.notes && pre.notes.text) || null;
  const fromStart = !!notes;
  const fileIn = w.querySelector('input[type=file]');
  if (!isSubscriber() && notesFree()) w.querySelector('.ex-file-btn').textContent = 'Use my notes (free once)';
  w.querySelector('.ex-file-btn').addEventListener('click', () => {
    if (!isSubscriber() && !notesFree()) { plusSheet('Plans from your notes', 'Plus builds your exam plan from your notes, slides or reviewer.'); return; }
    fileIn.click();
  });
  fileIn.addEventListener('change', async () => {
    const file = fileIn.files && fileIn.files[0];
    if (!file) return;
    status.textContent = 'Reading your notes…';
    try { const doc = await readDocument(file); if (!doc.text) throw new Error('empty'); notes = doc.text; w.querySelector('.ex-file-name').textContent = file.name; status.textContent = ''; f.topics.dispatchEvent(new Event('input')); }
    catch (e) { notes = null; status.textContent = CassieErrors.say('exam_file_failed'); }
  });
  const check = CassieErrors.form(f, {
    name: (v) => (v.trim() ? '' : 'exam_name_needed'),
    date: (v) => (!v ? 'exam_date_needed' : v < today ? 'exam_date_past' : v > dayAdd(today, 365) ? 'exam_date_far' : ''),
    topics: (v) => (v.trim() || notes ? '' : 'exam_topics_needed'),
  });
  let made = null;
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); if (pre && pre.then) { const t = pre.then; pre.then = null; t(made); } };
  const onKey = (e) => { if (e.key === 'Escape' && !document.querySelector('.plus-sheet')) { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  w.querySelector('.ex-cancel').addEventListener('click', close);
  w.addEventListener('click', (e) => { if (e.target === w) close(); });
  const make = async () => {
    if (!check.check()) return;
    if (!canChat()) { close(); openSettings(); return; }
    const btn = w.querySelector('.ex-make');
    btn.disabled = true; status.textContent = 'Cassie is making your plan…';
    try {
      const e = await makeExamPlan({ name: noDashes(f.name.value.trim()).slice(0, 60), date: f.date.value, topics: noDashes(f.topics.value.trim()).slice(0, 600), notes });
      made = e;
      if (notes && !isSubscriber()) { state.freeNotesPlan = true; save(); } // (Free's one plan from notes is used)
      close();
      if (onPhoneHome()) window.CassieNative.go('home');
      refreshHub();
      return e;
    } catch (err) {
      btn.disabled = false;
      status.innerHTML = '';
      const p = document.createElement('span'); p.textContent = CassieErrors.explain(err, 'exam_plan_failed');
      const again = document.createElement('button'); again.type = 'button'; again.className = 'ex-again'; again.textContent = 'Try again';
      again.addEventListener('click', make);
      status.append(p, again);
    }
  };
  f.addEventListener('submit', (e) => { e.preventDefault(); make(); });
  document.body.appendChild(w);
  if (pre) { f.name.value = pre.name || ''; f.date.value = pre.date || ''; f.topics.value = pre.topics || ''; if (fromStart) w.querySelector('.ex-file-name').textContent = pre.notes.name; }
  if (pre && pre.auto) make(); else f.name.focus();
}

function renderHome() {
  if (sideWide.matches) { // computers: the study dashboard, or the page picked in the sidebar (phones: Home is its own tab)
    const w = document.createElement('div'); w.className = 'home home-desk';
    w.appendChild((DESK_PAGES[deskPage] || DESK_PAGES.home)());
    chatLog.appendChild(w);
    chatPinned = false; // (Home reads from the top: its timer ticking never pulls it down)
    requestAnimationFrame(() => { chatLog.scrollTop = 0; chatPinned = false; });
    return;
  }
  const wrap = document.createElement('div');
  wrap.className = 'home';
  const intro = document.createElement('div');
  intro.className = 'home-intro';
  intro.innerHTML = `
    <div class="home-badge"><span class="brand-dot"></span></div>
    <h2 class="home-title">Hi, I'm Cassie <svg class="home-spark" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6c.2.6.7 1.1 1.3 1.3L20.8 11l-5.6 1.9c-.6.2-1.1.7-1.3 1.3L12 19.8l-1.9-5.6c-.2-.6-.7-1.1-1.3-1.3L3.2 11l5.6-1.9c.6-.2 1.1-.7 1.3-1.3z"/></svg></h2>
    <p class="home-sub">Your study buddy. Ask me anything.</p>
    <button type="button" class="home-ideas"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2l1.9 5.6c.2.6.7 1.1 1.3 1.3L20.8 11l-5.6 1.9c-.6.2-1.1.7-1.3 1.3L12 19.8l-1.9-5.6c-.2-.6-.7-1.1-1.3-1.3L3.2 11l5.6-1.9c.6-.2 1.1-.7 1.3-1.3z"/></svg>Ideas to get started</button>
  `;
  intro.querySelector('.home-ideas').addEventListener('click', () => showTools());
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
    intro.appendChild(btn); // personal and timely: it stays on the home screen
  }
  const cardsDue = window.CassieCards ? window.CassieCards.dueCount() : 0;
  if (cardsDue) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'home-example review-mistakes study-cards';
    btn.innerHTML = '<svg class="home-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 6h12a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2zm16-2v12h-1.5V5.5H7V4h11a2 2 0 0 1 2 2zM6 11h8v1.5H6zm0 3h5v1.5H6z"/></svg>';
    const lbl = document.createElement('span');
    lbl.textContent = `Flashcards to review (${cardsDue})`;
    btn.appendChild(lbl);
    btn.addEventListener('click', () => window.CassieCards.open());
    intro.appendChild(btn);
  }
  wrap.appendChild(intro);
  chatLog.appendChild(wrap);
  requestAnimationFrame(keepMascotClear);
}

function renderHistory() {
  setTimeout(deskChrome, 0);
  chatLog.innerHTML = '';
  clearFollowups();
  if (state.messages.length === 0) {
    renderHome();
    return;
  }
  state.messages.forEach((m) => {
    const b = m.care && window.CassieCare ? renderCare(m.care.lang, m.care.aiWords) : renderMessage(m.role, m.display || m.content);
    if (m.image && b) addImageToBubble(b, m.image, { download: true });
    if (m.papers && b && window.CassieCite) b.appendChild(window.CassieCite.bar(m.papers, { track }));
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
  requestAnimationFrame(keepMascotClear); // (she sat on Double-check)
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
    return CassieErrors.say('groq_daily', { when: wait ? ` until it resets in ${wait}${clock}` : '' });
  }
  if (wait) {
    return CassieErrors.say('groq_minute', { wait: `${wait}${clock}` });
  }
  return CassieErrors.say('groq_busy');
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
  return ids.find((id) => /llama-4-scout/i.test(id)) || ids.find((id) => /llama-4|vision|maverick|llava|pixtral|(^|[-/])vl([-/]|$)|-vl-|multimodal|gemma-?3/i.test(id)) || '';
}
async function nextGroqModel(tried) {
  return GROQ_MODELS.find((m) => !tried.has(m)) || (await discoverGroqTextModels()).find((m) => !tried.has(m)) || '';
}
function retiredError() {
  const e = new Error("Groq just retired the AI model I was using. Open Settings (gear icon), pick a different Groq model, and ask again. Your chat is saved.");
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
async function groqChat(messages, { model, maxTokens = 2048, onWait, lean = false, rotate = false, noWait = false, viaServer = false, q = false } = {}) {
  // No key of their own → Cassie's server answers (it holds the key and has a backup brain).
  if (!state.groqKey && SERVER) viaServer = true;
  if (viaServer) return serverChat(messages, { model, maxTokens, onWait, lean, q });
  if (geminiOnly()) return geminiFromChat(messages, { maxTokens });
  model = model || state.groqModel;
  const tried = new Set();
  let overloadTries = 0, waitTries = 0, switches = 0;
  const size = estimateTokens(JSON.stringify(messages)) + maxTokens;
  if (rotate && groqCooling(model)) model = (await groqAlternative(new Set([model]), size)) || model;
  // When the user's own key can't answer (daily limit, bad key, Groq down), use Cassie's server.
  const viaServerInstead = (e) => (SERVER ? serverChat(messages, { model, maxTokens, onWait, lean, q }) : Promise.reject(e));
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
      return viaServerInstead(friendlyError(CassieErrors.say('network')));
    }
    if (res.ok) {
      noteGroqBudget(model, res);
      const data = await res.json();
      // some models (Qwen) think out loud in <think> tags — keep only the answer
      return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 401) return viaServerInstead(friendlyError(CassieErrors.say('groq_key_bad')));
    if (modelRetired(res.status, detail)) {
      const next = await nextGroqModel(tried);
      if (!next) return viaServerInstead(retiredError());
      if (model === state.groqModel) { state.groqModel = next; save(); updateModelPill(); }
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
    if (res.status >= 500) return viaServerInstead(friendlyError(CassieErrors.say('groq_down')));
    throw new Error(detail || `Request failed (${res.status})`);
  }
}

function friendlyError(msg) { const e = new Error(msg); e.friendly = true; return e; }

/* Cassie's own server (server/worker.js): the same chat call, but with the owner's
   key, a fair daily allowance per person, and Workers AI as a backup brain. */
// signed in → the server knows the student's plan (Plus and Pro belong to an account)
const chatHeaders = () => { const t = authToken(); return { 'content-type': 'application/json', ...(t ? { authorization: 'Bearer ' + t } : {}) }; };
// a request to Cassie's server that never answers is given up on, with a plain message (older browsers: no limit)
const waitAtMost = (ms) => (typeof AbortSignal !== 'undefined' && AbortSignal.timeout ? AbortSignal.timeout(ms) : undefined);
var SERVER_WAIT = { chat: 90000, picture: 60000, hear: 45000 }; // (chat: the server's own backups can take a while)
const tooSlow = (e) => !!e && (e.name === 'TimeoutError' || e.name === 'AbortError');
async function serverChat(messages, { model, maxTokens = 2048, onWait, lean = false, brain, q } = {}) {
  let waits = 0;
  while (true) {
    let res;
    try {
      res = await fetch(SERVER + '/chat', {
        method: 'POST',
        headers: chatHeaders(),
        body: JSON.stringify({ uid: installId(), model: model || GROQ_MODELS[0], messages, max_tokens: maxTokens, temperature: 0.6, reasoning_effort: lean ? 'low' : undefined, brain, q: q ? 1 : undefined }),
        signal: waitAtMost(SERVER_WAIT.chat),
      });
    } catch (e) {
      throw friendlyError(CassieErrors.say(tooSlow(e) ? 'timeout' : 'network'));
    }
    if (res.ok) {
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    }
    let detail = '', code = '';
    try { const er = (await res.json()).error || {}; detail = er.message || ''; code = er.code || ''; } catch (e) { /* ignore */ }
    if (res.status === 413 || (res.status === 400 && isTooLarge(400, detail))) {
      const e = new Error('too large'); e.tooLarge = true; e.model = model; throw e;
    }
    if (code === 'daily_free') { const e = friendlyError(detail); e.dailyFree = true; throw e; } // out of today's free questions: no waiting
    const secs = parseDuration(res.headers.get('retry-after'));
    if ((res.status === 429 || res.status === 503) && secs && secs <= 30 && waits < 2) {
      waits += 1;
      if (onWait) onWait(Math.ceil(secs));
      await sleep(Math.ceil(secs * 1000) + 300);
      continue;
    }
    throw friendlyError(detail || CassieErrors.say('no_answer')); // Cassie's own server words its messages for people
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
      let text = await groqChat(messages, { model, onWait: opts.onWait, rotate: true, noWait: !!state.geminiKey, q: opts.q });
      if (!text) text = await groqChat(messages, { model, onWait: opts.onWait, rotate: true }); // blank once? ask again
      if (!text) throw friendlyError('I went blank on that one. Please ask again, maybe in different words.');
      return text;
    } catch (e) {
      if (e.groqLimited) {
        // every Groq model is out for this minute — answer with Gemini instead of waiting
        try { return await geminiFromChat(messages); } catch (g) { /* Gemini busy too: wait for Groq */ }
        return (await groqChat(messages, { model, onWait: opts.onWait, rotate: true, q: opts.q })) || '(no response)';
      }
      if (!e.tooLarge) {
        // Groq (and the server) couldn't answer: try Gemini before giving up.
        if (state.geminiKey) { try { return await geminiFromChat(messages); } catch (g) { /* fall through */ } }
        throw e;
      }
      if (historyBudget > 1000) { historyBudget = Math.floor(historyBudget / 2); continue; } // trim & retry
      const next = GROQ_MODELS.find((m) => !tried.has(m) && m !== e.model);
      if (next) { model = next; historyBudget = 3000; continue; }
      const err = new Error(CassieErrors.say('message_too_long'));
      err.friendly = true;
      throw err;
    }
  }
}

/* Gemini generateContent with model fallback (newest first). */
// Google retires Gemini model names often (gemini-2.5-flash is closed to new keys), so ask which
// models this key can use and pick the newest Flash ones. Remembered for a day, per key.
const GEMINI_FALLBACK = [GEMINI_VISION_MODEL, ...GEMINI_DOC_MODELS, 'gemini-flash-latest', 'gemini-flash-lite-latest'];
function rankGemini(models) {
  const ids = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/image|tts|audio|live|embed|thinking|computer|robotics|native|aqa|learnlm|banana/i.test(id));
  const ver = (id) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [0, 0])[1]) || 0;
  const rank = (id) => (/flash-lite/.test(id) ? 2 : /flash/.test(id) ? 0 : /pro/.test(id) ? 4 : 6) + (/preview|exp/.test(id) ? 1 : 0);
  return ids.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
}
let geminiPicked = null;
function forgetGeminiModels() { geminiPicked = null; try { localStorage.removeItem('cassie.geminiModels'); } catch (e) { /* ignore */ } }
async function geminiModels() {
  const tag = String(state.geminiKey || '').slice(-6);
  const fresh = (c) => c && c.tag === tag && Date.now() - c.at < 864e5 && Array.isArray(c.ids) && c.ids.length;
  if (fresh(geminiPicked)) return geminiPicked.ids;
  try { const c = JSON.parse(localStorage.getItem('cassie.geminiModels') || 'null'); if (fresh(c)) { geminiPicked = c; return c.ids; } } catch (e) { /* ignore */ }
  try {
    const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 8000);
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': state.geminiKey }, signal: ctl.signal });
    clearTimeout(t);
    const ids = r.ok ? rankGemini((await r.json()).models || []).slice(0, 4) : [];
    if (ids.length) {
      geminiPicked = { tag, at: Date.now(), ids };
      try { localStorage.setItem('cassie.geminiModels', JSON.stringify(geminiPicked)); } catch (e) { /* ignore */ }
      return ids;
    }
  } catch (e) { /* use the names we know */ }
  return GEMINI_FALLBACK;
}

async function geminiGenerate({ contents, system, maxTokens = 2048, models = null }) {
  const list = [...new Set(models || await geminiModels())];
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
      if (!text) return cand?.finishReason === 'SAFETY' ? CassieErrors.say('unsafe') : '(no response)';
      return text;
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 404 || /no longer available|decommission/i.test(detail)) { lastErr = new Error(detail); forgetGeminiModels(); continue; }
    // busy ("high demand", overloaded) or out of free requests: the next Gemini model has its own capacity
    if (res.status >= 500 || isRateLimited(res.status, detail) || /high demand|overloaded|unavailable/i.test(detail)) {
      lastErr = friendlyError(CassieErrors.say('gemini_busy'));
      lastErr.busy = true; lastErr.rateLimited = isRateLimited(res.status, detail);
      continue;
    }
    if (/api key/i.test(detail)) {
      const e = new Error(CassieErrors.say('gemini_key_bad'));
      e.friendly = true; e.keyRejected = true; throw e;
    }
    // refused for this model (newer models can be off for some keys): try the next one
    if (res.status === 403) {
      lastErr = friendlyError(CassieErrors.say('gemini_key_refused'));
      lastErr.keyRejected = true;
      continue;
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  if (lastErr && (lastErr.busy || lastErr.keyRejected)) throw lastErr;
  const e = new Error("Google retired the Gemini model I use for files and pictures. I'll be updated soon: meanwhile text questions still work.");
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
  return geminiGenerate({ contents, system, maxTokens });
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
    const e = new Error('To read pictures, add your free Google (Gemini) API key in Settings. Groq has no picture-reading model on your key right now.');
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
let serverClaude = false, serverPictures = false; // (serverPictures: Gemini pictures with the owner's key)
let lastPhoto = null;
try { serverClaude = sessionStorage.getItem('cassie.claude') === '1'; serverPictures = sessionStorage.getItem('cassie.pictures') === '1'; } catch (e) { /* storage blocked */ }
var serverPay = false, payPrices = null; // (var: buying can start before this part of the file has run)
try { const pc = JSON.parse(sessionStorage.getItem('cassie.pay') || 'null'); if (pc) { serverPay = !!pc.on; payPrices = pc.prices || null; } } catch (e) { /* storage blocked */ }
const configReady = !SERVER ? Promise.resolve() : (() => {
  return fetch(SERVER + '/config').then((r) => (r.ok ? r.json() : null)).then((c) => {
    serverClaude = !!(c && c.claude); serverPictures = !!(c && c.pictures);
    // (a test key: only on a tester's device, after opening the app with ?paytest=1)
    let tester = false; try { if (/[?&]paytest=1\b/.test(location.search)) sessionStorage.setItem('cassie.paytest', '1'); tester = sessionStorage.getItem('cassie.paytest') === '1'; } catch (e) { /* storage blocked */ }
    serverPay = !!(c && (c.pay || (c.test && tester))); payPrices = (c && c.prices) || null;
    try { sessionStorage.setItem('cassie.pay', JSON.stringify({ on: serverPay, prices: payPrices })); } catch (e) { /* storage blocked */ }
    payLabels();
    try { sessionStorage.setItem('cassie.claude', serverClaude ? '1' : '0'); sessionStorage.setItem('cassie.pictures', serverPictures ? '1' : '0'); } catch (e) { /* storage blocked */ }
  }).catch(() => { /* offline: the usual brains answer */ });
})();
async function askClaudeViaServer(msgs, images, opts = {}) {
  const hist = trimHistory(msgs, 12000).slice(-30).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
  const last = hist[hist.length - 1];
  if (images.length && last) last.content = [{ type: 'text', text: last.content || 'Please look at this and help me with it.' }, ...images.map((img) => ({ type: 'image_url', image_url: { url: `data:${img.mimeType};base64,${img.base64}` } }))];
  return serverChat([{ role: 'system', content: buildSystemPrompt(opts) }, ...hist], { brain: 'claude', maxTokens: 4000, onWait: opts.onWait, q: opts.q });
}

/* Pictures: Gemini first (with your key), then Groq's picture reader (your key or the server).
   A busy Gemini never ends the answer. */
async function askPicture(msgs, image, opts = {}) {
  let firstErr = null;
  if (state.geminiKey) {
    try { return await askGeminiVision(msgs, image, opts); } catch (e) { firstErr = e; }
  }
  if (state.groqKey) {
    try { return await askGroqVision(msgs, [image], { system: buildSystemPrompt(opts), onWait: opts.onWait }); } catch (e) { firstErr = firstErr || e; }
  }
  if (SERVER) { // the server tries every picture reader it has (Groq's, then the owner's Gemini)
    try {
      const hist = trimHistory(msgs, 2000).slice(-12).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: String(m.content || '') }));
      const last = hist.pop() || { role: 'user', content: '' };
      const content = [{ type: 'text', text: last.content || 'Please look at this picture and help me with it.' }, { type: 'image_url', image_url: { url: `data:${image.mimeType};base64,${image.base64}` } }];
      return await serverChat([{ role: 'system', content: buildSystemPrompt(opts) }, ...hist, { role: 'user', content }], { model: 'vision', maxTokens: 2048, onWait: opts.onWait, q: opts.q });
    } catch (e) { firstErr = firstErr || e; }
  }
  if (firstErr) throw firstErr.busy ? friendlyError(CassieErrors.say('pictures_busy')) : firstErr;
  throw new Error('Add your Google (Gemini) API key in Settings to use images.');
}

/* Router: Claude (if the server has it) → text to Groq, pictures to Gemini / Groq vision. */
/* Talk with Cassie: the answer streams in a few words at a time (Groq, straight with your own key
   or through Cassie's server), so she can start speaking the first sentence while the rest is
   still being written. onText(textSoFar) is called as it grows; resolves to the whole answer. */
async function streamChat(messages, onText) {
  const body = { messages, max_tokens: 900, temperature: 0.6, stream: true };
  let res;
  if (state.groqKey) {
    const model = state.groqModel || GROQ_MODELS[0];
    res = await fetch('https://api.groq.com/openai/v1/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + state.groqKey }, body: JSON.stringify({ ...body, model, ...(/gpt-oss/.test(model) ? { reasoning_effort: 'low' } : {}) }) });
  } else if (SERVER) {
    res = await fetch(SERVER + '/chat', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ ...body, uid: installId(), model: GROQ_MODELS[0], reasoning_effort: 'low', q: 1 }) });
  } else throw new Error('no brain');
  if (!res.ok) throw new Error('HTTP ' + res.status);
  // an older server answers all at once: that's fine too
  if (!/event-stream/.test(res.headers.get('content-type') || '') || !res.body) {
    const d = await res.json();
    const t = (d.choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
    if (t) onText(t);
    return t;
  }
  const reader = res.body.getReader(), dec = new TextDecoder();
  let buf = '', text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, nl).trim(); buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') continue;
      try { const piece = JSON.parse(data).choices?.[0]?.delta?.content; if (piece) { text += piece; onText(text.replace(/<think>[\s\S]*?(<\/think>\s*|$)/g, '')); } } catch (e) { /* a partial line */ }
    }
  }
  return text.replace(/<think>[\s\S]*?<\/think>\s*/g, '').trim();
}

async function askCassie(msgs, image, opts = {}) {
  opts = { ...opts, q: true }; // one question on the free daily count (file sections and helpers aren't)
  // spoken answers stream (quickest to start talking); anything that fails uses the usual brains
  if (opts.onDelta && !image && canChat()) {
    try {
      const messages = [{ role: 'system', content: buildSystemPrompt(opts) }, ...trimHistory(msgs, 2500).map((m) => ({ role: m.role === 'assistant' ? 'assistant' : 'user', content: m.content }))];
      const t = await streamChat(messages, opts.onDelta);
      if (t) return t;
    } catch (e) { /* the usual way below */ }
  }
  if (SERVER && serverClaude) {
    try { return await askClaudeViaServer(msgs, image ? [image] : [], opts); } catch (e) { /* the usual brains take over */ }
  }
  if (image) return askPicture(msgs, image, opts);
  if (!canChat()) throw new Error('Add your Groq API key in Settings first.');
  return askGroq(msgs, opts);
}

/* ---------- reading whole files: reviewers, summaries, answers ---------- */
// What "take note of everything" means — used for every file, photo and page.
const NOTES_GUIDE = `Take note of EVERYTHING a student could be asked about. One fact per bullet, under the labels below that fit THIS file (a programming module has no people or dates; a history reading does). Never write a label with nothing under it, and never write "None".
**Key terms**: **term**, what it means
**Ideas & explanations**: what each idea is, why it works, what it is for
**Code & examples**: copy every code example exactly inside \`\`\` code blocks, with what it prints or does; worked examples with every step
**Rules, syntax & formulas**: in \`backticks\`, with what each part means (never use * for times outside code)
**Processes**: numbered steps
**Lists, types & comparisons**
**Common mistakes & errors**: what goes wrong, and why
**People**: real people only (full name, who they are), never names used in examples or exercises
**Dates & events**: exact date or year, what happened, causes and effects
**Places, groups & things**: why each matters
**Pictures, tables & charts**: only ones that teach something (a diagram, chart, map, table, or a photo of a person or place): what each shows, every label and value you can read. Skip decorations: backgrounds, borders, icons, logos, title and "Thank you" slides, class rules
**Questions in the file**: exercises or questions it asks
Put the page or slide after a fact when you know it, like (p. 12). Copy names, dates, numbers and code exactly. Never invent anything.`;
// How Cassie writes a reviewer: a study guide that teaches, shaped for the subject (not a list of facts in boxes)
const REVIEWER_GUIDE = `How to write a reviewer, study guide or notes (like the best student in class would):
1. Start with a **bold title** that names the subject and its topics (never the file's name), then **The big picture**: 2 to 4 sentences on what the file is about and why it matters.
2. If the file lists objectives or outcomes, add **What you should be able to do** as a short list.
3. Then go topic by topic, in the file's order. Give each topic a **bold heading** named after the topic itself (never "Pages 1-22" or "Section 2"). Under it: explain the idea in plain words first, then the details; put each key term in **bold** with its meaning where it first appears; add a worked example from the file; and when students often get it wrong, a **Watch out:** line.
4. Shape it for the subject. Programming: the syntax, the code examples copied exactly in \`\`\` code blocks, and what each one prints. Math and physics: each formula, then a problem solved step by step. Science: processes as numbered steps, and what each diagram shows. History, literature and social studies: **People to remember** (real people only) as a table (Person, Why they matter) and a **Timeline** in order as a table (Date, What happened). Never write a label with nothing under it, and never write "None".
5. Use a small table when something is compared (like a function and a method).
6. End with **Quick review**: a table of every key term and its one line meaning.
7. Then **Practice questions**: 10 of them, mixed: multiple choice, identification, and at least 4 that make the student use the idea (what does this code print, find the bug, solve this problem, explain why). Never ask about names used in examples, page numbers or trivia. Then **Answers**, each with one short line on why.
Write each fact once: never the same list or the same point twice. Skip decorations (backgrounds, borders, logos, title and "Thank you" slides, class rules) and never write a section about the file's pictures: say what a diagram shows inside its topic. If the file itself gets a name, date or fact wrong, keep what it teaches but list it under **Notes on your file** at the end (what it says, and what is correct).
Put code, commands and formulas in \`backticks\` and never use * for times outside code. Put the page or slide in brackets after a fact when you know it, like (p. 12). Stick to the file: don't invent facts that aren't in it.`;
const REVIEWER_TAIL = 'End with **Quick review** (a table of every key term and its meaning), then **Practice questions** (10, mixed, with at least 4 that make the student use the idea) and **Answers** with one line on why each is right.';
const DOC_INSTRUCTION = `The user attached a file, and you are told what KIND it is (PDF, PowerPoint slides, Word document, text, or a photo). Refer to it correctly: say "slide 3" for a presentation, "page 3" for a PDF, "the document" for Word/text, "the photo" for a picture. Its full content is given to you (the text, and for PDFs and slides also the pictures, diagrams, charts, and tables, or notes describing them). You HAVE the whole file: never ask them to paste the text or upload it again, and never say you can't see images or can't make files.
Do exactly what they ask with it, a reviewer, study guide, summary, outline, notes, flashcards, practice quiz, or answers to questions in it.
For a reviewer, notes, summary or study guide: follow the file's order and cover EVERY page, section, slide or topic, don't stop early or skip the middle. Keep every key term, number, formula, code example, process, and (when the file has them) every person, date, place and event, and say what each diagram, chart, table or picture shows and why it matters.
${REVIEWER_GUIDE}
The app puts Save-as Word / PDF / Image / Text buttons under every answer, so if they want a file, just write the complete content, don't tell them to copy it anywhere.`;

function leanDocSystem() {
  let sp = `You are Cassie, a sharp, warm study buddy. Formatting: lead with what matters; label sections with a short **bold** phrase on its own line (never # headings); tight bullet points; key terms in **bold**; plain-text math (no LaTeX); a small table only when it truly helps.`;
  if (state.level && LEVEL_LABELS[state.level]) sp += ` Explain at a ${LEVEL_LABELS[state.level]} level.`;
  sp += ' Answer in the language they write in: English, Filipino, or Taglish mixed the way they mix it, with technical terms in English.';
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
      if (!doc.pdfDoc) doc.pdfDoc = openPdf(await doc.file.arrayBuffer()); // open once, reuse
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
    onStatus(`Reading all of ${doc.name}: pages, pictures and diagrams…`);
    parts.push({ inlineData: { mimeType: 'application/pdf', data: await fileToBase64(doc.file) } });
    parts.push({ text: `(That is "${doc.name}": a ${KIND_WORD[doc.kind] || 'file'}, ${doc.label}.)` });
  } else {
    onStatus(`Reading ${doc.name} and its pictures…`);
    if (doc.text) parts.push({ text: `File "${doc.name}": a ${KIND_WORD[doc.kind] || 'file'} (${doc.label}):\n"""\n${doc.text.slice(0, 500000)}\n"""` });
    const imgs = await docImages(doc, 16);
    imgs.forEach((img) => { parts.push({ text: `[Picture from ${img.label}]` }); parts.push({ inlineData: { mimeType: img.mimeType, data: img.base64 } }); });
  }
  parts.push({ text: request });
  const contents = compactHistory(history, 3000).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  contents.push({ role: 'user', parts });
  onStatus('Writing it up…');
  const whole = WHOLE_FILE_RE.test(request) || wantsStudyFile(request);
  return geminiGenerate({ contents, system: buildSystemPrompt({ tutor: false }) + '\n\n' + DOC_INSTRUCTION, maxTokens: whole ? 32768 : 8192 });
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
  return lo === hi ? `${word} ${lo}` : `${word}s ${lo}-${hi}`;
}
// Which pages a group of notes covers, from their [Pages 4-7] labels (older notes wrote 4–7).
function groupSpan(group) {
  const nums = [], word = /^\[Slide/i.test(group[0] || '') ? 'slides' : 'pages';
  group.forEach((n) => { const m = n.match(/^\[(?:Pages?|Slides?) (\d+)(?:\s*(?:-|–|to)\s*(\d+))?/i); if (m) nums.push(+m[1], +(m[2] || m[1])); });
  if (!nums.length) return '';
  const lo = Math.min(...nums), hi = Math.max(...nums);
  return lo === hi ? `${word.slice(0, -1)} ${lo}` : `${word} ${lo}-${hi}`;
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
    onStatus(`Looking at the pictures: ${labels} (${i + 1} of ${batches.length})…`);
    try {
      const note = await askGroqVision([{ role: 'user', content: `These are ${labels} from "${doc.name}". For each one, take study notes. If it is mostly text, write out ALL of its important content. If it is a diagram, table, chart or picture, say what it shows and every label and value you can read. Skip decorations (backgrounds, borders, logos, title and "Thank you" slides, class rules): write nothing about them.\n\n${NOTES_GUIDE}` }],
        imgs, { system: 'You turn pages and pictures from a student\'s file into accurate, complete study notes. Bullets only. Never invent anything you cannot read.', maxTokens: 1500, onWait: waitNote(`Looking at ${labels}…`) });
      if (note) out.push(`[${labels.replace(/^\w/, (c) => c.toUpperCase())}: pictures]\n${note}`);
    } catch (e) {
      if (e.friendly && /limit|free questions/i.test(e.message)) break; // out of budget: keep what we have
    }
  }
  return out;
}

// Pull "@@PERSON: …", "@@DATE: …", "@@TERM: …" lines out of a section into the master lists.
// The same person, date or term from two parts is kept once ("Gen. Emilio Aguinaldo" = "Emilio Aguinaldo",
// "June 12 , 1898" = "June 12, 1898"), with the fuller of the two descriptions.
const plainText = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const HONORIFICS = /^(?:(?:major|maj|lieutenant|lt|brigadier|general|gen|colonel|col|captain|capt|admiral|adm|dr|mrs|mr|ms|sir|president|pres|senator|sen|governor-general|gov-gen|governor|gov|saint|st|father|fr|rev)\.?\s+)+/;
function personKey(name) {
  const w = plainText(name).replace(/[^a-z\s.-]/g, ' ').replace(/\s+/g, ' ').trim().replace(HONORIFICS, '').replace(/\./g, ' ').split(/\s+/).filter(Boolean);
  return w.length > 1 ? `${w[0]} ${w[w.length - 1]}` : w.join(' ');
}
const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
function dateParts(t) {
  const s = plainText(t), y = +((s.match(/\b(1\d{3}|20\d{2})\b/) || [])[1] || 0);
  const m = MONTH_NAMES.findIndex((n) => new RegExp(`\\b${n.slice(0, 3).toLowerCase()}`).test(s));
  const d = +((s.replace(/\b\d{3,4}\b/g, ' ').match(/\b(\d{1,2})(?:st|nd|rd|th)?\b/) || [])[1] || 0);
  return { y, m, d: d >= 1 && d <= 31 ? d : 0 };
}
// one way to write a date: "June 12, 1898" (a date it can't read stays as it was)
function tidyDate(t) {
  const { y, m, d } = dateParts(t);
  if (y && m >= 0 && d && /^[\w\s,.]+$/.test(t)) return `${MONTH_NAMES[m]} ${d}, ${y}`;
  if (y && m >= 0 && !d && /^[\w\s,.]+$/.test(t)) return `${MONTH_NAMES[m]} ${y}`;
  return String(t).replace(/(\d)\s+,/g, '$1,').trim();
}
const factWords = (t) => new Set(plainText(t).match(/[a-z]{4,}/g) || []);
const sameFact = (a, b) => { const x = factWords(a), y = factWords(b); if (!x.size || !y.size) return true; let n = 0; x.forEach((w) => { if (y.has(w)) n++; }); return n / Math.min(x.size, y.size) >= 0.5; };
function takeMasterLines(md, lists) {
  return md.replace(/^\s*[-*•]?\s*@@\s*(PERSON|DATE|TERM)\s*:[ \t]*(.*)$/gim, (_, kind, body) => {
    if (!body.trim() || /^(none|n\/a|-)\b/i.test(body.trim())) return '';
    const [head, ...rest] = body.split(/\s+[—–|-]\s+/);
    const key = kind.toUpperCase();
    let h = (head || '').replace(/\*\*/g, '').trim();
    const tail = rest.join(', ').trim();
    if (!h) return '';
    if (key === 'DATE') h = tidyDate(h);
    const k = key === 'PERSON' ? personKey(h) : key === 'TERM' ? plainText(h).replace(/\([^)]*\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim() : h.toLowerCase();
    const same = lists[key].find((x) => x.k === k && (key !== 'DATE' || sameFact(x.tail, tail)));
    if (!same) lists[key].push({ head: h, tail, k });
    else { // the same one again: keep the fuller name and description
      if (key === 'PERSON' && h.replace(HONORIFICS, '').length > same.head.length) same.head = h;
      if (tail.length > same.tail.length) same.tail = tail;
    }
    return '';
  }).split('\n').filter((l) => !/@@/.test(l)).join('\n') // (and nothing about the markers ever reaches the student)
    .replace(/\n{3,}/g, '\n\n').trim();
}
function masterListsMd(lists) {
  const order = (x) => { const { y, m, d } = dateParts(x.head); return (y || 9999) * 10000 + (m + 1) * 100 + d; };
  const cell = (t) => String(t).replace(/\|/g, '/').replace(/\n/g, ' ').trim();
  let md = '';
  if (lists.PERSON.length) md += `**People to remember**\n\n| Person | Why they matter |\n| --- | --- |\n${lists.PERSON.map((x) => `| **${cell(x.head)}** | ${cell(x.tail)} |`).join('\n')}\n\n`;
  if (lists.DATE.length) md += `**Timeline**\n\n| Date | What happened |\n| --- | --- |\n${[...lists.DATE].sort((a, b) => order(a) - order(b)).map((x) => `| **${cell(x.head)}** | ${cell(x.tail)} |`).join('\n')}\n\n`;
  if (lists.TERM.length) md += `**Key terms: quick review**\n\n| Term | What it means |\n| --- | --- |\n${lists.TERM.map((x) => `| **${cell(x.head)}** | ${cell(x.tail)} |`).join('\n')}\n\n`;
  return md.trim();
}

// A reviewer, tidied before the student sees it: no section about the file's decorations, each point
// once, dates written one way, and no heading with nothing under it. With `lists` (the people, timeline
// and key terms gathered from the whole file), the sections' own lists of those go: they'd say it twice.
const NOTE_LISTS_RE = /^(?:key terms?(?: definitions)?|people|persons|people to remember|dates?(?: (?:&|and) (?:events|times))?|timeline(?::.*)?|every date)$/i;
const PICTURES_RE = /^(?:pictures?,? tables? (?:&|and) charts?|pictures?|visuals?|images?)$/i;
const DECOR_RE = /thank you for (?:listening|watching)|ink[- ]?splash|\bdecorative\b|background (?:graphics?|images?|texture|design)|textured (?:\w+ )?background|class rules|^\W*-\s*end\s*-\W*$/i;
function cleanReviewer(md, { lists = null } = {}) {
  const heading = (l) => { const m = l.match(/^\s*(?:#{1,4}\s+)?\*\*([^*]+?)\*\*:?\s*$/) || l.match(/^\s*#{1,4}\s+(.+?)\s*$/); return m ? m[1].replace(/:$/, '').trim() : null; };
  const seen = new Set(), out = [];
  let fence = false, skip = false;
  for (const raw of String(md).split('\n')) {
    if (/^\s*```/.test(raw)) { fence = !fence; if (!skip) out.push(raw); continue; }
    if (fence) { if (!skip) out.push(raw); continue; }
    const h = heading(raw);
    if (h) {
      skip = PICTURES_RE.test(h) || (!!lists && NOTE_LISTS_RE.test(h));
      if (!skip) out.push(raw);
      continue;
    }
    // a skipped section's own list goes; a sentence after it is the next point, so it stays
    if (skip && (!raw.trim() || /^\s*(?:[-*•]|\d+[.)]|\|)\s?/.test(raw) || /^\s{2,}\S/.test(raw))) continue;
    skip = false;
    if (DECOR_RE.test(raw)) continue;
    let line = raw.replace(/\b(Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|June?|July?|Aug(?:ust)?|Sept?(?:ember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?)\.?\s+(\d{1,2})\s*,?\s+(\d{4})\b/g, (_, mo, d, y) => `${tidyDate(`${mo} ${d} ${y}`)}`);
    // the same point twice (a bullet or a Watch out line): keep the first
    if (/^\s*(?:[-*•]|\*\*Watch out)/.test(line)) {
      const k = plainText(line).replace(/\((?:p|pp|page|slide|slides)\.?\s*[\d,\s-]+\)/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
      if (k.length > 12) { if (seen.has(k)) continue; seen.add(k); }
    }
    out.push(line);
  }
  // a heading with nothing under it (before the next heading, or at the end) goes
  const kept = [];
  for (let i = 0; i < out.length; i++) {
    if (heading(out[i]) !== null) {
      let j = i + 1;
      while (j < out.length && !out[j].trim()) j++;
      if (j >= out.length || heading(out[j]) !== null) continue;
    }
    kept.push(out[i]);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

// A part of a reviewer that ran out of room stops mid-sentence ("**Graph b"): ask once for the rest.
function looksCut(md, maxTokens) {
  const t = String(md).replace(/^\s*[-*•]?\s*@@.*$/gm, '').trimEnd();
  if (!t) return false;
  if ((t.match(/```/g) || []).length % 2) return true;
  const last = t.split('\n').pop().trim();
  if ((last.match(/\*\*/g) || []).length % 2) return true;
  if (/^\|/.test(last) && !/\|$/.test(last)) return true;
  if (/[,;(–—-]$/.test(last)) return true;
  return estimateTokens(md) >= maxTokens * 0.85 && !/[.!?)\]"'”’`|*:]$/.test(last);
}
async function finishCut(md, sys, maxTokens, waitNote) {
  if (!looksCut(md, maxTokens)) return md;
  try {
    const more = await groqChat([{ role: 'system', content: sys }, { role: 'user', content: `This part of a study guide stopped in the middle because it ran out of room:\n"""\n${String(md).slice(-2500)}\n"""\nWrite only what comes next: finish the sentence it stopped in, then the rest of that part. Don't repeat anything already written.` }],
      { maxTokens: 1500, lean: true, rotate: true, onWait: waitNote('Finishing it…') });
    if (!more || !more.trim()) return md;
    return String(md).replace(/\s+$/, '') + (/^[\s.,;:!?)]/.test(more) ? '' : ' ') + more.trim();
  } catch (e) { return md; } // (what's there is still worth having)
}

// The accuracy check: every Watch out line and every practice answer is checked against the file.
// One the file doesn't support goes (an answer takes its question with it), and mistakes in the
// file itself are listed under "Notes on your file" for the student to check with the teacher.
async function checkReviewer(md, source, waitNote, onStatus) {
  const lines = String(md).split('\n');
  const isHead = (l) => /^\s*(?:#{1,4}\s+)?\*\*[^*]+\*\*:?\s*$/.test(l);
  const headAt = (re) => lines.findIndex((l) => isHead(l) && re.test(l));
  // numbered items of a section: [{ n, from, to }] (a question can run over several lines)
  const items = (start) => {
    const out = [];
    if (start < 0) return out;
    for (let i = start + 1; i < lines.length && !isHead(lines[i]); i++) {
      const m = lines[i].match(/^\s*(\d+)[.)]\s+/);
      if (m) out.push({ n: +m[1], from: i, to: i });
      else if (out.length && lines[i].trim()) out[out.length - 1].to = i;
    }
    return out;
  };
  const qs = items(headAt(/practice questions|self-test/i)), as = items(headAt(/\*\*answers?\b/i));
  const watch = lines.map((l, i) => ({ l, i })).filter((x) => /\*\*Watch out:?\*\*/i.test(x.l));
  if (!watch.length && !as.length) return md;
  const text = (x) => lines.slice(x.from, x.to + 1).join(' ').replace(/\s+/g, ' ').trim();
  const list = [
    ...watch.map((w, k) => `W${k + 1}: ${w.l.replace(/^\s*[-*•]\s*/, '').trim()}`),
    ...as.map((a) => { const q = qs.find((x) => x.n === a.n); return `A${a.n}: ${q ? text(q) + ' ANSWER: ' : ''}${text(a)}`; }),
  ];
  onStatus('Checking it for mistakes…');
  let out = '';
  try {
    out = await groqChat([{ role: 'system', content: 'You check study guides for mistakes against the source they were made from. You are careful and brief.' },
      { role: 'user', content: `The source (a student's file, or notes taken from it):\n"""\n${String(source).slice(0, 12000)}\n"""\n\nThese lines are from a study guide made from it:\n${list.join('\n')}\n\nCheck each line against the source. For a line that is wrong, mixes things up, or says something the source does not support, write: DROP W2 (or DROP A5). Then, only if you are sure the source itself has a mistake (a misspelled name, a wrong date, a wrong fact), write: NOTE: what the file says, and what is correct. At most 5 notes. Write nothing else. If everything is right, write OK.` }],
      { maxTokens: 700, lean: true, rotate: true, onWait: waitNote('Checking it for mistakes…') });
  } catch (e) { return md; } // (no check is better than no reviewer)
  const drops = new Set([...String(out).matchAll(/DROP\s+([WA])\s*(\d+)/gi)].map((m) => m[1].toUpperCase() + m[2]));
  const notes = [...String(out).matchAll(/^\s*[-*•]?\s*NOTE:\s*(.{10,300})$/gim)].map((m) => m[1].trim()).slice(0, 5);
  // a check that throws out most of the guide is the check going wrong, not the guide
  if (drops.size > Math.max(2, (watch.length + as.length) * 0.6)) drops.clear();
  const gone = new Set();
  watch.forEach((w, k) => { if (drops.has(`W${k + 1}`)) gone.add(w.i); });
  as.forEach((a) => {
    if (!drops.has(`A${a.n}`)) return;
    for (let i = a.from; i <= a.to; i++) gone.add(i);
    const q = qs.find((x) => x.n === a.n);
    if (q) for (let i = q.from; i <= q.to; i++) gone.add(i);
  });
  let kept = lines.filter((_, i) => !gone.has(i));
  if (gone.size) { // number what's left 1, 2, 3… again (questions and answers alike)
    let n = 0, inList = false;
    kept = kept.map((l) => {
      if (isHead(l)) { inList = /practice questions|self-test|\*\*answers?\b/i.test(l); n = 0; return l; }
      return inList ? l.replace(/^(\s*)\d+([.)]\s+)/, (_, sp, p) => `${sp}${++n}${p}`) : l;
    });
  }
  let result = kept.join('\n');
  if (notes.length) {
    const box = `**Notes on your file**\n${notes.map((x) => `- ${x}`).join('\n')}\n- If one of these comes up on a test, follow your teacher's version.`;
    const at = result.search(/^\s*\*\*Practice questions\*\*/im);
    result = at > -1 ? `${result.slice(0, at)}${box}\n\n${result.slice(at)}` : `${result}\n\n${box}`;
  }
  return result;
}
// a reviewer, finished: tidied, then checked against the file
async function polishReviewer(md, source, waitNote, onStatus, lists) {
  return checkReviewer(cleanReviewer(md, { lists }), source, waitNote, onStatus);
}

// notesOnly: notes of one file for a reviewer of several (never a reviewer of its own: that one is written once, from all of them)
async function groqDocument(doc, request, history, onStatus, { notesOnly = false } = {}) {
  const sys = leanDocSystem();
  const waitNote = (label) => (secs) => onStatus(`${label} (free per-minute limit: continuing in ${secs}s)`);
  const whole = WHOLE_FILE_RE.test(request) || wantsStudyFile(request);
  const reviewer = whole && !notesOnly;
  const text = pagesAskedFor(doc.text || '', request);
  const visualNotes = doc.hasVisuals ? await pictureNotes(doc, onStatus, waitNote) : [];
  if (!text && !visualNotes.length) {
    throw friendlyError(CassieErrors.say('scanned_file', { name: doc.name }));
  }
  const hist = compactHistory(history, 800);

  // A short file: read it all in one go.
  const visualAll = visualNotes.join('\n\n');
  if (estimateTokens(text) <= 3800 && visualAll.length < 6000) {
    onStatus(`Reading ${doc.name}…`);
    try {
      const reply = await groqChat([{ role: 'system', content: sys }, ...hist,
        { role: 'user', content: `File "${doc.name}": a ${KIND_WORD[doc.kind] || 'file'} (${doc.label}):\n"""\n${text}\n"""${visualAll ? `\n\nNotes on the pictures and pages in the file:\n${visualAll}` : ''}\n\n${request}` }],
        { maxTokens: 3500, lean: true, rotate: true, onWait: waitNote('Reading…') });
      if (reply && reviewer) return polishReviewer(await finishCut(reply, sys, 3500, waitNote), `${text}\n\n${visualAll}`, waitNote, onStatus);
      if (reply) return reply;
    } catch (e) { if (!e.tooLarge) throw e; /* fall through to reading in parts */ }
  }

  // A long file: careful notes on every part, in order.
  let parts = text ? splitChunks(text, GROQ_DOC_PART) : [];
  const truncated = parts.length > GROQ_DOC_MAX_PARTS;
  if (truncated) parts = parts.slice(0, GROQ_DOC_MAX_PARTS);
  const NOTE_SYS = `You take complete, accurate study notes from one part of a student's file.\n${NOTES_GUIDE}\nBullets only, no intro. Be thorough: usually 250 to 500 words, more if the part is dense.`;
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
  if (doc.preNoted) notes.push(...parts); // (already notes, from each file: never notes of notes)
  else for (let i = 0; i < parts.length; i++) {
    span = partSpan(parts[i], span);
    onStatus(`Reading ${span} of ${doc.name}: part ${i + 1} of ${parts.length}…`);
    notes.push(`[${span.replace(/^\w/, (c) => c.toUpperCase())}]\n${await noteFor(parts[i], span.replace(/^\w/, (c) => c.toUpperCase()))}`);
  }
  notes.push(...visualNotes);
  // picture notes slot in by page, so everything reads in the file's order
  const firstNum = (n) => { const m = n.match(/^\[(?:Pages?|Slides?) (\d+)/i); return m ? +m[1] : Infinity; };
  notes.sort((x, y) => firstNum(x) - firstNum(y));
  const tail = truncated ? `\n\n*This file is very long, so I read the first ${GROQ_DOC_MAX_PARTS} parts. Add your free Gemini key in Settings and I'll read the whole file, pictures included, in one go.*` : '';
  if (notesOnly) return notes.join('\n\n') + tail;

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
    const one = await finishCut(await finalFrom(notes, `${request}\n\nCover every note above. ${REVIEWER_TAIL}`, 3500), sys, 3500, waitNote);
    return (await polishReviewer(one, notes.join('\n\n'), waitNote, onStatus)) + tail;
  }
  const lists = { PERSON: [], DATE: [], TERM: [] };
  const sections = [];
  const writeSection = async (group, i, n, depth = 0) => {
    const where = groupSpan(group) || `section ${i + 1}`;
    onStatus(`Writing it up: ${where} (section ${i + 1} of ${n})…`);
    try {
      return await groqChat([{ role: 'system', content: sys },
        { role: 'user', content: `Study notes from ${where} of "${doc.name}" (section ${i + 1} of ${n}):\n"""\n${group.join('\n\n')}\n"""\n\nThe student asked: ${request}\n\nWrite ONLY this part of the reviewer, following steps 3 to 5 of the guide: a bold heading for each topic, named after the topic; explain it, then the details; key terms in bold; the examples (code exactly, in code blocks, with what it prints); **Watch out:** lines. Cover every note above, in order, and keep every name, date, number, formula and code example. The notes are sorted under labels (Key terms, Ideas, People, Dates & events, Places, Pictures…): those labels are NOT headings, so organise by topic and write each fact once. Don't write lists of people, dates or key terms here (the @@ lines below collect them), and no section about the file's pictures: say what a diagram shows inside its topic. No big picture, no quick review and no practice questions (those come at the end).\nThen, after it, add one line for every key term, and for every real person and every date in these notes (none for names used in examples), exactly like this:\n@@TERM: term - what it means\n@@PERSON: full name - who they are / what they did\n@@DATE: date or time - what happened\nWrite no other line with @@ in it, and none for a kind this part doesn't have.` }],
        { maxTokens: 3200, lean: true, rotate: true, onWait: waitNote(`Writing ${where}…`) }).then((md) => finishCut(md, sys, 3200, waitNote));
    } catch (e) {
      if (!e.tooLarge || depth >= 1 || group.length < 2) throw e;
      const half = Math.ceil(group.length / 2);
      return `${await writeSection(group.slice(0, half), i, n, depth + 1)}\n\n${await writeSection(group.slice(half), i, n, depth + 1)}`;
    }
  };
  for (let i = 0; i < groups.length; i++) {
    sections.push(takeMasterLines(await writeSection(groups[i], i, groups.length), lists)); // (its topics are its headings)
  }
  const master = masterListsMd(lists);
  let questions = '', big = '', title = '';
  try {
    onStatus('Writing practice questions…');
    const whole = sections.join('\n\n').slice(0, 12000);
    let out = await groqChat([{ role: 'system', content: sys },
      { role: 'user', content: `The reviewer of all of "${doc.name}":\n"""\n${whole}\n"""\n\nWrite three things. First one line: TITLE: the subject and its topics, like "Readings in Philippine History: The Birth of a Nation" (never the file's name). Then **The big picture**: 2 to 4 sentences on what this file is about and why it matters. Then **Practice questions** that cover the whole file, following step 7 of the guide: 10 questions, mixed, with at least 4 that make the student use the ideas (what does this code print, find the bug, solve this problem, explain why), never about names used in examples or page numbers; then **Answers**, each with one short line on why.` }],
      { maxTokens: 2000, lean: true, rotate: true, onWait: waitNote('Writing practice questions…') });
    const named = out.match(/^\s*\**\s*TITLE\s*:?\**\s*:?\s*(.+)$/im);
    if (named) { title = named[1].replace(/\*\*/g, '').replace(/^["“]|["”]$/g, '').trim(); out = out.replace(named[0], ''); }
    const at = out.search(/\*\*Practice questions\*\*/i);
    if (at > 0) { big = out.slice(0, at).trim(); questions = out.slice(at).trim(); } else questions = `**Practice questions**\n\n${out.trim()}`;
    if (big && !/big picture/i.test(big)) big = `**The big picture**\n${big}`;
  } catch (e) { /* the reviewer is still complete without them */ }
  const pagesNote = doc.pages ? `, all ${doc.pages} pages` : '';
  const head = `**${title || doc.title || doc.name.replace(/\.[a-z0-9]{2,5}$/i, '')}**\n\n*From ${doc.from || doc.name}${pagesNote}*`;
  const body = cleanReviewer(sections.join('\n\n'), { lists }); // (the sections' own lists go: the master lists have them all, once)
  return (await checkReviewer([head, big, body, master, questions].filter(Boolean).join('\n\n'), notes.join('\n\n'), waitNote, onStatus)) + tail;
}

/* Several photos and files at once. Each photo is read on its own — every word copied out
   exactly, every diagram described, then notes of what matters — and each file goes through the
   usual whole-file reading. Their notes become one combined "file" (marked photo by photo,
   file by file) that Cassie answers from, so nothing from photo 9 is lost behind photo 1. */
const PHOTO_READ = (k, n, name) => `This is photo ${k} of ${n} that I attached${name ? ` ("${name}")` : ''}. Read it carefully and completely, then answer in three parts:
**Text in the photo**: copy out EVERY word exactly as written (printed or handwritten), in reading order: headings, paragraphs, lists, questions with all of their answer choices, labels, captions, table cells, formulas and numbers. Don't summarise or correct anything; write [unclear] for a word you can't read.
**Pictures**: every diagram, chart, table, map or drawing: what it shows, with every label and value you can read.
**Notes**: ${NOTES_GUIDE}
Never add anything that isn't in the photo. If part of it is blurry or cut off, say which part.`;
async function readPhoto(image, prompt) {
  const msgs = [{ role: 'user', content: prompt }];
  if (SERVER && serverClaude) { try { return await askClaudeViaServer(msgs, [image], {}); } catch (e) { /* the usual picture readers */ } }
  return askPicture(msgs, image, {});
}
async function answerAboutMany(items, request, history, onStatus) {
  const photos = items.filter((a) => a.kind === 'image'), files = items.filter((a) => a.kind === 'doc');
  const parts = new Array(items.length);
  // photos: three at a time (quick, and kind to the free per-minute limits), kept in order
  let done = 0;
  const queue = photos.map((a) => ({ a, k: photos.indexOf(a) + 1 }));
  const worker = async () => {
    for (let job = queue.shift(); job; job = queue.shift()) {
      let notes = '';
      try { notes = await readPhoto(job.a.image, PHOTO_READ(job.k, photos.length, job.a.name)); }
      catch (e) { notes = `(I couldn’t read this photo: ${errorText(e) || 'try it again on its own'}.)`; }
      parts[items.indexOf(job.a)] = `=== Photo ${job.k} of ${photos.length}${job.a.name ? ` (${job.a.name})` : ''} ===\n${notes}`;
      onStatus(`Read ${++done} of ${photos.length} photo${photos.length === 1 ? '' : 's'}…`);
    }
  };
  if (photos.length) { onStatus(`Reading ${photos.length} photo${photos.length === 1 ? '' : 's'}…`); await Promise.all([worker(), worker(), worker()]); }
  // files: short text files go in word for word; long or scanned ones are read into full notes
  for (let i = 0; i < files.length; i++) {
    const d = files[i].doc, k = i + 1, head = `=== File ${k} of ${files.length}: ${d.name} (${d.label}) ===`;
    let body;
    if (d.text && d.text.length <= 14000 && !d.hasVisuals && !d.scanned) body = d.text;
    else body = await readDocumentAnswer(d, `Take complete, accurate study notes of this WHOLE file, in its order. ${NOTES_GUIDE}`, [], (m) => onStatus(`File ${k} of ${files.length} (${d.name}): ${m}`), { notesOnly: true });
    parts[items.indexOf(files[i])] = `${head}\n${body}`;
  }
  const label = [photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : '', files.length ? `${files.length} file${files.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  const from = [...files.map((f) => f.doc.name), photos.length ? `${photos.length} photo${photos.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(', ');
  const doc = { name: `your ${label}`, title: 'Reviewer', from, kind: 'txt', label, text: parts.filter(Boolean).join('\n\n'), hasVisuals: false, scanned: false, combined: true, preNoted: true };
  onStatus('Putting it all together…');
  const reply = await answerAboutDocument(doc, `${request}\n\n(This content comes from ${label}, each marked with === headers. Use all of them: don't skip any. When it helps, say where a fact is from, like "(photo 3)" or "(${files[0] ? files[0].doc.name : 'the file'}, p. 4)".)`, history, onStatus);
  return { reply, doc };
}

async function answerAboutDocument(doc, request, history, onStatus) {
  try { return await readDocumentAnswer(doc, request, history, onStatus); }
  catch (e) {
    if (!e.tooLarge) throw e;
    throw friendlyError(CassieErrors.say('file_too_big', { name: doc.name }));
  }
}
async function readDocumentAnswer(doc, request, history, onStatus, opts = {}) {
  if (state.geminiKey) {
    try {
      const out = await geminiDocument(doc, request, history, onStatus);
      return !opts.notesOnly && (WHOLE_FILE_RE.test(request) || wantsStudyFile(request)) ? cleanReviewer(out) : out;
    }
    catch (e) {
      if (!canChat() || geminiOnly()) throw e;
      onStatus('Gemini is busy, reading it another way…');
    }
  }
  if (!canChat()) throw new Error('Add your Groq API key in Settings first.');
  return groqDocument(doc, request, history, onStatus, opts);
}

/* ---------- upload / download / image + document helpers ---------- */
/* What's attached to the next message: up to 15 photos and 5 files, read in the order they
   were added. Each is { id, kind: 'image' | 'doc', name, status: 'reading' | 'ready' | 'error',
   image: { mimeType, base64, dataUrl } | doc: { name, text, … }, note: what the chip says }. */
const MAX_PHOTOS = 15, MAX_FILES = 5;
let attachments = [];
let attachError = '';      // why the last file couldn't be attached
const readyOf = (kind) => attachments.filter((a) => a.kind === kind && a.status === 'ready');
const readyImages = () => readyOf('image').map((a) => ({ ...a.image, name: a.name }));
const readyDocs = () => readyOf('doc').map((a) => a.doc);
function renderAttachments() {
  attachPreview.hidden = !attachments.length;
  attachStrip.replaceChildren(...attachments.map((a) => {
    const chip = document.createElement('div');
    chip.className = `att att-${a.kind} att-${a.status}`; chip.dataset.id = a.id; chip.title = a.note || a.name;
    if (a.kind === 'image' && a.image && a.image.dataUrl) { const img = document.createElement('img'); img.src = a.image.dataUrl; img.alt = a.name || 'attached photo'; chip.appendChild(img); }
    else { const t = document.createElement('span'); t.className = 'att-name'; t.textContent = a.note || a.name; chip.appendChild(t); }
    if (a.kind === 'doc' && a.status === 'ready' && a.doc && a.doc.text) {
      const r = document.createElement('button'); r.type = 'button'; r.className = 'att-read'; r.textContent = '📖'; r.title = `Read ${a.name} here and highlight any part`; r.setAttribute('aria-label', r.title); chip.appendChild(r);
    }
    const x = document.createElement('button'); x.type = 'button'; x.className = 'att-x'; x.textContent = '×'; x.setAttribute('aria-label', `Remove ${a.name || 'attachment'}`); chip.appendChild(x);
    return chip;
  }));
  const nI = readyOf('image').length, nD = readyOf('doc').length, busy = attachments.some((a) => a.status === 'reading');
  attachCount.textContent = [nI ? `${nI} photo${nI === 1 ? '' : 's'}` : '', nD ? `${nD} file${nD === 1 ? '' : 's'}` : '', busy ? 'reading…' : ''].filter(Boolean).join(' · ');
}
attachStrip.addEventListener('click', (e) => {
  const chip = e.target.closest('.att'); if (!chip) return;
  const a = attachments.find((x) => x.id === chip.dataset.id); if (!a) return;
  if (e.target.closest('.att-read')) { openReader(a.doc); return; }
  if (e.target.closest('.att-x')) { attachments = attachments.filter((x) => x !== a); renderAttachments(); }
});
function addAttachment(a) { a.id = 'a' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); attachments.push(a); renderAttachments(); return a; }
function clearAttach() {
  attachments = []; attachError = '';
  renderAttachments();
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

// File readers live on Cassie's own site (vendor/), pinned to patched versions — nothing is
// loaded from a third-party CDN, so a hacked CDN can't slip code into the app.
const MAMMOTH_URL = 'vendor/mammoth.browser.min.js';
const JSZIP_URL = 'vendor/jszip.min.js';
const DOC_TEXT_CAP = 400000; // characters of extracted text we keep (long files are read in parts)
// pdf.js 4.10 (legacy build, for older phones). isEvalSupported: false switches off the font
// code that a booby-trapped PDF could abuse to run JavaScript (CVE-2024-4367).
let pdfjsReady = null;
function loadPdfJs() {
  if (!pdfjsReady) pdfjsReady = import('./vendor/pdf.min.mjs').then((m) => { m.GlobalWorkerOptions.workerSrc = new URL('vendor/pdf.worker.min.mjs', document.baseURI).href; return m; }).catch((e) => { pdfjsReady = null; throw e; });
  return pdfjsReady;
}
const openPdf = async (data) => (await loadPdfJs()).getDocument({ data, isEvalSupported: false }).promise;

// Returns { text, numPages, visualPages } — visualPages are pages holding
// pictures/figures or almost no text (scanned), so they can be looked at too.
async function extractPdf(file) {
  const pdfjs = await loadPdfJs();
  const data = await file.arrayBuffer();
  const pdf = await openPdf(data);
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
    if (raw) { const s = JSON.parse(raw); delete s.groqKey; delete s.geminiKey; delete s.apiKey; backup.state = s; }
  } catch (e) { /* ignore */ }
  const stamp = new Date().toISOString().slice(0, 10);
  downloadBlob(`cassie-backup-${stamp}.json`, new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' }));
}
function importBackupFile(file) {
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    let data;
    try { data = JSON.parse(reader.result); } catch (e) { alert('That file isn’t valid JSON. It may be corrupted.'); return; }
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
  // ＋ Flashcards: Cassie turns this answer into cards for spaced-repetition study
  if (window.CassieCards && text.length > 120) {
    const fcBtn = document.createElement('button');
    fcBtn.type = 'button';
    fcBtn.className = 'fc-make';
    fcBtn.textContent = '＋ Flashcards';
    fcBtn.addEventListener('click', async () => {
      if (fcBtn.disabled) return;
      if (fcBtn.dataset.deck) { window.CassieCards.open(fcBtn.dataset.deck); return; }
      fcBtn.disabled = true; fcBtn.textContent = 'Making cards…';
      try {
        const chat = curChat();
        const deck = (title || (chat && chat.title) || 'My cards').replace(/^(New chat|Chat)$/i, 'My cards').slice(0, 60);
        const r = await window.CassieCards.fromText(text, deck);
        fcBtn.dataset.deck = r.deck;
        fcBtn.textContent = r.added ? `✓ ${r.added} cards: Study` : '✓ Already cards: Study';
      } catch (e) {
        fcBtn.textContent = 'Try again'; mascotSay(CassieErrors.say('cards_failed'), 5000);
        setTimeout(() => { fcBtn.textContent = '＋ Flashcards'; }, 2600);
      } finally { fcBtn.disabled = false; }
    });
    tools.appendChild(fcBtn);
  }
  // Podcast: Jessica and Chris talk it through (a reviewer or notes long enough to talk about)
  if (text.length > 600) {
    const pod = document.createElement('button');
    pod.type = 'button'; pod.className = 'pod-make'; pod.textContent = 'Podcast';
    pod.setAttribute('aria-label', 'Make a podcast of this: two voices talk it through');
    pod.addEventListener('click', () => openPodcast(text, title || (curChat() && curChat().title) || 'Your notes'));
    tools.appendChild(pod);
  }
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
  const saveGroup = document.createElement('span'); // "Save as" and its formats wrap together
  saveGroup.className = 'save-group';
  saveGroup.appendChild(label);
  tools.appendChild(saveGroup);
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
        alert(CassieErrors.say('file_failed', { label: f.label }));
      } finally {
        setTimeout(() => { btn.textContent = f.label; btn.disabled = false; }, 1600);
      }
    });
    saveGroup.appendChild(btn);
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
  }).catch(() => { small.textContent = CassieErrors.say('file_failed_saveas'); });
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
  let eq = equationIn(question) || B.findEquation(reply);
  for (let i = state.messages.length - 1; !eq && i >= 0 && i >= state.messages.length - 8; i--) eq = equationIn(state.messages[i].display || state.messages[i].content);
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
function errorText(err, fallback = 'unknown') { return CassieErrors.explain(err, fallback); }
let autoReports = 0;
// Only which message it was ("file_kind", "network") is reported, never its words: they can hold a
// file's name or a service's reply. (The server keeps nothing else either.)
function messageKey(message) {
  const m = String(message || '');
  const all = (window.CassieErrors && window.CassieErrors.STRINGS) || {};
  for (const [key, words] of Object.entries(all)) {
    const re = new RegExp('^' + words.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\\?\{\w+\\?\}/g, '[\\s\\S]*') + '$');
    if (re.test(m.trim())) return key;
  }
  return 'other';
}
function reportAuto(where, message) {
  // only with usage counts on, and never for under-13s (like the counts themselves)
  const an = state.analytics;
  if (!an || an.usage === false || (state.profile && state.profile.age < 13)) return;
  if (autoReports++ >= 5) return; // a handful per visit at most
  try { sendFeedback('auto', where, messageKey(message)); } catch (e) { /* best effort */ }
}
function renderError(err, retry, prefix) {
  reportAuto('chat', String((err && err.message) || err || '').slice(0, 300));
  const busyErr = /limit|busy|wait/i.test(errorText(err, prefix));
  botMood(busyErr ? 'busy' : 'oops', 3000);
  islandErrUntil = Date.now() + 3000;
  islandShow(busyErr ? 'busy' : 'oops', busyErr ? 'Very busy. Try again soon' : 'That didn’t work', 3000);
  const b = renderMessage('assistant', errorText(err, prefix));
  b.classList.add('error');
  // out of today's free questions: the way to keep going, right here
  if (err && err.dailyFree) {
    const go = document.createElement('button');
    go.type = 'button'; go.className = 'fu-chip early-chip';
    go.textContent = 'Keep going with the Pasado Pass';
    go.addEventListener('click', () => plusSheet('More questions today', 'You’ve used today’s free questions. The Pasado Pass gives you 100 a day until your exam.', 'limit'));
    b.appendChild(go);
    return b;
  }
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
    progressMark(!/missed/i.test(kind), !/missed/i.test(kind) && i >= 0);
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
  if (!list.length) {
    const b = renderMessage('assistant', '');
    b.appendChild(CassieErrors.empty({ title: 'No mistakes to review', text: 'Nice! Questions you miss in a quiz come back here, so you can practise them again.', action: 'Start a quiz', onAction: () => { b.remove(); document.getElementById('quiz-btn')?.click(); } }));
    return;
  }
  if (!canChat()) { openSettings(); return; }
  track('feature', 'review');
  quizMode = true; quizStarted();
  if (quizBtn) quizBtn.classList.add('active');
  setQuizLabel('Stop quiz');
  dressCassie();
  const qs = list.map((m, k) => `${k + 1}. ${m.q}${m.a ? ` (correct answer: ${m.a})` : ''}`).join('\n');
  handleSend(`Let's review the quiz questions I got wrong before. Ask them one at a time (you may reword them slightly), wait for my answer, then grade it:\n${qs}`);
}

async function handleSend(text, opts = {}) {
  // photos and files still being read: Send waits for them, so nothing is left behind
  const stillReading = attachments.filter((a) => a.status === 'reading').map((a) => a.done);
  if (stillReading.length) {
    sendBtn.disabled = true;
    try { await Promise.all(stillReading); } finally { sendBtn.disabled = false; }
  }
  // a question typed under a share card is about what was shared
  if (sharedText && chatLog.querySelector('.share-card') && text.trim() && !text.includes(sharedText.slice(0, 40))) {
    text = withNote(sharedText, text.trim());
    chatLog.querySelector('.share-card').remove();
  }
  sharedText = chatLog.querySelector('.share-card') ? sharedText : '';
  // one photo → Cassie looks at it; one file → she reads it; more than one → each is read
  // carefully on its own, then she answers from all of them together
  const sentItems = attachments.filter((a) => a.status === 'ready');
  const images = readyImages(), docs = readyDocs(), many = images.length + docs.length > 1;
  const image = !many && images.length ? images[0] : null;
  const attachedDoc = !many && docs.length ? docs[0] : null;
  // the newest photo the student sent: "a photo of the answer" redraws it with the answer marked on it
  if (images.length && images[0].base64 && /image\/(jpeg|png|webp)/.test(images[0].mimeType || '')) lastPhoto = { chatId: state.currentId, url: `data:${images[0].mimeType};base64,${images[0].base64}` };
  let doc = attachedDoc;
  if (!text.trim() && !images.length && !docs.length) return;
  if (!doc && !image && !many && activeDoc && activeDoc.chatId === state.currentId && DOC_FOLLOWUP_RE.test(text)) doc = activeDoc.doc;
  if (!images.length && !docs.length && !opts.mode) {
    const pic = imageRequest(text);
    if (pic) return handleImageRequest(text, pic.subject);
  }

  const needKey = (image || doc || many) ? !(state.geminiKey || canChat()) : !canChat();
  if (needKey) {
    openSettings();
    detourToElement(geminiKeyInput, { click: true, resumeAfter: 1200 }); // one Google key covers everything
    // Show the reminder only once — don't stack a new bubble on every send.
    const prev = chatLog.querySelector('.need-key-msg');
    if (prev) prev.remove();
    const b = renderMessage('assistant', image
      ? "To read an image I need your free Google (Gemini) API key. Add it in Settings (top right)."
      : "I need one free key to start. The easiest is Google's: go to **aistudio.google.com/apikey**, sign in with your Google account, tap **Create API key**, and paste it in Settings. It takes about a minute, and that one key covers everything.");
    if (b) b.classList.add('need-key-msg');
    return;
  }

  let sendText = text.trim();
  if (!sendText && image) sendText = 'Please look at this image and help me with it. If it has questions or a lesson on it, read all of it carefully.';
  if (!sendText && doc) sendText = 'Please read this file and make me a complete reviewer of it.';
  if (!sendText && many) sendText = docs.length ? 'Please read all of these carefully and make me one complete reviewer of everything in them.' : 'Please read all of these photos carefully. If they have questions, answer every one; if they are notes or a lesson, make me a complete reviewer of everything in them.';

  clearFollowups();
  // if the home screen is showing, clear it before the first message (a computer's next empty chat is Home again)
  if (!state.messages.length) { chatLog.innerHTML = ''; setDeskPage('chat'); }
  // A document is read separately; history only keeps a short note + excerpt,
  // so later questions don't blow past the free per-minute limits.
  let modelContent = sendText;
  let displayContent = sendText;
  if (attachedDoc) {
    const excerpt = doc.text ? `\n\n(Excerpt from the start of the file:)\n${doc.text.slice(0, 1200)}` : '';
    modelContent = `[I attached the file "${doc.name}": a ${KIND_WORD[doc.kind] || 'file'}, ${doc.label}.] ${sendText}${excerpt}`;
    displayContent = `${sendText}\n\n(attached: ${doc.name} - ${doc.label})`;
  }
  const manyLabel = [images.length ? `${images.length} photo${images.length === 1 ? '' : 's'}` : '', docs.length ? `${docs.length} file${docs.length === 1 ? '' : 's'}` : ''].filter(Boolean).join(' and ');
  if (many) {
    modelContent = `[I attached ${manyLabel}: ${sentItems.map((a) => a.name).join(', ')}.] ${sendText}`;
    displayContent = `${sendText}\n\n(attached: ${docs.length ? docs.map((d) => d.name).join(', ') + (images.length ? ' + ' : '') : ''}${images.length ? `${images.length} photo${images.length === 1 ? '' : 's'}` : ''})`;
  }
  const history = state.messages.slice();
  const userMsg = { role: 'user', content: modelContent };
  if (attachedDoc || many) userMsg.display = displayContent;
  state.messages.push(userMsg);
  touchChat();
  save();
  if (doc) activeDoc = { chatId: state.currentId, doc };
  const userBubble = renderMessage('user', displayContent);
  images.forEach((im) => { if (im.dataUrl) addImageToBubble(userBubble, im.dataUrl); });
  if (images.length > 1) userBubble.classList.add('many-imgs'); // a neat grid of small photos
  clearAttach();
  promptInput.value = '';
  promptInput.placeholder = 'Ask Cassie a question…';
  autoGrow();
  taskOutfit = null;
  dressCassie();
  // Safety first: a student who says they want to hurt or kill themselves gets care before
  // anything else. No AI is asked, and nothing of it is remembered, tracked or counted as a topic
  // (the dashboard counts care with no words and no id).
  const careHit = window.CassieCare && window.CassieCare.check(text);
  if (careHit) { giveCare(careHit.lang); return; }

  const featureName = many ? 'files:many' : doc ? 'file:' + (doc.kind || 'file') : image ? 'photo' : counselorMode ? 'talk' : quizMode ? 'quiz' : opts.mode === 'hint' ? 'hint' : 'chat';
  track('feature', featureName);
  if (!doc && !image && !many) trackWords(sendText);
  mascotOnSend(sendText); // Cassie reacts/comments on what you sent
  // remember what the student is studying + any explicit "remember ..." note
  try {
    if (window.CassieMemory) {
      window.CassieMemory.maybeRememberFrom(sendText);
      window.CassieMemory.recordQuestion(sendText);
    }
  } catch (e) { /* ignore */ }
  progressAdd({ asked: 1 }); // (a day you asked Cassie something is a day you studied)

  setCursorMode('thinking');
  if (doc || many) botMood('reading');
  const typingBubble = renderTyping();
  sendBtn.disabled = true;
  const onWait = (secs) => { setTypingStatus(typingBubble, `Groq's free per-minute limit: continuing in ${secs}s…`); botMood('busy'); };

  try {
    let reply;
    if (many) {
      const out = await answerAboutMany(sentItems, sendText, history, (msg) => setTypingStatus(typingBubble, msg));
      reply = out.reply; doc = out.doc;
      activeDoc = { chatId: state.currentId, doc }; // follow-up questions are about all of them
    } else reply = doc
      ? await answerAboutDocument(doc, sendText, history, (msg) => setTypingStatus(typingBubble, msg))
      : await askCassie(state.messages, image, { tutor: true, mode: opts.mode, onWait, onDelta: opts.onDelta });
    reply = captureQuizMarks(reply); // saves missed quiz questions for "Review my mistakes"
    if (!reply) throw friendlyError('I went blank on that one. Please ask again.');
    // the AI's own judgement: it saw a student at risk that the word list didn't
    const careAI = window.CassieCare && window.CassieCare.fromAI(reply);
    if (careAI) { wordQ.length = 0; typingBubble.remove(); giveCare(window.CassieCare.langOf(sendText), careAI.aiWords); return; } // (and no topic words go out)
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
    // a reviewer that starts with its own title ("Readings in Philippine History") is saved under it, not the file's name
    const top = (reply.match(/^\s*\*\*([^*\n]{3,90})\*\*\s*\n/) || [])[1];
    const base = doc ? (top && !/big picture/i.test(top) ? top.replace(/^reviewer:?\s*/i, '') : doc.name.replace(/\.[^.]+$/, '')) : '';
    const title = doc
      ? (/review/i.test(sendText) ? `Reviewer: ${base}` : `${base}: notes`)
      : '';
    const want = window.CassieExport ? (window.CassieExport.wantedFormat(sendText) || (wantsStudyFile(sendText) && looksLikeContent(reply) ? 'docx' : '')) : '';
    addTextDownload(bubble, reply, { title, want });
    if (doc && doc.text && !doc.combined) { // open the file itself to read it and highlight any part
      const rb = document.createElement('button');
      rb.type = 'button'; rb.className = 'attach-read reader-open-btn'; rb.textContent = `📖 Read & highlight ${doc.name.length > 28 ? doc.name.slice(0, 28) + '…' : doc.name}`;
      rb.addEventListener('click', () => openReader(doc));
      bubble.appendChild(rb);
    }
    if (!doc && !image) webChip(bubble, sendText, reply);
    showFollowups();
    saveOffer(bubble);
    setCursorMode('idle');
    mascotCelebrate();
    maybeCelebrate(reply); // confetti if she's praising a correct answer
    try { if (window.CassieMemory) { window.CassieMemory.scanExchange(sendText, reply); updateMemoryDot(); } } catch (e) { /* ignore */ }
    detourToElement(bubble, { click: true, resumeAfter: 900 });
    speak(reply);
  } catch (err) {
    typingBubble.remove();
    const offline = !image && !doc && graphWithoutBrain(sendText);
    if (offline) { // the graph still comes, drawn here without the AI
      renderMessage('assistant', offline);
      state.messages.push({ role: 'assistant', content: offline });
      touchChat(); save(); setCursorMode('idle');
      reportAuto('chat: graph without AI', errorText(err));
      return;
    }
    const again = !image && text.trim() ? () => handleSend(takeBackLastQuestion(text), opts) : null;
    renderError(err, again);
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------- image generation (Gemini) ---------- */
// Try these image models in order — if one is off on the free tier, fall back.
const GEMINI_IMAGE_MODELS = ['gemini-3.1-flash-image-preview', GEMINI_IMAGE_MODEL, 'gemini-2.0-flash-preview-image-generation'];
const geminiImageGone = new Set(); // models this key can't use (asked once, then skipped)

async function tryGenerateImage(prompt, model) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': state.geminiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: picturePrompt(prompt) }] }],
      // a low temperature keeps it literal: what a camera would really see, not the model's own flourishes
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], temperature: 0.35, ...(/2\.0/.test(model) ? {} : { imageConfig: { aspectRatio: '4:3' } }) },
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
  if (!imgPart) throw new Error('no image came back. Try describing it differently');
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
    if (geminiImageGone.has(model)) continue;
    try { return await tryGenerateImage(prompt, model); } catch (e) {
      lastErr = e;
      if (e.status === 404) geminiImageGone.add(model);
      if (e.quota || e.notAvailable) continue;
      throw e;
    }
  }
  geminiImageOff = true;
  throw lastErr || new Error('image generation is off for this key');
}
// Style follows the request. The student's own style words (cartoon, anime, poster…) win, and labelled
// diagrams stay clean diagrams. Everything else is a real photograph: described the way a photographer
// would (camera, lens, light, film, framing) with what to avoid spelled out, never "hyperrealistic,
// stunning, 8k" — those words are what make pictures look plastic and computer-made.
const ART_STYLE_RE = /\b(cartoon|anime|chibi|pixel|clipart|clip art|watercolou?r|sketch|line art|3d render|illustration|drawing|painting|logo|icon|sticker|poster|wallpaper|comic|kawaii|vector|emoji|meme)\b/i;
const DIAGRAM_RE = /\b(diagram|labell?ed|parts of|cross[- ]section|infographic|chart|cycle|anatomy|structure|timeline|map of|flow ?chart|steps of)\b/i;
function imageKind(subject) {
  const s = String(subject || '');
  if (ART_STYLE_RE.test(s)) return 'art';
  if (DIAGRAM_RE.test(s)) return 'diagram';
  return 'photo';
}
// how a photographer would really take it
function photoSetup(s) {
  if (/\b(cells?|bacteri\w*|virus\w*|microb\w*|amoeba|paramecium|pollen|chromosomes?|tissue|blood cells?|plankton|algae|mitosis|under a microscope)\b/i.test(s))
    return ['light micrograph through a laboratory microscope, 40x objective, stained glass slide', 'even transmitted light from below, slight chromatic fringing at the edges', 'circular field of view, shallow focal plane, a few out-of-focus particles'];
  if (/\b(planets?|moon|mars|jupiter|saturn|venus|mercury|neptune|uranus|galax\w*|nebula\w*|stars?|comet|eclipse|milky way|solar system|asteroid|space|orbit|astronaut)\b/i.test(s))
    return ['astrophotograph from a spacecraft camera or a telescope with a cooled sensor, long exposure', 'single hard light from the Sun, true black sky, no glow added', 'faint sensor noise in the shadows, natural colour as the eye would see it'];
  if (/\b(insects?|bugs?|ants?|bees?|butterfl\w*|spiders?|flowers?|leaf|leaves|seeds?|mushrooms?|fungi|moss|crystals?|minerals?|rocks?|snowflakes?|feathers?|beetle|ladybug|dragonfly|frog)\b/i.test(s))
    return ['macro photograph, full-frame camera, 100mm f/2.8 macro lens at f/8', 'soft overcast daylight with a small reflector fill', 'real fine texture (hairs, pores, veins, dust), shallow depth of field, close candid framing'];
  if (/\b(mountains?|volcano\w*|rivers?|lakes?|oceans?|seas?|beach\w*|forests?|jungle|desert|glacier|canyon|waterfall|landscape|city|cities|skyline|village|farm|field|rice terraces?|island|coral reef|weather|storm|tornado|clouds?|sunset|sunrise)\b/i.test(s))
    return ['landscape photograph, full-frame camera, 24mm f/8 lens on a tripod', 'natural light at golden hour, soft directional shadows, a little atmospheric haze', 'Kodak Ektar 100 colour, fine grain, eye-level horizon, nothing staged'];
  if (/\b(people|person|man|woman|boy|girl|kids?|children|students?|teachers?|doctors?|farmers?|workers?|scientists?|portrait|family|face|athlete)\b/i.test(s))
    return ['candid documentary photograph, full-frame camera, 50mm f/2 lens', 'soft window light from one side, natural shadows', 'Kodak Portra 400 colour and grain, real skin texture with pores and fine lines, unposed, eye-level'];
  if (/\b(animals?|dogs?|cats?|birds?|lions?|tigers?|elephants?|horses?|cows?|fish|whales?|sharks?|monkeys?|bears?|wolf|wolves|deer|snakes?|turtles?|eagles?|owls?|carabao|wildlife)\b/i.test(s))
    return ['wildlife photograph, full-frame camera, 300mm f/4 telephoto lens', 'natural daylight, the animal in its real habitat', 'real fur, feather or scale detail, slightly soft background, candid moment, not posed'];
  if (/\b(foods?|fruits?|vegetables?|apple|banana|mango|bread|rice|dish|meal|cake|soup|adobo|pizza)\b/i.test(s))
    return ['food photograph, full-frame camera, 50mm f/2.8 lens, a little above eye level', 'soft daylight from a nearby window, gentle natural shadows', 'real surface texture and small imperfections, on a plain worn table, nothing glossy or styled'];
  return ['documentary photograph, full-frame camera, 35mm f/2.8 lens', 'available natural light, true shadows', 'Kodak Portra 400 colour and fine grain, real textures and small imperfections, candid eye-level framing'];
}
const PHOTO_AVOID = 'CGI, 3D render, digital painting, plastic or waxy surfaces, airbrushed smoothness, oversaturated colour, HDR halos, glowing edges, lens flare added in, text, letters, captions, watermark, extra or missing limbs and fingers';
// Pictures are for school. A person only appears when the student asks for one (a picture maker
// given a vague subject tends to invent a portrait), and anyone shown is fully, modestly dressed.
const PEOPLE_RE = /\b(people|persons?|m[ae]n|wom[ae]n|boys?|girls?|kids?|child(?:ren)?|students?|teachers?|doctors?|nurses?|farmers?|workers?|scientists?|portraits?|famil(?:y|ies)|faces?|athletes?|players?|dancers?|soldiers?|kings?|queens?|heroe?s?|president|crowds?|babies|baby|lad(?:y|ies)|guys?|astronauts?|chefs?|fisherm[ae]n|tao|bata|guro|estudyante|selfie|myself|me)\b/i;
function pictureSafety(s) {
  return PEOPLE_RE.test(s)
    ? 'Everyone fully and modestly dressed in everyday clothes, natural and school-appropriate.'
    : 'No people, no faces and no human figures in the picture.';
}
// The words sent to the picture maker. short: for the free service's quick retry (long prompts time out there).
function picturePrompt(subject, { short = false } = {}) {
  const s = String(subject || '').replace(/\s+/g, ' ').trim();
  const kind = imageKind(s), safe = pictureSafety(s);
  if (kind === 'art') return short ? `${s.slice(0, 220)}. ${safe}` : `${s}. Clean, careful work with accurate details. ${safe}`;
  if (kind === 'diagram') return `${short ? s.slice(0, 200) : s}. A clean educational diagram: accurate, clearly labelled parts with correctly spelled labels, flat white background, even line weight. ${safe}`;
  const [camera, day, look] = photoSetup(s);
  const light = /\b(night|midnight|in the dark)\b/i.test(s) && !/micrograph|astrophotograph/.test(camera) ? 'at night, lit only by the real lights in the scene, long exposure on a tripod, deep natural shadows' : day;
  if (short) return `Real photograph of ${s.slice(0, 180)}. ${camera}. ${light}. ${safe} No CGI, no 3D render, no plastic look, no text.`;
  return `A real photograph of ${s}. ${camera[0].toUpperCase() + camera.slice(1)}. Lighting: ${light}. Look: ${look}. ${safe} Accurate to how it really is in the world. Avoid: ${PHOTO_AVOID}.`;
}
// First try: the full photographic description. Second try: a shorter one — long prompts are what
// usually time out on the free service. (Its prompt "enhancer" stays off for photos: it adds the
// glossy buzzwords this is written to avoid.)
function freeImageUrl(prompt, seed, simple = false) {
  const p = picturePrompt(prompt, { short: simple }).slice(0, 700);
  const enhance = !simple && imageKind(prompt) !== 'photo';
  return `https://image.pollinations.ai/prompt/${encodeURIComponent(p)}?width=${simple ? 896 : 1024}&height=${simple ? 672 : 768}&seed=${seed}&model=flux${enhance ? '&enhance=true' : ''}&nologo=true&safe=true`;
}
// Gemini through Cassie's server (the owner's key, with billing on): the best pictures, and it can start
// from the student's own photo. null when it can't (not on, none left, a hiccup) — the app has other ways.
let geminiPicNote = '';
async function serverGeminiImage(prompt, ref) {
  geminiPicNote = '';
  if (!SERVER || !serverPictures) return null;
  try {
    const res = await fetch(SERVER + '/image', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ uid: installId(), gemini: true, prompt, ...(ref ? { ref } : {}) }), signal: waitAtMost(SERVER_WAIT.picture) });
    const d = await res.json().catch(() => ({}));
    if (!res.ok || !d.image) { if (d.used) geminiPicNote = (d.error && d.error.message) || ''; return null; }
    geminiPicNote = d.left === 0 ? (d.per === 'week' ? 'That was your last Gemini picture this week.' : 'That was your last Gemini picture today.') : '';
    return `data:${d.mimeType || 'image/png'};base64,${d.image}`;
  } catch (e) { return null; }
}
// Backup: Cassie's own server makes the picture (Workers AI).
async function serverImage(prompt) {
  let res;
  try { res = await fetch(SERVER + '/image', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: installId(), prompt: picturePrompt(prompt) }), signal: waitAtMost(SERVER_WAIT.picture) }); }
  catch (e) { throw friendlyError(CassieErrors.say(tooSlow(e) ? 'timeout' : 'picture_busy')); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* ignore */ }
  if (!res.ok || !data.image) throw friendlyError(CassieErrors.say('picture_busy'));
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
  const g = await serverGeminiImage(picturePrompt(prompt));
  if (g) return { src: g, keep: false, gemini: true };
  if (state.geminiKey && !geminiImageOff) {
    try { return { src: await geminiImage(prompt), keep: false }; } catch (e) { /* fall back to the free service */ }
  }
  for (let attempt = 0; attempt < 2; attempt++) {
    const url = freeImageUrl(prompt, Math.floor(Math.random() * 1e9), attempt > 0);
    try { return { src: await loadImageUrl(url, attempt ? 60000 : 50000), keep: true }; } catch (e) { if (attempt === 0) await sleep(2500); }
  }
  if (SERVER) return { src: await serverImage(prompt), keep: false };
  throw friendlyError(CassieErrors.say('picture_busy_free'));
}
function imageFileName(subject) {
  return (subject || 'cassie-image').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'cassie-image';
}

// "a photo of the answer", "a picture of your explanation": that's Cassie's own answer, saved as a picture
// (exact, every word right). "a picture of it / this" means what we were talking about.
const ANSWER_SUBJECT_RE = /^(?:(?:the|your|ur|my|that|this|ung|yung)\s+)?(?:final\s+|whole\s+|full\s+)?(?:answers?|solutions?|explanations?|results?|response|reply|steps|working|summary|sagot)(?:\s+(?:above|you\s+(?:just\s+)?(?:gave|wrote|said)|to\s+(?:this|that|it|my\s+question|the\s+question)))?$/i;
const PRONOUN_SUBJECT_RE = /^(?:it|this|that|these|those|them|the\s+above|this\s+one|that\s+one|what\s+you\s+(?:said|wrote|explained)|ito|iyan|yan|yun)$/i;
function lastAnswer() {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    const m = state.messages[i];
    if (m.role === 'assistant' && m.content && !/^\[I (?:made|saved) a picture/.test(m.content)) {
      const q = state.messages.slice(0, i).reverse().find((x) => x.role === 'user');
      return { ...m, question: q ? String(q.display || q.content || '').replace(/\(attached:[^)]*\)/g, '').replace(/\s+/g, ' ').trim() : '' };
    }
  }
  return null;
}
function answerPicturePrompt(ans, withPhoto) {
  const p = state.profile || {};
  const level = [p.grade, p.level].filter(Boolean).join(' ') || 'high school';
  const plain = String(ans.content || '').replace(/```[\s\S]*?```/g, '').replace(/[*_#>`]/g, '').replace(/\n{3,}/g, '\n\n').trim().slice(0, 3000);
  return [
    `Make ONE clear study picture that shows this answer, for a ${level} student.`,
    withPhoto ? 'Start from the attached photo of the problem: redraw it neatly as a clean, flat diagram (not a photo of paper), keep its shapes, regions and labels where they are, and mark the answer on it with colour, arrows and short labels.' : 'Draw the problem as a clean diagram and mark the answer on it with colour, arrows and short labels.',
    'At the top, a short title that states the answer. Add 2 to 4 short labelled notes that explain why.',
    'Use only facts from the answer below; never invent numbers or steps. Every word spelled correctly. Flat white background, like a teacher’s worked example on a handout. No people, no faces.',
    ans.question ? `Question: ${ans.question.slice(0, 400)}` : '',
    `Answer:\n${plain}`,
  ].filter(Boolean).join('\n\n');
}
async function answerPicture(label) {
  const ans = lastAnswer();
  if (!state.messages.length) chatLog.innerHTML = '';
  state.messages.push({ role: 'user', content: label });
  touchChat(); save();
  renderMessage('user', label);
  promptInput.value = ''; autoGrow(); clearFollowups();
  if (!ans || !window.CassieExport) {
    const ask = 'Ask me the question first, then I can save my answer as a picture. Or tell me what the picture should show, like “a picture of a map coloured with 2 colours”.';
    state.messages.push({ role: 'assistant', content: ask }); save(); renderMessage('assistant', ask);
    return;
  }
  track('feature', 'answer-picture');
  // Gemini (when the server has it): the answer drawn as a study picture, on the student's own photo if they sent one
  if (SERVER && serverPictures) {
    const typing = renderTyping();
    setTypingStatus(typing, 'Drawing your answer…');
    const ref = lastPhoto && lastPhoto.chatId === state.currentId ? lastPhoto.url : null;
    const src = await serverGeminiImage(answerPicturePrompt(ans, !!ref), ref);
    typing.remove();
    if (src) {
      const caption = 'Here’s the answer as a picture. ' + (geminiPicNote ? geminiPicNote + ' ' : '') + '(A picture maker drew it: check the labels against my answer.)';
      const b = renderMessage('assistant', caption);
      addImageToBubble(b, src, { download: true, name: 'cassie-answer' });
      state.messages.push({ role: 'assistant', content: '[I made a picture of my answer]', display: caption });
      save(); mascotCelebrate();
      return;
    }
  }
  // the student's question is the title (the answer's own first line would just repeat itself)
  const q = ans.question && !/^(?:answer|solve|explain)\b.{0,30}$/i.test(ans.question) ? ans.question : '';
  const title = q ? (q.length > 90 ? q.slice(0, 87).replace(/\s+\S*$/, '') + '…' : q) : 'Cassie’s answer';
  const caption = (geminiPicNote && SERVER && serverPictures ? geminiPicNote + ' So here’s my answer as a picture card you can save or share.' : 'Here’s my answer as a picture you can save or share. (Want a drawing instead? Tell me exactly what it should show.)');
  const bubble = renderMessage('assistant', caption);
  try {
    const blob = await window.CassieExport.toPng(ans.content, title);
    const url = await new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
    addImageToBubble(bubble, url, { download: true, name: window.CassieExport.fileBase(title) });
  } catch (e) { bubble.appendChild(Object.assign(document.createElement('p'), { textContent: CassieErrors.say('picture_save_failed') })); }
  state.messages.push({ role: 'assistant', content: '[I saved a picture of my answer]', display: caption });
  save();
}
async function handleImageRequest(text, subject) {
  const label = text.trim();
  if (subject && ANSWER_SUBJECT_RE.test(subject.trim())) return answerPicture(label);
  if (subject && PRONOUN_SUBJECT_RE.test(subject.trim())) subject = '';
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
  // never send "the answer" or "it" to the picture maker as words: it would invent something
  const bare = String(subject || '').trim();
  if (ANSWER_SUBJECT_RE.test(bare) || PRONOUN_SUBJECT_RE.test(bare)) subject = imageSubjectFromChat() || bare;
  setTypingStatus(typingBubble, 'Making your picture…');
  sendBtn.disabled = true;
  try {
    const { src, keep, gemini } = await generateImage(subject);
    typingBubble.remove();
    const caption = `Here’s your picture of ${subject}.` + (gemini && geminiPicNote ? ' ' + geminiPicNote : '');
    const bubble = renderMessage('assistant', caption);
    addImageToBubble(bubble, src, { download: true, name: imageFileName(subject) });
    // free-service links are stable, so the picture comes back when the chat reopens
    state.messages.push({ role: 'assistant', content: `[I made a picture of: ${subject}]`, display: caption, image: keep ? src : undefined });
    save();
    setCursorMode('idle');
    mascotCelebrate();
  } catch (err) {
    typingBubble.remove();
    renderError(err, () => pictureReply(subject, renderTyping()), 'picture_failed');
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
    // for the citation export (cite.js): the paper's own details
    doi: w.doi || '', type: w.type || '',
    volume: (w.biblio && w.biblio.volume) || '', issue: (w.biblio && w.biblio.issue) || '',
    firstPage: (w.biblio && w.biblio.first_page) || '', lastPage: (w.biblio && w.biblio.last_page) || '',
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
    renderMessage('assistant', CassieErrors.say('research_unreachable')).classList.add('error');
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
  const citeList = papers.map(({ abstract, cited, ...p }) => p); // the details a citation needs
  state.messages.push({ role: 'assistant', content: listMd, papers: citeList });
  save();
  const listBubble = renderMessage('assistant', listMd);
  if (listBubble && window.CassieCite) listBubble.appendChild(window.CassieCite.bar(citeList, { track }));

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
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${(await geminiModels())[0]}:generateContent`;
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
    if (isRateLimited(res.status, detail)) throw friendlyError(CassieErrors.say('search_busy'));
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

// No Gemini key of their own: Cassie's server searches (its key; a few a day, see /web on the server)
async function askServerWeb(q) {
  let res;
  try { res = await fetch(SERVER + '/web', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ q, uid: installId(), system: buildSystemPrompt() }) }); }
  catch (e) { throw friendlyError(CassieErrors.say('network')); }
  let d = {};
  try { d = await res.json(); } catch (e) { /* empty */ }
  if (!res.ok) throw friendlyError((d.error && d.error.message) || CassieErrors.say('unknown'));
  return { text: d.text || '(no response)', sources: Array.isArray(d.sources) ? d.sources : [] };
}
// Under an answer about the real world or something recent (a show, the news, a price, a person),
// or one where Cassie says she isn't sure: one tap to look it up on the web. Never searches by itself.
const WEB_ASK_RE = /\b(movies?|films?|series|shows?|drama|k-?drama|episodes?|seasons?|netflix|anime|actors?|actress|singers?|celebrit(y|ies)|news|latest|recent(ly)?|today|this (week|month|year)|current(ly)?|prices?|how much|stocks?|weather|scores?|won|elections?|president|released?|release date|20[2-9]\d|who is)\b/i;
const WEB_UNSURE_RE = /\b(don'?t|do not) have (reliable|up[- ]to[- ]date|current|recent)|can'?t (browse|access the (web|internet))|my (knowledge|training)|as of my\b/i;
function webChip(bubble, question, reply) {
  if (!state.geminiKey && !SERVER) return;
  if (!WEB_ASK_RE.test(question) && !WEB_UNSURE_RE.test(reply)) return;
  const b = document.createElement('button');
  b.type = 'button'; b.className = 'web-chip';
  b.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>Search the web';
  b.addEventListener('click', () => { b.remove(); runWebCheck(question); });
  bubble.appendChild(b);
}

async function runWebCheck(text) {
  text = (text || '').trim();
  if (!text) { promptInput.placeholder = 'Type a question first, then tap Web…'; promptInput.focus(); return; }
  taskOutfit = 'graduate'; dressCassie(); track('feature', 'web'); trackWords(text);
  if (!state.geminiKey && !SERVER) {
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
    const { text: answer, sources } = state.geminiKey ? await askGeminiGrounded(text) : await askServerWeb(text);
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
    renderMessage('assistant', CassieErrors.say('tab_file'));
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
  renderChatList();
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
    addAttachment({ kind: 'image', name: 'Board', status: 'ready', image: { mimeType: 'image/jpeg', base64: jpg.split(',')[1], dataUrl: jpg } });
    if (prompt && !promptInput.value.trim()) promptInput.value = prompt;
    autoGrow();
    promptInput.focus();
  };
  img.src = dataUrl;
}

function openSketch(opts = {}) {
  if (!window.CassieSketch) return;
  deskCloseOthers('board');
  window.CassieSketch.open({
    title: opts.title || 'Your board',
    dark: opts.dark != null ? opts.dark : prefersDark(),
    image: opts.image || null,
    note: opts.note || null,
    checkLabel: 'Send to Cassie',
    onCheck: (png) => {
      window.CassieSketch.close();
      attachDataUrl(png, 'Check my work on this board. What did I get right, and what should I fix?');
      return '';
    },
    askPlaceholder: 'Ask Cassie, or tell her what to draw (e.g. “graph y = x² − 4”)',
    onAsk: (png, q, parts) => askBoard(png, q, parts),
    hear: boardHear(),
    ...boardDecks(),
    extra: SERVER && !opts.noRoom ? [{ label: 'Study together', title: 'Start a study room: classmates join with a code, draw, chat, quiz each other and study flashcards together', onClick: () => openRoomChooser() }] : [],
  });
}

/* ---------- Study rooms: one board, drawn on together ----------
   Someone starts a room and gets a 6-letter code (and a link). Classmates join with it and
   everyone's drawing shows on everyone's board, about a second later. Each student can still
   ask Cassie about the board. Rooms last a day; only drawings are shared. */
let roomLive = null;
const roomName = () => ((state.profile && state.profile.name) || 'Classmate').split(/\s+/)[0].slice(0, 30);
async function roomCall(path, body) {
  const r = await fetch(SERVER + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: installId(), name: roomName(), ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(d.error || CassieErrors.say('room_unavailable')), { gone: !!d.gone, full: !!d.full, friendly: !!d.error, code: d.code || '', status: r.status });
  return d;
}
function openRoomChooser(prefill = '') {
  if (!SERVER) { renderMessage('assistant', 'Study rooms need Cassie’s server, which isn’t set up on this copy of Cassie.'); return; }
  document.querySelector('.room-dlg')?.remove();
  const el = document.createElement('div');
  el.className = 'room-dlg';
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Study room');
  el.innerHTML = `<div class="room-card">
      <button type="button" class="room-x" aria-label="Close">×</button>
      <h2>Study together</h2>
      <p>Start a study room and share the code, up to 12 classmates, each at home: draw on the same board, chat, ask Cassie for everyone, study shared flashcards, take a group quiz and pin notes, live.</p>
      <button type="button" class="room-go main" data-room="new">Start a room</button>
      <form class="room-join"><input name="code" maxlength="6" placeholder="Have a code? e.g. K7M2QX" autocomplete="off" autocapitalize="characters" value="${escapeHtml(prefill)}"><button type="submit" class="room-go">Join</button></form>
      <p class="room-err" hidden></p>
      <p class="room-fine">Rooms last a day. What you share in a room, drawings, sticky notes, cards, messages, and where your pointer is on the board, everyone in it sees. Be kind, it’s a study room.</p>
    </div>`;
  document.body.appendChild(el);
  const err = el.querySelector('.room-err');
  const fail = (e) => { err.hidden = false; err.textContent = CassieErrors.explain(e, 'room_unavailable'); el.querySelectorAll('button').forEach((b) => { b.disabled = false; }); };
  const joinForm = el.querySelector('.room-join');
  const check = CassieErrors.form(joinForm, { code: (v) => (String(v).toUpperCase().replace(/[^A-Z0-9]/g, '').length !== 6 ? 'room_code' : '') });
  el.querySelector('.room-x').addEventListener('click', () => el.remove());
  el.addEventListener('click', (e) => { if (e.target === el) el.remove(); });
  el.querySelector('[data-room="new"]').addEventListener('click', async (e) => {
    e.target.disabled = true;
    try { const d = await roomCall('/room/create', { title: `${roomName()}’s study room` }); el.remove(); track('feature', 'room:create'); startRoom(d.code, d.title); } catch (x) { fail(x); }
  });
  el.querySelector('.room-join').addEventListener('submit', async (e) => {
    e.preventDefault();
    const code = String(new FormData(e.target).get('code') || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
    err.hidden = true;
    if (!check.check()) return;
    try { const d = await roomCall('/room/join', { code }); el.remove(); track('feature', 'room:join'); startRoom(d.code, d.title); } catch (x) { fail(x); }
  });
  setTimeout(() => el.querySelector(prefill ? '.room-join input' : '[data-room="new"]').focus(), 30);
}
// Flashcards for the board: your own decks, or a deck Cassie writes on a topic
function boardDecks() {
  return {
    name: roomName(),
    premium: PREMIUM,
    decks: () => { const m = new Map(); (state.cards || []).forEach((c) => { if (!m.has(c.deck)) m.set(c.deck, []); m.get(c.deck).push({ f: c.f, b: c.b }); }); return [...m.entries()].map(([name, cards]) => ({ name, cards })); },
    makeCards: async (topic) => {
      const p = state.profile || {};
      const level = [p.grade, p.level].filter(Boolean).join(' ') || 'high school';
      const reply = await askCassie([{ role: 'user', content: `Write 8 flashcards about "${topic}" for a ${level} student. The front is a short question or term; the back is the answer in one short sentence. Reply with ONLY a JSON array, no other text: [{"f": "front", "b": "back"}]` }]);
      const t = String(reply || ''), i = t.indexOf('['), j = t.lastIndexOf(']');
      if (i < 0 || j <= i) return [];
      try { track('feature', 'board-cards'); return JSON.parse(t.slice(i, j + 1)).filter((c) => c && c.f && c.b).slice(0, 16).map((c) => ({ f: String(c.f), b: String(c.b) })); } catch (e) { return []; }
    },
  };
}
// a quiz for the whole room: Cassie writes 5 multiple-choice questions as data
const roomQuiz = (topic) => quizQuestions(topic, 5);
// a multiple-choice quiz as data (the study room's quiz, and Quiz me inside Labs and the 3D views)
async function quizQuestions(topic, n = 5) {
  const p = state.profile || {};
  const level = [p.grade, p.level].filter(Boolean).join(' ') || 'high school';
  const reply = await askCassie([{ role: 'user', content: `Write a ${n}-question multiple-choice quiz about "${topic}" for a ${level} student. Each question has 4 options and exactly one right answer; the wrong options should be believable. Reply with ONLY a JSON array, no other text: [{"q": "question", "o": ["option A", "option B", "option C", "option D"], "a": 0, "why": "one short sentence on why the answer is right"}], "a" is the index (0 to 3) of the right option.` }]);
  const s = noDashes(reply || ''), i = s.indexOf('['), j = s.lastIndexOf(']');
  if (i < 0 || j <= i) return [];
  try {
    return JSON.parse(s.slice(i, j + 1)).filter((q) => q && q.q && Array.isArray(q.o) && q.o.length >= 2 && Number.isInteger(+q.a) && +q.a < q.o.length).slice(0, Math.max(n, 1)).map((q) => ({ q: String(q.q), o: q.o.map(String), a: +q.a, why: String(q.why || '') }));
  } catch (e) { return []; }
}
async function startRoom(code, title) {
  if (!window.CassieSketch) return;
  if (roomLive) roomLive.stop();
  const me = installId();
  const R = { code, title, since: 0, queue: [], timer: 0, stopped: false, fails: 0, members: [] };
  roomLive = R;
  R.stop = () => { R.stopped = true; clearTimeout(R.timer); document.removeEventListener('visibilitychange', R.wake); if (roomLive === R) roomLive = null; };
  const link = `${location.origin}${location.pathname}?room=${code}`;
  await window.CassieSketch.open({
    title: `${title} · ${code}`,
    dark: false, // everyone sees the same page
    checkLabel: 'Send to Cassie',
    onCheck: (png) => { attachDataUrl(png, 'Check our work on this study-room board. What did we get right, and what should we fix?'); return ''; },
    askPlaceholder: 'Ask Cassie about the board (only you see her answer)',
    onAsk: (png, q, parts) => askBoard(png, q, parts),
    hear: boardHear(),
    ...boardDecks(),
    room: { me, name: roomName(), send: (op) => { R.queue.push(op); clearTimeout(R.timer); R.timer = setTimeout(tick, 150); } },
    onClose: () => R.stop(),
  });
  const session = window.CassieSketch.session();
  if (!session) { R.stop(); return; }
  // studying together beside the board (study-room.js): chat, Cassie for everyone, shared cards, a quiz, notes, a timer
  const panel = document.querySelector('.csk-panel');
  const study = window.CassieStudy && panel ? window.CassieStudy.attach({
    panel, me, name: roomName(),
    send: (op) => { R.queue.push(op); clearTimeout(R.timer); R.timer = setTimeout(tick, 150); },
    ask: askShown,
    makeQuiz: roomQuiz,
    decks: boardDecks().decks,
    speak: (t) => window.CassieVoice && window.CassieVoice.speak(cleanForSpeech(t), { gender: voiceGender() }),
    // what the room shared, kept after it ends: a deck into your flashcards, the pinned notes as a chat
    keepDeck: (title, cards) => (window.CassieCards ? window.CassieCards.add(cards.map((c) => ({ f: c.f, b: c.b })), title, 'room') : 0),
    keepNotes: (notes) => {
      const c = makeChat();
      c.title = `Study room notes · ${code}`;
      c.messages.push({ role: 'assistant', content: `**Notes from study room ${code}**\n\n` + notes.map((n) => `- ${n.text} *(${n.by})*`).join('\n') });
      c.updatedAt = Date.now();
      state.chats.push(c); save(); renderChatList();
      return true;
    },
    onUnread: (n) => { const b = document.querySelector('[data-room-act="study"]'); if (b) b.textContent = n ? `📚 Study together (${n})` : '📚 Study together'; },
  }) : null;
  const stopRoom = R.stop;
  R.stop = () => { stopRoom(); if (study) study.destroy(); };
  const banner = (note = '') => {
    const who = R.members.map((m) => `<span>${escapeHtml(m.uid === me ? `${m.name} (you)` : m.name)}</span>`).join('');
    const el = session.setRoom(`<span>Room</span><b>${code}</b><button type="button" class="csk-btn" data-room-act="copy">Copy invite link</button><button type="button" class="csk-btn" data-room-act="check" title="Cassie looks at the whole board, a proof, code, a diagram, and everyone sees her answer">🔎 Ask Cassie to check our board</button>${study ? `<button type="button" class="csk-btn primary" data-room-act="study">📚 Study together${study.unread() ? ` (${study.unread()})` : ''}</button>` : ''}${note ? `<span class="csk-room-note">${escapeHtml(note)}</span>` : ''}<span class="csk-who">${who}</span>`);
    const sb = el.querySelector('[data-room-act="study"]');
    if (sb) sb.onclick = () => study.toggle();
    el.querySelector('[data-room-act="check"]').onclick = (e) => groupCheck(e.currentTarget);
    const btn = el.querySelector('[data-room-act="copy"]');
    btn.onclick = () => {
      const txt = `Join my Cassie study room: ${link} (code ${code})`;
      const done = () => { btn.textContent = 'Copied ✓'; setTimeout(() => { btn.textContent = 'Copy invite link'; }, 1600); };
      try { if (navigator.share && matchMedia('(pointer: coarse)').matches) navigator.share({ title: 'Cassie study room', text: txt, url: link }).catch(() => {}); else navigator.clipboard.writeText(txt).then(done, done); } catch (e) { done(); }
    };
  };
  // "Ask Cassie to check our board": she looks at the whole shared board and everyone sees the answer
  async function groupCheck(btn) {
    if (btn.disabled) return;
    const input = document.querySelector('.csk-ask input');
    const typed = input && input.value.trim();
    const q = typed || 'Check our shared board. If it’s maths or a proof, check every step; if it’s code or a diagram of how code fits together, look for bugs and design problems; if it’s a drawing, diagram or notes, say whether it’s right. Say what’s right, what’s wrong, and how to fix it.';
    const was = btn.textContent;
    btn.disabled = true; btn.textContent = 'Cassie is looking…';
    session.showNote({ reply: 'Cassie is checking the board for everyone…' });
    try {
      const out = await askBoard(session.snapshot(), q, session.parts());
      if (input && typed) input.value = '';
      if (out.draw) session.draw(out.draw);
      const a = String(out.reply || (out.draw ? 'I drew it on the board.' : '')).slice(0, 4000);
      session.showNote({ headline: 'Cassie checked the board (everyone sees this)', reply: a });
      if (study) study.share(typed ? q : 'Check our board', a, { board: 1 });
      track('feature', 'room:check');
    } catch (e) { session.showNote({ reply: errorText(e) }); }
    finally { btn.disabled = false; btn.textContent = was; }
  }
  banner('Connecting…');
  // one check at a time; and back to the tab: check now (a hidden tab only checks every 15 s)
  async function tick() {
    if (R.stopped || R.busy) return;
    R.busy = true;
    try { await poll(); } finally { R.busy = false; }
  }
  R.wake = () => { if (!document.hidden) tick(); };
  document.addEventListener('visibilitychange', R.wake);
  async function poll() {
    if (R.stopped) return;
    clearTimeout(R.timer);
    try {
      if (R.queue.length) {
        const ops = R.queue.splice(0, 40);
        try { await roomCall('/room/ops', { code, ops }); }
        catch (e) { if (e.full) { banner(e.message); } else { R.queue.unshift(...ops); throw e; } }
      }
      // where your pointer is (and your laser's trail) goes along with the check for news
      const here = session.presence && session.presence();
      if (here) R.active = Date.now();
      const r = await fetch(`${SERVER}/room/poll?code=${code}&uid=${encodeURIComponent(me)}&since=${R.since}${here ? `&p=${encodeURIComponent(JSON.stringify(here).slice(0, 3900))}` : ''}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw Object.assign(new Error(d.error || 'Lost the room'), { gone: !!d.gone });
      if (d.ops && d.ops.length) {
        R.since = d.ops[d.ops.length - 1].id;
        const isStudy = (o) => o.op && window.CassieStudy && window.CassieStudy.kinds.has(o.op.t);
        if (study) study.receive(d.ops.filter(isStudy), d.now);
        session.remote(d.ops.filter((o) => !isStudy(o)));
        // a classmate asked Cassie to check the board: show it on everyone's board
        const checked = d.ops.filter((o) => o.op && o.op.t === 'share' && o.op.board && o.uid !== me && (d.now || Date.now()) - (o.ts || 0) < 120000).pop();
        if (checked) session.showNote({ headline: `${String(checked.op.n || 'A classmate').slice(0, 30)} asked Cassie to check the board`, reply: String(checked.op.a || '').slice(0, 4000) });
      }
      if (session.others) { session.others(d.here || [], d.members || R.members); if ((d.here || []).some((h) => d.now - h.ts < 3000)) R.active = Date.now(); }
      const names = JSON.stringify(d.members || []);
      if (names !== JSON.stringify(R.members) || R.fails) { R.members = d.members || []; R.fails = 0; if (study) study.members(R.members); banner(); }
      // quicker while people are moving pointers, so cursors and lasers feel live
      // (a hidden tab: every 15 s, which still keeps you in the room: the server drops you after 25 s unseen)
      R.timer = setTimeout(tick, d.more || R.queue.length ? 50 : document.hidden ? 15000 : Date.now() - (R.active || 0) < 4000 ? 450 : 1000);
    } catch (e) {
      if (e.gone) { banner('This room has ended. Save your board with the picture button.'); R.stop(); return; }
      R.fails++;
      banner(R.fails > 2 ? 'Reconnecting…' : '');
      R.timer = setTimeout(tick, Math.min(15000, 1000 * 2 ** Math.min(R.fails, 4)));
    }
  }
  tick();
}
// a link like app.html?room=K7M2QX joins that room
{ const rc = new URLSearchParams(location.search).get('room'); if (rc && /^[A-Za-z0-9]{6}$/.test(rc)) setTimeout(() => {
  roomCall('/room/join', { code: rc.toUpperCase() }).then((d) => { track('feature', 'room:join'); startRoom(d.code, d.title); }).catch(() => openRoomChooser(rc.toUpperCase()));
}, 400); }
// Find the function to graph in what the student wrote: "y = …", "f(x) = …", or a bare
// expression like "x^2(x+6)^3(x-4) graph it".
function equationIn(text) {
  const B = window.CassieBoard;
  if (!B) return '';
  const t = String(text || '');
  const eq = B.findEquation(t);
  if (eq) return eq;
  const runs = t.match(/[-+−–0-9xX.^*/×÷()\s√π²³]{3,}/g) || [];
  const cands = runs.map((r) => r.trim()).filter((r) => /x/i.test(r) && /[\d^(²³]/.test(r)).sort((a, b) => b.length - a.length);
  for (const c of cands) {
    try { const n = B.normalize(c); const f = B.compile(n); if ([1.3, 2.7, -1.1].some((v) => isFinite(f(v)))) return n; } catch (e) { /* not maths */ }
  }
  return '';
}
// No AI answered, but the equation is right there: draw the graph anyway.
function graphWithoutBrain(text) {
  const eq = GRAPH_ASK_RE.test(text || '') && equationIn(text);
  if (!eq || !window.CassieBoard) return '';
  const spec = window.CassieBoard.graphSpec(eq);
  return 'I couldn’t reach my brain just now, so here’s the graph on its own. Ask me again in a minute and I’ll explain it.\n\n```cassie-board\n' + JSON.stringify(spec) + '\n```';
}

// The board's "Ask": Cassie answers about the board, and draws on it when asked (or when a
// graph says it best). A blank board isn't sent as a picture.
async function askBoard(png, q, parts) {
  const B = window.CassieBoard;
  const strokes = (parts && parts.strokes) || [];
  const typed = strokes.filter((x) => x.tool === 'text').map((x) => x.text).join('\n').trim();
  const notes = strokes.filter((x) => x.obj === 'note' && x.text).map((x) => `- sticky note${x.n ? ` (${x.n})` : ''}: ${x.text}`);
  const cards = strokes.filter((x) => x.obj === 'card').map((x) => `- flashcard: ${x.f} → ${x.b}`);
  // only typed text on the board: send it as text, no picture needed (exact, and works with any brain)
  const needsPicture = !!(parts && parts.image) || strokes.some((x) => x.tool !== 'text' && !x.obj && x.by !== 'cassie');
  const wrote = (typed ? 'On my board I wrote:\n"' + typed + '"\n' : '') + (notes.length || cards.length ? 'On the board there are also:\n' + notes.concat(cards).slice(0, 60).join('\n') + '\n' : '');
  const prompt = `${needsPicture ? 'This is my board (maybe a picture, maybe my own writing on it). ' : ''}${wrote}${q}\n\nIf I asked you to draw, graph, plot, sketch or show something, or the answer is best shown as a graph, shape or numbered steps, include exactly one cassie-board block: it gets drawn right on my board. Keep your words short (under 120 words).`;
  const image = needsPicture ? { mimeType: 'image/png', base64: String(png).split(',')[1] || '' } : null;
  let reply;
  try { reply = await askCassie([{ role: 'user', content: prompt }], image, { tutor: true }); }
  catch (e) {
    const eq = GRAPH_ASK_RE.test(q) && equationIn(q + '\n' + typed);
    if (eq && B) return { reply: 'I couldn’t reach my brain just now, so I drew the graph on its own. Ask again in a minute for the explanation.', draw: B.graphSpec(eq) };
    reportAuto('board', errorText(e));
    throw e;
  }
  const { clean, boards } = B ? B.extract(reply) : { clean: reply, boards: [] };
  let draw = boards[0];
  if (!draw && B && GRAPH_ASK_RE.test(q)) { const eq = equationIn(q + '\n' + typed) || B.findEquation(reply); if (eq) draw = B.graphSpec(eq); }
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
    openSketch({ image, title: spec.title ? `Board: ${spec.title}` : 'Your board' });
  };
}
const boardBtn = document.getElementById('board-btn');
if (boardBtn) boardBtn.addEventListener('click', () => { track('feature', 'board'); botMood('drawing', 4000); openSketch(); });

/* ---------- attach / generate wiring ---------- */
attachBtn.addEventListener('click', () => fileInput.click());
// the camera (phones): one snap, and Cassie works through it at once (what you typed goes with it)
const SNAP_ASK = 'Solve this step by step and explain each step. If it is a page of notes or a textbook page, explain it simply and point out what matters most.';
const cameraInput = document.getElementById('camera-input');
document.getElementById('camera-btn').addEventListener('click', () => { track('feature', 'camera'); cameraInput.click(); });
cameraInput.addEventListener('change', async () => {
  const f = cameraInput.files && cameraInput.files[0];
  cameraInput.value = '';
  if (!f) return;
  if (!(await attachFile(f))) return; // (it couldn't be read: the chip says why)
  if (!promptInput.value.trim()) promptInput.value = SNAP_ASK;
  document.getElementById('composer').requestSubmit();
});
fileInput.addEventListener('change', async () => {
  const files = [...(fileInput.files || [])];
  fileInput.value = '';
  for (const f of files) await attachFile(f); // in order, so photo 1 is the first one picked
});

// Attach a picture or document to the next message (it joins the others — up to 15 photos and
// 5 files). Its chip shows at once, in order; returns true when it's ready.
async function attachFile(file) {
  attachError = '';
  const a = addAttachment({ kind: 'pending', name: file.name || 'file', status: 'reading', note: `Reading ${file.name || 'your file'}…` });
  let finish;
  a.done = new Promise((ok) => { finish = ok; });
  try { return await attachInto(a, file); }
  catch (e) { a.status = 'error'; a.note = attachError = `Couldn’t open ${file.name}.`; return false; }
  finally { finish(); renderAttachments(); }
}
async function attachInto(a, file) {
  const kind = await sniffKind(file);
  const fail = (msg) => { a.status = 'error'; a.note = msg; attachError = msg; islandShow('oops', msg.length > 60 ? 'Couldn’t attach that' : msg, 2600); botMood('oops', 2600); return false; };
  const others = (k) => attachments.filter((x) => x !== a && x.kind === k && x.status !== 'error').length;

  // Photos / screenshots → picture reading.
  if (kind === 'image' || kind === 'heic') {
    a.kind = 'image';
    if (others('image') >= MAX_PHOTOS) return fail(`Up to ${MAX_PHOTOS} photos at a time. Send these first, then add more.`);
    try {
      a.image = await processImageFile(file);
      a.status = 'ready'; a.note = '';
      const n = readyOf('image').length;
      islandShow('upload', n > 1 ? `Got ${n} photos!` : 'Got your photo!', 2200); botMood('upload', 2200);
      return true;
    } catch (e) {
      // iPhone HEIC photos can't be drawn by most browsers — Gemini can still read them as-is.
      if (kind === 'heic' && state.geminiKey) {
        const base64 = await new Promise((res) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.readAsDataURL(file); });
        a.image = { mimeType: file.type || 'image/heic', base64, dataUrl: '' };
        a.status = 'ready'; a.note = `Photo (iPhone HEIC) · ${file.name}`;
        return true;
      }
      return fail(CassieErrors.say(kind === 'heic' ? 'heic' : 'photo_unreadable', { name: file.name }));
    }
  }

  // Documents → read the whole thing in the browser.
  a.kind = 'doc';
  if (kind === 'pdf' || kind === 'docx' || kind === 'pptx' || kind === 'txt') {
    if (others('doc') >= MAX_FILES) return fail(`Up to ${MAX_FILES} files at a time. Send these first, then add more.`);
    renderAttachments();
    islandShow('upload', `Opening ${file.name}…`); botMood('upload');
    try {
      const doc = await readDocument(file, kind);
      if (!doc.text && !doc.hasVisuals) return fail(CassieErrors.say('nothing_readable', { name: file.name }));
      a.doc = doc; a.status = 'ready';
      a.note = `${doc.label} · ${file.name}${doc.scanned ? ': scanned, I’ll read the pages as pictures' : ''}`;
      if (!promptInput.value.trim()) promptInput.placeholder = 'What should I do with it? e.g. “Make a reviewer”';
      islandShow('done', `Got it · ${doc.label}`, 2200); botMood('done', 2200);
      return true;
    } catch (e) {
      return fail(`Couldn’t read ${file.name}. Try a PDF, PowerPoint (.pptx), Word (.docx) or a photo.`);
    }
  }
  if (kind === 'legacy-ppt') return fail('That’s an old PowerPoint (.ppt). Open it and Save As .pptx or PDF, then attach it again.');
  if (kind === 'legacy-doc') return fail('That’s an old Word file (.doc). Open it and Save As .docx or PDF, then attach it again.');
  if (kind === 'xlsx') return fail(CassieErrors.say('spreadsheet'));
  return fail(CassieErrors.say('file_kind', { name: file.name }));
}
attachRemove.addEventListener('click', clearAttach);

composer.addEventListener('submit', (e) => {
  e.preventDefault();
  // nothing typed yet: Send puts you in the box to type (a tap always does something)
  if (!promptInput.value.trim() && !attachments.length) { promptInput.focus(); return; }
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
/* ---------- Explore 3D: cells you can turn, zoom and tap ----------
   The viewer (explore/cell3d.js, with three.js) only loads when it's opened, so the app
   stays light. Tapping "Ask Cassie" or "Quiz me" in it brings the question back here. */
let exploreMod = null;
/* Ask Cassie and Quiz me inside Labs and the 3D views (labs/helper.js): the same path to Cassie as the
   chat (askCassie), her answers drawn like the chat's, a quiz written as data, missed questions kept
   for "Review my mistakes". */
// Teach me: one decision for a whole lesson (voice.js): Bella says every step when what's left of her
// voice covers the lesson (plan), otherwise she types the steps and says so once
function lessonVoice() {
  const CV = window.CassieVoice;
  if (!CV || !CV.session) return null;
  const s = CV.session({ gender: voiceGender() });
  return { speak: (t) => s.speak(cleanForSpeech(t)), plan: (t) => s.plan(cleanForSpeech(t)), end: () => s.end() };
}
const IN_LAB = {
  converse: (msgs) => (canChat() ? askCassie(msgs, null, { tutor: true }) : Promise.reject(friendlyError(CassieErrors.say('not_set_up')))),
  format: (node, text) => renderFormatted(node, text),
  makeQuiz: (topic) => (canChat() ? (quizStarted(topic), quizQuestions(topic, 5)) : Promise.reject(friendlyError(CassieErrors.say('not_set_up')))),
  onMark: (q, a, right) => { captureQuizMarks(`[[${right ? 'GOT' : 'MISSED'}: ${q} || ${a}]]`); },
  speak: (t) => window.CassieVoice && window.CassieVoice.speak(cleanForSpeech(t), { gender: voiceGender() }),
};
function labsCss() {
  if (!document.querySelector('link[data-labs-css]')) { const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = 'labs/labs.css?v=12'; l.dataset.labsCss = '1'; document.head.appendChild(l); }
}
// the panel for one 3D view (made when first needed, gone when the view closes)
let help3d = null;
async function help3dFor(view) {
  if (help3d && help3d.view === view) return help3d.h;
  if (help3d) help3d.h.destroy();
  labsCss();
  const { helper } = await import('./labs/helper.js');
  const h = helper({ view: view.root, name: X3D_NAMES[view.kind] ? X3D_NAMES[view.kind].replace(/^The /, 'the ') : 'the 3D model', described: () => describe3d(view), ask: IN_LAB.converse, format: IN_LAB.format, speak: IN_LAB.speak, quiz: IN_LAB.makeQuiz, onMark: IN_LAB.onMark });
  help3d = { view, h };
  return h;
}
function dropHelp3d() { if (help3d) { help3d.h.destroy(); help3d = null; } }
function startQuizOn(topic) {
  if (!canChat()) { openSettings(); return; }
  quizMode = true; quizStarted(topic);
  if (quizBtn) quizBtn.classList.add('active');
  setQuizLabel('Stop quiz');
  dressCassie();
  handleSend(`Quiz me on: ${topic}. Ask the first question.`, {});
}
// ret: { back(), leave() } when it was opened from Labs — closing goes back to Labs, asking Cassie leaves it
// what's on the 3D screen, in words, for Cassie
function describe3d(view) {
  const r = view.root, sheet = r.querySelector('.x3d-sheet');
  const part = sheet && !sheet.hidden ? (sheet.querySelector('h3') || {}).textContent : '';
  const sys = [...r.querySelectorAll('.x3d-sys[aria-pressed="true"]')].map((b) => b.textContent.trim());
  return [`looking at the ${view.kind === 'body' ? 'human body' : view.kind + ' cell'}`, sys.length ? `body systems showing: ${sys.join(', ')}` : '', part ? `the part open now: ${part}` : ''].filter(Boolean).join('; ');
}
let teacher3d = null;
const lessons3d = new Map(); // the body, the animal cell, the plant cell -> where the student stopped a lesson
function stopTeach3d() {
  if (!teacher3d) return;
  const l = teacher3d.lesson();
  if (l) lessons3d.set(teacher3d.kind, l); else lessons3d.delete(teacher3d.kind);
  teacher3d.stop(); teacher3d = null;
}
async function teach3d(view) {
  if (teacher3d && teacher3d.root.isConnected) { stopTeach3d(); return; }
  if (help3d && help3d.view === view && help3d.h.open) help3d.h.close();
  labsCss();
  const { tutor, collectAll } = await import('./labs/tutor.js');
  const body = view.kind === 'body';
  const lab = body
    ? { id: 'body3d', name: 'Human body 3D', subject: 'explore', blurb: 'a real 3D human body', about: 'The chips at the bottom turn each body system on or off (bones, muscles, organs…). Boy or Girl picks the body. "Find a part" searches any part by name. Tap any part on the model to see what it is and does, then Ask Cassie or Quiz me about it. "Look around" turns the body to the front, back or side, and its slider pulls every part apart and sorts it. Drag to turn, pinch or scroll to zoom, two fingers to move.' }
    : { id: view.kind + 'cell', name: view.kind === 'plant' ? 'Plant cell 3D' : 'Animal cell 3D', subject: 'explore', blurb: 'a 3D cell, cut open', about: 'Tap any organelle (or its name in the list at the bottom) to see what it does. Labels shows or hides the names; Cut open shows the inside or the whole cell. The Animal cell and Plant cell tabs at the top switch between the two cells. Drag to turn, pinch or scroll to zoom.' };
  teacher3d = tutor({ view: view.root, lab, collect: collectAll, described: () => describe3d(view),
    ask: askShown,
    speak: (t) => window.CassieVoice && window.CassieVoice.speak(cleanForSpeech(t), { gender: voiceGender() }),
    speaker: lessonVoice,
    hear: canHear() ? hearOnce : null,
    level: [state.profile && state.profile.grade, state.profile && state.profile.level].filter(Boolean).join(' ') });
  teacher3d.kind = view.kind;
  teacher3d.root.querySelector('.tut-x').addEventListener('click', () => stopTeach3d()); // (the lesson is kept: Teach me offers to carry on)
  track('feature', 'teach-' + lab.id);
  if (lessons3d.has(view.kind)) teacher3d.offer(lessons3d.get(view.kind));
  else teacher3d.teach('How do I use this? Teach me from the start.');
}
// the cells and the body are separate views: 'cells' opens the cells on the one last looked at
let lastCell = 'animal';
async function openExplore(cell, ret) {
  track('feature', 'explore');
  // free: 2 views a week of each (the body, the animal cell, the plant cell); Plus has them always
  const want = cell === 'cells' ? lastCell : ['plant', 'animal', 'body'].includes(cell) ? cell : 'body', seen = new Set();
  const first = free3d(want, seen);
  if (!first) { if (ret) ret.back(); return; }
  try {
    if (!exploreMod) {
      islandShow('reading', 'Opening the 3D cell…');
      exploreMod = await import('./explore/cell3d.js?v=181');
      islandRest();
    }
    if (!exploreMod.supported()) {
      if (ret) ret.leave();
      renderMessage('assistant', CassieErrors.say('webgl'));
      return;
    }
    // Ask Cassie and Quiz me open a panel right here (labs/helper.js): the 3D view stays where it was
    const view = exploreMod.open({
      cell: want,
      allow: (k) => free3d(k, seen),
      onAsk: async (q, about) => { stopTeach3d(); (await help3dFor(view)).ask(q, about && about.part ? `Tell me about the ${String(about.part).toLowerCase()}.` : 'Tell me about this.'); },
      onQuiz: async (topic) => { stopTeach3d(); (await help3dFor(view)).quiz(topic); },
      // Teach me: Cassie tutors here too (labs/tutor.js); Ask Cassie: about what's on the screen
      onTeach: () => teach3d(view),
      onAskHere: async () => { stopTeach3d(); (await help3dFor(view)).ask('Explain what I\'m looking at simply, then ask me one quick question to check I understood.', 'What am I looking at?'); },
      // a short explanation of a tapped part of the body, without leaving the 3D view
      explain: (q) => (canChat() ? askShown(q) : Promise.reject(new Error('no brain'))),
      onClose: () => {
        if (view.kind !== 'body') lastCell = view.kind;
        stopTeach3d();
        lessons3d.clear(); // (a lesson is about the 3D view as it was on screen)
        dropHelp3d();
        if (ret) { ret.back(); return; }
        try { labsBtn && labsBtn.focus(); } catch (e) { /* ignore */ }
      },
    });
    if (ret && ret.opened) ret.opened(); // Labs stayed on screen until now (no flash of the chat)
    if (typeof first === 'string' && view.toast) view.toast(first);
  } catch (e) {
    if (ret) ret.back();
    islandShow('oops', 'Couldn’t open 3D', 2600);
    renderMessage('assistant', CassieErrors.say('open_3d_failed'));
  }
}
// a link like app.html?explore=plant (or =cells, =body) opens it straight away
{ const ex = new URLSearchParams(location.search).get('explore'); if (ex) setTimeout(() => openExplore(ex), 300); }

/* ---------- Labs: simulations to play with, then ask Cassie why ----------
   labs/ loads only when opened. "Ask Cassie" in a lab sends what's on its screen right now. */
const labsBtn = document.getElementById('labs-btn');
let labsMod = null;
async function openLabs(lab, more = {}) {
  deskCloseOthers('labs');
  track('feature', 'labs');
  refreshPlan();
  try {
    if (!labsMod) {
      islandShow('reading', 'Opening Labs…');
      labsMod = await import('./labs/labs.js?v=181');
      islandRest();
    }
    labsMod.open({
      lab,
      ...more,
      onAsk: (q) => handleSend(q),
      onQuiz: (topic) => startQuizOn(topic),
      // Ask Cassie and Quiz me stay inside the lab
      converse: IN_LAB.converse, format: IN_LAB.format, makeQuiz: IN_LAB.makeQuiz, onMark: IN_LAB.onMark,
      openExplore: (cell, ret) => openExplore(cell, ret),
      premium: PREMIUM,
      // a short hint from Cassie inside the lab, without leaving it
      explain: (q) => (canChat() ? askShown(q) : Promise.reject(new Error('no brain'))),
      // the study tools: your flashcard decks (spaced repetition) and reading your files
      addCards: (list, deck) => (window.CassieCards ? window.CassieCards.add(list, deck, 'labs') : 0),
      openCards: window.CassieCards ? (deck) => window.CassieCards.open(deck) : null,
      decks: () => boardDecks().decks(),
      readFile: async (file) => (await readDocument(file)).text,
      speak: (t) => window.CassieVoice && window.CassieVoice.speak(cleanForSpeech(t), { gender: voiceGender() }),
      speaker: lessonVoice,
      // Teach me (the tutor in a lab): listen to one question, and the student's level
      hear: canHear() ? hearOnce : null,
      level: [state.profile && state.profile.grade, state.profile && state.profile.level].filter(Boolean).join(' '),
      onTeach: (id) => track('feature', 'lab-teach-' + id),
      // the daily puzzles' score board (on Cassie's server)
      scores: SERVER ? scoreCall : null,
      onOpen: (id) => track('feature', 'lab-' + id),
      onClose: () => { try { labsBtn && labsBtn.focus(); } catch (e) { /* ignore */ } },
    });
  } catch (e) {
    islandShow('oops', 'Couldn’t open Labs', 2600);
    renderMessage('assistant', CassieErrors.say('open_labs_failed'));
  }
}
if (labsBtn) labsBtn.addEventListener('click', () => openLabs(undefined, { section: 'learn' }));
// Games: Labs, opened straight on the games shelf
document.getElementById('games-btn')?.addEventListener('click', () => openLabs(undefined, { section: 'games' }));
async function scoreCall(kind, body = {}) {
  const r = kind === 'today'
    ? await fetch(`${SERVER}/scores/today?day=${encodeURIComponent(body.day || '')}&uid=${encodeURIComponent(installId())}`)
    : await fetch(`${SERVER}/scores/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ uid: installId(), name: roomName() === 'Classmate' ? 'Student' : roomName(), ...body }) });
  const d = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(d.error || 'The score board isn’t available right now.');
  return d;
}
// app.html?lab=pendulum opens that lab
{ const lab = new URLSearchParams(location.search).get('lab'); if (lab) setTimeout(() => openLabs(lab), 300); }

if (quizBtn) {
  quizBtn.addEventListener('click', () => {
    if (!canChat()) {
      openSettings();
      detourToElement(groqKeyInput, { click: true, resumeAfter: 1200 });
      renderMessage('assistant', 'Add a free Groq or Gemini key in Settings first, then we can start a quiz.');
      return;
    }
    quizMode = !quizMode;
    if (quizMode) quizStarted(promptInput.value);
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
        ? `Quiz stopped. Nice work! I saved ${saved} question${saved === 1 ? '' : 's'} to practise again. Tap “Review my mistakes” on the home screen (New chat) any time, or turn them into flashcards (Ideas → Flashcards).`
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
      setQuizLabel('Quiz me');
      if (!state.messages.length) chatLog.innerHTML = '';
      renderMessage('assistant', "Okay: real talk mode. No lessons, no fluff. What's going on? I'm listening.");
      try { set3D('encouraging'); } catch (e) { /* ignore */ }
    } else {
      renderMessage('assistant', "Back to study mode. I'm here whenever you want to talk again.");
    }
  });
}

/* ---------- settings ---------- */
/* ---------- Reminders (web push): one a day at most, when cards are due or the streak ends tonight ----------
   Off until the student turns them on. Cassie's server keeps the push address with the hour, the time zone,
   the quiet hours and two facts (when the next card is due, the streak); the words of the reminder are written
   on this device (sw.js reads the snapshot below), so no card words leave it. */
const REMIND_CACHE = 'cassie-remind';
const remindOk = () => !!(SERVER && 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window);
const remindPrefs = () => ({ on: false, hour: 19, quietFrom: 22, quietTo: 7, ...(state.remind || {}) });
const hourName = (h) => `${h % 12 || 12}:00 ${h < 12 ? 'AM' : 'PM'}`;
function remindFacts() {
  const cards = (state.cards || []).filter((c) => c.due).sort((a, b) => a.due - b.due);
  const st = (window.CassieMemory && window.CassieMemory.data && window.CassieMemory.data.streak) || { count: 0, lastDay: '' };
  return { cards, nextDue: cards.length ? cards[0].due : 0, streak: st.count || 0, streakDay: st.lastDay || '' };
}
// what the service worker needs to write the reminder (this device only)
async function remindSnapshot() {
  const f = remindFacts();
  const snap = { due: f.cards.slice(0, 300).map((c) => c.due), soon: f.cards.slice(0, 5).map((c) => ({ due: c.due, f: String(c.f).replace(/\s+/g, ' ').slice(0, 60) })), streak: f.streak, streakDay: f.streakDay };
  try { const c = await caches.open(REMIND_CACHE); await c.put('/__remind', new Response(JSON.stringify(snap), { headers: { 'content-type': 'application/json' } })); } catch (e) { /* no cache here */ }
  return f;
}
var remindTimer = 0, remindSent = ''; // (var: save() can run before this line, while the app starts)
function remindSoon() {
  if (!(state.remind && state.remind.on)) return;
  clearTimeout(remindTimer);
  remindTimer = setTimeout(async () => {
    const f = await remindSnapshot(), facts = JSON.stringify([f.nextDue, f.streak, f.streakDay]);
    if (facts === remindSent) return; // (only when something changed)
    remindSent = facts;
    fetch(SERVER + '/push/state', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: installId(), nextDue: f.nextDue, streak: f.streak, streakDay: f.streakDay }) }).catch(() => {});
  }, 1500);
}
const b64uBytes = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)), (c) => c.charCodeAt(0));
async function remindSubscribe(p) {
  const key = await fetch(SERVER + '/push/key').then((r) => r.json());
  if (!key.on) throw Object.assign(new Error('off'), { why: 'server' });
  const perm = await Notification.requestPermission();
  if (perm !== 'granted') throw Object.assign(new Error('blocked'), { why: 'blocked' });
  const reg = await navigator.serviceWorker.ready;
  const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(key.key) });
  const f = await remindSnapshot();
  remindSent = JSON.stringify([f.nextDue, f.streak, f.streakDay]);
  const r = await fetch(SERVER + '/push/subscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: installId(), endpoint: sub.endpoint, hour: p.hour, quietFrom: p.quietFrom, quietTo: p.quietTo, tz: -new Date().getTimezoneOffset(), nextDue: f.nextDue, streak: f.streak, streakDay: f.streakDay }) });
  if (!r.ok) throw new Error('subscribe ' + r.status);
}
async function remindOff() {
  try { const reg = await navigator.serviceWorker.ready; const sub = await reg.pushManager.getSubscription(); if (sub) await sub.unsubscribe(); } catch (e) { /* already off */ }
  fetch(SERVER + '/push/unsubscribe', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ id: installId() }) }).catch(() => {});
}
function renderRemind() {
  const t = document.getElementById('remind-toggle'); if (!t) return;
  const p = remindPrefs(), note = document.getElementById('remind-note'), times = document.getElementById('remind-times');
  const ios = /iPhone|iPad/.test(navigator.userAgent), standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  t.checked = !!p.on; times.hidden = !p.on;
  t.disabled = !remindOk();
  if (!remindOk()) note.textContent = ios && !standalone ? 'On iPhone, add Cassie to your Home Screen first (Share, then Add to Home Screen), then turn reminders on there.' : 'This browser can’t show reminders.';
  else note.textContent = p.on ? `Cassie reminds you at ${hourName(p.hour)}, never between ${hourName(p.quietFrom)} and ${hourName(p.quietTo)}.` : '';
  const fill = (id, v) => { const s = document.getElementById(id); if (!s.options.length) s.innerHTML = Array.from({ length: 24 }, (_, h) => `<option value="${h}">${hourName(h)}</option>`).join(''); s.value = String(v); };
  fill('remind-hour', p.hour); fill('quiet-from', p.quietFrom); fill('quiet-to', p.quietTo);
}
async function setRemind(change) {
  const p = { ...remindPrefs(), ...change }, note = document.getElementById('remind-note');
  const quiet = (h) => (p.quietFrom === p.quietTo ? false : p.quietFrom < p.quietTo ? h >= p.quietFrom && h < p.quietTo : h >= p.quietFrom || h < p.quietTo);
  if (p.on && quiet(p.hour)) { note.textContent = `${hourName(p.hour)} is in your quiet hours. Pick another time, or change the quiet hours.`; renderRemindKeep(); return; }
  try {
    if (p.on) { note.textContent = 'Turning reminders on…'; await remindSubscribe(p); }
    else if (remindPrefs().on) await remindOff();
    state.remind = p; save(); track('feature', p.on ? 'remind-on' : 'remind-off');
    renderRemind();
  } catch (e) {
    state.remind = { ...p, on: false }; save(); renderRemind();
    note.textContent = e.why === 'blocked' ? 'Notifications are blocked for Cassie. Allow them in your browser’s site settings, then try again.' : e.why === 'server' ? 'Reminders aren’t switched on yet. Please try again later.' : 'Cassie couldn’t turn reminders on just now. Check your connection, then try again.';
  }
}
function renderRemindKeep() { const s = (id, v) => { document.getElementById(id).value = String(v); }; const p = remindPrefs(); s('remind-hour', p.hour); s('quiet-from', p.quietFrom); s('quiet-to', p.quietTo); }
document.getElementById('remind-toggle')?.addEventListener('change', (e) => setRemind({ on: e.target.checked }));
['remind-hour', 'quiet-from', 'quiet-to'].forEach((id) => document.getElementById(id)?.addEventListener('change', (e) => setRemind({ [{ 'remind-hour': 'hour', 'quiet-from': 'quietFrom', 'quiet-to': 'quietTo' }[id]]: +e.target.value })));
renderRemind();
// computers: whatever you open last is in front, so what was open before it closes first (each with its own close)
function deskCloseOthers(keep = '') {
  if (!sideWide.matches) return;
  if (keep !== 'settings' && !settingsPanel.hidden) closeSettings();
  const mem = document.getElementById('memory-panel');
  if (keep !== 'memory' && mem && !mem.hidden) closeMemory();
  if (keep !== 'labs' && document.documentElement.classList.contains('labs-open')) { const x = document.querySelector('.labs .labs-x'); if (x) x.click(); }
  if (keep !== 'cards' && document.documentElement.classList.contains('fc-open') && window.CassieCards) window.CassieCards.close();
  if (keep !== 'board' && window.CassieSketch && window.CassieSketch.isOpen && window.CassieSketch.isOpen()) window.CassieSketch.close();
}
function openSettings(page = 'all') {
  deskCloseOthers('settings');
  if (settingsPanel.hidden) setTrail = [];
  groqKeyInput.value = state.groqKey;
  groqModelSelect.value = state.groqModel;
  geminiKeyInput.value = state.geminiKey;
  voiceOutToggle.checked = state.voiceOut;
  if (highlightHelpToggle) highlightHelpToggle.checked = state.highlightHelp !== false;
  if (voiceGenderSelect) voiceGenderSelect.value = state.voiceGender === 'man' ? 'man' : 'woman';
  if (hearingSelect) hearingSelect.value = state.hearing === 'fast' ? 'fast' : 'accurate';
  showHumanVoiceSetting();
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
  if (keysSub && SERVER) keysSub.textContent = 'Optional, for heavy use';
  syncAccentSwatches();
  settingsPanel.hidden = false;
  setPage(page);
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
const ACCENT_NAMED = [['Cassie', 'cassie'], ['Monochrome', 'mono'], ['Forest', '#15803d'], ['Ocean', '#1d4ed8'], ['Plum', '#7e22ce'], ['Ember', '#c2410c']];
function buildAccentSwatches() {
  const wrap = document.getElementById('accent-swatches');
  if (!wrap) return;
  wrap.innerHTML = '';
  // (computers: a few colours by name first, then the whole palette)
  const named = document.getElementById('accent-named');
  if (named) named.innerHTML = ACCENT_NAMED.map(([n, c]) => `<button type="button" class="accent-chip" data-accent="${c}" aria-pressed="false"><i style="--sw:${c === 'cassie' ? 'var(--sw-blush)' : c === 'mono' ? 'var(--sw-ink)' : c}" aria-hidden="true"></i>${n}</button>`).join('');
  const none = document.createElement('button');
  none.type = 'button'; none.className = 'accent-sw accent-none';
  none.dataset.accent = 'cassie'; none.title = 'Cassie: blush and sage';
  none.setAttribute('aria-label', 'Cassie (blush and sage)');
  wrap.appendChild(none);
  const mono = document.createElement('button');
  mono.type = 'button'; mono.className = 'accent-sw accent-mono';
  mono.dataset.accent = 'mono'; mono.title = 'Monochrome: black and white';
  mono.setAttribute('aria-label', 'Monochrome (black and white)');
  wrap.appendChild(mono);
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

// computers: the list on the left of Settings opens each part
settingsPanel.querySelector('.set-nav').addEventListener('click', (e) => { const b = e.target.closest('[data-go]'); if (!b) return; setTrail = []; setPage(b.dataset.go); settingsPanel.querySelector('.settings-card').scrollTop = 0; });
// Mark the swatch matching the saved colour (or "None") as active.
function syncAccentSwatches() {
  const pick = accentChoice(), cur = pick === 'mono' ? 'mono' : pick || 'cassie';
  settingsPanel.querySelectorAll('.accent-chip[data-accent]').forEach((c) => c.setAttribute('aria-pressed', String(c.dataset.accent.toLowerCase() === cur)));
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
  if (bot2d) bot2d.setAccent(accentHex() || '#d8343c');
  if (islandBot) islandBot.setAccent(accentHex() || '#d8343c');
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
// every change is kept as it's made (and again on the way out), under the same keys as always
function commitSettings() {
  state.groqKey = groqKeyInput.value.trim();
  state.groqModel = groqModelSelect.value;
  state.geminiKey = geminiKeyInput.value.trim();
  state.voiceOut = voiceOutToggle.checked;
  if (highlightHelpToggle) { state.highlightHelp = highlightHelpToggle.checked; syncSideHl(); }
  if (voiceGenderSelect) state.voiceGender = voiceGenderSelect.value;
  if (hearingSelect) state.hearing = hearingSelect.value;
  if (state.voiceOut) track('feature', 'voice-out');
  if (levelSelect) state.level = levelSelect.value;
  if (citationSelect) state.citationStyle = citationSelect.value;
  if (textsizeSelect) state.textSize = textsizeSelect.value;
  if (easyreadToggle) state.easyRead = easyreadToggle.checked;
  save();
  updateModelPill();
  applyReading();
}
function closeSettings() {
  commitSettings();
  settingsPanel.hidden = true;
  resumeFollowing();
}
settingsBtn.addEventListener('click', () => {
  openSettings();
  detourToElement(settingsBtn, { click: true, resumeAfter: 900 });
});
settingsCloseBtn.addEventListener('click', closeSettings);
document.getElementById('settings-x').addEventListener('click', closeSettings);
settingsPanel.addEventListener('change', (e) => { if (!e.target.closest('.profile-card')) commitSettings(); });

/* ---------- You, Settings and Plans: one panel, a page at a time ----------
   "profile": who you are, a few numbers and the parts of Settings about you; "all": every setting
   in grouped glass lists, with search; a section ("account", "study", "voice", "privacy" ...) on its
   own with a back arrow; "plans": Free and Plus. */
const SET_TITLES = { profile: 'You', all: 'Settings', plans: 'Plans', account: 'Account', study: 'Study', appearance: 'Appearance', voice: 'Voice and sound', privacy: 'Privacy and data', help: 'Help' };
const setCard = settingsPanel.querySelector('.settings-card');
const setSearch = document.getElementById('settings-search');
let setTrail = [];
function setPage(page, { back = false } = {}) {
  const now = setCard.dataset.page;
  if (!back && now && now !== page && !settingsPanel.hidden) setTrail.push(now);
  setCard.dataset.page = page;
  document.getElementById('set-title').textContent = SET_TITLES[page] || 'Settings';
  settingsPanel.querySelector('.set-back').hidden = !setTrail.length;
  // a section page shows that section alone; the full list shows them all
  settingsPanel.querySelectorAll('.set-sec').forEach((sec) => { sec.hidden = page === 'all' ? false : sec.dataset.sec !== page; });
  settingsPanel.querySelectorAll('[data-page-only]').forEach((el) => { el.hidden = el.dataset.pageOnly !== page; });
  const secs = settingsPanel.querySelector('.set-secs');
  secs.hidden = !(page === 'all' || SET_TITLES[page] && !['profile', 'plans'].includes(page));
  if (page !== 'all' && setSearch.value) { setSearch.value = ''; filterSettings(); }
  if (page === 'profile') fillYou();
  if (page === 'study' || page === 'all') renderRemind();
  settingsPanel.querySelectorAll('.set-nav [data-go]').forEach((b) => { if (b.dataset.go === page) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
  setCard.scrollTop = 0;
}
function setBack() { const prev = setTrail.pop(); if (prev) setPage(prev, { back: true }); }
settingsPanel.querySelector('.set-back').addEventListener('click', setBack);
settingsPanel.addEventListener('click', (e) => { const l = e.target.closest('.set-link[data-open]'); if (l) setPage(l.dataset.open); });
document.getElementById('set-edit-profile').addEventListener('click', () => openProfile(false));
settingsPanel.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (setTrail.length) setBack(); else closeSettings(); } });
// Search: rows whose name (or section) matches; a section with none left hides
function filterSettings() {
  const q = setSearch.value.trim().toLowerCase();
  let any = false;
  settingsPanel.querySelectorAll('.set-sec').forEach((sec) => {
    const title = sec.querySelector('.set-sec-h').textContent.toLowerCase();
    let shown = 0;
    sec.querySelectorAll('.set-row').forEach((r) => {
      const name = [r.dataset.k || '', (r.querySelector('span, summary .sg-title, button') || r).textContent].join(' ').toLowerCase();
      const ok = !q || name.includes(q) || title.includes(q);
      r.hidden = !ok; if (ok) shown++;
    });
    sec.hidden = !shown; if (shown) any = true;
  });
  document.getElementById('settings-none').hidden = any;
}
setSearch.addEventListener('input', filterSettings);
// the numbers on You: questions asked this week, cards learned, the study streak
function fillYou() {
  const p = state.profile || {};
  const name = (p.name || '').trim();
  document.getElementById('set-name').textContent = name || 'You';
  document.getElementById('set-initial').textContent = (name || 'C')[0].toUpperCase();
  document.getElementById('set-level').textContent = [p.role === 'pro' ? 'Working professional' : p.grade, state.account && state.account.email].filter(Boolean).join(' · ') || 'Add your level in Edit';
  const week = Date.now() - 7 * 864e5;
  const asked = state.chats.reduce((n, c) => n + (c.messages || []).filter((m) => m.role === 'user' && (m.at || c.updatedAt || 0) >= week).length, 0);
  document.getElementById('st-questions').textContent = asked;
  document.getElementById('st-cards').textContent = (state.cards || []).filter((c) => (c.box || 0) >= 4).length;
  document.getElementById('st-streak').textContent = window.CassieMemory ? window.CassieMemory.stats().streak : 0;
}
// Favorite-colour swatches: preset click, "None", or a custom colour.
settingsPanel.addEventListener('click', (e) => {
  const sw = e.target.closest('.accent-sw[data-accent], .accent-chip[data-accent]');
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
      <p class="mem-privacy">${memIcon('lock')}Everything here stays on your device. No account, no server. Only you can see it.</p>
      ${hasData ? `
      <div class="mem-stats">
        <div class="mem-stat"><b>${memIcon('flame')}${s.streak}</b><small>day streak</small></div>
        <div class="mem-stat"><b>${memIcon('check')}${s.mastered}</b><small>mastered</small></div>
        <div class="mem-stat"><b>${memIcon('clock')}${s.focusHours}h</b><small>focus</small></div>
        <div class="mem-stat"><b>${memIcon('book')}${s.topics}</b><small>topics</small></div>
        <div class="mem-stat"><b>${memIcon('repeat')}${s.due}</b><small>to review</small></div>
      </div>
      <p class="mem-note">A gentle tracker. It grows as you learn. No streak-shaming here.</p>` : `
      <p class="mem-welcome">This is where your progress will live. Ask Cassie a question or finish a focus session, and your streak, topics, and reviews start filling in here.</p>`}

      <label class="field"><span>Your name (optional)</span><input id="mem-name" type="text" value="${memEsc(d.profile.name)}" placeholder="What should I call you?"></label>
      <label class="field"><span>Your goal (optional)</span><input id="mem-goal" type="text" value="${memEsc(d.profile.goal)}" placeholder="e.g. pass my chemistry finals"></label>

      ${due.length ? `<div class="mem-section">Due for review</div><div class="mem-chips">${due.map((t) => `<button class="mem-review" data-topic="${memEsc(t.name)}">${memEsc(t.name)}</button>`).join('')}</div>` : ''}
      ${weak.length ? `<div class="mem-section">Weak spots</div><div class="mem-chips">${weak.map((t) => `<button class="mem-review weak" data-topic="${memEsc(t.name)}">${memEsc(t.name)}</button>`).join('')}</div>` : ''}

      <div class="mem-section">Recently studied</div>
      ${recent.length ? `<div class="mem-topics">${recent.map(memTopicRow).join('')}</div>` : '<div class="mem-empty-slot"></div>'}

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
  const memSlot = memoryPanel.querySelector('.mem-empty-slot');
  if (window.CassieMic) window.CassieMic.attach(document.getElementById('mem-fact'));
  if (memSlot) memSlot.replaceWith(CassieErrors.empty({ title: 'Nothing remembered yet', text: 'Cassie remembers the topics you study, so she can help you review them later.', action: 'Ask a question', onAction: () => { memoryPanel.hidden = true; document.querySelector('.tabbar [data-tab="chat"]')?.click(); promptInput.focus(); } }));
}

function openMemory() {
  if (!memoryPanel) return;
  deskCloseOthers('memory');
  renderMemory();
  memoryPanel.hidden = false;
}
function closeMemory() { if (memoryPanel) memoryPanel.hidden = true; updateMemoryDot(); }

function startReview(topic) {
  closeMemory();
  if (!topic) return;
  quizMode = true;
  if (quizBtn) quizBtn.classList.add('active');
  setQuizLabel('Stop quiz');
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
    try { set3D(pose); } catch (e) { /* */ }
    try { mascotSay(msg, 5200); } catch (e) { /* */ }
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
      try { if (window.CassieMemory) { window.CassieMemory.addFocusMinutes(times.focus); updateMemoryDot(); } } catch (e) { /* */ }
      progressAdd({ focus: times.focus }); // (the weekly card)
      const long = cycles % 4 === 0;
      switchMode(long ? 'long' : 'break');
      nudge(long ? `Awesome focus! Take a ${times.long}-minute break: stretch and breathe.` : `Nice work! ${times.brk}-minute break: drink some water and rest your eyes.`, 'encouraging');
    } else {
      switchMode('focus');
      nudge(`Break's over: ${times.focus} minutes of focus. Let's go!`, 'thinking');
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
  renderChatList(); syncSideHl();
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
    chatList.appendChild(CassieErrors.empty({
      title: 'No chats yet',
      text: 'Every chat you start with Cassie is kept here, so you can come back to it.',
      action: 'Ask your first question',
      onAction: () => { closeSidebar(); document.querySelector('.tabbar [data-tab="chat"]')?.click(); promptInput.focus(); },
    }));
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
  applySideSearch();
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
  setDeskPage('chat'); // (a computer: a new chat is a blank chat with the ask box; Home is in the sidebar)
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
let readAloud = null; // the answer being read aloud right now
// Read an answer aloud in Bella's studio voice (voice.js). When what's left of the month's voice
// can't cover it, she types instead and says so once: never another voice.
function speak(text) {
  if (!state.voiceOut || voiceChat) return; // the voice screen speaks for itself
  if (readAloud) { readAloud.stop(); readAloud = null; }
  const clean = cleanForSpeech(text);
  if (!clean || !humanVoiceWanted()) return;
  const h = window.CassieVoice.speak(clean, { gender: voiceGender(), onStart: () => botMood('talking') });
  readAloud = h;
  h.done.then(() => { if (readAloud === h) readAloud = null; if (bot2d && bot2d.state === 'talking') botMood('idle'); });
}

/* ---------- Talk with Cassie: a real voice conversation ----------
   The sound-wave button opens a screen where you just talk. Three ways to use it:
     Chat         — ask anything out loud
     Teach Cassie — explain a topic; she plays the curious classmate and asks questions
                    (you learn by teaching), then tells you what you missed
     Quiz me      — she quizzes you out loud and tells you if you got it right
   Hearing you: the browser's own speech recognition (Chrome, Edge, Safari). Where there
   isn't one, the app records and the Cassie server (or your own Groq key) writes it down.
   Talking: Bella's studio voice only; when it isn't there, the chat goes on typed. Everything is saved in the chat. */
const VOICE_MODES = {
  chat: { label: 'Chat', hello: 'Hi! I’m listening. Ask me anything.', tip: 'Ask anything out loud. Tap Cassie to stop her talking.' },
  teach: { label: 'Teach Cassie', hello: 'Okay, I’m your student today! What are you going to teach me?', tip: 'Explain a topic like you’re teaching a friend. Cassie asks questions and catches what you missed. Say “I’m done” for your report.' },
  quiz: { label: 'Quiz me', hello: 'Quiz time! What topic should I quiz you on?', tip: 'Answer out loud. Cassie tells you if you’re right and why.' },
};
const voiceBtn = document.getElementById('voice-btn');
const canHear = () => !!SpeechRecognitionCtor || !!(navigator.mediaDevices && window.MediaRecorder);
// the mic beside the other boxes (mic.js): where the browser can't listen, Cassie's server writes it down
if (window.CassieMic) window.CassieMic.setup({ transcribe: (blob) => transcribeAudio(blob) });
const boardHear = () => (window.CassieMic && window.CassieMic.can() ? window.CassieMic.listen : null);
// Cassie's voice (voice.js): Bella, her studio voice, through Cassie's server. It is the only voice.
const humanVoiceWanted = () => !!window.CassieVoice && window.CassieVoice.supported();
if (window.CassieVoice && SERVER) window.CassieVoice.studio.setup({ server: SERVER, uid: installId(), token: () => authToken() }); // (the voice is per account: signed in, its plan's month)
if (window.CassieVoice) window.CassieVoice.onChange(voiceHalfNote);
// half of this month's studio voice used: Cassie says so, once a month per account
function voiceHalfNote() {
  const S = window.CassieVoice && window.CassieVoice.studio;
  if (!S || !S.known() || S.guest() || !S.max() || !state.account) return;
  const used = S.used(), max = S.max(), mark = `${state.account.email}|${phDay().slice(0, 7)}`;
  if (used < max / 2 || state.voiceHalf === mark) return;
  state.voiceHalf = mark; save();
  const back = /^\d{4}-\d{2}-\d{2}$/.test(S.back()) ? new Date(S.back() + 'T12:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'the 1st';
  const n = document.createElement('p'); // (a note on screen for a few seconds, like the voice's own notes)
  n.className = 'cv-note voice-half'; n.setAttribute('role', 'status');
  n.textContent = `Heads up: you’ve used half of this month’s studio voice. ${Math.max(0, max - used).toLocaleString('en-PH')} of ${max.toLocaleString('en-PH')} characters left, and it all comes back on ${back}.`;
  document.body.appendChild(n);
  setTimeout(() => n.remove(), 9000);
}
function voiceAgain() { try { if (window.CassieVoice && SERVER) window.CassieVoice.studio.refresh(); } catch (e) { /* ignore */ } }
let voiceUI = null;

// Turn an answer into something that sounds right read aloud.
function cleanForSpeech(t) {
  return String(t || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/\[\[[^\]]*\]\]/g, ' ')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/\\frac\{([^}]*)\}\{([^}]*)\}/g, '$1 over $2')
    .replace(/\\sqrt\{([^}]*)\}/g, 'the square root of $1')
    .replace(/\\times|×/g, ' times ').replace(/\\div|÷/g, ' divided by ').replace(/\\cdot|·/g, ' times ')
    .replace(/\^2\b/g, ' squared').replace(/\^3\b/g, ' cubed').replace(/\^\{?(-?\w+)\}?/g, ' to the power of $1')
    .replace(/≠/g, ' is not equal to ').replace(/≤/g, ' is at most ').replace(/≥/g, ' is at least ').replace(/→/g, ' to ')
    .replace(/\s=\s/g, ' equals ')
    .replace(/\\[a-zA-Z]+/g, ' ').replace(/[$\\{}]/g, '')
    .replace(/^\s*[-*•]\s+/gm, '').replace(/^\s*#+\s*/gm, '').replace(/[*_#>|]+/g, ' ')
    .replace(/\s+/g, ' ').trim();
}
// Cassie's voice can be a woman's (Jessica) or a man's (Chris): Settings, or the switch on the voice screen.
const voiceGender = () => (state.voiceGender === 'man' ? 'man' : 'woman');
function buildVoiceUI() {
  const el = document.createElement('div');
  el.className = 'vc';
  el.hidden = true;
  el.setAttribute('role', 'dialog');
  el.setAttribute('aria-label', 'Talk with Cassie');
  el.innerHTML = `
    <div class="vc-top">
      <button type="button" class="vc-x" aria-label="End the conversation">×</button>
      <div class="vc-modes" role="tablist" aria-label="How to talk">
        ${Object.entries(VOICE_MODES).map(([k, m]) => `<button type="button" role="tab" data-vmode="${k}">${m.label}</button>`).join('')}
      </div>
      <div class="vc-gender" role="radiogroup" aria-label="Cassie's voice"><button type="button" role="radio" data-gender="woman">Woman</button><button type="button" role="radio" data-gender="man">Man</button></div>
    </div>
    <button type="button" class="vc-stage" aria-label="Cassie. Tap her to stop her talking, or to start listening"><span class="vc-ring"></span><span class="vc-bot"></span></button>
    <p class="vc-status" aria-live="polite"></p>
    <p class="vc-you"></p>
    <p class="vc-cassie" aria-live="polite"></p>
    <div class="vc-care" hidden></div>
    <div class="vc-bar">
      <button type="button" class="vc-mic" aria-label="Pause listening"><svg viewBox="0 0 24 24"><path d="M12 15a3 3 0 0 0 3-3V6a3 3 0 0 0-6 0v6a3 3 0 0 0 3 3zm5-3a5 5 0 0 1-10 0H5a7 7 0 0 0 6 6.9V21h2v-2.1A7 7 0 0 0 19 12h-2z"/></svg></button>
    </div>
    <p class="vc-tip"></p>`;
  document.body.appendChild(el);
  const q = (s) => el.querySelector(s);
  const ui = { el, status: q('.vc-status'), you: q('.vc-you'), cassie: q('.vc-cassie'), care: q('.vc-care'), mic: q('.vc-mic'), tip: q('.vc-tip'), gender: q('.vc-gender'), stage: q('.vc-stage'), bot: null };
  if (window.CassieBot) ui.bot = window.CassieBot.create(q('.vc-bot'), { glow: true, accent: accentHex() || '#d8343c' });
  q('.vc-x').addEventListener('click', closeVoice);
  el.addEventListener('keydown', (e) => { if (e.key === 'Escape') closeVoice(); });
  q('.vc-modes').addEventListener('click', (e) => { const b = e.target.closest('[data-vmode]'); if (b && voiceChat && b.dataset.vmode !== voiceChat.mode) startVoiceMode(b.dataset.vmode); });
  ui.mic.addEventListener('click', () => {
    const v = voiceChat;
    if (!v) return;
    if (v.phase === 'listening') { if (v.heardSomething && v.finish) v.finish(); else pauseVoice(); }
    else if (v.phase === 'speaking') { v.stopSpeaking && v.stopSpeaking(); }
    else if (v.phase === 'paused') listenVoice();
  });
  // tapping Cassie: stops her talking; when she isn't, it's the mic (a tap on her always does something)
  ui.stage.addEventListener('click', () => {
    const v = voiceChat;
    if (!v) return;
    if (v.phase === 'speaking' && v.stopSpeaking) v.stopSpeaking();
    else if (v.phase === 'paused') listenVoice();
    else if (v.phase === 'listening') setVoicePhase('listening', 'I’m listening. Say something, or tap the mic to pause.');
  });
  const markGender = () => ui.gender.querySelectorAll('[data-gender]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.gender === voiceGender())));
  markGender();
  ui.gender.addEventListener('click', (e) => {
    const b = e.target.closest('[data-gender]');
    if (!b) return;
    state.voiceGender = b.dataset.gender; save(); markGender();
    const sel = document.getElementById('voice-gender-select'); if (sel) sel.value = voiceGender();
    if (voiceChat && voiceChat.phase !== 'thinking') { voiceChat.stopSpeaking && voiceChat.stopSpeaking(); stopHearing(); newConversationVoice(voiceChat); sayThenListen('Hi! This is my voice now.'); }
  });
  ui.markGender = markGender;
  return ui;
}

/* Settings → Voice: is Bella's voice there, and when is she back if she's resting? */
const HV_SAMPLE = 'Hi! I’m Cassie. Let’s study together. Ask me anything, and I’ll explain it step by step.';
const VOICE_ENOUGH = 400; // (about one spoken answer)
function voiceBackDate(back) {
  const d = /^\d{4}-\d{2}-\d{2}$/.test(back || '') ? new Date(back + 'T12:00:00') : null;
  return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'tomorrow';
}
function voiceLine() {
  const CV = window.CassieVoice;
  if (!CV || !CV.supported()) return CassieErrors.say('voice_unsupported');
  if (!CV.studio.known()) return SERVER ? 'Checking Cassie’s voice…' : CassieErrors.say('voice_not_set_up');
  if (!CV.studio.on()) return CassieErrors.say('voice_not_set_up');
  if (CV.studio.left() < VOICE_ENOUGH) return CassieErrors.say('voice_resting', { date: voiceBackDate(CV.studio.back()) });
  return `${voiceGender() === 'man' ? 'Chris’s' : 'Jessica’s'} voice is ready. Cassie reads her answers aloud in it.`;
}
function showHumanVoiceSetting() {
  const box = document.getElementById('hv-state');
  if (box) box.textContent = voiceLine();
}
function playHumanSample() {
  const CV = window.CassieVoice;
  if (!CV || !CV.supported()) { showHumanVoiceSetting(); return; }
  CV.unlock(); // inside the tap
  CV.speak(HV_SAMPLE, { gender: voiceGender() });
}
document.getElementById('hv-play')?.addEventListener('click', playHumanSample);
document.getElementById('voice-gender-select')?.addEventListener('change', () => { state.voiceGender = document.getElementById('voice-gender-select').value; showHumanVoiceSetting(); });
if (window.CassieVoice) window.CassieVoice.onChange(showHumanVoiceSetting);

// The voice screen decides when it opens: Bella for the whole conversation, or a typed chat when
// what's left of her voice can't cover it. She never speaks in another voice.
function newConversationVoice(v) {
  if (v.voice) v.voice.end();
  v.voice = window.CassieVoice && window.CassieVoice.session ? window.CassieVoice.session({ gender: voiceGender(), onText: () => voiceToTyped(v) }) : null;
  if (!v.voice) { voiceToTyped(v); return false; }
  return v.voice.start() === 'studio';
}
// Bella stopped partway: what she was saying is in the chat, the voice screen closes, the chat goes
// on typed, and the one line says why (once)
function voiceToTyped(v) {
  if (v.typed) return;
  v.typed = true;
  if (voiceChat === v) closeVoice();
  toTypedChat();
}
function toTypedChat() {
  if (window.CassieVoice) window.CassieVoice.notice();
  try { promptInput.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
}
function setVoicePhase(phase, text) {
  const v = voiceChat, ui = voiceUI;
  if (!v || !ui) return;
  v.phase = phase;
  ui.el.dataset.phase = phase;
  const say = { listening: 'Listening…', thinking: 'Thinking…', speaking: 'Cassie is talking. Tap her to cut in', paused: 'Paused. Tap the mic to talk' }[phase];
  ui.status.textContent = text || say || '';
  const mood = { listening: 'listening', thinking: 'thinking', speaking: 'talking', paused: 'idle' }[phase] || 'idle';
  if (ui.bot) ui.bot.setState(mood);
  ui.mic.setAttribute('aria-label', phase === 'listening' ? (v.heardSomething ? 'Send now' : 'Pause listening') : phase === 'speaking' ? 'Stop Cassie talking' : 'Start talking');
  ui.mic.classList.toggle('live', phase === 'listening');
}

function stopHearing() {
  const v = voiceChat;
  if (!v) return;
  if (v.rec) { try { v.rec.onend = null; v.rec.abort ? v.rec.abort() : v.rec.stop(); } catch (e) { /* ignore */ } v.rec = null; }
  if (v.recorder) { try { v.recorder.onstop = null; if (v.recorder.state !== 'inactive') v.recorder.stop(); } catch (e) { /* ignore */ } v.recorder = null; }
  clearInterval(v.vadTimer);
  v.finish = null;
}
function pauseVoice() { stopHearing(); setVoicePhase('paused'); }

// Cassie says something, then listens again.
function sayThenListen(text) {
  const v = voiceChat;
  if (!v) return Promise.resolve();
  const clean = cleanForSpeech(text);
  voiceUI.cassie.textContent = clean;
  setVoicePhase('speaking');
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return; done = true;
      clearTimeout(v.speakTimer);
      v.stopSpeaking = null;
      resolve();
      if (voiceChat === v && !v.typed) { if (v.wantPause) setVoicePhase('paused'); else listenVoice(); }
    };
    // Bella says it; if she can't, the words are on the screen and the chat goes on typed
    if (!clean || v.typed || !v.voice) { finish(); return; }
    const h = v.voice.speak(clean);
    v.stopSpeaking = () => { h.stop(); finish(); };
    h.done.then(() => { if (!done && voiceChat === v) finish(); });
  });
}

function listenVoice() {
  const v = voiceChat;
  if (!v) return;
  stopHearing();
  v.heardSomething = false; // what you said last stays on screen until you speak again
  setVoicePhase('listening');
  if (SpeechRecognitionCtor && !v.useRecorder) listenWithBrowser(v); else listenWithRecorder(v);
}
// Whisper (Groq, through Cassie's server or your own key) hears better than the browser —
// accents, Taglish and science words — so Cassie uses it when she can.
function accurateHearing() {
  return (SERVER || state.groqKey) && navigator.mediaDevices && window.MediaRecorder && (window.AudioContext || window.webkitAudioContext) && state.hearing !== 'fast';
}
function heard(text) {
  const v = voiceChat;
  if (!v) return;
  stopHearing();
  voiceUI.you.textContent = text;
  askOutLoud(text);
}
// Is the microphone really blocked? Phones (iPhone most of all) also refuse to listen when the
// mic is busy — Cassie was still talking, or listening started without a tap — even though it is
// allowed. Only a real "blocked" asks you to change the setting; otherwise a tap on the mic does it.
async function micBlocked() {
  try { const p = await navigator.permissions.query({ name: 'microphone' }); return p.state === 'denied'; } catch (e) { return null; } // null: this browser can't say
}
const MIC_BLOCKED = CassieErrors.say('mic_blocked');
async function micTrouble(v, sure) {
  if (voiceChat !== v) return;
  const blocked = await micBlocked();
  if (voiceChat !== v) return;
  if (blocked === true || (blocked === null && sure)) setVoicePhase('paused', /iPhone|iPad/.test(navigator.userAgent) ? MIC_BLOCKED + ' (iPhone: Settings → Safari → Microphone → Allow.)' : MIC_BLOCKED);
  else setVoicePhase('paused', 'Tap the mic to talk.');
}
function listenWithBrowser(v) {
  const rec = new SpeechRecognitionCtor();
  rec.lang = navigator.language || 'en-US';
  rec.continuous = true;
  rec.interimResults = true;
  let finalText = '', interim = '', timer = 0, sent = false, restarts = 0;
  const send = () => {
    if (sent) return; sent = true; clearTimeout(timer);
    const t = (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
    if (t) heard(t); else listenVoice();
  };
  rec.onresult = (e) => {
    interim = '';
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const r = e.results[i];
      if (r.isFinal) finalText += r[0].transcript + ' '; else interim += r[0].transcript;
    }
    const t = (finalText + interim).trim();
    v.micWorked = true;
    v.heardSomething = !!t;
    voiceUI.you.textContent = t;
    if (t) setVoicePhase('listening', 'Listening… tap the mic to send now');
    clearTimeout(timer);
    timer = setTimeout(send, interim ? 1400 : 850); // a short pause means they've finished
  };
  rec.onerror = async (e) => {
    if (!/not-allowed|service-not-allowed|audio-capture/.test(e.error)) return;
    sent = true;
    // the recorder often works where the browser's listener won't (on iPhone it wants a fresh tap
    // every time) — unless the microphone really is blocked
    const canRecord = navigator.mediaDevices && window.MediaRecorder && (SERVER || state.groqKey);
    if (canRecord && !v.triedRecorder && (e.error !== 'not-allowed' || (await micBlocked()) !== true)) {
      v.triedRecorder = true; v.useRecorder = true;
      if (voiceChat === v) listenVoice();
      return;
    }
    micTrouble(v, e.error === 'not-allowed' && !v.micWorked);
  };
  rec.onend = () => {
    if (sent || voiceChat !== v || v.phase !== 'listening') return;
    if ((finalText + interim).trim()) { send(); return; }
    if (++restarts > 8) { sent = true; setVoicePhase('paused', 'Still there? Tap the mic when you’re ready.'); return; }
    try { rec.start(); } catch (e) { sent = true; setTimeout(listenVoice, 300); }
  };
  v.rec = rec;
  v.finish = send;
  try { rec.start(); } catch (e) { setTimeout(() => { if (voiceChat === v && v.phase === 'listening') listenVoice(); }, 400); }
}
async function listenWithRecorder(v) {
  // a microphone that went quiet (the phone took it back while Cassie talked) is opened again
  if (v.stream && !v.stream.getAudioTracks().some((t) => t.readyState === 'live')) { v.stream.getTracks().forEach((t) => t.stop()); v.stream = null; }
  if (!v.stream) {
    for (let tries = 0; !v.stream && tries < 2; tries++) {
      try { v.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); }
      catch (e) {
        if (voiceChat !== v) return;
        if (/NotAllowed|Security/.test(e.name) || tries) {
          // busy or refused: the browser's own listener may still work; otherwise say what to do
          if (!/NotAllowed|Security/.test(e.name) && SpeechRecognitionCtor && !v.triedBrowser) { v.triedBrowser = true; v.useRecorder = false; listenVoice(); return; }
          micTrouble(v, /NotAllowed|Security/.test(e.name) && !v.micWorked); return;
        }
        await new Promise((r) => setTimeout(r, 400)); // the mic may still be busy for a moment
      }
    }
  }
  v.micWorked = true;
  if (voiceChat !== v || v.phase !== 'listening') return;
  const type = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'].find((t) => window.MediaRecorder.isTypeSupported && MediaRecorder.isTypeSupported(t)) || '';
  const recorder = new MediaRecorder(v.stream, type ? { mimeType: type } : undefined);
  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
  // hear when they start and stop talking
  let an = null, buf = null, src = null;
  try {
    v.actx = v.actx || new (window.AudioContext || window.webkitAudioContext)();
    src = v.actx.createMediaStreamSource(v.stream);
    an = v.actx.createAnalyser(); an.fftSize = 1024; src.connect(an);
    buf = new Float32Array(an.fftSize);
  } catch (e) { an = null; }
  // without a loudness meter Cassie can't tell when you stop: the mic button sends
  if (!an) { v.heardSomething = true; setVoicePhase('listening', 'Talk, then tap the mic to send'); }
  let spoke = false, lastLoud = 0;
  const t0 = Date.now();
  const stop = () => { clearInterval(v.vadTimer); try { if (recorder.state !== 'inactive') recorder.stop(); } catch (e) { /* ignore */ } try { src && src.disconnect(); } catch (e) { /* ignore */ } };
  v.finish = () => { spoke = true; stop(); };
  v.vadTimer = setInterval(() => {
    if (voiceChat !== v || v.phase !== 'listening') { stop(); return; }
    const now = Date.now();
    if (an) {
      an.getFloatTimeDomainData(buf);
      let sum = 0; for (let i = 0; i < buf.length; i++) sum += buf[i] * buf[i];
      if (Math.sqrt(sum / buf.length) > 0.02) {
        spoke = true; lastLoud = now;
        if (!v.heardSomething) { v.heardSomething = true; setVoicePhase('listening', 'Listening… tap the mic to send now'); }
      }
    }
    if (spoke && an && now - lastLoud > 800) stop();
    else if (!spoke && now - t0 > 15000) stop();
    else if (now - t0 > 45000) stop();
  }, 100);
  recorder.onstop = async () => {
    v.recorder = null;
    if (voiceChat !== v) return;
    if (!spoke) { setVoicePhase('paused', 'Still there? Tap the mic when you’re ready.'); return; }
    setVoicePhase('thinking', 'Writing down what you said…');
    try {
      const text = await transcribeAudio(new Blob(chunks, { type: recorder.mimeType || type || 'audio/webm' }));
      if (voiceChat !== v) return;
      v.hearFails = 0;
      if (text && !/^(thank you\.?|thanks for watching!?|you)$/i.test(text)) heard(text); else sayThenListen('Sorry, I didn’t catch that. Can you say it again?');
    } catch (e) {
      if (voiceChat !== v) return;
      v.hearFails = (v.hearFails || 0) + 1;
      if (v.hearFails >= 2 && SpeechRecognitionCtor) v.useRecorder = false; // the browser listens instead
      sayThenListen(e.friendly ? e.message : CassieErrors.say('not_heard'));
    }
  };
  v.recorder = recorder;
  recorder.start(250);
}
// A hint for Whisper: the words of what you're talking about, so "mitochondria" isn't heard as "my toe kondria".
function hearingHint() {
  const recent = state.messages.slice(-4).map((m) => (typeof m.content === 'string' ? m.content : '')).join(' ');
  return cleanForSpeech(recent).slice(-400);
}
/* A pinch inside a full-screen view (Labs, a lab, the 3D body and cells, the board) turns and zooms the
   picture, never the whole page: on iPhones a zoomed page leaves buttons hard to tap (or not tappable)
   and stays zoomed after you leave. In the chat, pinch-to-zoom stays on for reading. */
const inFullView = () => document.documentElement.matches('.labs-open, .x3d-open') || !!document.querySelector('.csk-wrap');
const pageZoomed = () => !!window.visualViewport && visualViewport.scale > 1.01;
// (a page that is zoomed anyway can always be pinched back out: blocking that left students stuck)
['gesturestart', 'gesturechange'].forEach((t) => document.addEventListener(t, (e) => { if (inFullView() && !pageZoomed()) e.preventDefault(); }, { passive: false }));
// two fingers on a view's buttons and panels must not zoom the page either (the 3D canvas uses them itself)
document.addEventListener('touchmove', (e) => { if (e.touches && e.touches.length > 1 && inFullView() && !pageZoomed() && !(e.target.closest && e.target.closest('canvas'))) e.preventDefault(); }, { passive: false });
// While a full view is open the page is held at its normal size (maximum-scale=1, for as long as the view
// is open): this also stops an iPhone zooming into a box you type in, and puts back a page that got zoomed.
const viewportMeta = document.querySelector('meta[name=viewport]'), viewportBase = viewportMeta && viewportMeta.content;
const viewportHeld = viewportBase + ', maximum-scale=1';
function holdPageSize() {
  if (!viewportMeta) return;
  const want = inFullView() ? viewportHeld : viewportBase;
  if (viewportMeta.content !== want) viewportMeta.content = want;
  else if (want === viewportHeld && pageZoomed()) { viewportMeta.content = viewportBase + ', maximum-scale=1, minimum-scale=1'; requestAnimationFrame(() => { viewportMeta.content = viewportHeld; }); }
}
new MutationObserver(holdPageSize).observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });
new MutationObserver(holdPageSize).observe(document.body, { childList: true }); // (the board opens without a class on the page)
document.addEventListener('focusin', holdPageSize, true);
if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (inFullView()) setTimeout(holdPageSize, 150); });

// One thing said out loud (the lab tutor's 🎤): the browser's own listening where there is one, else a
// short recording written down by Whisper. { done: Promise<text>, stop() } — stop() ends it early.
function hearOnce() {
  let stopFn = () => {}, finish, fail;
  const done = new Promise((res, rej) => { finish = res; fail = rej; });
  if (SpeechRecognitionCtor) {
    const rec = new SpeechRecognitionCtor();
    rec.continuous = false; rec.interimResults = false;
    let got = '';
    rec.addEventListener('result', (e) => { got = e.results[0][0].transcript; });
    rec.addEventListener('error', (e) => { if (e.error === 'no-speech' || e.error === 'aborted') finish(''); else fail(friendlyError(CassieErrors.say(/not-allowed|service-not-allowed/.test(e.error) ? 'mic_blocked' : 'not_heard'))); });
    rec.addEventListener('end', () => finish(got));
    try { rec.start(); } catch (e) { fail(e); }
    stopFn = () => { try { rec.stop(); } catch (e) { /* already stopped */ } };
  } else if (navigator.mediaDevices && window.MediaRecorder) {
    navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
      const mr = new MediaRecorder(stream), chunks = [];
      mr.addEventListener('dataavailable', (e) => { if (e.data && e.data.size) chunks.push(e.data); });
      mr.addEventListener('stop', async () => {
        stream.getTracks().forEach((t) => t.stop());
        try { finish(chunks.length ? await transcribeAudio(new Blob(chunks, { type: mr.mimeType || 'audio/webm' })) : ''); } catch (e) { fail(e); }
      });
      mr.start();
      stopFn = () => { if (mr.state !== 'inactive') mr.stop(); };
      setTimeout(stopFn, 15000);
    }).catch(() => fail(new Error('Allow the microphone to talk to Cassie, or type instead.')));
  } else fail(friendlyError(CassieErrors.say('cant_listen')));
  return { done, stop: () => stopFn() };
}
async function transcribeAudio(blob) {
  const ext = /mp4/.test(blob.type) ? 'm4a' : /ogg/.test(blob.type) ? 'ogg' : 'webm';
  const hint = hearingHint();
  const form = (extra) => { const fd = new FormData(); fd.append('file', blob, 'speech.' + ext); if (hint) fd.append('prompt', hint); Object.entries(extra).forEach(([k, val]) => fd.append(k, val)); return fd; };
  if (state.groqKey) {
    try {
      const r = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', { method: 'POST', headers: { authorization: 'Bearer ' + state.groqKey }, body: form({ model: 'whisper-large-v3-turbo', response_format: 'json' }) });
      if (r.ok) return String((await r.json()).text || '').trim();
    } catch (e) { /* the server can still do it */ }
  }
  if (SERVER) {
    let r;
    try { r = await fetch(SERVER + '/transcribe', { method: 'POST', body: form({ uid: installId() }), signal: waitAtMost(SERVER_WAIT.hear) }); }
    catch (e) { throw new Error(tooSlow(e) ? 'That took too long. Try saying it again?' : 'Sorry, I couldn’t hear that. Try again?'); }
    if (r.status === 404 && SpeechRecognitionCtor && voiceChat) { voiceChat.useRecorder = false; throw new Error('Sorry, can you say that again?'); } // an older server: the browser listens instead
    if (r.ok) return String((await r.json()).text || '').trim();
    let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
    throw new Error(m || 'Sorry, I couldn’t hear that. Try again?');
  }
  throw new Error('To talk with me here, use Chrome, Edge or Safari, or add a free Groq key in Settings.');
}

// Cut a growing answer into pieces to speak: the first piece as soon as there is one (short, so
// she starts quickly), later ones a sentence or two at a time. Returns [pieces, where it got to].
function speakablePieces(text, from, finished) {
  const out = [];
  let i = from;
  for (;;) {
    const rest = text.slice(i);
    if (!rest.trim()) break;
    const first = !out.length && from === 0;
    const m = /[.!?…]+["”’)]*(\s|$)/.exec(rest);
    let end = m ? m.index + m[0].length : -1;
    // a long sentence: cut at a comma so no piece takes long to make
    const lim = first ? 60 : 200;
    if ((end < 0 || end > lim) && rest.length > lim) { const cut = Math.max(rest.lastIndexOf(', ', lim), rest.lastIndexOf('; ', lim), rest.lastIndexOf(' - ', lim)); if (cut > 20) end = cut + 2; }
    if (end < 0) { if (finished) end = rest.length; else break; }
    // short sentences after the first are joined to the next (fewer, smoother pieces)
    if (!first && end < 40 && !finished) { const m2 = /[.!?…]+["”’)]*(\s|$)/.exec(rest.slice(end)); if (!m2) break; end += m2.index + m2[0].length; }
    out.push(rest.slice(0, end).trim()); i += end;
  }
  return [out.filter(Boolean), i];
}
async function askOutLoud(text) {
  const v = voiceChat;
  if (!v) return;
  setVoicePhase('thinking');
  voiceUI.cassie.textContent = '';
  const before = state.messages.length;
  // she starts speaking the first sentence while the rest of the answer is still coming
  const live = v.voice ? v.voice.stream({ onStart: () => { if (voiceChat === v) setVoicePhase('speaking'); } }) : null;
  let upTo = 0;
  v.stopSpeaking = live ? () => live.stop() : null;
  const onDelta = (sofar) => {
    if (voiceChat !== v) return;
    const t = String(sofar).trimStart(), mark = window.CassieCare ? window.CassieCare.MARK : '';
    if (mark && t && (t.startsWith(mark) || mark.startsWith(t))) return; // care: said gently below, not read out as it comes
    const clean = cleanForSpeech(sofar);
    voiceUI.cassie.textContent = clean;
    if (!live) return;
    const [pieces, at] = speakablePieces(clean, upTo, false);
    upTo = at; pieces.forEach((p) => live.push(p));
  };
  try { await handleSend(text, { mode: v.mode === 'teach' ? 'teach' : 'voice', onDelta }); } catch (e) { /* handleSend shows its own errors */ }
  if (voiceChat !== v) { if (live) live.stop(); return; }
  const last = state.messages[state.messages.length - 1];
  const reply = state.messages.length > before && last && last.role === 'assistant' ? last.content : '';
  // a student at risk: Cassie says it gently, and the crisis lines stay on the screen to tap
  if (reply && last.care && window.CassieCare) {
    if (live) live.stop();
    voiceUI.care.replaceChildren(window.CassieCare.card(last.care.lang, last.care.aiWords));
    voiceUI.care.hidden = false;
    voiceUI.cassie.textContent = '';
    sayThenListen(window.CassieCare.spoken(last.care.lang, last.care.aiWords));
    return;
  }
  track('feature', 'voice');
  if (live && reply) {
    // the rest of the answer, then listen again
    const clean = cleanForSpeech(reply);
    voiceUI.cassie.textContent = clean;
    const [pieces] = speakablePieces(clean, Math.min(upTo, clean.length), true);
    pieces.forEach((p) => live.push(p));
    live.end();
    if (v.phase !== 'speaking') setVoicePhase('speaking');
    v.stopSpeaking = () => { live.stop(); };
    await live.done;
    if (voiceChat !== v || v.typed) return; // (Bella stopped partway: the rest is on screen, and the chat goes on typed)
    v.stopSpeaking = null;
    if (v.wantPause) setVoicePhase('paused'); else listenVoice();
    return;
  }
  if (live) live.stop();
  sayThenListen(reply || CassieErrors.say('voice_no_answer'));
}

function startVoiceMode(mode) {
  const v = voiceChat;
  if (!v) return;
  v.stopSpeaking && v.stopSpeaking();
  stopHearing();
  v.mode = VOICE_MODES[mode] ? mode : 'chat';
  voiceUI.el.querySelectorAll('[data-vmode]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.vmode === v.mode)));
  voiceUI.tip.textContent = VOICE_MODES[v.mode].tip;
  voiceUI.you.textContent = '';
  quizMode = v.mode === 'quiz';
  if (quizBtn) quizBtn.classList.toggle('active', quizMode);
  setQuizLabel(quizMode ? 'Stop quiz' : 'Quiz me');
  dressCassie();
  sayThenListen(VOICE_MODES[v.mode].hello);
}

function openVoice(mode = 'chat', checked = false) {
  if (!canChat()) { openSettings(); return; }
  if (!canHear()) { renderMessage('assistant', CassieErrors.say('no_mic_browser')); return; }
  // what's left of Bella's voice can't cover a conversation: Cassie says so once and the chat stays typed
  const CV = window.CassieVoice;
  if (CV && SERVER && !CV.studio.known() && !checked) { CV.unlock(); CV.studio.refresh().finally(() => openVoice(mode, true)); return; }
  if (!CV || !CV.canSay(CV.CHAT_CHARS)) { toTypedChat(); return; }
  if (!voiceUI) voiceUI = buildVoiceUI();
  if (voiceChat) closeVoice();
  voiceChat = { mode, phase: 'paused', quizBefore: quizMode, useRecorder: !SpeechRecognitionCtor || !!accurateHearing() };
  voiceUI.el.hidden = false;
  document.documentElement.classList.add('vc-open');
  if (voiceUI.bot) voiceUI.bot.pause(false);
  track('feature', 'voice:' + mode);
  if (window.CassieVoice) window.CassieVoice.unlock(); // inside the tap, so phones let her speak later
  if (!newConversationVoice(voiceChat)) return; // (no voice left: she says so once, and the chat goes on typed)
  startVoiceMode(mode); // speaks right away, inside the tap, so phones allow the sound
  setTimeout(() => { try { voiceUI.mic.focus(); } catch (e) { /* ignore */ } }, 60);
}
function closeVoice() {
  const v = voiceChat;
  if (!v) return;
  v.stopSpeaking && v.stopSpeaking();
  if (v.voice) v.voice.end();
  voiceChat = null;
  if (v.rec) { try { v.rec.onend = null; v.rec.abort(); } catch (e) { /* ignore */ } }
  if (v.recorder) { try { v.recorder.onstop = null; v.recorder.stop(); } catch (e) { /* ignore */ } }
  clearInterval(v.vadTimer); clearTimeout(v.speakTimer);
  if (v.stream) v.stream.getTracks().forEach((t) => t.stop());
  if (v.actx) { try { v.actx.close(); } catch (e) { /* ignore */ } }
  quizMode = v.quizBefore;
  if (quizBtn) quizBtn.classList.toggle('active', quizMode);
  setQuizLabel(quizMode ? 'Stop quiz' : 'Quiz me');
  dressCassie();
  voiceUI.el.hidden = true;
  voiceUI.care.hidden = true; voiceUI.care.replaceChildren();
  document.documentElement.classList.remove('vc-open');
  if (voiceUI.bot) voiceUI.bot.pause(true);
  try { voiceBtn && voiceBtn.focus(); } catch (e) { /* ignore */ }
}
if (voiceBtn) {
  voiceBtn.hidden = !canHear();
  voiceBtn.addEventListener('click', () => openVoice('chat'));
}
// a link like app.html?talk=teach opens it (the first sound still needs a tap on phones)
{ const t = new URLSearchParams(location.search).get('talk'); if (t && voiceBtn && !voiceBtn.hidden) setTimeout(() => openVoice(VOICE_MODES[t] ? t : 'chat'), 400); }

/* ---------- highlight-to-ask (the Ask Cassie button by a selection) ---------- */
/* Select any text in an answer, tap Ask Cassie, and pick Explain / Answer /
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
    prompt = `Give only the direct answer to this. No explanation, no extra words:\n\n"${text}"`;
  } else if (mode === 'code') {
    prompt = `Write clean, well-commented code that solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, and briefly explain how it works.${depth}\n\n"${text}"`;
  } else {
    prompt = `Answer this and explain your reasoning. Give the answer, then explain why/how.${depth}\n\n"${text}"`;
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

/* Right-click on selected text keeps the browser's own menu, so Copy works as usual. */

/* Highlight-to-ask on ANY device, with an on/off switch (Settings, and the switch on the
   home screen's side panel): ON — selecting text inside an answer (or a file in the
   reader) opens the Explain / Answer / Code popover; OFF — highlighting is just
   highlighting, to copy and paste. Debounced so it waits for the selection to settle
   (mobile selection-handle dragging fires many selectionchange events). */
let selPopoverTimer = null;
function trySelectionPopover() {
  if (!highlightPopover) return;
  if (state.highlightHelp === false) return; // switched off: just highlighting
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
  ['Preschool', 'elementary', ['Nursery', 'Kindergarten']],
  ['Elementary', 'elementary', ['Elementary', 'Grade 1', 'Grade 2', 'Grade 3', 'Grade 4', 'Grade 5', 'Grade 6']],
  ['Junior High School', 'middle', ['Junior High', 'Grade 7', 'Grade 8', 'Grade 9', 'Grade 10']],
  ['Senior High School', 'high', ['Senior High', 'Grade 11', 'Grade 12']],
  ['College / University', 'college', ['College', '1st year college', '2nd year college', '3rd year college', '4th year college', '5th year college']],
  ['Graduate school', 'college', ['Graduate school']],
  ['Board exam', 'college', ['Board exam reviewee']],
  ['Working', 'auto', ['Working professional']],
];
const WORKING = 'Working professional';
const levelForGrade = (g) => { const grp = GRADE_GROUPS.find((x) => x[2].includes(g)); return grp ? grp[1] : 'auto'; };
const ageBand = (a) => (!a ? '' : a < 13 ? 'under 13' : a < 18 ? '13-17' : a < 25 ? '18-24' : a < 35 ? '25-34' : a < 50 ? '35-49' : '50+');
function profileLine(p) {
  const who = p.role === 'pro' ? (p.who === 'teach' ? 'a teacher or parent' : `a working professional${p.field ? ` (${p.field})` : ''}`)
    : /^(Nursery|Kindergarten)$/.test(p.grade || '') ? `a little one in ${p.grade.toLowerCase()}`
    : p.grade === 'Board exam reviewee' ? 'reviewing for a board exam (like the LET)'
    : /^(Elementary|Junior High|Senior High|College)$/.test(p.grade || '') ? `${p.grade === 'Elementary' ? 'an elementary' : 'a ' + p.grade.toLowerCase()} student`
    : `a ${p.grade || 'student'} student`.replace('a Graduate school student', 'a graduate student');
  const young = (p.age && p.age < 8) || /^(Nursery|Kindergarten)$/.test(p.grade || '');
  return `You're helping ${p.name || 'the user'}${p.age ? `, age ${p.age}` : ''} - ${who}. Use their name now and then when talking with them, but never inside a paper, essay or anything they will hand in. Pitch every explanation to that level.${young ? ' They are a very young child: use very short sentences, simple everyday words and a warm, playful tone, and keep everything safe.' : p.age && p.age < 13 ? ' They are a young child: keep it simple, warm and safe.' : ''}`;
}
function openProfile(first) {
  const p = state.profile || (state.account && state.account.name ? { name: state.account.name } : {});
  const wrap = document.createElement('div');
  wrap.className = 'profile-overlay';
  wrap.innerHTML = `<form class="profile-card" novalidate>
    <h2>${first ? 'Let’s set up Cassie for you' : 'Your profile'}</h2>
    <p class="pf-sub">So she explains things at the right level. Saved only on this device.</p>
    <label class="pf-field"><span>Your name (nickname)</span><input name="name" maxlength="40" autocomplete="nickname" placeholder="e.g. Hazel"></label>
    <label class="pf-field"><span>Age</span><input name="age" type="number" inputmode="numeric" min="2" max="100" placeholder="e.g. 16"></label>
    <label class="pf-field"><span>Level</span><select name="grade"><option value="">Choose your level…</option>${GRADE_GROUPS.map(([g, , list]) => `<optgroup label="${g}">${list.map((x) => `<option>${x}</option>`).join('')}</optgroup>`).join('')}</select></label>
    <div class="pf-field"><span>Gender</span><div class="pf-seg pf-seg3"><button type="button" data-gender="female">Female</button><button type="button" data-gender="male">Male</button><button type="button" data-gender="none">Prefer not to say</button></div><input type="hidden" name="gender"></div>
    <button type="submit" class="pf-go">${first ? 'Start studying' : 'Save'}</button>
  </form>`;
  document.body.appendChild(wrap);
  const f = wrap.querySelector('form');
  let gender = p.gender || '';
  f.name.value = p.name || ''; f.age.value = p.age || '';
  f.grade.value = p.role === 'pro' ? WORKING : (p.grade || '');
  const check = CassieErrors.form(f, {
    name: (v) => (!v.trim() ? 'need_name' : ''),
    age: (v) => (!String(v).trim() ? 'need_age' : !(Math.round(+v) >= 2 && Math.round(+v) <= 100) ? 'age_range' : ''),
    grade: (v) => (!v ? 'need_level' : ''),
    gender: (v) => (!v ? 'need_gender' : ''),
  });
  const sync = () => { f.gender.value = gender; f.querySelectorAll('[data-gender]').forEach((b) => { b.classList.toggle('on', b.dataset.gender === gender); b.setAttribute('aria-pressed', String(b.dataset.gender === gender)); }); };
  f.querySelectorAll('[data-gender]').forEach((b) => b.addEventListener('click', () => { gender = b.dataset.gender; sync(); f.gender.dispatchEvent(new Event('change')); }));
  sync();
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    const name = f.name.value.trim(), age = Math.round(+f.age.value), grade = f.grade.value;
    if (!check.check()) return;
    wrap.remove();
    saveProfile({ name, age, grade, gender }, first, p);
  });
  // the name box gets the focus, unless you're already typing in another box (it took the
  // next letters: an age typed straight away landed in the name)
  setTimeout(() => { if (!f.contains(document.activeElement)) f.name.focus(); }, 50);
}
/* ---------- First run: Welcome, Intro, Sign in, then four questions ----------
   Minimal and centred, a step at a time. Where you are is kept (FR_KEY), so a reload carries on at
   the same step; the answers end up in the same profile the old form saved. */
const FR_KEY = 'cassie.firstRun';
const HELP_WITH = [['homework', 'Homework'], ['exams', 'Exams'], ['notes', 'Notes'], ['flashcards', 'Flashcards'], ['labs', 'Labs']];
function frLoad() { try { return JSON.parse(localStorage.getItem(FR_KEY) || 'null'); } catch (e) { return null; } }
function frSave(s) { try { if (s) localStorage.setItem(FR_KEY, JSON.stringify(s)); else localStorage.removeItem(FR_KEY); } catch (e) { /* ignore */ } }
// the profile, saved exactly as the profile form saves it (and Cassie's colours follow it)
function saveProfile({ name, age, grade, gender, who }, first, prev = {}) {
  const role = grade === WORKING ? 'pro' : 'student';
  state.profile = { name, role, grade: role === 'student' ? grade : '', field: role === 'pro' ? (prev.field || '') : '', age, gender, at: prev.at || Date.now() };
  if (who === 'teach') state.profile.who = 'teach'; // (a teacher or parent, from the first questions)
  state.audience = role === 'pro' ? 'pro' : 'student';
  state.level = role === 'pro' ? 'auto' : levelForGrade(grade);
  // anonymous usage counts stay as they were (changeable in Settings); never for under-13s,
  // and topic words only ever from adults
  const an0 = state.analytics || { usage: true, topics: true };
  state.analytics = { usage: an0.usage !== false && age >= 13, topics: an0.topics !== false && age >= 18 };
  save();
  try { if (window.CassieMemory && name) window.CassieMemory.setProfile('name', name); } catch (e2) { /* ignore */ }
  syncAudience();
  applyAccent();
  dressCassie();
  if (first) { track('signup'); track('open'); set3D('celebratory'); setTimeout(() => set3D('neutral'), 2200); }
  try { mascotSay(first ? (name ? `Nice to meet you, ${name}! 👋` : 'Nice to meet you! 👋') : 'Profile saved ✓', 3000); } catch (e3) { /* ignore */ }
  renderProfileSummary();
}
// the screen everything sits on (one at a time); on a computer, a centred glass card
function frShell() {
  let el = document.querySelector('.fr');
  if (!el) {
    el = document.createElement('div');
    el.className = 'fr';
    el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Welcome to Cassie');
    document.body.appendChild(el);
    // the keyboard never covers the box or the button: the screen stays full size (nothing behind it
    // shows) and its content fits what's left above the keyboard (--fr-h), with room for the keyboard
    // below it (--fr-kb)
    const vv = window.visualViewport;
    const fit = () => {
      if (!el.isConnected || !vv) return;
      el.style.setProperty('--fr-h', vv.height + 'px');
      el.style.setProperty('--fr-kb', Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop)) + 'px');
    };
    if (vv) { vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit); fit(); }
  }
  return el;
}
function frClose() { const el = document.querySelector('.fr'); if (el) el.remove(); }
// While a full-screen first-run or sign-in page is open, the app behind it is locked: it can't scroll
// (iOS scrolls the page up to a field when the keyboard opens) and taps and screen readers skip it.
(function lockBehindFullScreen() {
  const app = document.getElementById('app'), root = document.documentElement;
  const unscroll = () => { if (root.classList.contains('fr-open') && (window.scrollY || root.scrollTop)) window.scrollTo(0, 0); };
  const sync = () => {
    const on = !!document.querySelector('body > .fr, body > .auth-page');
    root.classList.toggle('fr-open', on);
    if (app) app.inert = on;
    unscroll();
  };
  new MutationObserver(sync).observe(document.body, { childList: true });
  window.addEventListener('scroll', unscroll, { passive: true });
  sync();
})();
const frMascot = (host, st = 'greeting') => { try { window.CassieBot.create(host, { state: st, glow: true, pokeable: true }); } catch (e) { /* the words still work */ } };
const reduceMotion = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
// Cassie in 3D on the Get started screen (cassie-3d.js, loaded while the welcome shows). The flat
// Cassie stays, still, for Reduce Motion, Lite mode or no WebGL, and until the 3D one is ready.
let fr3d = null;
const fr3dWanted = () => !reduceMotion() && !window.CASSIE_LITE;
const fr3dLoad = () => { if (!fr3d && fr3dWanted()) fr3d = import('./cassie-3d.js?v=181').catch(() => null); return fr3d; };
// (during the welcome: only downloaded, at low priority, so the welcome's timing stays the same;
// running three.js waits for the Get started screen)
const fr3dFetch = () => { if (!fr3dWanted()) return; ['cassie-3d.js?v=181', 'explore/three.module.min.js', 'explore/RoomEnvironment.js'].forEach((u) => { try { fetch(u, { priority: 'low' }).catch(() => {}); } catch (e) { /* ignore */ } }); };
// Which Cassie is decided before she's painted: the 3D one (her place stays empty until her first
// frame), or the flat one from the start (Reduce Motion, Lite mode, no WebGL, 3D failed here before).
// If the 3D one fails, the flat one shows in her place instead: never one then the other.
function frMascot3d(host) {
  const want3d = fr3dWanted() && !!window.WebGLRenderingContext && !(window.CassieBot && window.CassieBot.failed3d());
  let flat = null;
  try { flat = window.CassieBot.create(host, { state: 'happy', glow: true, pokeable: true, flat: true, waitFor3d: want3d }); } catch (e) { /* the words still work */ }
  if (flat && (window.CASSIE_LITE || reduceMotion())) flat.pause(); // (Lite mode or Reduce Motion: drawn once, no movement, not even a blink)
  host.dataset.mascot = want3d ? 'waiting' : '2d';
  if (!want3d) return;
  const noThreeD = () => { host.dataset.mascot = '2d'; if (flat) flat.reveal(true); };
  fr3dLoad().then((m) => {
    if (!host.isConnected) return;
    if (!m || !m.webglOK()) { noThreeD(); return; }
    let canvas = null;
    try { m.mount(host); canvas = host.querySelector('canvas.cassie-3d'); } catch (e) { noThreeD(); return; }
    // the flat stand-in goes once her first 3D frame is drawn (or comes back if 3D fails here)
    const watch = setInterval(() => {
      if (!host.isConnected) { clearInterval(watch); return; }
      if (canvas && canvas.dataset.frames !== '0') { clearInterval(watch); host.dataset.mascot = '3d'; if (flat) flat.destroy(); }
      else if (m.failed && m.failed()) { clearInterval(watch); if (canvas) canvas.remove(); noThreeD(); }
    }, 100);
  }, noThreeD);
}

// 1. Welcome: Cassie, her name and one line, while the app gets ready (first visit only)
function frWelcome(next) {
  const el = frShell();
  el.dataset.step = 'welcome';
  el.innerHTML = `<section class="fr-welcome" aria-live="polite">
    <div class="fr-bot" aria-hidden="true"></div>
    <h1 class="fr-name">Cassie</h1>
    <p class="fr-line">Your study buddy.</p>
    <span class="fr-load" role="progressbar" aria-label="Loading"><i></i><i></i><i></i></span>
  </section>`;
  frMascot(el.querySelector('.fr-bot'));
  fr3dFetch(); // (ready for the Get started screen)
  setTimeout(next, reduceMotion() ? 900 : 1600);
}
// 2. Intro: one illustrated card and a big Get started
function frIntro() {
  frSave({ step: 'intro' });
  const el = frShell();
  el.dataset.step = 'intro';
  el.innerHTML = `<section class="fr-intro">
    <div class="fr-art" aria-hidden="true">
      <svg class="fr-scene" viewBox="0 0 400 300" preserveAspectRatio="xMidYMax slice">
        <path d="M0 210 C70 160 140 170 210 196 C270 218 330 176 400 186 V300 H0Z" class="fr-hill1"/>
        <path d="M0 238 C90 206 170 236 240 230 C310 224 350 208 400 220 V300 H0Z" class="fr-hill2"/>
        <g class="fr-books"><rect x="64" y="236" width="92" height="16" rx="3"/><rect x="72" y="220" width="80" height="16" rx="3"/><rect x="60" y="204" width="88" height="16" rx="3"/></g>
        <path d="M282 250 l40 -40 l10 10 l-40 40 l-14 4z" class="fr-pencil"/>
      </svg>
      <div class="fr-bot" aria-hidden="true"></div>
    </div>
    <div class="fr-copy">
      <h1>Study smarter with Cassie</h1>
      <p>Ask anything, make flashcards, try labs and study with friends. Free.</p>
      <button type="button" class="fr-go fr-start">Get started</button>
    </div>
  </section>`;
  frMascot3d(el.querySelector('.fr-art .fr-bot'));
  el.querySelector('.fr-start').addEventListener('click', () => frOnboard(0)); // (the questions first, for everyone)
  setTimeout(() => { const b = el.querySelector('.fr-start'); if (b) b.focus({ preventScroll: true }); }, 50);
}
// after the first good answer of a student who went straight in: keep it, and fit Cassie to them (asked once)
function saveOffer(after) {
  if (!state.setupLater || state.setupAsked || !after || !after.isConnected) return;
  state.setupAsked = true; save();
  const canSave = accountsOn() && !authToken();
  const card = document.createElement('div');
  card.className = 'save-offer'; card.setAttribute('role', 'group'); card.setAttribute('aria-label', 'Save your progress');
  card.innerHTML = `<p class="save-offer-h">${canSave ? 'Keep this, and make Cassie fit you?' : 'Make Cassie fit you?'}</p>
    <p class="save-offer-p">${canSave ? 'Save your progress free on every device, and tell Cassie your name and what you’re studying so her answers match your level.' : 'Tell Cassie your name and what you’re studying so her answers match your level.'}</p>
    <div class="save-offer-acts">
      ${canSave ? '<button type="button" class="save-offer-go" data-so="save">Save my progress</button>' : '<button type="button" class="save-offer-go" data-so="about">Tell Cassie about me</button>'}
      ${canSave ? '<button type="button" class="save-offer-line" data-so="about">Just tell Cassie about me</button>' : ''}
      <button type="button" class="save-offer-line" data-so="no">Not now</button>
    </div>`;
  card.addEventListener('click', (e) => {
    const b = e.target.closest('[data-so]');
    if (!b) return;
    card.remove();
    if (b.dataset.so === 'save') openAuth({ first: true, mode: 'signup' });
    else if (b.dataset.so === 'about') frOnboard(0);
  });
  after.after(card);
}
// 5. Sign in (with Cassie's server) or Continue as a guest, once the questions are answered
function frSignIn() {
  if (state.profile && !state.setupLater) { if (!accountsOn() || authToken() || state.skippedAuth) { frSave(null); frClose(); frLand(); return; } } // (answered: in they go)
  else if (!accountsOn() || authToken() || state.skippedAuth) { frOnboard((frLoad() || {}).at || 0); return; } // (an older first run: sign in came first)
  frSave({ step: 'auth' });
  frClose();
  openAuth({ first: true, mode: 'signup' });
}
// 4. The questions, one a screen: your name, where you are in your learning, what brings you, how you
// like to learn. Every screen has Skip for now (it keeps what's answered and goes straight in).
// Where you are: [key, what the pill says, the level saved in the profile (GRADE_GROUPS)]
const FR_WHO = [['elem', 'Elementary', 'Elementary'], ['jhs', 'Junior High', 'Junior High'], ['shs', 'Senior High', 'Senior High'], ['college', 'College / University', 'College'],
  ['board', 'Reviewing for a board exam', 'Board exam reviewee'], ['teach', 'Teacher or parent', WORKING], ['work', 'Working / lifelong learner', WORKING]];
const FR_GOALS = [['exam', 'Getting ready for an exam'], ['read', 'Getting through readings and PDFs'], ['homework', 'Homework and math problems'], ['learn', 'Learning something new'], ['labs', 'Exploring labs and games']];
const FR_STYLES = [['brief', 'Quick bullet summaries'], ['deep', 'Deep step-by-step breakdowns'], ['voice', 'Voice and audio explanations']];
// an older profile's level, as one of the pills
function whoOfGrade(g) {
  if (!g) return '';
  if (g === WORKING) return 'work';
  const own = FR_WHO.find((x) => x[2] === g);
  if (own) return own[0];
  return { elementary: 'elem', middle: 'jhs', high: 'shs', college: 'college' }[levelForGrade(g)] || '';
}
function frOnboard(at = 0) {
  const prev = frLoad() || {};
  const a = { name: '', gender: '', who: '', age: '', goals: [], style: '', ...(prev.answers || {}) };
  if (!a.who && a.grade) a.who = whoOfGrade(a.grade); // (an onboarding left halfway in the older questions)
  if (!Array.isArray(a.goals)) a.goals = [];
  if (!a.name && state.account && state.account.name) a.name = state.account.name;
  const TOTAL = FR_TOTAL;
  at = Math.max(0, Math.min(TOTAL - 1, at | 0)); // (the older questions had five screens)
  const keep = () => frSave({ step: 'ob', at, answers: a });
  keep();
  const el = frShell();
  el.dataset.step = 'ob' + (at + 1);
  const pills = (list, attr, role) => list.map(([v, l]) => `<button type="button" class="fr-pick" ${role ? 'role="radio"' : 'aria-pressed="false"'} data-${attr}="${v}">${l}</button>`).join('');
  const Q = [
    { h: 'What should Cassie call you?', body: `<input class="fr-big" name="name" maxlength="40" autocomplete="given-name" placeholder="Your first name" aria-label="Your first name">` },
    { h: 'Where are you in your learning?', body: `<div class="fr-picks" role="radiogroup" aria-label="Where you are in your learning">${pills(FR_WHO, 'who', true)}</div>
        <label class="fr-q2"><span>Your age (optional)</span><input class="fr-age" name="age" type="number" inputmode="numeric" min="2" max="100" placeholder="e.g. 16"></label>` },
    { h: 'What brings you to Cassie today?', sub: 'Pick any.', body: `<div class="fr-picks">${pills(FR_GOALS, 'goal', false)}</div>` },
    { h: 'How do you like to learn?', sub: 'Optional. Pick one, or skip it.', body: `<div class="fr-picks" role="radiogroup" aria-label="How you like to learn">${pills(FR_STYLES, 'style', true)}</div>` },
  ][at];
  el.innerHTML = `<form class="fr-ob" novalidate>
    <div class="fr-top">
      <button type="button" class="fr-back"${at === 0 ? ' hidden' : ''}>‹ Back</button>
      <div class="fr-progress"><span class="fr-bar"><i style="width:${((at + 1) / TOTAL) * 100}%"></i></span><span class="fr-count">${at + 1} of ${TOTAL}</span></div>
      <button type="button" class="fr-skip">Skip for now</button>
    </div>
    <div class="fr-mid">
      <h1 class="fr-h">${Q.h}</h1>
      ${Q.sub ? `<p class="fr-sub">${Q.sub}</p>` : ''}
      ${Q.body}
      <p class="fr-err" role="alert" hidden></p>
    </div>
    <button type="submit" class="fr-go">${at === TOTAL - 1 ? 'Start studying' : 'Next'}</button>
  </form>`;
  const f = el.querySelector('form'), err = el.querySelector('.fr-err');
  const say = (m) => { err.textContent = m; err.hidden = !m; };
  // fill in what's known, and keep each answer as it changes
  if (f.name) f.name.value = a.name;
  if (f.age) f.age.value = a.age;
  const mark = () => {
    f.querySelectorAll('[data-who]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.who === a.who)));
    f.querySelectorAll('[data-goal]').forEach((b) => b.setAttribute('aria-pressed', String(a.goals.includes(b.dataset.goal))));
    f.querySelectorAll('[data-style]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.style === a.style)));
  };
  mark();
  const typed = () => { if (f.name) a.name = f.name.value.trim(); if (f.age) a.age = f.age.value; };
  f.addEventListener('input', () => { typed(); say(''); keep(); });
  f.addEventListener('click', (e) => {
    const w = e.target.closest('[data-who]'), g = e.target.closest('[data-goal]'), s = e.target.closest('[data-style]');
    if (w) a.who = w.dataset.who;
    if (g) a.goals = a.goals.includes(g.dataset.goal) ? a.goals.filter((x) => x !== g.dataset.goal) : [...a.goals, g.dataset.goal];
    if (s) a.style = a.style === s.dataset.style ? '' : s.dataset.style; // (optional: a second tap clears it)
    if (w || g || s) { say(''); mark(); keep(); }
  });
  const go = (k) => { if (k >= TOTAL) frFinish(a); else { frSave({ step: 'ob', at: k, answers: a }); frOnboard(k); } };
  el.querySelector('.fr-back').addEventListener('click', () => go(Math.max(0, at - 1)));
  el.querySelector('.fr-skip').addEventListener('click', () => { typed(); frFinish(a); }); // (what's answered so far is kept)
  f.addEventListener('submit', (e) => {
    e.preventDefault();
    typed();
    if (at === 0 && !a.name) { say('Type your name, or tap Skip for now.'); f.name.focus(); return; }
    if (at === 1 && !a.who) { say('Tap the one that fits you, or tap Skip for now.'); f.querySelector('[data-who]').focus(); return; }
    if (at === 1 && a.age && !(Math.round(+a.age) >= 2 && Math.round(+a.age) <= 100)) { say('Type an age from 2 to 100, or leave it empty.'); f.age.focus(); return; }
    go(at + 1);
  });
  setTimeout(() => { const first = f.querySelector('.fr-big, .fr-pick'); if (first && !f.contains(document.activeElement)) first.focus({ preventScroll: true }); }, 60);
}
var FR_TOTAL = 4; // (var: the first questions can open before this line runs)
// done (or skipped): the answers go in the profile, and the student lands straight on the ask box
function frFinish(a) {
  const age = Math.round(+a.age) || 0, p0 = state.profile || {};
  const who = FR_WHO.find((x) => x[0] === a.who);
  saveProfile({ name: a.name || '', age: age >= 2 && age <= 100 ? age : 0, grade: who ? who[2] : (a.grade || ''), gender: a.gender || p0.gender || 'none', who: who ? who[0] : '' }, true, p0);
  state.setupLater = false;
  state.helpWith = Array.isArray(a.goals) ? a.goals : [];
  state.answerStyle = FR_STYLES.some((x) => x[0] === a.style) ? a.style : '';
  if (a.style === 'voice') state.voiceOut = true; // (answers are read aloud)
  save();
  frSave(null);
  frClose();
  syncAccount(true);
  if (typeof refreshHub === 'function') refreshHub(); // (Home puts what they came for first)
  if (accountsOn() && !authToken() && !state.skippedAuth) { frSignIn(); return; } // (then sign in, or Continue as a guest)
  frLand();
}
// the first run is over: a plan from the Exam Rescue Plan page if one is ready, else the ask box
function frLand() {
  track('open');
  if (rescued && !rescued.full) { examReadySheet(rescued); return; }
  frToAsk();
}
// straight to the ask box (a phone: the Chat tab; a computer: the chat page)
function frToAsk() {
  if (onPhoneHome()) { window.CassieNative.go('chat'); setTimeout(() => promptInput.focus(), 60); return; }
  if (document.body.classList.contains('desk-on')) deskGo('chat'); // (a computer opens on Home, which has no ask box)
  setTimeout(() => promptInput.focus(), 60); // (after the first-run screen has gone)
}
// Free gets one exam plan made from notes (the first one); Plus, every one
function notesFree() { return !state.freeNotesPlan; }
// right after the first run (signed in or as a guest): a quick tour?, asked once, ever; after: once it's over
function offerTour(after = null) { setTimeout(() => { if (window.CassieTour) window.CassieTour.offer(after); else if (after) after(); }, 700); }
// after the tour: your new exam plan, one tap away
function examReadySheet(e) {
  if (!examsNow().some((x) => x.id === e.id)) return;
  document.querySelector('.ex-ready-sheet')?.remove();
  const w = document.createElement('div');
  w.className = 'plus-sheet ex-ready-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'ex-ready-h');
  w.innerHTML = `<div class="plus-card">
    <h3 id="ex-ready-h">Your Exam Plan is ready</h3>
    <p class="plus-why"><b>Subject:</b> <span class="exr-subj"></span><br><b>Exam day:</b> <span class="exr-day"></span><br><b>Topics:</b> <span class="exr-tops"></span></p>
    <div class="plus-actions"><button type="button" class="plus-go exr-see">See my exam plan</button><button type="button" class="plus-ok">Not now</button></div></div>`;
  w.querySelector('.exr-subj').textContent = e.name;
  w.querySelector('.exr-day').textContent = dayName(e.date);
  w.querySelector('.exr-tops').textContent = (e.topics || '').trim() || planTopics(e).join(', ');
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (k) => { if (k.key === 'Escape') { k.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  w.querySelector('.plus-ok').addEventListener('click', close);
  w.addEventListener('click', (k) => { if (k.target === w) close(); });
  w.querySelector('.exr-see').addEventListener('click', () => { close(); showExamPlan(e.id); });
  document.body.appendChild(w);
  w.querySelector('.exr-see').focus({ preventScroll: true });
}
// the plan lives on Home: the Home tab on a phone, an empty new chat on a computer
function showExamPlan(id) {
  if (onPhoneHome()) window.CassieNative.go('home');
  else if (sideWide.matches) deskGo('plan');
  else if (state.messages.length) createNewChat();
  refreshHub();
  requestAnimationFrame(() => {
    const card = [...document.querySelectorAll('.ex-plan')].find((c) => c.dataset.id === id && c.offsetParent);
    if (!card) return;
    card.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    card.classList.add('ex-flash'); setTimeout(() => card.classList.remove('ex-flash'), 1600);
  });
}
// where the first run starts: a returning student never sees it; a reload carries on
function firstRun() {
  const saved = frLoad();
  if (saved && saved.step === 'ob') { frOnboard(saved.at || 0); return; }
  if (saved && saved.step === 'auth') { frSignIn(); return; }
  if (saved && saved.step === 'intro') { frIntro(); return; }
  frWelcome(() => frIntro());
}

/* ---------- Cassie accounts: sign in once, and your profile follows you ---------- */
// Only with Cassie's server (config.js). What syncs: profile, settings and saved quiz
// mistakes — never chats or API keys. Without an account everything stays on the device.
// (var/function, not const: save() can run before this part of the file has loaded)
function accountsOn() { return !!SERVER; }
var AUTH_KEY = 'cassie.auth';
function authToken() { try { return localStorage.getItem(AUTH_KEY) || ''; } catch (e) { return ''; } }
async function authCall(path, body, method = 'POST', { timeout = 20000, signal } = {}) {
  const token = authToken();
  let res;
  // a server that never answers is given up on (the student then sees why, with Try again)
  const ctl = new AbortController(), late = setTimeout(() => ctl.abort(), timeout);
  if (signal) signal.addEventListener('abort', () => ctl.abort(), { once: true });
  try {
    res = await fetch(SERVER + path, {
      method,
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), ...(token ? { authorization: 'Bearer ' + token } : {}) },
      body: body ? JSON.stringify(body) : undefined,
      signal: ctl.signal,
    });
  } catch (e) { const timedOut = ctl.signal.aborted; const x = friendlyError(CassieErrors.say(timedOut ? 'timeout' : 'network')); x.code = timedOut ? 'timeout' : 'network'; throw x; }
  finally { clearTimeout(late); }
  let data = {};
  try { data = await res.json(); } catch (e) { /* empty */ }
  // (a broken server's own words, like "Internal error", are never shown: only Cassie's plain ones)
  if (!res.ok) { const e = friendlyError((data.code || res.status < 500) && data.error ? data.error : CassieErrors.say('unknown')); e.status = res.status; e.code = data.code || ''; throw e; }
  return data;
}
function accountData() {
  return { profile: state.profile || null, mistakes: state.mistakes || [], cards: (state.cards || []).slice(-500), exams: (state.exams || []).slice(-10), progress: state.progress || {}, audience: state.audience, level: state.level, accent: state.accent, citationStyle: state.citationStyle, textSize: state.textSize, easyRead: state.easyRead, analytics: state.analytics, tour: state.tour || null, answerStyle: state.answerStyle || '', helpWith: state.helpWith || [] };
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
  ['profile', 'audience', 'level', 'accent', 'citationStyle', 'textSize', 'easyRead', 'analytics', 'tour', 'answerStyle', 'helpWith'].forEach((k) => { if (d[k] != null) state[k] = d[k]; });
  if (Array.isArray(d.cards)) { // flashcards from both devices (the newest review wins)
    const mine = new Map((state.cards || []).map((c) => [c.id, c]));
    d.cards.forEach((c) => { if (!c || !c.id || !c.f) return; const m = mine.get(c.id); if (!m || (c.seen || 0) > (m.seen || 0)) mine.set(c.id, c); });
    state.cards = [...mine.values()].slice(-2000);
  }
  if (Array.isArray(d.mistakes)) { // keep both devices' saved mistakes
    const have = new Set((state.mistakes || []).map((m) => (m.q || '').toLowerCase()));
    state.mistakes = [...(state.mistakes || []), ...d.mistakes.filter((m) => m && m.q && !have.has(m.q.toLowerCase()))].slice(0, 200);
  }
  if (Array.isArray(d.exams)) { // exam plans from both devices (the plan with more ticks wins)
    const ticks = (e) => (e.days || []).reduce((n, x) => n + (x.tasks || []).filter((t) => t.done).length, 0);
    const mine = new Map((state.exams || []).map((e) => [e.id, e]));
    d.exams.forEach((e) => { if (!e || !e.id || !Array.isArray(e.days)) return; const m = mine.get(e.id); if (!m || ticks(e) > ticks(m)) mine.set(e.id, e); });
    state.exams = [...mine.values()].slice(-10);
  }
  if (d.progress && typeof d.progress === 'object') { // the week's counts: the bigger count of each day wins
    const p = state.progress && typeof state.progress === 'object' ? state.progress : (state.progress = {});
    Object.entries(d.progress).forEach(([day, c]) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !c) return; const m = p[day] || (p[day] = {}); Object.entries(c).forEach(([k, n]) => { if (Number.isFinite(+n)) m[k] = Math.max(m[k] || 0, +n); }); });
  }
  lastSynced = JSON.stringify(accountData());
  save();
  try { syncAudience(); applyAccent(); applyReading(); dressCassie(); renderProfileSummary(); } catch (e) { /* ignore */ }
  if (!state.messages.length) renderHistory();
}
function signedIn(token, account, plan) {
  try { localStorage.setItem(AUTH_KEY, token); } catch (e) { /* ignore */ }
  state.account = accountOf(account);
  if (plan) state.plan = plan;
  save();
  voiceAgain(); // (the studio voice is the account's now)
}
// what the app keeps about the account: who, and which ways in it has (Google, Apple)
function accountOf(a) {
  const providers = Array.isArray(a.providers) ? a.providers.filter((p) => p === 'google' || p === 'apple') : a.google ? ['google'] : [];
  return { email: a.email || '', name: a.name || '', providers, google: providers.includes('google') };
}
async function signOutNow() { try { await authCall('/auth/logout', {}); } catch (e2) { /* signed out anyway */ } signedOutLocally(); mascotSay('Signed out. Your stuff is still here on this device.', 3000); }
function signedOutLocally() {
  try { localStorage.removeItem(AUTH_KEY); } catch (e) { /* ignore */ }
  state.account = null; state.plan = null; save(); renderProfileSummary();
  voiceAgain(); // (a guest: no studio voice)
}

/* ---------- Plus / Pro extras ----------
   The server says which plan an account has (/auth/me and sign-in), and the app keeps it so it
   works offline too. Signing out forgets it.
   The AI limits are kept by the server; these extras (Real 3D in Labs, the Museum quiz,
   saving and printing notes and boards) are checked here. */
function planName() {
  const p = state.plan;
  return p && (p.plan === 'plus' || p.plan === 'pro') && (!p.until || p.until > Date.now()) ? p.plan : 'free';
}
const isSubscriber = () => planName() !== 'free';
// ask the account again (a plan given on the dashboard shows up without signing out and in)
let planAsked = 0;
function refreshPlan(force) {
  if (!accountsOn() || !authToken() || (!force && Date.now() - planAsked < 60e3)) return Promise.resolve();
  planAsked = Date.now();
  return authCall('/auth/me', null, 'GET').then((r) => { if (r && r.plan) { state.plan = r.plan; save(); renderAccountRow(); voiceAgain(); } })
    .catch((e) => { if (e.status === 401) signedOutLocally(); });
}
// Plans: Get it early opens the early list
document.querySelector('.set-plans')?.addEventListener('click', (e) => {
  const g = e.target.closest('[data-early]');
  if (!g) return;
  if (serverPay) buyPlan(g.dataset.early === 'pro' ? 'pro' : 'plus', document.querySelector('.set-plans').classList.contains('bill-sem') ? 'sem' : 'month');
  else plusSheet('', '', 'plans', 'Get the Pasado Pass first');
});
// Plans: prices a month first; Semester shows the one-payment prices
document.querySelector('.set-plans .bill-seg')?.addEventListener('click', (e) => {
  const b = e.target.closest('[data-bill]');
  if (!b) return;
  const sem = b.dataset.bill === 's';
  document.querySelector('.set-plans').classList.toggle('bill-sem', sem);
  b.parentElement.querySelectorAll('[data-bill]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
});
/* ---------- buying a pass (PayMongo) ----------
   Every plan is a pass: one payment for 30 days, the semester or 12 months, and it never renews.
   Buy: signed in first (the plan belongs to an account), then PayMongo's own checkout page (GCash,
   Maya or card; a US$ price is charged its peso price there), then back here, where the plan shows. */
var BUY_KEY = 'cassie.buy'; // (a purchase waiting for the student to sign in)
const BILL_LONG = { month: '30 days', sem: 'the semester', year: '12 months' };
function payCur() { const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '', lang = (navigator.language || '').toLowerCase(); return tz === 'Asia/Manila' || /-ph$|^fil|^tl/.test(lang) ? 'php' : 'usd'; }
const pesos = (n) => `₱${Number(n).toLocaleString('en-PH')}`;
function priceLine(plan, bill, cur = payCur()) {
  const p = payPrices && payPrices[cur] && payPrices[cur][plan] && payPrices[cur][plan][bill];
  if (!p) return '';
  return cur === 'usd' ? `${p.shown} for ${BILL_LONG[bill]} (charged as ${pesos(p.php)})` : `${p.shown} for ${BILL_LONG[bill]}`;
}
// the Plans page buttons say Get, once paying is on
function payLabels() {
  if (!serverPay) return;
  document.querySelectorAll('.set-plans [data-early]').forEach((b) => {
    const pro = b.dataset.early === 'pro';
    b.innerHTML = pro ? 'Get Pro' : '<span class="bill-m">Get Plus</span><span class="bill-s">Get the Pasado Pass</span>';
  });
}
async function buyPlan(plan = 'plus', bill = 'month', cur = payCur()) {
  await configReady;
  if (!SERVER || !serverPay) { plusSheet('', '', 'plans', 'Get the Pasado Pass first'); return; }
  if (!authToken()) {
    try { sessionStorage.setItem(BUY_KEY, JSON.stringify({ plan, bill, cur })); } catch (e) { /* storage blocked */ }
    if (!state.profile) { frSave({ step: 'auth' }); frClose(); }
    openAuth({ first: !state.profile, mode: 'signup' });
    try { mascotSay('Sign in first, so your plan has an account to belong to.', 4000); } catch (e) { /* the little helper is a bonus */ }
    return;
  }
  document.querySelector('.plus-sheet')?.remove();
  const note = paySheet('Opening the secure checkout…', 'PayMongo’s page opens next. Pay with GCash, Maya or a card.');
  let r = null, j = {};
  try { r = await fetch(SERVER + '/pay/checkout', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ plan, bill, cur }) }); j = await r.json().catch(() => ({})); } catch (e) { r = null; }
  if (r && r.ok && j.url) { location.href = j.url; return; }
  if (r && r.status === 401) { note.close(); signedOutLocally(); buyPlan(plan, bill, cur); return; } // (signed out on the server: sign in again, then buy)
  note.set('That didn’t work', CassieErrors.explain(r ? friendlyError(j.error || '') : new Error('network'), 'network'));
}
// a small sheet for buying news: set() changes it, close() takes it away
function paySheet(title, text) {
  document.querySelector('.pay-sheet')?.remove();
  const w = document.createElement('div');
  w.className = 'plus-sheet pay-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'pay-sheet-h');
  w.innerHTML = `<div class="plus-card"><h3 id="pay-sheet-h"></h3><p class="plus-why" role="status"></p><div class="plus-actions"></div></div>`;
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  w.addEventListener('click', (e) => { if (e.target === w || e.target.closest('.plus-ok')) close(); });
  const set = (t, x, actions = '<button type="button" class="plus-ok">OK</button>') => {
    w.querySelector('h3').textContent = t; w.querySelector('.plus-why').textContent = x;
    w.querySelector('.plus-actions').innerHTML = actions;
    (w.querySelector('.plus-actions button') || w).focus?.();
  };
  set(title, text, '');
  document.body.appendChild(w);
  return { set, close, el: w };
}
const planDate = (ms) => new Date(ms).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', year: 'numeric' });
// back from PayMongo: the plan arrives with PayMongo's message, usually within seconds
async function paidReturn(id) {
  await configReady;
  if (id === 'cancel') { paySheet('No payment was made', 'You can get Plus any time from Plans.').set('No payment was made', 'You can get Plus any time from Plans.'); return; }
  const sh = paySheet('Checking your payment…', 'PayMongo is confirming it. This takes a few seconds.');
  for (let i = 0; i < 12; i++) {
    let st = null;
    try { const r = await fetch(SERVER + '/pay/status?id=' + encodeURIComponent(id), { headers: chatHeaders() }); if (r.ok) st = await r.json(); } catch (e) { /* try again */ }
    if (st && st.status === 'paid') {
      await refreshPlan(true);
      const name = st.plan === 'pro' ? 'Pro' : 'Plus', paid = /^US\$/.test(st.shown || '') ? `${pesos(st.php)} (${st.shown})` : pesos(st.php);
      sh.set(`✅ You have Cassie ${name} until ${planDate(st.until || (state.plan && state.plan.until) || Date.now())}`, `Paid ${paid}. It never renews by itself: Cassie reminds you before it ends. Thank you!`);
      renderAccountRow();
      return;
    }
    await sleep(2500);
  }
  sh.set('Your payment is still being confirmed', 'If you paid, your plan shows up here within a few minutes, and PayMongo emails you a receipt. Nothing after an hour? Email askcassie.study@gmail.com with your receipt.');
}
// a few days before a pass ends (a week for the semester, a month for a year): once a day, in the app
function planReminder() {
  const p = state.plan;
  if (!p || planName() === 'free' || !p.until) return;
  const left = p.until - Date.now(), days = Math.ceil(left / 864e5), warn = { month: 3, sem: 7, year: 30 }[p.bill] || 3;
  const today = phDay();
  if (left <= 0 || days > warn || state.planRemindedDay === today) return;
  // never on top of something the student is in the middle of: it comes back when that closes
  if (document.querySelector('.plus-sheet, .ex-sheet, .auth-page, .fr, .tour-card, .tour-offer')) { setTimeout(planReminder, 4000); return; }
  state.planRemindedDay = today; save();
  const name = p.plan === 'pro' ? 'Pro' : 'Plus', bill = p.bill || 'month';
  const sh = paySheet(`Your Cassie ${name} ends ${days <= 1 ? 'tomorrow' : `in ${days} days`}`, '');
  const more = serverPay && priceLine(p.plan, bill) ? `<button type="button" class="plus-go pay-again">Get ${BILL_LONG[bill]} more: ${escapeHtml(priceLine(p.plan, bill))}</button>` : '';
  sh.set(sh.el.querySelector('h3').textContent, `It ends on ${planDate(p.until)}. It never renews by itself, so nothing is charged.${more ? ' Want more time?' : ''}`, `${more}<button type="button" class="plus-ok">Not now</button>`);
  sh.el.querySelector('.pay-again')?.addEventListener('click', () => { sh.close(); buyPlan(p.plan, bill); });
}

// the Pasado Pass early list: signed in, the account's email is used; otherwise the one typed
const EARLY_KEY = 'cassie.early';
const earlyJoined = () => { try { return JSON.parse(localStorage.getItem(EARLY_KEY) || 'null'); } catch (e) { return null; } };
async function joinEarly(email, src) {
  if (!SERVER) throw friendlyError('The early list needs Cassie’s server. Try again on askcassie.study.');
  let res;
  try { res = await fetch(SERVER + '/early', { method: 'POST', headers: chatHeaders(), body: JSON.stringify({ email: email || undefined, plan: 'plus', src }) }); } catch (e) { throw friendlyError(CassieErrors.say('network')); }
  const r = await res.json().catch(() => ({}));
  if (!res.ok) { const e = friendlyError((r && r.error) || 'That didn’t work. Try again.'); e.status = res.status; throw e; }
  try { localStorage.setItem(EARLY_KEY, JSON.stringify({ email: r.email, at: Date.now() })); } catch (e) { /* ignore */ }
  track('feature', 'early-' + src);
  return r.email;
}
function plusSheet(what, why, src = 'plus', title) {
  track('feature', 'plus-ask');
  document.querySelector('.plus-sheet')?.remove();
  const signedOut = accountsOn() && !authToken();
  const w = document.createElement('div');
  w.className = 'plus-sheet'; w.setAttribute('role', 'dialog'); w.setAttribute('aria-modal', 'true'); w.setAttribute('aria-labelledby', 'plus-sheet-h');
  w.innerHTML = `<div class="plus-card">
    <span class="plus-kicker">Plus</span>
    <h3 id="plus-sheet-h">${escapeHtml(title || `${what} comes with Plus`)}</h3>
    ${why ? `<p class="plus-why">${escapeHtml(why)}</p>` : ''}
    <ul class="plus-list">
      <li>100 questions a day until your exam</li>
      <li>Your exams planned day by day, up to 5 at once, even from your notes</li>
      <li>All the 3D any time, and save or print your notes and boards</li>
    </ul>
    <p class="plus-foot">${serverPay ? 'One payment, and it never renews: 7 days to change your mind. Everything else in Cassie stays free.' : 'Coming soon: the Pasado Pass, one payment of ₱599 for your whole semester. It never renews, and you have 7 days to change your mind. Everything else in Cassie stays free.'}</p>
    <form class="plus-early" novalidate hidden>
      <label for="plus-early-mail">Your email, so Cassie can tell you the day it opens</label>
      <input id="plus-early-mail" type="email" autocomplete="email" inputmode="email" placeholder="juan@gmail.com" required>
      <p class="plus-err" role="alert" hidden></p>
    </form>
    <div class="plus-actions">
      ${serverPay && payPrices ? `<button type="button" class="plus-go plus-buy" data-bill="month">Get Plus: ${escapeHtml(priceLine('plus', 'month'))}</button><button type="button" class="plus-buy plus-buy-sem" data-bill="sem">The Pasado Pass: ${escapeHtml(priceLine('plus', 'sem'))}</button>`
        : earlyJoined() ? `<p class="plus-done">You’re on the early list. Cassie will email ${escapeHtml(earlyJoined().email || 'you')} the day it opens.</p>` : '<button type="button" class="plus-go plus-join">Get the Pasado Pass early</button>'}
      <a class="plus-see" href="index.html#pricing" target="_blank" rel="noopener">See the plans</a>
      ${signedOut ? '<button type="button" class="plus-in">I have Plus. Sign in</button>' : ''}
      <button type="button" class="plus-ok">Not now</button>
    </div></div>`;
  const close = () => { w.remove(); document.removeEventListener('keydown', onKey, true); };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  document.addEventListener('keydown', onKey, true);
  // signed in: the plan may have just been given — check, and say so
  if (!signedOut && authToken()) refreshPlan(true).then(() => { if (isSubscriber() && w.isConnected) { w.querySelector('h3').textContent = `You have ${planName() === 'pro' ? 'Pro' : 'Plus'}`; w.querySelector('.plus-list').remove(); w.querySelector('.plus-why')?.remove(); w.querySelector('.plus-foot').textContent = 'Your plan just came through. Tap it again to open it.'; w.querySelectorAll('.plus-join, .plus-see, .plus-done').forEach((x) => x.remove()); w.querySelector('.plus-ok').textContent = 'OK'; } });
  const form = w.querySelector('.plus-early'), mail = form.querySelector('input'), err = form.querySelector('.plus-err');
  const join = async () => {
    const btn = w.querySelector('.plus-join');
    if (!btn) return;
    const typed = !form.hidden;
    if (typed && !mail.value.trim()) { err.textContent = 'Type your email first.'; err.hidden = false; mail.focus(); return; }
    btn.disabled = true; err.hidden = true;
    try {
      const email = await joinEarly(typed ? mail.value.trim() : '', src);
      form.remove();
      const done = document.createElement('p'); done.className = 'plus-done'; done.setAttribute('role', 'status');
      done.textContent = `You’re on the early list. Cassie will email ${email} the day it opens.`;
      btn.replaceWith(done);
      w.querySelector('.plus-ok').textContent = 'OK';
      w.querySelector('.plus-ok').focus();
    } catch (e2) {
      btn.disabled = false;
      // no account email to use: ask for one
      if (!typed) { form.hidden = false; btn.textContent = 'Keep my spot'; mail.focus(); if (e2.status !== 400) { err.textContent = CassieErrors.explain(e2, 'unknown'); err.hidden = false; } return; }
      err.textContent = CassieErrors.explain(e2, 'unknown'); err.hidden = false; mail.focus();
    }
  };
  form.addEventListener('submit', (e) => { e.preventDefault(); join(); });
  w.addEventListener('click', (e) => {
    if (e.target === w || e.target.closest('.plus-ok')) close();
    else if (e.target.closest('.plus-in')) { close(); openAuth({ mode: 'signin' }); }
    else if (e.target.closest('.plus-buy')) { close(); buyPlan('plus', e.target.closest('.plus-buy').dataset.bill); }
    else if (e.target.closest('.plus-join')) {
      // signed in: one tap, with the account's email; otherwise the email field first
      if (!authToken() && form.hidden) { form.hidden = false; e.target.closest('.plus-join').textContent = 'Keep my spot'; mail.focus(); return; }
      join();
    }
  });
  document.body.appendChild(w);
  (w.querySelector('.plus-join') || w.querySelector('.plus-ok')).focus();
}
// free tries of an extra, a week (from Monday, Philippine time): Real 3D twice a week in each lab ("3d:atom")
const FREE_TRIES = { '3d': 2 };
function freeWeek() {
  const d = new Date(Date.now() + 8 * 3600e3);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); // back to Monday
  return d.toISOString().slice(0, 10);
}
function freeLeft(kind) {
  const week = freeWeek(), u = state.freeUses || {};
  return Math.max(0, (FREE_TRIES[kind.split(':')[0]] || 0) - (u.week === week ? u[kind] || 0 : 0));
}
function freeTake(kind) {
  if (freeLeft(kind) <= 0) return false;
  const week = freeWeek();
  const u = state.freeUses && state.freeUses.week === week ? state.freeUses : { week };
  u[kind] = (u[kind] || 0) + 1; state.freeUses = u; save();
  track('feature', 'free-' + kind);
  return true;
}
const PREMIUM = { has: isSubscriber, ask: plusSheet, take: freeTake, left: freeLeft };
// Explore 3D: may this one open? true (Plus, or already open this time), a note (a free view used), or false
const X3D_NAMES = { body: 'The 3D human body', animal: 'The 3D animal cell', plant: 'The 3D plant cell' };
function free3d(k, seen) {
  if (isSubscriber() || seen.has(k)) return true;
  if (!freeTake('3d:' + k)) { plusSheet(X3D_NAMES[k] || 'This 3D view', 'You’ve used its 2 free views this week. They come back on Monday.'); return false; }
  seen.add(k);
  const n = freeLeft('3d:' + k);
  return n === 0 ? 'Your last free view of this one this week · Plus has 3D always' : `${n} more free ${n === 1 ? 'view' : 'views'} of this one this week · Plus has 3D always`;
}
// After any sign-in: bring the account's profile here, or ask the profile questions once.
function afterSignIn(res) {
  signedIn(res.token, res.account, res.plan);
  let waiting = null;
  try { waiting = JSON.parse(sessionStorage.getItem(BUY_KEY) || 'null'); sessionStorage.removeItem(BUY_KEY); } catch (e) { /* storage blocked */ }
  if (waiting) setTimeout(() => buyPlan(waiting.plan, waiting.bill, waiting.cur), 300); // (signed in to buy: on to the checkout)
  if (res.account.data && res.account.data.profile) {
    const firstHere = !!frLoad(); // (signing in was this device's first run)
    frSave(null); // (the account already knows them: no questions)
    applyAccountData(res.account.data);
    state.setupLater = false; save();
    if (firstHere) { frClose(); offerTour(); }
    track('open');
    try { mascotSay(`Welcome back, ${state.profile.name}! 👋`, 3000); } catch (e) { /* ignore */ }
  } else {
    if (state.profile && !state.setupLater) { // this device already has a profile → save it to the account
      syncAccount(true);
      if (frLoad()) { frSave(null); frClose(); frLand(); } // (the first run's questions were answered just before)
    } else frOnboard(0); // the four questions (also after going straight in: the profile is still blank)
  }
  renderProfileSummary();
}

// Which sign-in buttons to show: the server says which providers have a client ID set (asked once a visit)
var providersAsk = null;
function authProviders() {
  if (!accountsOn()) return Promise.resolve({});
  if (!providersAsk) providersAsk = authCall('/auth/providers', null, 'GET').catch(() => { providersAsk = null; return {}; });
  return providersAsk;
}
const PROVIDER_NAME = { google: 'Google', apple: 'Apple' };
/* Sign in with Google or Apple: the whole page goes to them and comes back here. Never a popup:
   this site keeps other windows apart (so the voice can use several cores), so a popup can't hand
   its answer back, which left students on a blank white window. Google comes straight back to this
   page (#id_token=…); Apple has to post to Cassie's server first, which sends the answer on here
   (#cassie-auth=…). Within 15 seconds the student is signed in, sees "Signing you in…", or sees
   what went wrong with a Try again button. */
var SIGNIN_KEY = 'cassie.signin';
const SIGNIN_CALL_LIMIT = 10000, SIGNIN_LIMIT = 15000; // (Cassie's server gets 10s; nothing stays up past 15s)
function b64url(s) { return btoa(unescape(encodeURIComponent(s))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); }
function unb64url(s) { return decodeURIComponent(escape(atob(String(s).replace(/-/g, '+').replace(/_/g, '/')))); }
// the sign-in this device started (kept in both stores: an installed app may drop one of them)
function pendingSignin() {
  for (const store of [sessionStorage, localStorage]) {
    try { const p = JSON.parse(store.getItem(SIGNIN_KEY) || 'null'); if (p && p.n && Date.now() - p.at < 10 * 60e3) return p; } catch (e) { /* none */ }
  }
  return null;
}
function setPendingSignin(p) {
  for (const store of [sessionStorage, localStorage]) { try { if (p) store.setItem(SIGNIN_KEY, JSON.stringify(p)); else store.removeItem(SIGNIN_KEY); } catch (e) { /* none */ } }
}
// where Google sends the student back: this page, without anything after it (register it in Google Cloud)
function googleReturnURL() { const u = new URL('app.html', location.href); u.search = ''; u.hash = ''; return u.href; }
function signinStart(provider, cfg) {
  const n = b64url(String.fromCharCode(...crypto.getRandomValues(new Uint8Array(24))));
  setPendingSignin({ p: provider, n, at: Date.now() });
  if (provider === 'google') {
    location.assign('https://accounts.google.com/o/oauth2/v2/auth?' + new URLSearchParams({ client_id: cfg.clientId, redirect_uri: googleReturnURL(), response_type: 'id_token', scope: 'openid email profile', nonce: n, state: b64url(JSON.stringify({ n })), prompt: 'select_account' }));
  } else {
    const st = b64url(JSON.stringify({ o: location.origin, p: location.pathname, n }));
    location.assign('https://appleid.apple.com/auth/authorize?' + new URLSearchParams({ client_id: cfg.clientId, redirect_uri: cfg.redirectURI, response_type: 'code id_token', scope: 'name email', response_mode: 'form_post', state: st, nonce: n }));
  }
}
// back from Google or Apple: read the answer, take it out of the address, and use it only if this
// device asked for it. Back with no answer (the back button, the window closed) says it was cancelled.
function signinReturned() {
  const h = location.hash.slice(1), q = new URLSearchParams(h), p = pendingSignin();
  let out = null;
  if (/^cassie-auth=/.test(h)) {
    let msg = null;
    try { msg = JSON.parse(decodeURIComponent(h.slice(12))); } catch (e) { /* not ours */ }
    if (msg && msg.type === 'cassie-auth' && msg.provider === 'apple') out = { provider: 'apple', nonce: msg.nonce, msg };
  } else if (q.has('state') && (q.has('id_token') || q.has('error'))) {
    let st = {};
    try { st = JSON.parse(unb64url(q.get('state'))); } catch (e) { /* not ours */ }
    out = { provider: 'google', nonce: st.n, idToken: q.get('id_token'), error: q.get('error') };
  }
  if (!out) {
    if (!p) return null;
    setPendingSignin(null);
    return { provider: p.p, code: p.p + '_cancelled' };
  }
  history.replaceState(null, '', location.pathname + location.search);
  setPendingSignin(null);
  if (out.error) return { provider: 'google', code: out.error === 'access_denied' ? 'google_cancelled' : 'google_failed' };
  if (!p || p.p !== out.provider || !out.nonce || out.nonce !== p.n) return { provider: out.provider, code: 'signin_mismatch' };
  return out;
}

function openAuth({ first = false, mode = 'signin', returned = null } = {}) {
  document.querySelector('.auth-page')?.remove();
  const page = document.createElement('div');
  page.className = 'auth-page';
  page.innerHTML = `
    <div class="auth-left">
      <div class="auth-brand"><svg viewBox="40 40 420 420" aria-hidden="true"><path d="M108 90 L395 259 L275 281 L342 399 L287 422 L225 300 L108 382 Z" fill="currentColor" stroke="currentColor" stroke-width="56" stroke-linejoin="round"/><g fill="var(--logo-eyes, var(--bg, #fff))"><rect x="168" y="196" width="22" height="70" rx="11"/><rect x="236" y="214" width="22" height="70" rx="11"/></g></svg>Cassie</div>
      <form class="auth-form" novalidate>
        <h1 class="auth-title"></h1>
        <p class="auth-sub"></p>
        <div class="auth-providers">
          <button type="button" class="auth-google" hidden><svg viewBox="0 0 48 48" aria-hidden="true"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg><span>Continue with Google</span></button>
          <button type="button" class="auth-apple" hidden><svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701"/></svg><span>Sign in with Apple</span></button>
        </div>
        <div class="auth-or" hidden><span>or</span></div>
        <label class="auth-field"><span>Email</span><input name="email" type="email" autocomplete="email" inputmode="email" required></label>
        <label class="auth-field auth-age"><span>Your age</span><input name="age" type="number" inputmode="numeric" min="2" max="100" placeholder="e.g. 16"></label>
        <label class="auth-field"><span>Password</span><span class="auth-pw"><input name="password" type="password" minlength="8" required><button type="button" class="auth-eye" aria-label="Show password"><svg viewBox="0 0 24 24"><path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg></button></span></label>
        <div class="auth-busy" role="status" hidden><span class="auth-spin" aria-hidden="true"></span><b>Signing you in…</b><span class="auth-busy-sub">This takes a few seconds.</span></div>
        <p class="auth-err" role="alert" hidden></p>
        <button type="button" class="auth-retry" hidden>Try again</button>
        <button type="submit" class="auth-go"></button>
        <p class="auth-switch"></p>
        <p class="auth-forgot" hidden></p>
        <button type="button" class="auth-skip">Continue as a guest</button>
        <p class="auth-legal">Cassie is for learners of every age, from nursery to college and work. Young children: ask a parent or teacher to help you sign up. Your chats stay on your device; an account keeps your name, grade, settings and saved quiz mistakes in sync. <a href="terms.html" target="_blank" rel="noopener">Terms</a> · <a href="privacy.html" target="_blank" rel="noopener">Privacy</a></p>
      </form>
    </div>
    <div class="auth-right" aria-hidden="true">
      <div class="auth-glow"></div>
      <div class="auth-copy">
        <p class="auth-kicker">Your study buddy</p>
        <h2>Learn anything.<br>On every device.</h2>
        <p>Sign in once: your grade, level and the quiz questions you missed follow you from your phone to your laptop.</p>
      </div>
      <div class="auth-hero"></div>
    </div>`;
  document.body.appendChild(page);
  try { window.CassieBot.create(page.querySelector('.auth-hero'), { state: 'greeting', glow: true, pokeable: true, accessory: window.CassieBot.seasonal() }); } catch (e) { /* no Cassie drawing: the words still work */ }
  const f = page.querySelector('form');
  const err = f.querySelector('.auth-err');
  const go = f.querySelector('.auth-go');
  const retryBtn = f.querySelector('.auth-retry');
  let retry = null;
  const showErr = (m, again) => { err.textContent = m; err.hidden = !m; retry = m && again ? again : null; retryBtn.hidden = !retry; };
  retryBtn.addEventListener('click', () => { const r = retry; showErr(''); if (r) r(); });
  // "Signing you in…": the form steps aside; a watchdog makes sure it never stays up for long
  let busyTimer = 0, busyStop = null, busyAgain = null;
  const busy = (on, words, again) => {
    if (on) busyAgain = again || busyAgain;
    f.classList.toggle('busy', !!on);
    f.querySelector('.auth-busy').hidden = !on;
    if (on) f.querySelector('.auth-busy b').textContent = words || 'Signing you in…';
    clearTimeout(busyTimer);
    if (on) busyTimer = setTimeout(() => { if (busyStop) busyStop(); busy(false); showErr(CassieErrors.say('timeout'), busyAgain || (() => location.reload())); }, SIGNIN_LIMIT);
  };
  const signup = () => mode === 'signup';
  const EMAIL_OK = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
  const check = CassieErrors.form(f, {
    email: (v) => (!v.trim() ? 'need_email' : !EMAIL_OK.test(v.trim()) ? 'email_bad' : ''),
    age: (v) => (!signup() ? '' : !String(v).trim() ? 'need_age' : !(Math.round(+v) >= 2 && Math.round(+v) <= 100) ? 'age_range' : ''),
    password: (v) => (!v ? 'need_password' : signup() && v.length < 8 ? ['password_short', { n: 8 - v.length }] : ''),
  });
  // where the server's answer belongs: under a field, or above the button
  const FIELD_OF = { email_taken: 'email', email_bad: 'email', email_disposable: 'email', no_account: 'email', wrong_password: 'password', password_short: 'password', password_long: 'password', age_range: 'age', link_wrong_password: 'password' };
  // the providers the server reports (a button shows only for those), and a link waiting for its password
  const prov = { google: null, apple: null };
  let linking = null;
  const showProviders = () => {
    const g = !!prov.google && !linking, a = !!prov.apple && !linking;
    page.querySelector('.auth-google').hidden = !g;
    page.querySelector('.auth-apple').hidden = !a;
    page.querySelector('.auth-or').hidden = !(g || a);
  };
  const setMode = (m) => {
    mode = m;
    linking = null;
    f.email.readOnly = false;
    showProviders();
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
    check.clear();
  };
  f.querySelector('.auth-switch').addEventListener('click', (e) => {
    const to = e.target.closest('[data-to]')?.dataset.to;
    if (!to) return;
    if (to === 'forget') { linkWith({ forget: true }); return; }
    if (to === 'forgot') {
      const fp = f.querySelector('.auth-forgot');
      const ways = [prov.google && '“Continue with Google”', prov.apple && '“Sign in with Apple”'].filter(Boolean);
      fp.textContent = ways.length
        ? `If your account’s email is also your ${prov.google && prov.apple ? 'Google or Apple' : prov.google ? 'Google' : 'Apple'} email, tap ${ways.join(' or ')} to get back in. When Cassie asks for the old password, tap “I don’t know this password”.`
        : 'Password resets aren’t available yet. Tap “Report a problem” in Settings with your email and we’ll help, or create a new account.';
      fp.hidden = false; return;
    }
    setMode(to);
  });
  f.querySelector('.auth-eye').addEventListener('click', () => { f.password.type = f.password.type === 'password' ? 'text' : 'password'; });
  f.addEventListener('input', () => { if (!retry) showErr(''); });
  const close = () => { clearTimeout(busyTimer); page.remove(); };
  const done = (res) => { close(); afterSignIn(res); };
  // An answer from Google or Apple: signed in, or (the first time on an email account with a
  // password) ask for that password once, so nobody else's Google or Apple can take the account.
  const startAgain = (provider) => async () => {
    if (navigator.onLine === false) { showErr(CassieErrors.say('offline'), startAgain(provider)); return; }
    busy(true, 'Opening ' + PROVIDER_NAME[provider] + '…', startAgain(provider));
    const p = await authProviders();
    if (!p[provider]) { busy(false); showErr(CassieErrors.say('network'), startAgain(provider)); return; }
    signinStart(provider, p[provider]);
  };
  const providerResult = (provider, res, extra) => {
    busy(false);
    if (res.code) { showErr(CassieErrors.STRINGS[res.code] ? CassieErrors.say(res.code) : CassieErrors.say(provider + '_failed'), startAgain(provider)); return; }
    if (!res.needsPassword) { done(res); return; }
    const P = PROVIDER_NAME[provider];
    setMode('signin');
    linking = { provider, ...extra };
    showProviders();
    f.email.value = res.email || ''; f.email.readOnly = true;
    f.password.value = '';
    f.querySelector('.auth-title').textContent = `Link ${P} to your Cassie account`;
    f.querySelector('.auth-sub').textContent = `There’s already a Cassie account for ${res.email || 'this email'}. Type its password once to link ${P}. After that, you can sign in with ${P} or your password.`;
    go.textContent = 'Link and sign in';
    f.querySelector('.auth-switch').innerHTML = '<button type="button" data-to="forget">I don’t know this password</button> · <button type="button" data-to="signin">Back</button>';
    const fp = f.querySelector('.auth-forgot');
    fp.textContent = `Don’t know it? Tap “I don’t know this password”. Cassie removes the old password and signs out other devices, then signs you in with ${P}.`;
    fp.hidden = false;
    setTimeout(() => f.password.focus(), 30);
  };
  const providerCall = async (provider, body) => {
    busy(true, 'Signing you in…', startAgain(provider));
    const stop = new AbortController();
    busyStop = () => stop.abort();
    try { providerResult(provider, await authCall('/auth/' + provider, body, 'POST', { timeout: SIGNIN_CALL_LIMIT, signal: stop.signal }), { credential: body.credential, nonce: body.nonce, name: body.name }); }
    catch (e) { busy(false); showErr(CassieErrors.explain(e, provider + '_failed'), startAgain(provider)); }
    finally { busyStop = null; }
  };
  const linkWith = async (how) => {
    const l = linking;
    if (!l) return;
    showErr('');
    go.disabled = true; go.setAttribute('aria-busy', 'true');
    try { done(await authCall('/auth/' + l.provider, { credential: l.credential, nonce: l.nonce, name: l.name, ...how }, 'POST', { timeout: SIGNIN_CALL_LIMIT })); }
    catch (e) {
      go.disabled = false; go.removeAttribute('aria-busy');
      if (FIELD_OF[e.code] === 'password' && !how.forget) check.show('password', e.code);
      else showErr(CassieErrors.explain(e, l.provider + '_failed'), () => linkWith(how));
    }
  };
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const email = f.email.value.trim(), password = f.password.value, age = Math.round(+f.age.value);
    showErr('');
    if (!check.check()) return;
    if (linking) { linkWith({ password }); return; }
    go.disabled = true; go.setAttribute('aria-busy', 'true');
    try {
      const res = await authCall(signup() ? '/auth/signup' : '/auth/login', signup() ? { email, password, age } : { email, password });
      if (signup() && first) frSave({ step: 'ob', at: 0, answers: { ...((frLoad() || {}).answers || {}), age: String(age) } }); // (the questions won't ask the age again)
      done(res);
    }
    catch (e2) {
      go.disabled = false; go.removeAttribute('aria-busy');
      const field = FIELD_OF[e2.code];
      if (field) check.show(field, e2.code, { n: Math.max(1, 8 - password.length) });
      else showErr(CassieErrors.explain(e2));
    }
  });
  if (state.profile && state.profile.age && !f.age.value) f.age.value = state.profile.age; // (the age from the first questions)
  f.querySelector('.auth-skip').addEventListener('click', () => {
    close();
    state.skippedAuth = true; save();
    if (!state.profile) frOnboard((frLoad() || {}).at || 0);
    else if (first && frLoad()) { frSave(null); frLand(); } // (the questions are answered: a guest goes straight in)
  });
  if (!first) page.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  const tapProvider = (provider) => {
    if (!prov[provider]) return;
    if (navigator.onLine === false) { showErr(CassieErrors.say('offline'), startAgain(provider)); return; }
    busy(true, 'Opening ' + PROVIDER_NAME[provider] + '…', startAgain(provider));
    signinStart(provider, prov[provider]);
  };
  page.querySelector('.auth-apple').addEventListener('click', () => tapProvider('apple'));
  page.querySelector('.auth-google').addEventListener('click', () => tapProvider('google'));
  // back here from Google with the page kept as it was (the back button): it was cancelled
  page.addEventListener('signin-back', (e) => { busy(false); showErr(CassieErrors.say(e.detail.code), startAgain(e.detail.provider)); });
  authProviders().then((p) => {
    if (!page.isConnected) return;
    prov.google = p.google && p.google.clientId ? p.google : null;
    prov.apple = p.apple && p.apple.clientId && p.apple.redirectURI ? p.apple : null;
    showProviders();
  });
  setMode(mode);
  // back from Google or Apple: sign in (Google's answer is checked by Cassie's server first), or say why not
  if (returned) {
    if (returned.code) providerResult(returned.provider, { code: returned.code });
    else if (returned.provider === 'google') providerCall('google', { credential: returned.idToken, nonce: returned.nonce });
    else providerResult('apple', returned.msg, { credential: returned.msg.credential, nonce: returned.msg.nonce, name: returned.msg.name });
  }
  setTimeout(() => f.email.focus(), 60);
}

function renderAccountRow() {
  const row = document.getElementById('account-row');
  if (!row) return;
  row.hidden = !accountsOn();
  const a = state.account && authToken() ? state.account : null;
  row.innerHTML = a
    ? `<p class="field-hint">Signed in as <b>${escapeHtml(a.email || a.name || 'you')}</b>${(a.providers || (a.google ? ['google'] : [])).length ? ` (${(a.providers || ['google']).map((p) => PROVIDER_NAME[p]).join(' and ')})` : ''}. Your profile and saved mistakes sync to your account. Plan: <b>${{ plus: 'Plus', pro: 'Pro' }[planName()] || 'Free'}</b>.</p>
       <div class="acct-btns"><button type="button" class="new-chat-btn" data-act="signout">Sign out</button><button type="button" class="new-chat-btn acct-del" data-act="delete">Delete account</button></div>`
    : `<p class="field-hint">Sign in to keep your profile and progress on every device.</p>
       <button type="button" class="new-chat-btn" data-act="signin">Sign in or create an account</button>`;
}
document.getElementById('account-row')?.addEventListener('click', async (e) => {
  const act = e.target.closest('[data-act]')?.dataset.act;
  if (!act) return;
  if (act === 'signin') { settingsPanel.hidden = true; openAuth({ mode: 'signin' }); return; }
  if (act === 'signout') { await signOutNow(); return; }
  if (act === 'delete') {
    if (!confirm('Delete your Cassie account? Your profile and saved mistakes are removed from the server. What’s on this device stays.')) return;
    try { await authCall('/auth/delete', {}); signedOutLocally(); mascotSay('Account deleted.', 2500); } catch (e2) { alert(CassieErrors.explain(e2)); }
  }
});

function renderProfileSummary() {
  { const card = document.querySelector('#settings-panel .settings-card'); if (card && card.dataset.page === 'profile') setTimeout(fillYou, 0); }
  const el = document.getElementById('profile-summary'); const p = state.profile;
  if (el) el.textContent = p ? [p.name, p.role === 'pro' ? (p.field || 'Working') : p.grade, p.age ? `age ${p.age}` : '', { female: 'Female', male: 'Male' }[p.gender] || ''].filter(Boolean).join(' · ') : 'No profile yet.';
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
    <p class="pf-err" role="alert" hidden></p>
    <div class="pf-row"><button type="button" class="new-chat-btn pf-cancel">Cancel</button><button type="submit" class="pf-go">Send</button></div>
  </form>`;
  document.body.appendChild(wrap);
  const f = wrap.querySelector('form');
  const close = () => wrap.remove();
  wrap.querySelector('.pf-cancel').addEventListener('click', close);
  wrap.addEventListener('click', (e) => { if (e.target === wrap) close(); });
  f.text.focus();
  if (window.CassieMic) window.CassieMic.attach(f.text);
  const check = CassieErrors.form(f, { text: (v) => (v.trim().length < 5 ? 'need_report' : '') });
  f.addEventListener('submit', async (e) => {
    e.preventDefault();
    const text = f.text.value.trim();
    const err = f.querySelector('.pf-err');
    err.hidden = true;
    if (!check.check()) return;
    const send = f.querySelector('.pf-go');
    send.disabled = true; send.setAttribute('aria-busy', 'true');
    const ok = await sendFeedback('report', 'report', text);
    if (!ok) { err.textContent = CassieErrors.say(navigator.onLine === false ? 'offline' : 'report_failed'); err.hidden = false; send.disabled = false; send.removeAttribute('aria-busy'); return; }
    f.innerHTML = '<h2>Thank you!</h2><p class="pf-sub">Your report was sent. It helps make Cassie better for everyone.</p><button type="button" class="pf-go">Close</button>';
    f.querySelector('.pf-go').addEventListener('click', close);
  });
}
document.getElementById('report-btn')?.addEventListener('click', () => { settingsPanel.hidden = true; openReport(); });
if (!SERVER) { const rb = document.getElementById('report-row'); if (rb) rb.hidden = true; }

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

/* ---------- Flashcards (cards.js): spaced-repetition study, on the device ---------- */
if (window.CassieCards) {
  window.CassieCards.init({
    state: () => state,
    save,
    ask: (prompt) => askCassie([{ role: 'user', content: prompt }]),
    speak: (text) => window.CassieVoice.speak(cleanForSpeech(text), { gender: voiceGender() }),
    // Listen to a whole deck: one decision for all of it (Bella reads every card, or none and says so once)
    session: (all) => { const s = window.CassieVoice.session({ gender: voiceGender() }); s.plan(cleanForSpeech(all)); return { speak: (t) => s.speak(cleanForSpeech(t)), end: () => s.end() }; },
    track,
    onChange: () => { if (!state.messages.length) renderHistory(); }, // the home screen shows what's due
    onGrade: (before, after) => { if (after > before) progressAdd({ cardsUp: 1 }); }, // (the weekly card)
  });
}

/* ---------- Read & highlight: a file opened inside Cassie (phones and tablets) ----------
   Phone browsers don't run extensions, so students read their PDF / Word / PowerPoint here,
   page by page, and highlight any part of it: the same Ask Cassie button as in the chat shows. */
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

document.getElementById('reader-close')?.addEventListener('click', closeReader);

/* "Paste & ask": copy words in any app, open Cassie, tap once (the easiest way on iPhone). */
document.getElementById('paste-btn')?.addEventListener('click', async () => {
  let text = '';
  islandShow('reading', 'Reading what you copied…'); // at once: the browser can take a moment (or ask first)
  try { text = (await navigator.clipboard.readText()) || ''; } catch (e) { text = ''; }
  islandRest();
  track('feature', 'paste-ask');
  if (text.trim()) { showShareCard(text, 'what you copied'); return; }
  // no clipboard access (or nothing copied): let them paste by hand
  promptInput.focus();
  islandShow('busy', 'Copy some words first, or long-press here → Paste', 3200);
});

/* ---------- text and files shared from other apps (phones and tablets) ----------
   Android: select text in any app → Share → Cassie (the manifest's share_target; sw.js keeps
   what was shared). iPhone / iPad, or any link: app.html?text=… (an iOS Shortcut can send it).
   Cassie then asks what to do with it. */
// Text copied on a phone loses its maths: PDF "math letters" (𝑥, 𝒚), x² → x2, fractions split
// over lines. Turn the special letters back into normal ones, and tell Cassie to rebuild the rest.
function cleanShared(t) {
  return String(t || '')
    .replace(/[\u{1D400}-\u{1D7FF}]/gu, (c) => c.normalize('NFKC')) // 𝑥 𝑦 𝟐 → x y 2
    .replace(/[\u2212\u2013]/g, '-').replace(/\u00a0/g, ' ')
    .replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
}
const looksMathy = (t) => /[=^√∫∑π≤≥÷×]|\b\d+\s*[a-z]\b|\b[a-z]\d\b|\([^)]*[a-z][^)]*\)\s*\d|\bsolve\b|\bf\(x\)/i.test(t);
const MATH_NOTE = 'It was copied on a phone, so the maths may be flattened: "x2" usually means x², "x3" means x³, a number on the line under another is often a fraction, and symbols like √, π or exponents may be missing. First rebuild the intended expression and write it in one line ("I read this as: …"), then work it out carefully and double-check.';
const withNote = (t, ask) => `${ask}\n\n"${t}"${looksMathy(t) ? `\n\n(${MATH_NOTE})` : ''}`;
const SHARE_ACTIONS = [
  ['Explain', (t) => withNote(t, 'Explain this step by step, simply:')],
  ['Answer', (t) => withNote(t, 'Answer this. Give the answer first, then a short explanation of why:')],
  ['Summarize', (t) => withNote(t, 'Summarize this in a few short bullet points with the key terms in bold:')],
  ['Quiz me', (t) => withNote(t, 'Quiz me on this, one question at a time:')],
];
function showShareCard(text, source) {
  const t = cleanShared(text).slice(0, 6000);
  if (!t) return;
  if (state.messages.length) createNewChat();
  const card = document.createElement('div');
  card.className = 'share-card';
  card.innerHTML = '<div class="share-head">What should I do with this?</div><blockquote class="share-quote"></blockquote><div class="share-from"></div><div class="share-row"></div><div class="share-tip" hidden>Equations copied from a PDF can lose their formatting. If my answer looks off, send a <b>screenshot</b> instead (📎): I read pictures exactly.</div>';
  card.querySelector('.share-tip').hidden = !looksMathy(t);
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
document.querySelectorAll('.share-link').forEach((el) => { el.textContent = SERVER ? SERVER + '/ask?text=' : new URL('app.html?text=', location.href).href; });
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
const rescued = takeRescue(); // a plan from the Exam Rescue Plan page (a new student keeps it through the first run)
const fromRescue = /[?&]from=rescue/.test(location.search);
if (fromRescue) history.replaceState(null, '', location.pathname + location.hash);
if (rescued && state.profile && (!rescued.full || fromRescue)) setTimeout(() => (rescued.full ? (!isSubscriber() && plusSheet('More exam plans', 'Free keeps one exam plan at a time. Delete the plan on Home to add your Exam Rescue Plan, or get Plus for up to 5 at once.')) : examReadySheet(rescued)), 600);
const signinBack = accountsOn() ? signinReturned() : null; // back from Google or Apple
if (signinBack) openAuth({ first: !state.profile, mode: 'signin', returned: signinBack }); // at once: "Signing you in…", never a bare page
else if (!state.profile) {
  // Welcome, Intro, Sign in (with Cassie's server), then the four questions; a reload carries on
  firstRun();
}
if (state.profile) track('open');
// back from PayMongo (?paid=…), or sent from the website's pricing to buy (?buy=plus-month-usd)
{
  const q = new URLSearchParams(location.search), paid = q.get('paid'), buy = q.get('buy');
  if (paid || buy) history.replaceState(null, '', location.pathname + location.hash);
  if (paid && /^(cancel|cas_[a-f0-9]{24})$/.test(paid)) setTimeout(() => paidReturn(paid), 400);
  else if (buy) { const [pl, bi, cu] = buy.split('-'); setTimeout(() => buyPlan(pl === 'pro' ? 'pro' : 'plus', ['month', 'sem', 'year'].includes(bi) ? bi : 'month', cu === 'usd' || cu === 'php' ? cu : payCur()), 500); }
  else setTimeout(() => refreshPlan().then(planReminder).catch(() => {}), 1500);
}
// back from Google with the page kept as it was (the back button on a phone): say it was cancelled
window.addEventListener('pageshow', (e) => {
  if (!e.persisted || !accountsOn()) return;
  const r = signinReturned();
  if (!r) return;
  const page = document.querySelector('.auth-page');
  if (page && r.code) page.dispatchEvent(new CustomEvent('signin-back', { detail: r }));
  else openAuth({ first: !state.profile, mode: 'signin', returned: r });
});
// signed in: fetch the latest profile from the account (another device may have changed it)
if (accountsOn() && authToken()) {
  planAsked = Date.now(); // (this asks for the plan too: refreshPlan needn't ask again for a minute)
  authCall('/auth/me', null, 'GET').then((r) => { if (r.account) { state.account = accountOf(r.account); if (r.plan) { state.plan = r.plan; save(); } if (r.account.data) applyAccountData(r.account.data); else syncAccount(true); renderProfileSummary(); } })
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
