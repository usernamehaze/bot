'use strict';

/* ---------- storage ---------- */
const STORE_KEY = 'cassie.v1';

function loadState() {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) { /* ignore corrupt state */ }
  return {
    apiKey: '',
    model: 'claude-sonnet-5',
    voiceOut: false,
    messages: [], // { role: 'user' | 'assistant', content: '...' }
    studyText: '',
  };
}

let state = loadState();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

const SYSTEM_PROMPT = `You are Cassie, a brilliant, patient, encouraging AI tutor that lives inside a
study app as an animated cursor character. You can help with any subject a
student is studying: math, science, history, languages, coding, essay
writing, test prep, and more.

Teach, don't just answer:
- Explain concepts step by step, building from what the student already seems to know.
- Use short, clear paragraphs and concrete examples. Use markdown-style
  formatting sparingly (short lists, bold for key terms) since this renders as plain text.
- When solving a problem, show the reasoning, not just the final answer.
- After explaining, briefly check understanding or offer a related practice question when it fits naturally.
- Keep answers focused and not overly long unless the student asks for depth.
- Be warm and encouraging, especially when the student is stuck.`;

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
const clearChatBtn = document.getElementById('clear-chat-btn');
const cursorEl = document.getElementById('cassie-cursor');
const studyTextWrap = document.getElementById('study-text-wrap');
const studyTextToggle = document.getElementById('study-text-toggle');
const studyText = document.getElementById('study-text');
const studyTextClear = document.getElementById('study-text-clear');
const highlightToolbar = document.getElementById('highlight-toolbar');
const contextMenu = document.getElementById('context-menu');

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

function renderMessage(role, text) {
  const bubble = document.createElement('div');
  bubble.className = `bubble bubble-${role}`;
  text.split(/\n{2,}/).forEach((para) => {
    const p = document.createElement('p');
    p.textContent = para;
    bubble.appendChild(p);
  });
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

/* ---------- Anthropic API ---------- */
async function askCassie(userText) {
  const body = {
    model: state.model,
    max_tokens: 1024,
    system: SYSTEM_PROMPT,
    messages: [...state.messages, { role: 'user', content: userText }]
      .map((m) => ({ role: m.role, content: m.content })),
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': state.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }

  const data = await res.json();
  return (data.content || []).map((block) => block.text || '').join('').trim() || '(no response)';
}

/* ---------- send flow ---------- */
async function handleSend(text) {
  if (!text.trim()) return;

  if (!state.apiKey) {
    openSettings();
    detourToElement(apiKeyInput, { click: true, resumeAfter: 1200 });
    renderMessage('assistant', "I need an Anthropic API key before I can answer — pop it into Settings (top right) and I'll be ready.");
    return;
  }

  state.messages.push({ role: 'user', content: text });
  save();
  renderMessage('user', text);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  const typingBubble = renderTyping();
  sendBtn.disabled = true;

  try {
    const reply = await askCassie(text);
    state.messages.push({ role: 'assistant', content: reply });
    save();
    typingBubble.remove();
    const bubble = renderMessage('assistant', reply);
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
  settingsPanel.hidden = false;
}
function closeSettings() {
  state.apiKey = apiKeyInput.value.trim();
  state.model = modelSelect.value;
  state.voiceOut = voiceOutToggle.checked;
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
  hideHighlightToolbar();
});

/* ---------- highlight-to-ask ---------- */
/* Only ever looks at text inside #study-text (what the user pasted into
   Cassie), never at the rest of the page or anything outside the app. */
let selTimer = null;

function hideHighlightToolbar() {
  highlightToolbar.hidden = true;
}

function updateHighlightToolbar() {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hideHighlightToolbar(); return; }
  const range = sel.getRangeAt(0);
  if (!studyText.contains(range.commonAncestorContainer)) { hideHighlightToolbar(); return; }
  const text = sel.toString().trim();
  if (!text) { hideHighlightToolbar(); return; }

  const rect = range.getBoundingClientRect();
  const left = Math.min(Math.max(rect.left + rect.width / 2, 60), window.innerWidth - 60);
  const top = Math.max(rect.top, 50);
  highlightToolbar.style.left = `${left}px`;
  highlightToolbar.style.top = `${top}px`;
  highlightToolbar.dataset.text = text;
  highlightToolbar.hidden = false;
}

document.addEventListener('selectionchange', () => {
  clearTimeout(selTimer);
  selTimer = setTimeout(updateHighlightToolbar, 120);
});

document.addEventListener('mousedown', (e) => {
  if (!highlightToolbar.contains(e.target) && !studyText.contains(e.target)) {
    hideHighlightToolbar();
  }
});

chatLog.addEventListener('scroll', hideHighlightToolbar);
studyText.addEventListener('scroll', hideHighlightToolbar);
window.addEventListener('resize', hideHighlightToolbar);

function sendExplainAction(text, action) {
  const label = action === 'answer' ? 'Explain and answer' : 'Explain';
  window.getSelection().removeAllRanges();
  handleSend(`${label}: "${text}"`);
}

highlightToolbar.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const text = highlightToolbar.dataset.text;
  if (!text) return;
  hideHighlightToolbar();
  sendExplainAction(text, btn.dataset.action);
});

/* ---------- custom right-click menu on the study-text box ---------- */
/* Same scope as the toolbar above: only fires for a selection inside
   #study-text, and adds "Explain" / "Explain & answer" next to a normal
   Copy — it never touches the browser's native menu anywhere else. */
function hideContextMenu() {
  contextMenu.hidden = true;
}

studyText.addEventListener('contextmenu', (e) => {
  const sel = window.getSelection();
  if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if (!studyText.contains(range.commonAncestorContainer)) return;
  const text = sel.toString().trim();
  if (!text) return;

  e.preventDefault();
  hideHighlightToolbar();
  contextMenu.dataset.text = text;
  const left = Math.min(e.clientX, window.innerWidth - 170);
  const top = Math.min(e.clientY, window.innerHeight - 150);
  contextMenu.style.left = `${left}px`;
  contextMenu.style.top = `${top}px`;
  contextMenu.hidden = false;
});

contextMenu.addEventListener('click', (e) => {
  const btn = e.target.closest('button[data-action]');
  if (!btn) return;
  const text = contextMenu.dataset.text;
  hideContextMenu();
  if (!text) return;
  if (btn.dataset.action === 'copy') {
    if (navigator.clipboard?.writeText) navigator.clipboard.writeText(text).catch(() => {});
    window.getSelection().removeAllRanges();
    return;
  }
  sendExplainAction(text, btn.dataset.action);
});

document.addEventListener('mousedown', (e) => {
  if (!contextMenu.contains(e.target)) hideContextMenu();
});
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') hideContextMenu();
});
document.addEventListener('scroll', hideContextMenu, true);
window.addEventListener('resize', hideContextMenu);

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
