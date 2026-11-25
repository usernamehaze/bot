/* Runs only on the Cassie web app. It tells the app this extension's id, so the app can
 * ask the extension, through Chrome's own extension messaging, for a file to make a
 * reviewer of and for what was asked in the extension (externally_connectable in the
 * manifest; background.js answers only Cassie's own sites).
 * (v3.82) Nothing is passed through window.postMessage any more: other scripts on a page
 * can send and read those, so they could have faked a file or a chat, or read a key.
 * Nothing leaves the user's computer: extension → the app, checked by Chrome.
 */
(() => {
  'use strict';
  if (window.top !== window) return;
  // the id the app talks to (for a copy installed from the zip, it is not the store's)
  document.documentElement.dataset.cassieExtId = chrome.runtime.id;
  // a nudge, with no data: the app asks the extension itself what there is
  const nudge = () => document.dispatchEvent(new CustomEvent('cassie-ext-ready'));
  nudge();
  chrome.runtime.onMessage.addListener((m) => { if (m && m.type === 'CASSIE_NUDGE') nudge(); }); // (a file was just kept for this tab)
  try { chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.cassieHistory) nudge(); }); } catch (e) { /* ignore */ }

  // Share the website's keys with the extension, so a stale key saved in the
  // extension doesn't cause "Invalid API Key". The extension only takes a key when
  // it has none, or its own was rejected and this one works. This goes from the
  // site's own storage straight to the extension, never through the page.
  try {
    const st = JSON.parse(localStorage.getItem('cassie.v2') || '{}');
    if (st.groqKey || st.geminiKey) chrome.runtime.sendMessage({ type: 'CASSIE_APP_KEYS', groqKey: st.groqKey || '', geminiKey: st.geminiKey || '' }).catch(() => {});
  } catch (e) { /* storage blocked */ }
})();
