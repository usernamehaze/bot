'use strict';

const SYSTEM_PROMPT = `You are Cassie, a warm, sharp, and reliable study buddy and professional buddy,
available as a browser extension. The user has highlighted a piece of text on a
webpage they're reading or working through and wants help with it. You are the
most dependable helper they have, on any subject or task.

You are especially strong at:
- Definitions and meanings: give a clear, precise definition, the part of speech, and a simple example sentence.
- Spelling: give the correct spelling, and gently note the fix if the word was misspelled.
- Synonyms and antonyms: offer a few of the most useful ones.
- Word history / etymology when it aids understanding.
- Programming and computer science: write, explain, review, and debug code in any language; algorithms, data structures, Big-O complexity, OOP, databases, and CS theory — a great mentor for a CS student and future developer.
- Trivia and hard or obscure facts: answer precisely when you know it; flag real uncertainty instead of bluffing.
- Riddles, brain teasers, and lateral-thinking puzzles: work out the intended answer, then explain the wordplay/trick behind it (don't take a riddle literally).
- History, science, math, literature, languages, writing, exam prep, general knowledge, and professional tasks.

How you work:
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing — never invent dates, quotes, statistics, or sources.
- Think it through before answering. For any non-trivial problem (math, logic, multi-step reasoning, tricky wording), work through it carefully, use the right approach or formula, and DOUBLE-CHECK your result — re-do the key calculation or test it against the given facts before committing. Watch for trick questions, hidden assumptions, and distractor details that don't matter (e.g. a fact given only to mislead). Better slower and right than fast and wrong.
- Teach when explanation is wanted: show the reasoning step by step and use concrete examples.
- The highlighted text is copied from a webpage, so math notation may be flattened: "x2" almost always means x squared (x^2), "x3" means x^3, and a lone number over another (like "25" above "6") is a fraction (25/6). Read math charitably this way. Don't answer "insufficient information" for a standard, solvable problem — reconstruct the intended equations and work it out. For a multiple-choice question, pick the correct option and show the key steps briefly.
- Match the format the user asks for. If they ask for only the answer, give just the answer. If they ask you to explain, give the answer AND the reasoning.
- For a single word or short phrase, respond like a helpful dictionary + thesaurus: definition, part of speech, meaning, a couple of synonyms and antonyms, and an example — unless they asked for only one of those.
- Adapt your tone: friendly and encouraging for students, crisp and professional for work tasks.

Graphs — you can DRAW real graphs in this popup. When the user asks you to graph, plot, sketch, or draw a function, line, or shape (including a follow-up like "can you graph it"), include exactly one fenced code block tagged cassie-board holding minified JSON, plus a short explanation in words. NEVER draw a graph with ASCII characters or symbols, and never give plotting code (matplotlib, etc.) unless they explicitly ask for code. Don't mention the JSON or the block to the user.
- Graph a function: {"type":"graph","title":"y = 2x + 1","fn":"2*x + 1","xrange":[-2,4],"points":[{"x":0,"y":1,"label":"(0, 1)"},{"x":2,"y":5,"label":"(2, 5)"}]}
  fn MUST use explicit * for multiply and ^ for powers; allowed: + - * / ^ ( ), x, sin cos tan sqrt abs exp ln log, pi, e. Optional: "yrange":[a,b], "vertex":{"x":..,"y":..}, "fill":[a,b] to shade area under the curve, "caption":"...". Pick an xrange that shows the important points (intercepts, vertex).
- A vertical line or other non-function can't be graphed this way — describe it in words instead.
- Geometry shape: {"type":"shape","shape":"rectangle","w":8,"h":5,"title":"Rectangle"} (rectangle|square|triangle|circle; square uses "side"; triangle uses "base","height" and optional "sides":[a,b,c]; circle uses "r").
Keep the numbers correct — it draws exactly what you give it.

Formatting — this shows in a small popup beside the user's selection, so keep it tight and scannable:
- Lead with the answer in the first line or two; put detail after.
- Be brief. Give the shortest response that fully answers — no filler, no repetition, no padding a simple question into an essay.
- Use short bullet points or a couple of short paragraphs. Only add a heading when the answer truly has multiple distinct parts.
- Don't use tables — they render badly in this narrow popup. For a comparison, use short grouped bullets instead.
- Fenced code blocks are fine for code; bold the single key term or number so the takeaway stands out.
- Math: write it in plain, readable text — NEVER LaTeX. Do not use \\frac, \\begin{cases}, \\text{}, \\left, \\right, dollar-sign math, or any backslash commands. Use ordinary characters and symbols: a/b for fractions, x^2 (or x²) for powers, √ for roots, and ≤ ≥ ≠ ≈ × ÷ · π ∑ ∞ directly. Put a piecewise or multi-case answer as a short bulleted list, one case per line (e.g. "- b/(a+b), if p = q = 1/2"), and keep each equation on its own line.
- Aim for a clean, uncluttered note a sharp tutor would jot down — never a wall of text.`;

// Text runs on Groq (OpenAI-compatible, higher free limits than Gemini).
// Smartest first — also the default and the head of the fallback chain.
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];

function modelRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|unsupported|not exist|does not exist|decommission/i.test(msg || '');
}
function isTransientOverload(status, msg) {
  return status === 503 || /overloaded|temporarily|unavailable|try again later/i.test(msg || '');
}
function isRateLimited(status, msg) {
  return status === 429 || /resource exhausted|quota|rate limit|too many requests/i.test(msg || '');
}
function isTooLarge(status, msg) {
  return status === 413 || /too large|reduce your (message|prompt)|tokens per minute|\bTPM\b|context length|maximum context/i.test(msg || '');
}
function estimateTokens(str) { return Math.ceil((str || '').length / 4); }
function trimHistory(msgs, budgetTokens) {
  const out = [];
  let used = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    const t = estimateTokens(msgs[i].content);
    if (out.length && used + t > budgetTokens) break;
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
    const ra = res.headers.get('retry-after');
    if (ra) secs = parseDuration(ra);
    if (!secs) secs = parseDuration(res.headers.get('x-ratelimit-reset-requests'));
    if (!secs) secs = parseDuration(res.headers.get('x-ratelimit-reset-tokens'));
  } catch (e) { /* headers unavailable */ }
  if (!secs && detail) { const mm = detail.match(/try again in ([0-9hms.\s]+)/i); if (mm) secs = parseDuration(mm[1]); }
  const wait = humanWait(secs);
  let clock = '';
  if (secs) { try { clock = ` (around ${new Date(Date.now() + secs * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })})`; } catch (e) { /* ignore */ } }
  const daily = secs > 3600; // a long reset means the daily cap, not the per-minute burst
  if (daily) {
    return `You've used up today's free questions on this model.${wait ? ` It resets in ${wait}${clock}.` : ''} Tip: switch to another model (Llama 3.3 70B or GPT-OSS 20B) in the Cassie popup — each model has its own daily limit.`;
  }
  if (wait) {
    return `Slow down a sec — that's Groq's free per-minute limit. Try again in ${wait}${clock}. (The free tier allows a burst of questions each minute.)`;
  }
  return "Groq's free tier is busy for a moment — wait a few seconds and try again. (Free tier allows ~30 questions/minute.)";
}
const MAX_OVERLOAD_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// When Groq retires models, ask it which chat models this key can use right now.
let _groqModelCache = null;
async function discoverGroqModels(groqKey) {
  if (_groqModelCache) return _groqModelCache;
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${groqKey}` } });
    if (!res.ok) return [];
    const ids = ((await res.json()).data || []).filter((m) => m.active !== false).map((m) => m.id)
      .filter((id) => !/whisper|tts|guard|playai|orpheus|embed|compound|prompt-guard/i.test(id));
    const rank = (id) => (/gpt-oss-120b/.test(id) ? 0 : /70b|maverick|120b|qwen3-32b|kimi/i.test(id) ? 1 : 2);
    _groqModelCache = ids.sort((a, b) => rank(a) - rank(b));
    return _groqModelCache;
  } catch (e) { return []; }
}

// Ask Groq. If onDelta is given, stream the reply (calling onDelta with each
// chunk of text as it arrives) so the answer appears while it's generated;
// otherwise return the whole reply at once. Returns the full text either way.
async function askCassie(input, groqKey, model, onDelta) {
  let modelId = model || GROQ_MODELS[0];
  const tried = new Set();
  let overloadTries = 0;
  const stream = typeof onDelta === 'function';
  // `input` is either a single user string or a full [{role, content}] history
  // (for multi-turn follow-ups). Keep only valid roles and cap the history.
  const allTurns = Array.isArray(input)
    ? input.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
    : [{ role: 'user', content: String(input) }];
  let historyBudget = 4000; // tokens of history to include (trimmed on overflow)
  while (true) {
    tried.add(modelId);
    const messages = [{ role: 'system', content: SYSTEM_PROMPT }, ...trimHistory(allTurns, historyBudget)];
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: 2048, temperature: 0.7, stream }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail)) {
        const next = GROQ_MODELS.find((m) => !tried.has(m)) || (await discoverGroqModels(groqKey)).find((m) => !tried.has(m));
        if (next) { modelId = next; chrome.storage.local.set({ groqModel: next }); continue; }
        throw new Error("Groq retired the models I know about. Open the Cassie popup and pick a different model, then try again.");
      }
      if (isTooLarge(res.status, detail)) {
        if (historyBudget > 1000) { historyBudget = Math.floor(historyBudget / 2); continue; }
        const next = GROQ_MODELS.find((m) => !tried.has(m));
        if (next) { modelId = next; chrome.storage.local.set({ groqModel: next }); historyBudget = 4000; continue; }
        throw new Error('That was a bit too long for the free per-minute limit — try a shorter selection or question.');
      }
      if (isTransientOverload(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
        overloadTries += 1;
        await sleep(1000 * Math.pow(2, overloadTries - 1));
        continue;
      }
      if (isRateLimited(res.status, detail)) {
        throw new Error(rateLimitMessage(res, detail));
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }
    if (!stream) {
      const data = await res.json();
      return (data.choices?.[0]?.message?.content || '').trim() || '(no response)';
    }
    // Streamed response (Server-Sent Events): parse `data:` lines as they arrive.
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '', full = '';
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const lines = buf.split('\n');
      buf = lines.pop(); // keep the last, possibly-incomplete line
      for (const line of lines) {
        const t = line.trim();
        if (!t.startsWith('data:')) continue;
        const payload = t.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        try {
          const delta = JSON.parse(payload).choices?.[0]?.delta?.content || '';
          if (delta) { full += delta; onDelta(delta); }
        } catch (e) { /* ignore keep-alives / partial JSON */ }
      }
    }
    return full.trim() || '(no response)';
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CASSIE_ASK') return false;

  (async () => {
    const { groqKey, groqModel } = await chrome.storage.local.get(['groqKey', 'groqModel']);
    if (!groqKey) {
      sendResponse({ error: 'no-key' });
      return;
    }
    try {
      const reply = await askCassie(msg.text, groqKey, groqModel);
      sendResponse({ reply });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

// Streaming path (used by the on-page popover): the content script opens a
// long-lived port so we can push the reply chunk-by-chunk as it generates.
chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cassie-stream') return;
  const post = (m) => { try { port.postMessage(m); } catch (e) { /* port closed */ } };
  port.onMessage.addListener((msg) => {
    if (msg?.type !== 'CASSIE_ASK') return;
    (async () => {
      const { groqKey, groqModel } = await chrome.storage.local.get(['groqKey', 'groqModel']);
      if (!groqKey) { post({ error: 'no-key' }); return; }
      try {
        const input = Array.isArray(msg.messages) ? msg.messages : msg.text;
        const reply = await askCassie(input, groqKey, groqModel, (delta) => post({ delta }));
        post({ done: true, reply });
      } catch (err) {
        post({ error: err.message });
      }
    })();
  });
});

// ---- Snip & see: capture the visible tab, and read pictures (Gemini or Groq vision) ----
// Every failure comes back as a plain-English sentence (never a bare "couldn't reach").
const GEMINI_VISION_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];

async function visionViaGemini(key, { image, prompt, system, maxTokens }) {
  const m = String(image).match(/^data:([^;]+);base64,(.*)$/);
  if (!m) throw new Error('That picture couldn’t be read.');
  let last = null;
  for (const model of GEMINI_VISION_MODELS) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [{ inlineData: { mimeType: m[1], data: m[2] } }, { text: prompt }] }],
          generationConfig: { maxOutputTokens: maxTokens || 900, temperature: 0.4 },
        }),
      });
    } catch (e) { throw new Error('Couldn’t connect to Google — check your internet connection.'); }
    if (res.ok) {
      const cand = (await res.json()).candidates?.[0];
      const text = (cand?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('').trim();
      if (text) return text;
      throw new Error('Gemini sent back an empty answer — try again.');
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 404 || /no longer available|decommission/i.test(detail)) { last = new Error('Gemini model unavailable'); continue; }
    if (res.status === 429) throw new Error('Gemini’s free tier is rate-limiting right now — wait a minute and try again.');
    if (res.status === 400 && /api key/i.test(detail)) throw new Error('Your Gemini key was rejected — check it in the Cassie toolbar popup.');
    if (res.status === 403) throw new Error('Your Gemini key isn’t allowed to read pictures — check it in the Cassie toolbar popup.');
    throw new Error(detail || `Gemini request failed (${res.status})`);
  }
  throw last || new Error('Gemini isn’t available right now.');
}

// Groq pictures: try every vision-capable model this key can see until one works.
let _visionModelOK = null;
async function groqVisionCandidates(groqKey) {
  let ids = [];
  try {
    const res = await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${groqKey}` } });
    if (res.ok) ids = ((await res.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
  } catch (e) { /* offline — handled by caller */ }
  const score = (id) => (/llama-4-scout/i.test(id) ? 0 : /llama-4-maverick/i.test(id) ? 1 : /vision|llava|pixtral|(^|[-/])vl([-/]|$)|multimodal/i.test(id) ? 2 : 9);
  const list = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed/i.test(id) && score(id) < 9).sort((a, b) => score(a) - score(b));
  if (_visionModelOK && list.includes(_visionModelOK)) list.splice(list.indexOf(_visionModelOK), 1), list.unshift(_visionModelOK);
  return list;
}
async function visionViaGroq(groqKey, { image, prompt, system, maxTokens }) {
  const models = await groqVisionCandidates(groqKey);
  if (!models.length) throw new Error('NO_VISION');
  let lastDetail = '';
  for (const model of models) {
    for (let attempt = 0; attempt < 3; attempt++) {
      let res;
      try {
        res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
          method: 'POST',
          headers: { 'content-type': 'application/json', authorization: `Bearer ${groqKey}` },
          body: JSON.stringify({
            model, max_tokens: maxTokens || 900, temperature: 0.4,
            messages: [
              ...(system ? [{ role: 'system', content: system }] : []),
              { role: 'user', content: [{ type: 'text', text: prompt }, { type: 'image_url', image_url: { url: image } }] },
            ],
          }),
        });
      } catch (e) { throw new Error('Couldn’t connect to Groq — check your internet connection.'); }
      if (res.ok) {
        _visionModelOK = model;
        return ((await res.json()).choices?.[0]?.message?.content || '').trim() || '(no answer)';
      }
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      lastDetail = detail || `HTTP ${res.status}`;
      if (res.status === 429) {
        // Wait out a short per-minute limit; a daily limit (hours) is reported instead.
        let secs = 0;
        try { secs = parseDuration(res.headers.get('retry-after')); } catch (e) { /* ignore */ }
        if (!secs) { const w = detail.match(/try again in ([0-9hms.\s]+)/i); if (w) secs = parseDuration(w[1]); }
        if (secs > 0 && secs <= 20 && attempt < 2) { await sleep(secs * 1000 + 300); continue; }
        throw new Error(rateLimitMessage(res, detail).replace(/ Tip:.*$/, ' Tip: add a free Google (Gemini) key in the Cassie toolbar popup — snips will use that instead.'));
      }
      if (res.status === 401) throw new Error('Groq rejected your key — check it in the Cassie toolbar popup.');
      if (res.status === 413 || /too large|reduce/i.test(detail)) throw new Error('That snip is too big for Groq’s free limit — drag a smaller box around just the part you need.');
      break; // 400/404 etc: this model can't take pictures — try the next one
    }
  }
  throw new Error(/does not exist|not found|decommission|no longer/i.test(lastDetail) ? 'NO_VISION' : lastDetail);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CASSIE_SNIP') {
    // The page's own overlay is hidden by the content script before this runs.
    chrome.tabs.captureVisibleTab(sender.tab ? sender.tab.windowId : undefined, { format: 'png' })
      .then((dataUrl) => sendResponse({ dataUrl }))
      .catch((e) => sendResponse({ error: e.message || 'capture failed' }));
    return true;
  }
  if (msg?.type === 'CASSIE_VISION') {
    (async () => {
      const { groqKey, geminiKey } = await chrome.storage.local.get(['groqKey', 'geminiKey']);
      if (!groqKey && !geminiKey) { sendResponse({ error: 'no-key' }); return; }
      let geminiErr = null;
      if (geminiKey) {
        try { sendResponse({ reply: await visionViaGemini(geminiKey, msg) }); return; }
        catch (e) { geminiErr = e; if (!groqKey) { sendResponse({ error: e.message }); return; } }
      }
      try { sendResponse({ reply: await visionViaGroq(groqKey, msg) }); }
      catch (e) {
        if (e.message === 'NO_VISION') sendResponse({ error: geminiErr ? geminiErr.message : 'no-vision' });
        else sendResponse({ error: e.message });
      }
    })().catch((e) => sendResponse({ error: e.message || 'Something went wrong reading the picture.' }));
    return true;
  }
  return false;
});

// ---- "Make a reviewer" on a PDF / Google Doc / Slides tab: hand the whole file
// to the Cassie web app, which reads it (pictures included) and writes the reviewer.
const CASSIE_APP_URL = 'https://askcassie.pages.dev/app.html';
const pendingImports = new Map(); // tabId -> { name, mime, base64, prompt, groqKey }

function bufToBase64(buf) {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CASSIE_OPEN_IN_APP') {
    (async () => {
      let base64 = msg.base64;
      if (!base64 && msg.url) {
        const res = await fetch(msg.url, { credentials: 'include' });
        if (!res.ok) throw new Error('download failed (' + res.status + ')');
        base64 = bufToBase64(await res.arrayBuffer());
      }
      if (!base64) throw new Error('no file');
      const { groqKey } = await chrome.storage.local.get(['groqKey']);
      const tab = await chrome.tabs.create({ url: CASSIE_APP_URL, index: sender.tab ? sender.tab.index + 1 : undefined });
      pendingImports.set(tab.id, { name: msg.name, mime: msg.mime, base64, prompt: msg.prompt, groqKey: groqKey || '' });
      setTimeout(() => pendingImports.delete(tab.id), 120000);
      sendResponse({ ok: true });
    })().catch((e) => sendResponse({ error: e.message || 'failed' }));
    return true;
  }
  // The bridge script on the Cassie app asks for the file meant for its tab.
  if (msg?.type === 'CASSIE_BRIDGE_READY') {
    const id = sender.tab && sender.tab.id;
    const payload = pendingImports.get(id) || null;
    if (payload) pendingImports.delete(id);
    sendResponse(payload);
    return false;
  }
  return false;
});

