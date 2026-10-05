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
- Do exactly what you're asked: follow every part of the request (the task, format, length, language and limits like "only the answer"). Never swap it for a different task or skip a part; if it's about a picture or snip, do that exact thing with what's in it. Ask back only when it truly can't be done otherwise.
- Sound like a real person: warm, natural and a little playful, like a smart friend. No canned openers ("Certainly!", "Great question!") and no speeches about being an AI.
- Teach when explanation is wanted: show the reasoning step by step and use concrete examples.
- Writing the user will hand in as their own — reflection papers, reaction papers, personal essays, journals, narratives, speeches, letters: write it AS THE USER, in the first person ("I"), in their voice. It is their reflection, not yours: never write as Cassie, never give Cassie's own feelings, opinions or experiences, never mention Cassie, AI or this chat, and never put the user's name inside the paper. Use the details they gave you; where a personal detail is missing, write a short bracketed placeholder like [a moment that stuck with me] instead of inventing a memory, and after the paper add one line inviting them to fill in the brackets.
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

// ---- keys: tidy, un-swap, and check that they work ----
// The extension keeps its OWN copy of the keys (separate from the website), so a
// stale or mistyped one here gives "Invalid API Key" even when the site works.
function tidyKey(k) {
  return String(k || '').trim().replace(/^bearer\s+/i, '').replace(/^["'`]+|["'`]+$/g, '').replace(/\s+/g, '');
}
async function getKeys() {
  const o = await chrome.storage.local.get(['groqKey', 'geminiKey', 'groqModel']);
  let groqKey = tidyKey(o.groqKey), geminiKey = tidyKey(o.geminiKey);
  // pasted into the wrong boxes? Groq keys start with gsk_, Google keys with AIza
  if (/^AIza/.test(groqKey) && (!geminiKey || /^gsk_/.test(geminiKey))) [groqKey, geminiKey] = [geminiKey, groqKey];
  else if (/^gsk_/.test(geminiKey) && !groqKey) [groqKey, geminiKey] = [geminiKey, ''];
  if (groqKey !== (o.groqKey || '') || geminiKey !== (o.geminiKey || '')) chrome.storage.local.set({ groqKey, geminiKey });
  return { groqKey, geminiKey, groqModel: o.groqModel };
}
async function checkKey(kind, key) {
  if (!key) return 'missing';
  try {
    const res = kind === 'groq'
      ? await fetch('https://api.groq.com/openai/v1/models', { headers: { authorization: `Bearer ${key}` } })
      : await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1', { headers: { 'x-goog-api-key': key } });
    if (res.ok) return 'ok';
    if (res.status === 400 || res.status === 401 || res.status === 403) return 'invalid';
    return 'unknown';
  } catch (e) { return 'offline'; }
}
const BAD_GROQ_KEY = 'The Groq key saved in the Cassie extension was rejected (“Invalid API Key”). The extension keeps its own copy of your keys, separate from the Cassie website — click the Cassie icon in the toolbar and paste your Groq key again (it starts with gsk_). Opening the Cassie website once also copies working keys over.';

// Text answer from Gemini — used when Gemini is the only key, or Groq can't answer.
// Streams like Groq does when onDelta is given, so the answer appears as it's written.
const GEMINI_RATE = 'Gemini’s free plan is busy for a moment — wait a minute and try again. (Adding a free Groq key in the Cassie toolbar popup gives you more questions per minute.)';
async function geminiText(key, turns, onDelta) {
  const contents = trimHistory(turns, 6000).map((m) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  const stream = typeof onDelta === 'function';
  let last = null;
  for (const model of GEMINI_VISION_MODELS) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:${stream ? 'streamGenerateContent?alt=sse' : 'generateContent'}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents,
          generationConfig: { maxOutputTokens: 4096, temperature: 0.6 },
        }),
      });
    } catch (e) { throw new Error('Couldn’t connect to Gemini — check your internet connection.'); }
    if (res.ok) {
      const textOf = (j) => (j?.candidates?.[0]?.content?.parts || []).filter((p) => !p.thought).map((p) => p.text || '').join('');
      if (!stream) {
        const text = textOf(await res.json()).trim();
        if (text) return text;
        last = new Error('Gemini sent back an empty answer — try again.'); continue;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '', full = '';
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop();
        for (const line of lines) {
          const t = line.trim();
          if (!t.startsWith('data:')) continue;
          try { const d = textOf(JSON.parse(t.slice(5))); if (d) { full += d; onDelta(d); } } catch (e) { /* partial line */ }
        }
      }
      if (full.trim()) return full.trim();
      last = new Error('Gemini sent back an empty answer — try again.'); continue;
    }
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    if (res.status === 404 || /no longer available|not found|decommission/i.test(detail)) { last = new Error('Gemini model unavailable'); continue; }
    if (res.status === 429 || /quota|exhausted/i.test(detail)) throw new Error(GEMINI_RATE);
    if ((res.status === 400 && /api key/i.test(detail)) || res.status === 401 || res.status === 403) throw new Error('Your Gemini key was rejected — click the Cassie icon in the toolbar and paste it again (it starts with AIza). Get one free at aistudio.google.com/apikey.');
    if (res.status === 503 || /overloaded|unavailable/i.test(detail)) { last = new Error('Gemini is busy right now — try again in a moment.'); continue; }
    throw new Error(detail || `Gemini request failed (${res.status})`);
  }
  throw last || new Error('Gemini isn’t available right now — try again in a moment.');
}
// Groq answers when there's a Groq key (it's faster). Gemini answers when it's the
// only key, or when Groq rejects the key or runs out of free questions.
async function answerText(input, keys, onDelta) {
  const turns = Array.isArray(input) ? input.filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string') : [{ role: 'user', content: String(input) }];
  if (!keys.groqKey) {
    if (!keys.geminiKey) throw new Error('no-key');
    return geminiText(keys.geminiKey, turns, onDelta);
  }
  try {
    return await askCassie(input, keys.groqKey, keys.groqModel, onDelta);
  } catch (e) {
    const limited = /limit|busy|too many|slow down/i.test(e.message || '');
    if (!keys.geminiKey || !(e.badKey || limited)) throw e;
    let reply = await geminiText(keys.geminiKey, turns, onDelta);
    if (e.badKey) {
      const note = '\n\n*(Your Groq key in the extension was rejected, so Gemini answered this one. Paste a fresh Groq key in the Cassie toolbar popup.)*';
      reply += note;
      if (onDelta) onDelta(note);
    }
    return reply;
  }
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
      if (res.status === 401 || /invalid api key/i.test(detail)) throw Object.assign(new Error(BAD_GROQ_KEY), { badKey: true });
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

// ---- Everything asked in the extension is kept in a short history (cassieHistory).
// The toolbar popup lists it, and on the Cassie website the bridge copies it into
// the app's chats, so highlights, snips and pastes all end up in one place.
let logChain = Promise.resolve();
function tidyReply(reply) {
  const t = String(reply || '').trim();
  try {
    const m = t.replace(/```(?:json)?/gi, '').match(/\{[\s\S]*\}/);
    const d = m && JSON.parse(m[0]);
    if (d && (d.headline || Array.isArray(d.steps))) {
      return [d.headline ? `**${String(d.headline).trim()}**` : '', ...(d.steps || []).map((x, i) => `${i + 1}. ${String(x).trim()}`)].filter(Boolean).join('\n');
    }
  } catch (e) { /* not the board JSON — keep the text */ }
  return t;
}
async function thumbOf(dataUrl) {
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const k = Math.min(1, 360 / Math.max(bmp.width, bmp.height));
  const c = new OffscreenCanvas(Math.max(1, Math.round(bmp.width * k)), Math.max(1, Math.round(bmp.height * k)));
  const x = c.getContext('2d');
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, 0, 0, c.width, c.height);
  return blobToDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.72 }));
}
function logAnswer(log, reply, image, sender) {
  if (!log || !reply || reply === '(no response)') return;
  logChain = logChain.then(async () => {
    let tab = sender && sender.tab;
    if (!tab) { try { [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true }); } catch (e) { tab = null; } }
    let thumb = '';
    if (image) { try { thumb = await thumbOf(image); } catch (e) { thumb = ''; } }
    const { cassieHistory } = await chrome.storage.local.get('cassieHistory');
    const list = Array.isArray(cassieHistory) ? cassieHistory : [];
    list.unshift({
      id: 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      kind: log.kind || 'highlight', q: String(log.q || '').slice(0, 600), a: tidyReply(reply).slice(0, 8000),
      url: (tab && tab.url) || '', title: String((tab && tab.title) || '').slice(0, 140), ts: Date.now(),
      ...(thumb ? { image: thumb } : {}),
    });
    let pics = 0;
    for (const it of list) if (it.image && ++pics > 10) delete it.image; // pictures are big: keep the newest 10
    await chrome.storage.local.set({ cassieHistory: list.slice(0, 60) });
  }).catch(() => { /* storage full or unavailable */ });
}

// A snip or question that didn't get an answer still goes to the history (and so to the app),
// so it's never lost: the student can ask again there.
chrome.runtime.onMessage.addListener((msg, sender) => {
  if (msg?.type !== 'CASSIE_LOG') return false;
  logAnswer(msg.log, msg.reply, msg.image, sender);
  return false;
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CASSIE_ASK') return false;

  (async () => {
    const keys = await getKeys();
    if (!keys.groqKey && !keys.geminiKey) {
      sendResponse({ error: 'no-key' });
      return;
    }
    try {
      const reply = await answerText(msg.text, keys);
      sendResponse({ reply });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});

// Streaming path (used by the on-page popover): the content script opens a
// long-lived port so we can push the reply chunk-by-chunk as it generates.
// ---- screenshot + crop in the service worker ----
function statsOf(src) {
  const c = new OffscreenCanvas(40, 40);
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, 40, 40);
  const d = x.getImageData(0, 0, 40, 40).data;
  let sum = 0, sq = 0; const n = d.length / 4;
  for (let k = 0; k < d.length; k += 4) { const l = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; sum += l; sq += l * l; }
  const mean = sum / n;
  return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
}
async function blobToDataUrl(blob) { return 'data:' + blob.type + ';base64,' + bufToBase64(await blob.arrayBuffer()); }
async function captureAndCrop(windowId, rect, vw, vh) {
  const dataUrl = await chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
  if (!rect) {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    return { dataUrl, full: statsOf(bmp), w: bmp.width, h: bmp.height };
  }
  const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
  const full = statsOf(bmp);
  const kx = bmp.width / (vw || bmp.width), ky = bmp.height / (vh || bmp.height);
  const sx = Math.max(0, Math.round(rect.left * kx)), sy = Math.max(0, Math.round(rect.top * ky));
  const sw = Math.min(bmp.width - sx, Math.max(1, Math.round(rect.width * kx)));
  const sh = Math.min(bmp.height - sy, Math.max(1, Math.round(rect.height * ky)));
  if (sw < 4 || sh < 4) throw new Error('That box is outside the visible page.');
  const scale = Math.min(1, 1400 / Math.max(sw, sh));
  const c = new OffscreenCanvas(Math.max(1, Math.round(sw * scale)), Math.max(1, Math.round(sh * scale)));
  const x = c.getContext('2d', { willReadFrequently: true });
  x.fillStyle = '#fff'; x.fillRect(0, 0, c.width, c.height);
  x.drawImage(bmp, sx, sy, sw, sh, 0, 0, c.width, c.height);
  const crop = statsOf(c);
  return { dataUrl: await blobToDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.9 })), full, crop, w: bmp.width, h: bmp.height };
}

chrome.runtime.onConnect.addListener((port) => {
  if (port.name !== 'cassie-stream') return;
  const post = (m) => { try { port.postMessage(m); } catch (e) { /* port closed */ } };
  port.onMessage.addListener((msg) => {
    if (msg?.type !== 'CASSIE_ASK') return;
    (async () => {
      const keys = await getKeys();
      if (!keys.groqKey && !keys.geminiKey) { post({ error: 'no-key' }); return; }
      try {
        const input = Array.isArray(msg.messages) ? msg.messages : msg.text;
        const reply = await answerText(input, keys, (delta) => post({ delta }));
        post({ done: true, reply });
        logAnswer(msg.log, reply, null, port.sender);
      } catch (err) {
        post({ error: err.message });
      }
    })();
  });
});

// ---- Snip & see: capture the visible tab, and read pictures (Gemini or Groq vision) ----
// Every failure comes back as a plain-English sentence (never a bare "couldn't reach").
const GEMINI_VISION_MODELS = ['gemini-3.6-flash', 'gemini-2.5-flash'];

async function visionViaGemini(key, { image, images, prompt, system, maxTokens }) {
  const pics = (images || [image]).map((u) => String(u).match(/^data:([^;]+);base64,(.*)$/));
  if (!pics.length || pics.some((m) => !m)) throw new Error('That picture couldn’t be read.');
  let last = null;
  for (const model of GEMINI_VISION_MODELS) {
    let res;
    try {
      res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
        body: JSON.stringify({
          ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
          contents: [{ role: 'user', parts: [...pics.map((m) => ({ inlineData: { mimeType: m[1], data: m[2] } })), { text: prompt }] }],
          // flash models think first, and thinking counts toward this cap — leave room so answers aren't cut off
          generationConfig: { maxOutputTokens: Math.max(2048, (maxTokens || 900) * 3), temperature: 0.4 },
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
    // busy ("high demand") or out of free requests: the next model has its own capacity, then Groq
    if (res.status >= 500 || res.status === 429 || /high demand|overloaded|unavailable/i.test(detail)) { last = new Error('Google’s Gemini is very busy right now — try again in a minute.'); continue; }
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
async function visionViaGroq(groqKey, { image, images, prompt, system, maxTokens }) {
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
              { role: 'user', content: [{ type: 'text', text: prompt }, ...(images || [image]).map((u) => ({ type: 'image_url', image_url: { url: u } }))] },
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
      if (res.status === 401) throw new Error(BAD_GROQ_KEY);
      if (res.status === 413 || /too large|reduce/i.test(detail)) throw new Error('That snip is too big for Groq’s free limit — drag a smaller box around just the part you need.');
      break; // 400/404 etc: this model can't take pictures — try the next one
    }
  }
  throw new Error(/does not exist|not found|decommission|no longer/i.test(lastDetail) ? 'NO_VISION' : lastDetail);
}

// Make a snip easy for a vision model to read: flattened onto white, JPEG, a sensible
// size (small snips are enlarged) — and for dark-mode pages, a light (inverted) copy
// too, because some models call a dark screenshot "blank".
async function prepareVision(dataUrl) {
  try {
    const bmp = await createImageBitmap(await (await fetch(dataUrl)).blob());
    const long = Math.max(bmp.width, bmp.height);
    const k = long > 1600 ? 1600 / long : long < 700 ? Math.min(2, 700 / long) : 1;
    const w = Math.max(1, Math.round(bmp.width * k)), h = Math.max(1, Math.round(bmp.height * k));
    const c = new OffscreenCanvas(w, h);
    const x = c.getContext('2d', { willReadFrequently: true });
    x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
    x.imageSmoothingQuality = 'high';
    x.drawImage(bmp, 0, 0, w, h);
    const st = statsOf(c);
    const jpeg = async () => blobToDataUrl(await c.convertToBlob({ type: 'image/jpeg', quality: 0.92 }));
    const original = await jpeg();
    let light = null;
    if (st.mean < 110) {
      x.globalCompositeOperation = 'difference'; x.fillStyle = '#fff'; x.fillRect(0, 0, w, h);
      light = await jpeg();
    }
    return { original, light, flat: st.std < 2.5 };
  } catch (e) { return { original: dataUrl, light: null, flat: false }; }
}
const DARK_NOTE = '\n\n(This page is in dark mode: the second picture is the same snip with its colours inverted so the text is easier to read. Use the first picture for colours.)';
const SEEMS_BLANK = /\b(completely|entirely|totally|mostly|appears|seems|looks)\s+(to be\s+)?(dark|black|blank|empty)\b|\bcan(?:not|'t|’t)\s+see\s+(the|any|anything)\b|\bunable to see\b|\b(image|picture|snip)\s+(is|was)\s+(blank|empty|black)\b|\bre-?upload\b/i;

// Rebuild the student's board here from plain data (picture + strokes) — reading a
// page canvas back can give a blank picture on some graphics drivers.
function paintStroke(ctx, s) {
  if (s.tool === 'group') { (s.items || []).forEach((it) => paintStroke(ctx, it)); return; } // Cassie's own drawing
  ctx.save();
  if (s.tool === 'rect') {
    ctx.fillStyle = s.fill || 'rgba(255,255,255,.94)'; ctx.strokeStyle = s.color || 'rgba(0,0,0,.15)'; ctx.lineWidth = s.size || 2;
    ctx.beginPath(); ctx.rect(s.x, s.y, s.w, s.h); ctx.fill(); ctx.stroke(); ctx.restore(); return;
  }
  if (s.tool === 'text') {
    ctx.fillStyle = s.color; ctx.font = `600 ${s.size}px system-ui, sans-serif`; ctx.textBaseline = 'top';
    String(s.text || '').split('\n').forEach((ln, i) => ctx.fillText(ln, s.x, s.y + i * s.size * 1.25));
    ctx.restore(); return;
  }
  const p = s.points || [];
  if (!p.length) { ctx.restore(); return; }
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  ctx.globalCompositeOperation = s.tool === 'eraser' ? 'destination-out' : 'source-over';
  ctx.strokeStyle = s.tool === 'eraser' ? '#000' : s.color;
  ctx.globalAlpha = s.tool === 'hl' ? 0.35 : 1;
  ctx.lineWidth = s.tool === 'hl' ? s.size * 4 : s.tool === 'eraser' ? s.size * 4 : s.size;
  ctx.beginPath();
  ctx.moveTo(p[0][0], p[0][1]);
  if (p.length === 1) ctx.lineTo(p[0][0] + 0.01, p[0][1]);
  else if (s.tool === 'line') ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  else {
    for (let i = 1; i < p.length - 1; i++) ctx.quadraticCurveTo(p[i][0], p[i][1], (p[i][0] + p[i + 1][0]) / 2, (p[i][1] + p[i + 1][1]) / 2);
    ctx.lineTo(p[p.length - 1][0], p[p.length - 1][1]);
  }
  ctx.stroke();
  ctx.restore();
}
async function composeBoard(b) {
  const w = Math.max(1, Math.min(4000, b.w | 0)), h = Math.max(1, Math.min(4000, b.h | 0));
  const c = new OffscreenCanvas(w, h);
  const x = c.getContext('2d');
  x.fillStyle = b.paper || '#ffffff'; x.fillRect(0, 0, w, h);
  if (b.image) x.drawImage(await createImageBitmap(await (await fetch(b.image)).blob()), 0, 0, w, h);
  if (b.strokes && b.strokes.length) {
    const ink = new OffscreenCanvas(w, h); // own layer, so the eraser only removes ink
    const ix = ink.getContext('2d');
    b.strokes.forEach((s) => paintStroke(ix, s));
    x.drawImage(ink, 0, 0);
  }
  return blobToDataUrl(await c.convertToBlob({ type: 'image/png' }));
}

async function readPicture(keys, msg) {
  if (msg.board && (msg.board.image || (msg.board.strokes || []).length)) {
    try { msg = { ...msg, image: await composeBoard(msg.board) }; } catch (e) { /* use the page's own snapshot */ }
  }
  const prep = await prepareVision(msg.image);
  const ask = async (images, prompt) => {
    let geminiErr = null;
    if (keys.geminiKey) {
      try { return await visionViaGemini(keys.geminiKey, { ...msg, images, prompt }); }
      catch (e) { geminiErr = e; if (!keys.groqKey) throw e; }
    }
    try { return await visionViaGroq(keys.groqKey, { ...msg, images, prompt }); }
    catch (e) {
      if (e.message === 'NO_VISION') throw new Error(geminiErr ? geminiErr.message : 'no-vision');
      throw geminiErr && e.message === BAD_GROQ_KEY ? geminiErr : e;
    }
  };
  let reply = await ask(prep.light ? [prep.original, prep.light] : [prep.original], msg.prompt + (prep.light ? DARK_NOTE : ''));
  // The model said it's blank, but the picture has content: one more careful look
  // at the easiest-to-read version.
  if (SEEMS_BLANK.test(reply) && !prep.flat) {
    try {
      reply = await ask([prep.light || prep.original], 'This picture is NOT blank — it is a screenshot with text and/or a diagram on it' + (prep.light ? ' (colours inverted from a dark-mode page)' : '') + '. Read it carefully.\n\n' + msg.prompt);
    } catch (e) { /* keep the first reply */ }
  }
  return reply;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CASSIE_SNIP') {
    // The page's own overlay is hidden by the content script before this runs.
    // With a rect, the crop happens HERE (OffscreenCanvas, software) — a different path
    // from the page's canvas, which misbehaves on some machines.
    captureAndCrop(msg.windowId || (sender.tab ? sender.tab.windowId : undefined), msg.rect, msg.vw, msg.vh)
      .then((out) => sendResponse(out))
      .catch((e) => sendResponse({ error: e.message || 'capture failed' }));
    return true;
  }
  if (msg?.type === 'CASSIE_CHECK_KEYS') {
    // Popup / side panel: save (optional) and test the keys.
    (async () => {
      if (msg.save) await chrome.storage.local.set({ groqKey: tidyKey(msg.save.groqKey), geminiKey: tidyKey(msg.save.geminiKey) });
      const k = await getKeys();
      const [groq, gemini] = await Promise.all([checkKey('groq', k.groqKey), checkKey('gemini', k.geminiKey)]);
      sendResponse({ groq, gemini });
    })();
    return true;
  }
  if (msg?.type === 'CASSIE_APP_KEYS') {
    // The Cassie website (via bridge.js) shares its keys: take one only when the
    // extension has none, or its own was rejected and the website's works.
    (async () => {
      const k = await getKeys(), updated = [];
      for (const [kind, field] of [['groq', 'groqKey'], ['gemini', 'geminiKey']]) {
        const app = tidyKey(msg[field]);
        if (!app || app === k[field]) continue;
        if (!k[field] || ((await checkKey(kind, k[field])) === 'invalid' && (await checkKey(kind, app)) === 'ok')) {
          await chrome.storage.local.set({ [field]: app }); updated.push(kind);
        }
      }
      sendResponse({ updated });
    })();
    return true;
  }
  if (msg?.type === 'CASSIE_H2C') {
    // Load the page renderer (html2canvas) into the content script's world on demand.
    chrome.scripting.executeScript({ target: { tabId: sender.tab.id, frameIds: [sender.frameId || 0] }, files: ['vendor/html2canvas.min.js'] })
      .then(() => sendResponse({ ok: true }))
      .catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg?.type === 'CASSIE_VISION') {
    (async () => {
      const keys = await getKeys();
      if (!keys.groqKey && !keys.geminiKey) { sendResponse({ error: 'no-key' }); return; }
      try { const reply = await readPicture(keys, msg); sendResponse({ reply }); logAnswer(msg.log, reply, msg.image, sender); }
      catch (e) { sendResponse({ error: e.message }); }
    })().catch((e) => sendResponse({ error: e.message || 'Something went wrong reading the picture.' }));
    return true;
  }
  return false;
});

// ---- "Make a reviewer" on a PDF / Google Doc / Slides tab: hand the whole file
// to the Cassie web app, which reads it (pictures included) and writes the reviewer.
const CASSIE_APP_URL = 'https://askcassie.pages.dev/app.html';
const pendingImports = new Map(); // tabId -> { name, mime, base64, prompt, groqKey }

async function openInApp(file, index) {
  const { groqKey } = await getKeys();
  const tab = await chrome.tabs.create({ url: CASSIE_APP_URL, index });
  pendingImports.set(tab.id, { ...file, groqKey: groqKey || '' });
  setTimeout(() => pendingImports.delete(tab.id), 120000);
}

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
      await openInApp({ name: msg.name, mime: msg.mime, base64, prompt: msg.prompt }, sender.tab ? sender.tab.index + 1 : undefined);
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

// Download a (cross-origin) picture on behalf of the page, so Cassie can read it even when the
// page can't draw it to a canvas. Extensions with host access can fetch it without CORS.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CASSIE_FETCH_IMG') return false;
  (async () => {
    const res = await fetch(msg.url);
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const blob = await res.blob();
    if (!/^image\//.test(blob.type) || blob.size > 8 * 1024 * 1024) throw new Error('not a usable picture');
    sendResponse({ dataUrl: 'data:' + blob.type + ';base64,' + bufToBase64(await blob.arrayBuffer()) });
  })().catch((e) => sendResponse({ error: e.message }));
  return true;
});

// ---- the Cassie side panel (works beside ANY tab, including Chrome's PDF viewer) ----
try { chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }); } catch (e) { /* older Chrome */ }

// What file is this tab showing? (PDF / Google Doc / Google Slides / photo)
async function tabFile(tab) {
  const url = tab.url || '';
  let m = url.match(/^https:\/\/docs\.google\.com\/(document|presentation)\/d\/([^/]+)/);
  const title = (tab.title || 'file').replace(/\s+-\s+Google (Docs|Slides)$/, '').trim() || 'file';
  if (m && m[1] === 'document') return { kind: 'docx', url: `https://docs.google.com/document/d/${m[2]}/export?format=docx`, name: title + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  if (m && m[1] === 'presentation') return { kind: 'pptx', url: `https://docs.google.com/presentation/d/${m[2]}/export/pptx`, name: title + '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  if (!/^(https?|file):/.test(url)) return null;
  const last = decodeURIComponent((new URL(url).pathname.split('/').pop() || ''));
  if (/\.pdf$/i.test(last)) return { kind: 'pdf', url, name: last, mime: 'application/pdf' };
  if (/\.(png|jpe?g|gif|webp)$/i.test(last)) return { kind: 'image', url, name: last, mime: 'image/*' };
  if (/\.pptx$/i.test(last)) return { kind: 'pptx', url, name: last, mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' };
  if (/\.docx$/i.test(last)) return { kind: 'docx', url, name: last, mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' };
  // No telling extension: ask the server what it is.
  try {
    const r = await fetch(url, { method: 'HEAD', credentials: 'include' });
    const ct = (r.headers.get('content-type') || '').toLowerCase();
    if (ct.includes('pdf')) return { kind: 'pdf', url, name: (last || 'document') + (/\.pdf$/i.test(last) ? '' : '.pdf'), mime: 'application/pdf' };
    if (ct.startsWith('image/')) return { kind: 'image', url, name: last || 'photo', mime: ct };
  } catch (e) { /* ignore */ }
  return null;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === 'CASSIE_TAB_FILE') {
    chrome.tabs.get(msg.tabId).then(tabFile).then((f) => sendResponse({ file: f })).catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  if (msg?.type === 'CASSIE_PANEL_OPEN_FILE') {
    (async () => {
      const tab = await chrome.tabs.get(msg.tabId);
      const f = await tabFile(tab);
      if (!f || f.kind === 'image') throw new Error('This tab isn’t a PDF, Google Doc, Google Slides or Office file.');
      const res = await fetch(f.url, { credentials: 'include' });
      if (!res.ok) throw new Error('Couldn’t download it (' + res.status + '). Download the file and attach it in the Cassie app.');
      const buf = await res.arrayBuffer();
      if (buf.byteLength > 30 * 1024 * 1024) throw new Error('That file is over 30 MB — download it and attach it in the Cassie app.');
      await openInApp({ name: f.name, mime: f.mime, base64: bufToBase64(buf), prompt: msg.prompt || 'Read this whole file and make me a complete reviewer of it.' }, tab.index + 1);
      sendResponse({ ok: true, kind: f.kind, name: f.name });
    })().catch((e) => sendResponse({ error: e.message }));
    return true;
  }
  return false;
});

// Right-click menu: works on highlighted text everywhere — including inside Chrome's PDF
// viewer, where pages can't see the selection — and on pictures.
function makeMenus() {
  try {
    chrome.contextMenus.removeAll(() => {
      chrome.contextMenus.create({ id: 'cassie-explain', title: 'Explain with Cassie', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'cassie-answer', title: 'Answer with Cassie', contexts: ['selection'] });
      chrome.contextMenus.create({ id: 'cassie-image', title: 'Explain this picture with Cassie', contexts: ['image'] });
      chrome.contextMenus.create({ id: 'cassie-panel', title: 'Open Cassie side panel', contexts: ['page', 'frame'] });
    });
  } catch (e) { /* ignore */ }
}
chrome.runtime.onInstalled.addListener(makeMenus);
chrome.runtime.onStartup.addListener(makeMenus);

chrome.contextMenus.onClicked.addListener((info, tab) => {
  // Open the panel first — it must happen inside the click (a user gesture).
  try { chrome.sidePanel.open(tab && tab.id >= 0 ? { tabId: tab.id } : { windowId: tab.windowId }); } catch (e) { /* ignore */ }
  const job = { at: Date.now(), tabId: tab ? tab.id : null, windowId: tab ? tab.windowId : null, pageUrl: info.pageUrl || (tab && tab.url) || '' };
  if (info.menuItemId === 'cassie-explain' || info.menuItemId === 'cassie-answer') Object.assign(job, { kind: 'text', mode: info.menuItemId === 'cassie-answer' ? 'answer' : 'explain', text: info.selectionText || '' });
  else if (info.menuItemId === 'cassie-image') Object.assign(job, { kind: 'image', srcUrl: info.srcUrl });
  else Object.assign(job, { kind: 'open' });
  chrome.storage.session.set({ cassieJob: job });
});

chrome.commands.onCommand.addListener((cmd, tab) => {
  if (cmd !== 'open-panel') return;
  try { chrome.sidePanel.open(tab && tab.id >= 0 ? { tabId: tab.id } : { windowId: tab.windowId }); } catch (e) { /* ignore */ }
});

