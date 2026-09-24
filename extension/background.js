'use strict';

const SYSTEM_PROMPT = `You are Cassie, a brilliant, patient, encouraging AI tutor available as a
browser extension. A student has highlighted a piece of text on a webpage
they're reading or working through, and wants help with it. You can help
with any subject: math, science, history, languages, coding, essay
writing, test prep, and more.

Teach, don't just answer:
- Explain concepts step by step, building from what the student already seems to know.
- Use short, clear paragraphs and concrete examples. Use markdown-style
  formatting sparingly (short lists, bold for key terms) since this renders as plain text.
- When solving a problem, show the reasoning, not just the final answer.
- Keep answers focused and not overly long unless the student asks for depth.
- Be warm and encouraging, especially when the student is stuck.`;

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

async function askCassie(text, apiKey, model) {
  let modelId = model || FALLBACK_MODEL;
  let overloadTries = 0;
  while (true) {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(modelId)}:generateContent`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-goog-api-key': apiKey,
      },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
        contents: [{ role: 'user', parts: [{ text }] }],
        generationConfig: { maxOutputTokens: 2048, temperature: 0.7 },
      }),
    });

    if (!res.ok) {
      let detail = '';
      try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
      if (modelRetired(res.status, detail) && modelId !== FALLBACK_MODEL) {
        modelId = FALLBACK_MODEL;
        chrome.storage.local.set({ model: FALLBACK_MODEL }); // remember for next time
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
    const reply = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    if (!reply) {
      if (cand?.finishReason === 'SAFETY') return "I can't help with that one — try rephrasing it.";
      return '(no response)';
    }
    return reply;
  }
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type !== 'CASSIE_ASK') return false;

  (async () => {
    const { apiKey, model } = await chrome.storage.local.get(['apiKey', 'model']);
    if (!apiKey) {
      sendResponse({ error: 'no-key' });
      return;
    }
    try {
      const reply = await askCassie(msg.text, apiKey, model);
      sendResponse({ reply });
    } catch (err) {
      sendResponse({ error: err.message });
    }
  })();

  return true; // keep the message channel open for the async sendResponse above
});
