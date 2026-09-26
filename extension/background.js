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
const GROQ_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'llama-3.1-8b-instant', 'openai/gpt-oss-20b'];

function modelRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|unsupported|not exist|does not exist|decommission/i.test(msg || '');
}
function isTransientOverload(status, msg) {
  return status === 503 || /overloaded|temporarily|unavailable|try again later/i.test(msg || '');
}
function isRateLimited(status, msg) {
  return status === 429 || /resource exhausted|quota|rate limit|too many requests/i.test(msg || '');
}
const MAX_OVERLOAD_RETRIES = 3;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Ask Groq. If onDelta is given, stream the reply (calling onDelta with each
// chunk of text as it arrives) so the answer appears while it's generated;
// otherwise return the whole reply at once. Returns the full text either way.
async function askCassie(text, groqKey, model, onDelta) {
  let modelId = model || GROQ_MODELS[0];
  const tried = new Set();
  let overloadTries = 0;
  const stream = typeof onDelta === 'function';
  const messages = [
    { role: 'system', content: SYSTEM_PROMPT },
    { role: 'user', content: text },
  ];
  while (true) {
    tried.add(modelId);
    const res = await fetch('https://api.groq.com/openai/v1/chat/completions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${groqKey}` },
      body: JSON.stringify({ model: modelId, messages, max_tokens: 2048, temperature: 0.7, stream }),
    });
    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail)) {
        const next = GROQ_MODELS.find((m) => !tried.has(m));
        if (next) { modelId = next; chrome.storage.local.set({ groqModel: next }); continue; }
      }
      if (isTransientOverload(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
        overloadTries += 1;
        await sleep(1000 * Math.pow(2, overloadTries - 1));
        continue;
      }
      if (isRateLimited(res.status, detail)) {
        throw new Error("Groq's free tier is rate-limiting for a moment — wait a few seconds and try again. (Free tier allows ~30 questions/minute.)");
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
        const reply = await askCassie(msg.text, groqKey, groqModel, (delta) => post({ delta }));
        post({ done: true, reply });
      } catch (err) {
        post({ error: err.message });
      }
    })();
  });
});
