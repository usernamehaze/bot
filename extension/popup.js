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
