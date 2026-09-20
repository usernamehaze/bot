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

async function askCassie(text, apiKey, model) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: model || 'claude-sonnet-5',
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: text }],
    }),
  });

  if (!res.ok) {
    let detail = '';
    try { detail = (await res.json()).error?.message || ''; } catch (e) { /* ignore */ }
    throw new Error(detail || `Request failed (${res.status})`);
  }

  const data = await res.json();
  return (data.content || []).map((block) => block.text || '').join('').trim() || '(no response)';
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
