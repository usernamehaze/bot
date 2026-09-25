'use strict';

/* ---------- storage ---------- */
const STORE_KEY = 'cassie.v2'; // v2: switched from Anthropic to Google Gemini

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt state */ }
  return {
    apiKey: '',
    model: 'gemini-3.6-flash',
    voiceOut: false,
    webSearch: true, // fact-check via Google Search grounding when available
    messages: [], // { role: 'user' | 'assistant', content: '...' }
    studyText: '',
  };
}

const CURRENT_MODELS = ['gemini-3.6-flash', 'gemini-3.6-pro'];

let state = loadState();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

// If a previously stored model has since been retired, snap to the current default.
if (!CURRENT_MODELS.includes(state.model)) {
  state.model = 'gemini-3.6-flash';
  save();
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
- History, science, math, literature, languages, essay and email writing, exam prep, general knowledge, and professional tasks (summaries, reports, explanations).

How you work:
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing — never invent dates, quotes, statistics, or sources. A careful "I'm not fully certain, but…" is better than a confident wrong answer.
- Teach when explanation is wanted: show the reasoning step by step, build from what the user seems to know, and use concrete examples.
- For coding: give correct, runnable code inside fenced code blocks (triple backticks with the language, e.g. \`\`\`python). Explain what the code does and why, call out edge cases and complexity, and when useful suggest a cleaner or more idiomatic approach. When debugging, identify the actual cause, show the fix, and explain it so they learn.
- Match the format the user asks for. If they ask for only the answer, give just the answer. If they ask you to explain, give the answer AND the reasoning.
- For a single word or short phrase, respond like a helpful dictionary + thesaurus: definition, part of speech, meaning, a couple of synonyms and antonyms, and an example — unless they asked for only one of those.
- Keep answers focused and well-organized: short paragraphs, small lists, and fenced code blocks for any code.
- Adapt your tone: friendly and encouraging for students, crisp and professional for work tasks.
- Be honest, clear, and genuinely useful every time.`;

/* ---------- DOM refs ---------- */
const chatLog = document.getElementById('chat-log');
const composer = document.getElementById('composer');
const promptInput = document.getElementById('prompt-input');
const sendBtn = document.getElementById('send-btn');
const micBtn = document.getElementById('mic-btn');
const settingsBtn = document.getElementById('settings-btn');
const settingsPanel = document.getElementById('settings-panel');
const settingsCloseBtn = document.getElementById('settings-close-btn');
const apiKeyInput = document.getElementById('api-key-input');
const modelSelect = document.getElementById('model-select');
const voiceOutToggle = document.getElementById('voice-out-toggle');
const webSearchToggle = document.getElementById('web-search-toggle');
const clearChatBtn = document.getElementById('clear-chat-btn');
const cursorEl = document.getElementById('cassie-cursor');
const attachBtn = document.getElementById('attach-btn');
const fileInput = document.getElementById('file-input');
const attachPreview = document.getElementById('attach-preview');
const attachThumb = document.getElementById('attach-thumb');
const attachRemove = document.getElementById('attach-remove');
const imageBtn = document.getElementById('image-btn');
const studyTextWrap = document.getElementById('study-text-wrap');
const studyTextToggle = document.getElementById('study-text-toggle');
const studyText = document.getElementById('study-text');
const studyTextClear = document.getElementById('study-text-clear');
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

function setCursorMode(mode) {
  cursorState = mode;
  cursorEl.classList.toggle('thinking', mode === 'thinking');
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

// Escape first, then apply a tiny bit of inline markdown (`code`, **bold**).
function inlineFormat(text) {
  return escapeHtml(text)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
}

// Render text into `container`, turning ```fenced``` blocks into <pre><code>
// (monospaced) and normal text into paragraphs with inline formatting.
function renderFormatted(container, text) {
  container.innerHTML = '';
  const segments = String(text).split('```'); // even = prose, odd = code block
  segments.forEach((seg, i) => {
    if (i % 2 === 1) {
      let body = seg;
      const nl = seg.indexOf('\n');
      if (nl !== -1) {
        const first = seg.slice(0, nl).trim();
        if (/^[a-zA-Z0-9+#.\-]{0,15}$/.test(first)) body = seg.slice(nl + 1); // strip language label
      }
      const pre = document.createElement('pre');
      const code = document.createElement('code');
      code.textContent = body.replace(/\n$/, '');
      pre.appendChild(code);
      container.appendChild(pre);
    } else {
      seg.split(/\n{2,}/).forEach((para) => {
        if (!para.trim()) return;
        const p = document.createElement('p');
        p.innerHTML = inlineFormat(para);
        container.appendChild(p);
      });
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

function renderHistory() {
  chatLog.innerHTML = '';
  if (state.messages.length === 0) {
    const bubble = document.createElement('div');
    bubble.className = 'bubble bubble-assistant intro';
    bubble.innerHTML = "<p>Hi, I'm Cassie. Ask me anything you're studying — I'll walk you through it step by step.</p>";
    chatLog.appendChild(bubble);
    return;
  }
  state.messages.forEach((m) => renderMessage(m.role, m.content));
}

/* ---------- Google Gemini API (free tier) ---------- */
/* Google retires model IDs over time. FALLBACK_MODEL is the current known-good
   one; if a request fails because the selected model is gone, we retry once on
   the fallback and remember it, so a retired ID never permanently breaks the app. */
const FALLBACK_MODEL = 'gemini-3.6-flash';

function modelRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|unsupported|not exist/i.test(msg || '');
}

/* Transient "the model is busy" conditions — worth waiting out and retrying the
   same model, rather than surfacing an error or asking the user to switch. */
function isOverloaded(status, msg) {
  return status === 429 || status === 503 ||
    /high demand|overloaded|try again later|temporarily|unavailable|resource exhausted|quota/i.test(msg || '');
}
const MAX_OVERLOAD_RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/* Pull the web sources Gemini used to ground its answer, so we can show them. */
function extractSources(cand) {
  const chunks = cand?.groundingMetadata?.groundingChunks || [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const uri = c.web && c.web.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); out.push(c.web.title || uri); }
  }
  return out.slice(0, 5);
}

/* `msgs` is an array of { role: 'user' | 'assistant', content } — the caller
   owns the history (handleSend passes state.messages; the highlight popover
   passes a one-off), so nothing is appended or duplicated here. `image`
   (optional { mimeType, base64 }) is attached to the latest user turn. */
async function askCassie(msgs, image) {
  const contents = msgs.map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: m.content }],
  }));
  if (image && contents.length) {
    contents[contents.length - 1].parts.unshift({
      inlineData: { mimeType: image.mimeType, data: image.base64 },
    });
  }

  let model = state.model;
  let useSearch = state.webSearch !== false; // fact-check with Google Search
  let overloadTries = 0;
  while (true) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents,
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    };
    if (useSearch) body.tools = [{ google_search: {} }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': state.apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail) && model !== FALLBACK_MODEL) {
        model = FALLBACK_MODEL;
        state.model = FALLBACK_MODEL; // remember, so we skip the retry next time
        save();
        continue;
      }
      // If the search tool isn't allowed (e.g. free-tier/model limit), drop it
      // and answer normally rather than failing.
      if (useSearch && res.status === 400) {
        useSearch = false;
        continue;
      }
      if (isOverloaded(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
        overloadTries += 1;
        await sleep(1200 * Math.pow(2, overloadTries - 1)); // ~1.2s, 2.4s, 4.8s, 9.6s
        continue;
      }
      if (isOverloaded(res.status, detail)) {
        throw new Error("Google's free tier is really busy right now — give it a minute and try again.");
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }

    const data = await res.json();
    const cand = data.candidates?.[0];
    let text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!text) {
      if (cand?.finishReason === 'SAFETY') return "I can't help with that one — try rephrasing it.";
      return '(no response)';
    }
    const sources = extractSources(cand);
    if (sources.length) text += `\n\nSources: ${sources.join(' · ')}`;
    return text;
  }
}

/* ---------- upload / download / image helpers ---------- */
let pendingImage = null; // { mimeType, base64, dataUrl }

function clearAttach() {
  pendingImage = null;
  attachPreview.hidden = true;
  attachThumb.removeAttribute('src');
  fileInput.value = '';
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

const DL_ICON = '<svg viewBox="0 0 24 24"><path d="M12 16l-5-5h3V4h4v7h3l-5 5zm-7 2h14v2H5z"/></svg>';

function addTextDownload(bubble, text) {
  const tools = document.createElement('div');
  tools.className = 'bubble-tools';
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
async function handleSend(text) {
  const image = pendingImage;
  if (!text.trim() && !image) return;

  if (!state.apiKey) {
    openSettings();
    detourToElement(apiKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', "I need a free Google (Gemini) API key before I can answer — pop it into Settings (top right) and I'll be ready.");
    return;
  }

  let sendText = text.trim();
  if (!sendText && image) sendText = 'Please look at this image and help me with it.';

  state.messages.push({ role: 'user', content: sendText });
  save();
  const userBubble = renderMessage('user', sendText);
  if (image) addImageToBubble(userBubble, image.dataUrl);
  clearAttach();
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  const typingBubble = renderTyping();
  sendBtn.disabled = true;

  try {
    const reply = await askCassie(state.messages, image);
    state.messages.push({ role: 'assistant', content: reply });
    save();
    typingBubble.remove();
    const bubble = renderMessage('assistant', reply);
    addTextDownload(bubble, reply);
    setCursorMode('idle');
    detourToElement(bubble, { click: true, resumeAfter: 900 });
    speak(reply);
  } catch (err) {
    typingBubble.remove();
    renderMessage('assistant', `Something went wrong: ${err.message}`).classList.add('error');
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = false;
  }
}

/* ---------- image generation ---------- */
const IMAGE_MODEL = 'gemini-2.5-flash-image';

async function generateImage(prompt) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${IMAGE_MODEL}:generateContent`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': state.apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'] },
    }),
  });
  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 404 || res.status === 400) {
      throw new Error("image generation isn't available on the free tier for this key right now");
    }
    throw new Error(detail || `Request failed (${res.status})`);
  }
  const parts = (await res.json()).candidates?.[0]?.content?.parts || [];
  const imgPart = parts.find((p) => p.inlineData && p.inlineData.data);
  if (!imgPart) throw new Error('no image came back — try describing it differently');
  return `data:${imgPart.inlineData.mimeType || 'image/png'};base64,${imgPart.inlineData.data}`;
}

async function handleGenerateImage() {
  const text = promptInput.value.trim();
  if (!text) return;
  if (!state.apiKey) {
    openSettings();
    detourToElement(apiKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', "I need a free Google (Gemini) API key first — add it in Settings (top right).");
    return;
  }
  state.messages.push({ role: 'user', content: `Generate an image: ${text}` });
  save();
  renderMessage('user', `Generate an image: ${text}`);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  const typingBubble = renderTyping();
  sendBtn.disabled = imageBtn.disabled = true;

  try {
    const dataUrl = await generateImage(text);
    typingBubble.remove();
    const bubble = renderMessage('assistant', '');
    addImageToBubble(bubble, dataUrl, { download: true });
    state.messages.push({ role: 'assistant', content: '[generated an image]' });
    save();
    setCursorMode('idle');
  } catch (err) {
    typingBubble.remove();
    renderMessage('assistant', `Couldn't generate that image: ${err.message}`).classList.add('error');
    setCursorMode('idle');
  } finally {
    sendBtn.disabled = imageBtn.disabled = false;
  }
}

/* ---------- attach / generate wiring ---------- */
attachBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file || !file.type.startsWith('image/')) return;
  try {
    pendingImage = await processImageFile(file);
    attachThumb.src = pendingImage.dataUrl;
    attachPreview.hidden = false;
  } catch (e) {
    clearAttach();
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

/* ---------- settings ---------- */
function openSettings() {
  apiKeyInput.value = state.apiKey;
  modelSelect.value = state.model;
  voiceOutToggle.checked = state.voiceOut;
  webSearchToggle.checked = state.webSearch !== false;
  settingsPanel.hidden = false;
}
function closeSettings() {
  state.apiKey = apiKeyInput.value.trim();
  state.model = modelSelect.value;
  state.voiceOut = voiceOutToggle.checked;
  state.webSearch = webSearchToggle.checked;
  save();
  settingsPanel.hidden = true;
  resumeFollowing();
}
settingsBtn.addEventListener('click', () => {
  openSettings();
  detourToElement(settingsBtn, { click: true, resumeAfter: 900 });
});
settingsCloseBtn.addEventListener('click', closeSettings);

clearChatBtn.addEventListener('click', () => {
  if (!confirm('Clear the whole conversation?')) return;
  state.messages = [];
  save();
  renderHistory();
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

/* ---------- study text panel ---------- */
studyTextToggle.addEventListener('click', () => {
  studyTextWrap.classList.toggle('expanded');
});

studyText.addEventListener('paste', (e) => {
  e.preventDefault();
  const text = (e.clipboardData || window.clipboardData).getData('text/plain');
  document.execCommand('insertText', false, text);
});

let studyTextSaveTimer = null;
studyText.addEventListener('input', () => {
  clearTimeout(studyTextSaveTimer);
  studyTextSaveTimer = setTimeout(() => {
    state.studyText = studyText.innerText;
    save();
  }, 300);
});

studyTextClear.addEventListener('click', () => {
  studyText.innerText = '';
  state.studyText = '';
  save();
  hideHighlightPopover();
});

/* ---------- highlight-to-ask (automatic) ---------- */
/* Only ever looks at text inside #study-text (what the user pasted into
   Cassie), never at the rest of the page or anything outside the app.
   Highlighting a bit of that text — no button, no menu — shows the
   explanation/answer in a small popover right there. Nothing here is
   added to the main chat; it's a separate, throwaway lookup. */
let selTimer = null;
let lastAutoText = '';
let highlightGen = 0;

function hideHighlightPopover() {
  highlightPopover.hidden = true;
  lastAutoText = '';
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

function setPopoverChoice(text, rect) {
  pendingText = text;
  pendingRect = rect;
  highlightPopoverBody.classList.remove('muted');
  highlightPopoverBody.innerHTML = `
    <div class="popover-question">Explain this, or answer it?</div>
    <div class="popover-choice-row">
      <button type="button" class="popover-choice-btn" data-mode="explain">Explain</button>
      <button type="button" class="popover-choice-btn" data-mode="answer">Answer</button>
    </div>
  `;
  positionPopover(rect);
}

highlightPopoverBody.addEventListener('click', (e) => {
  const btn = e.target.closest('.popover-choice-btn');
  if (!btn) return;
  runExplainOrAnswer(pendingText, pendingRect, btn.dataset.mode);
});

async function runExplainOrAnswer(text, rect, mode) {
  const myGen = ++highlightGen;
  setPopoverContent('Thinking…', { muted: true });
  positionPopover(rect);

  if (!state.apiKey) {
    setPopoverContent('Add your free Google (Gemini) API key in Settings first.', { muted: true });
    positionPopover(rect);
    openSettings();
    detourToElement(apiKeyInput, { click: true, resumeAfter: 1200 });
    return;
  }

  setCursorMode('thinking');
  const prompt = mode === 'answer'
    ? `Give only the direct answer to this — no explanation, no extra words:\n\n"${text}"`
    : `Answer this and explain your reasoning — give the answer, then explain why/how:\n\n"${text}"`;
  try {
    const reply = await askCassie([{ role: 'user', content: prompt }]);
    if (myGen !== highlightGen) return; // a newer selection superseded this one
    setPopoverContent(reply);
    positionPopover(rect);
    detourToElement(highlightPopover, { click: true, resumeAfter: 900 });
  } catch (err) {
    if (myGen !== highlightGen) return;
    setPopoverContent(`Something went wrong: ${err.message}`, { muted: true });
    positionPopover(rect);
  } finally {
    if (myGen === highlightGen) setCursorMode('idle');
  }
}

function checkSelectionForAutoExplain() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideHighlightPopover(); return; }
  const range = sel.getRangeAt(0);
  if (!studyText.contains(range.commonAncestorContainer)) { hideHighlightPopover(); return; }
  const text = sel.toString().trim();
  if (!text || text.length < 2 || text === lastAutoText) return;
  lastAutoText = text;
  highlightPopover.hidden = false;
  setPopoverChoice(text, range.getBoundingClientRect());
}

document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(checkSelectionForAutoExplain, 450);
});

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

document.addEventListener('mousedown', (e) => {
  if (!highlightPopover.contains(e.target) && !studyText.contains(e.target)) {
    hideHighlightPopover();
  }
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape' && !highlightPopover.hidden) dismissHighlightPopover();
});

/* Right-click (or two-finger tap on a trackpad) on selected text shows the
   Explain / Answer buttons at the pointer, instead of the browser menu.
   Only hijacks when there IS a selection; plain inputs keep their native menu. */
document.addEventListener('contextmenu', (e) => {
  if (e.target.closest('input, textarea')) return; // keep native menu in edit fields
  const sel = window.getSelection();
  const text = sel ? sel.toString().trim() : '';
  if (!text || text.length < 2) return; // nothing selected -> normal menu
  e.preventDefault();
  lastAutoText = text;
  const rect = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
  highlightPopover.hidden = false;
  setPopoverChoice(text, rect);
});

chatLog.addEventListener('scroll', hideHighlightPopover);
studyText.addEventListener('scroll', hideHighlightPopover);
window.addEventListener('resize', hideHighlightPopover);

/* ---------- init ---------- */
if (state.studyText) studyText.innerText = state.studyText;
renderHistory();
requestAnimationFrame(() => {
  setCursorMode('idle');
  followMouseNow();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install still works without SW */ });
  });
}
