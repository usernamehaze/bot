'use strict';

/* ---------- storage ---------- */
const STORE_KEY = 'clicky.v1';

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
  };
}

let state = loadState();

function save() {
  localStorage.setItem(STORE_KEY, JSON.stringify(state));
}

const SYSTEM_PROMPT = `You are Clicky, a brilliant, patient, encouraging AI tutor that lives inside a
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
const cursorEl = document.getElementById('clicky-cursor');

/* ---------- animated cursor ---------- */
let cursorState = 'idle';

function moveCursorTo(x, y, { click = false } = {}) {
  cursorEl.style.transform = `translate(${x}px, ${y}px)`;
  if (click) {
    cursorEl.classList.remove('clicking');
    void cursorEl.offsetWidth; // restart animation
    cursorEl.classList.add('clicking');
  }
}

function moveCursorToElement(el, opts) {
  if (!el) return;
  const r = el.getBoundingClientRect();
  moveCursorTo(r.left + Math.min(28, r.width * 0.5), r.top + Math.min(14, r.height * 0.4), opts);
}

function setCursorMode(mode) {
  cursorState = mode;
  cursorEl.classList.toggle('idle', mode === 'idle');
  cursorEl.classList.toggle('thinking', mode === 'thinking');
}

function idleFloatToInput() {
  setCursorMode('idle');
  moveCursorToElement(promptInput);
}

window.addEventListener('resize', () => {
  if (cursorState === 'idle') idleFloatToInput();
});

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
    bubble.innerHTML = "<p>Hi, I'm Clicky. Ask me anything you're studying — I'll walk you through it step by step.</p>";
    chatLog.appendChild(bubble);
    return;
  }
  state.messages.forEach((m) => renderMessage(m.role, m.content));
}

/* ---------- Anthropic API ---------- */
async function askClicky(userText) {
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
    moveCursorToElement(apiKeyInput, { click: true });
    renderMessage('assistant', "I need an Anthropic API key before I can answer — pop it into Settings (top right) and I'll be ready.");
    return;
  }

  state.messages.push({ role: 'user', content: text });
  save();
  renderMessage('user', text);
  promptInput.value = '';
  autoGrow();

  setCursorMode('thinking');
  moveCursorToElement(chatLog.lastElementChild, { click: false });
  const typingBubble = renderTyping();
  sendBtn.disabled = true;

  try {
    const reply = await askClicky(text);
    state.messages.push({ role: 'assistant', content: reply });
    save();
    typingBubble.remove();
    const bubble = renderMessage('assistant', reply);
    moveCursorToElement(bubble, { click: true });
    speak(reply);
  } catch (err) {
    typingBubble.remove();
    renderMessage('assistant', `Something went wrong: ${err.message}`).classList.add('error');
  } finally {
    sendBtn.disabled = false;
    setTimeout(idleFloatToInput, 500);
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
  idleFloatToInput();
}
settingsBtn.addEventListener('click', () => {
  openSettings();
  moveCursorToElement(settingsBtn, { click: true });
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
      moveCursorToElement(micBtn, { click: true });
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

/* ---------- init ---------- */
renderHistory();
requestAnimationFrame(() => {
  setCursorMode('idle');
  idleFloatToInput();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('sw.js').catch(() => { /* offline install still works without SW */ });
  });
}
