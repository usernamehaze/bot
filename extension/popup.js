'use strict';

const apiKeyInput = document.getElementById('api-key');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.local.get(['apiKey', 'model'], ({ apiKey, model }) => {
  if (apiKey) apiKeyInput.value = apiKey;
  if (model) modelSelect.value = model;
});

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set(
    { apiKey: apiKeyInput.value.trim(), model: modelSelect.value },
    () => {
      status.textContent = 'Saved.';
      setTimeout(() => { status.textContent = ''; }, 1500);
    }
  );
});
