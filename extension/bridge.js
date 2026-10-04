/* Runs only on the Cassie web app. When the extension opens the app to make a
 * reviewer of a PDF / Google Doc / Slides tab, this hands the file to the app.
 * The file never leaves the user's computer: extension → this tab → the app.
 */
(() => {
  'use strict';
  if (window.top !== window) return;
  chrome.runtime.sendMessage({ type: 'CASSIE_BRIDGE_READY' }).then((payload) => {
    if (!payload || !payload.base64) return;
    let tries = 0;
    (function deliver() {
      // wait for the app to finish starting up
      if (document.documentElement.dataset.cassieReady !== '1' && tries++ < 100) { setTimeout(deliver, 100); return; }
      window.postMessage({ source: 'cassie-ext', type: 'import-file', name: payload.name, mime: payload.mime, base64: payload.base64, prompt: payload.prompt, groqKey: payload.groqKey }, location.origin);
    })();
  }).catch(() => { /* extension reloaded — nothing to hand over */ });

  // Share the website's keys with the extension, so a stale key saved in the
  // extension doesn't cause "Invalid API Key". The extension only takes a key when
  // it has none, or its own was rejected and this one works. Nothing leaves the device.
  try {
    const st = JSON.parse(localStorage.getItem('cassie.v2') || '{}');
    if (st.groqKey || st.geminiKey) chrome.runtime.sendMessage({ type: 'CASSIE_APP_KEYS', groqKey: st.groqKey || '', geminiKey: st.geminiKey || '' }).catch(() => {});
  } catch (e) { /* storage blocked */ }
})();
