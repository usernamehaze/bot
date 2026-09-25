'use strict';

// One-time reset: an earlier build defaulted web search ON, which the free tier
// can't sustain. Turn it off once; the user can re-enable it in the popup.
chrome.storage.local.get(['webSearchReset'], (r) => {
  if (!r.webSearchReset) chrome.storage.local.set({ webSearch: false, webSearchReset: true });
});

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
- Trivia and hard or obscure facts: answer precisely when you know it; for time-sensitive or very obscure facts, lean on reliable sources and flag real uncertainty instead of bluffing.
- Riddles, brain teasers, and lateral-thinking puzzles: work out the intended answer, then explain the wordplay/trick behind it (don't take a riddle literally).
- History, science, math, literature, languages, writing, exam prep, general knowledge, and professional tasks.

How you work:
- Accuracy comes first. If you are not sure of a fact, say so plainly instead of guessing — never invent dates, quotes, statistics, or sources.
- Teach when explanation is wanted: show the reasoning step by step and use concrete examples.
- For coding: give correct, runnable code inside fenced code blocks (triple backticks with the language). Explain what it does, note edge cases and complexity, and when debugging, find the real cause and explain the fix.
- Match the format the user asks for. If they ask for only the answer, give just the answer. If they ask you to explain, give the answer AND the reasoning.
- For a single word or short phrase, respond like a helpful dictionary + thesaurus: definition, part of speech, meaning, a couple of synonyms and antonyms, and an example — unless they asked for only one of those.
- Keep answers focused and well-organized: short paragraphs and small lists. Use markdown-style formatting sparingly since this renders as plain text.
- Adapt your tone: friendly and encouraging for students, crisp and professional for work tasks.`;

const FALLBACK_MODEL = 'gemini-3.6-flash';

function modelRetired(status, msg) {
  return status === 404 || /no longer available|not found|is not supported|unsupported|not exist/i.test(msg || '');
}

function isOverloaded(status, msg) {
  return status === 429 || status === 503 ||
    /high demand|overloaded|try again later|temporarily|unavailable|resource exhausted|quota/i.test(msg || '');
}
const MAX_OVERLOAD_RETRIES = 4;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function extractSources(cand) {
  const chunks = (cand && cand.groundingMetadata && cand.groundingMetadata.groundingChunks) || [];
  const seen = new Set();
  const out = [];
  for (const c of chunks) {
    const uri = c.web && c.web.uri;
    if (uri && !seen.has(uri)) { seen.add(uri); out.push(c.web.title || uri); }
  }
  return out.slice(0, 5);
}

async function askCassie(text, apiKey, model, webSearch) {
  let modelId = model || FALLBACK_MODEL;
  let useSearch = webSearch === true;
  let overloadTries = 0;
  while (true) {
    const body = {
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: [{ role: 'user', parts: [{ text }] }],
      generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
    };
    if (useSearch) body.tools = [{ google_search: {} }];

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail) && modelId !== FALLBACK_MODEL) {
        modelId = FALLBACK_MODEL;
        chrome.storage.local.set({ model: FALLBACK_MODEL }); // remember for next time
        continue;
      }
      // Grounded requests hit tighter free-tier limits; on rejection (400) or
      // rate-limit/overload, drop search and retry without it so the user still
      // gets an answer instead of a "busy" error.
      if (useSearch && (res.status === 400 || isOverloaded(res.status, detail))) {
        useSearch = false;
        continue;
      }
      if (isOverloaded(res.status, detail) && overloadTries < MAX_OVERLOAD_RETRIES) {
        overloadTries += 1;
        await sleep(1200 * Math.pow(2, overloadTries - 1)); // ~1.2s, 2.4s, 4.8s, 9.6s
        continue;
      }
      if (isOverloaded(res.status, detail)) {
        throw new Error("Google's free tier is rate-limiting right now — wait a minute and try again.");
      }
      throw new Error(detail || `Request failed (${res.status})`);
    }

    const data = await res.json();
    const cand = data.candidates?.[0];
    let reply = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!reply) {
      if (cand?.finishReason === 'SAFETY') return "I can't help with that one — try rephrasing it.";
      return '(no response)';
    }
    const sources = extractSources(cand);
    if (sources.length) reply += `\n\nSources: ${sources.join(' · ')}`;
    return reply;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CASSIE_ASK') return false;

  (async () => {
    const { apiKey, model, webSearch } = await chrome.storage.local.get(['apiKey', 'model', 'webSearch']);
    if (!apiKey) {
      sendResponse({ error: 'no-key' });
      return;
    }
    try {
      const reply = await askCassie(msg.text, apiKey, model, webSearch);
      sendResponse({ reply });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
