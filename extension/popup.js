'use strict';

const groqKeyInput = document.getElementById('groq-key');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.local.get(['groqKey', 'groqModel'], ({ groqKey, groqModel }) => {
  if (groqKey) groqKeyInput.value = groqKey;
  if (groqModel && [...modelSelect.options].some((o) => o.value === groqModel)) {
    modelSelect.value = groqModel;
  }
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    { groqKey: groqKeyInput.value.trim(), groqModel: modelSelect.value },
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
