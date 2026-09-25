'use strict';

const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model');
const webSearchToggle = document.getElementById('web-search');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.local.get(['apiKey', 'model', 'webSearch'], ({ apiKey, model, webSearch }) => {
  if (apiKey) apiKeyInput.value = apiKey;
  // Only restore the saved model if it's still one of the current options;
  // otherwise leave the dropdown on its default (a retired ID was stored).
  if (model && [...modelSelect.options].some((o) => o.value === model)) {
    modelSelect.value = model;
  }
  webSearchToggle.checked = webSearch === true; // off unless explicitly enabled
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    { apiKey: apiKeyInput.value.trim(), model: modelSelect.value, webSearch: webSearchToggle.checked },
    () => {
      status.textContent = 'Saved.';
      setTimeout(() => { status.textContent = ''; }, 1500);
    }
  );
});

/* ---------- Ask about this page ---------- */
const pageQ = document.getElementById('page-q');
const pageAsk = document.getElementById('page-ask');
const pageAnswer = document.getElementById('page-answer');

function showPageAnswer(text) {
  pageAnswer.hidden = false;
  pageAnswer.textContent = text;
}

pageAsk.addEventListener('click', () => {
  const question = pageQ.value.trim() || 'Summarize this page and list the key points.';
  showPageAnswer('Reading the page…');
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    const tab = tabs && tabs[0];
    if (!tab) { showPageAnswer('Could not find the active tab.'); return; }
    chrome.tabs.sendMessage(tab.id, { type: 'CASSIE_GET_PAGE' }, (resp) => {
      if (chrome.runtime.lastError || !resp) {
        showPageAnswer("Can't read this tab. Open a normal website (not a chrome:// or Web Store page) and try again.");
        return;
      }
      const pageText = (resp.text || '').trim();
      if (!pageText) { showPageAnswer('This page has no readable text.'); return; }
      showPageAnswer('Thinking…');
      const prompt = `Here is the text of the web page the user is currently viewing:\n\n"""\n${pageText}\n"""\n\nUsing that page, answer: ${question}`;
      chrome.runtime.sendMessage({ type: 'CASSIE_ASK', text: prompt }, (res) => {
        if (chrome.runtime.lastError) { showPageAnswer('Something went wrong talking to the extension. Reload it and try again.'); return; }
        if (res?.error === 'no-key') { showPageAnswer('Add your Google (Gemini) API key above and Save first.'); return; }
        if (res?.error) { showPageAnswer(res.error); return; }
        showPageAnswer(res.reply || '(no response)');
      });
    });
  });
});
