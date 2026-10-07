'use strict';

const groqKeyInput = document.getElementById('groq-key');
try { document.getElementById('version').textContent = 'Cassie extension v' + chrome.runtime.getManifest().version; } catch (e) { /* ignore */ }
const geminiKeyInput = document.getElementById('gemini-key');
const modelSelect = document.getElementById('model');
const saveBtn = document.getElementById('save');
const status = document.getElementById('status');

chrome.storage.local.get(['groqKey', 'groqModel', 'geminiKey'], ({ groqKey, groqModel, geminiKey }) => {
  if (groqKey) groqKeyInput.value = groqKey;
  if (geminiKey) geminiKeyInput.value = geminiKey;
  if (groqModel && [...modelSelect.options].some((o) => o.value === groqModel)) {
    modelSelect.value = groqModel;
  }
});

// Test the keys (Groq / Google say whether they work) and say so plainly.
const KEY_WORDS = {
  ok: (n) => `${n} key works ✓`,
  invalid: (n) => `${n} key was rejected — copy it again from ${n === 'Groq' ? 'console.groq.com/keys' : 'aistudio.google.com/apikey'}`,
  missing: () => '',
  offline: (n) => `Couldn’t check the ${n} key (offline?)`,
  unknown: (n) => `Couldn’t check the ${n} key right now`,
};
function showKeyStatus(r, saved) {
  if (!r) { status.textContent = saved ? 'Saved.' : ''; return; }
  const parts = [KEY_WORDS[r.groq]('Groq'), KEY_WORDS[r.gemini]('Gemini')].filter(Boolean);
  const bad = r.groq === 'invalid' || r.gemini === 'invalid';
  status.style.color = bad ? '#dc2626' : '#16a34a';
  status.textContent = (saved ? 'Saved. ' : '') + parts.join(' · ');
}
function checkKeys(save) {
  status.style.color = '#6b7280';
  status.textContent = save ? 'Saving and checking your keys…' : '';
  chrome.runtime.sendMessage({ type: 'CASSIE_CHECK_KEYS', save }).then((r) => {
    // keys may have been tidied or un-swapped — show what's really stored
    chrome.storage.local.get(['groqKey', 'geminiKey'], (o) => { groqKeyInput.value = o.groqKey || ''; geminiKeyInput.value = o.geminiKey || ''; });
    showKeyStatus(r, !!save);
  }).catch(() => { status.textContent = save ? 'Saved.' : ''; });
}
checkKeys(null);

saveBtn.addEventListener('click', () => {
  chrome.storage.local.set({ groqModel: modelSelect.value });
  checkKeys({ groqKey: groqKeyInput.value, geminiKey: geminiKeyInput.value });
});

/* ---------- what highlighting does ---------- */
const hlMode = document.getElementById('hl-mode');
if (hlMode) {
  chrome.storage.local.get(['cassieHighlight'], ({ cassieHighlight }) => { hlMode.value = cassieHighlight || 'button'; });
  hlMode.addEventListener('change', () => chrome.storage.local.set({ cassieHighlight: hlMode.value }));
}

/* ---------- side buttons hidden on some sites ("Hide here") ---------- */
const dockNote = document.getElementById('dock-note');
function refreshDockNote() {
  chrome.storage.local.get(['cassieDock'], ({ cassieDock }) => {
    const off = Object.keys(cassieDock || {}).filter((k) => cassieDock[k] && cassieDock[k].off);
    if (!dockNote) return;
    dockNote.hidden = !off.length;
    document.getElementById('dock-sites').textContent = off.length > 2 ? `${off.length} sites` : off.join(' and ');
  });
}
refreshDockNote();
document.getElementById('dock-show')?.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.storage.local.get(['cassieDock'], ({ cassieDock }) => {
    const all = cassieDock || {};
    Object.keys(all).forEach((k) => { if (all[k]) delete all[k].off; });
    chrome.storage.local.set({ cassieDock: all }, refreshDockNote);
  });
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
        if (res?.error === 'no-key') { showPageAnswer('Add a free Groq or Gemini key above and Save first.'); return; }
        if (res?.error) { showPageAnswer(res.error); return; }
        showPageAnswer(res.reply || '(no response)');
      });
    });
  });
});

/* ---------- Recent answers (history) ---------- */
const historyList = document.getElementById('history-list');
const historyEmpty = document.getElementById('history-empty');
const historyClear = document.getElementById('history-clear');

function timeAgo(ts) {
  const s = Math.max(0, Math.round((Date.now() - ts) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) { const m = Math.round(s / 60); return `${m}m ago`; }
  if (s < 86400) { const h = Math.round(s / 3600); return `${h}h ago`; }
  const d = Math.round(s / 86400); return `${d}d ago`;
}

function renderHistory() {
  chrome.storage.local.get(['cassieHistory'], ({ cassieHistory }) => {
    const list = Array.isArray(cassieHistory) ? cassieHistory : [];
    historyList.innerHTML = '';
    if (!list.length) { historyEmpty.hidden = false; historyClear.hidden = true; return; }
    historyEmpty.hidden = true;
    historyClear.hidden = false;
    list.forEach((item) => {
      const el = document.createElement('div');
      el.className = 'history-item';
      const q = document.createElement('p'); q.className = 'history-q'; q.textContent = item.q || '(question)';
      const a = document.createElement('div'); a.className = 'history-a'; a.textContent = item.a || '';
      const meta = document.createElement('div'); meta.className = 'history-meta';
      let host = ''; try { host = new URL(item.url).hostname.replace(/^www\./, ''); } catch (e) { /* ignore */ }
      meta.textContent = [host, item.ts ? timeAgo(item.ts) : ''].filter(Boolean).join(' · ');
      el.appendChild(q); el.appendChild(a); if (meta.textContent) el.appendChild(meta);
      historyList.appendChild(el);
    });
  });
}

historyClear.addEventListener('click', () => {
  chrome.storage.local.set({ cassieHistory: [] }, renderHistory);
});

renderHistory();

/* ---------- side panel ---------- */
document.getElementById('open-panel')?.addEventListener('click', () => {
  chrome.windows.getCurrent((w) => {
    try { chrome.sidePanel.open({ windowId: w.id }).then(() => window.close(), () => {}); } catch (e) { /* older Chrome */ }
  });
});

