/* Listen: for students who learn by ear. Every answer from Cassie (explanations, quiz questions,
   reviewers) and every part card in the 3D explorers gets a 🔊 Listen button; Cassie reads it in
   her best voice there is (the studio voice, Bella, or the device's — voice.js). Tap again to stop.
   Uses app.js's cleanForSpeech and voiceGender. */
(function () {
  'use strict';
  const log = document.getElementById('chat-log');
  if (!log || !window.CassieVoice) return;
  let playing = null; // { btn, h }
  const ICON = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/></svg>';
  function stop() { if (playing) { playing.h.stop(); playing.btn.classList.remove('on'); playing.btn.lastChild.textContent = 'Listen'; playing = null; } }
  function play(btn, text) {
    const was = playing && playing.btn === btn;
    stop();
    if (was) return; // tapped while it was reading: that's "stop"
    const clean = typeof cleanForSpeech === 'function' ? cleanForSpeech(text) : text;
    if (!clean.trim()) return;
    const h = window.CassieVoice.speak(clean, { gender: typeof voiceGender === 'function' ? voiceGender() : 'woman' });
    playing = { btn, h };
    btn.classList.add('on'); btn.lastChild.textContent = 'Stop';
    h.done.then(() => { if (playing && playing.h === h) stop(); });
    if (typeof track === 'function') track('feature', 'listen');
  }
  function button(getText) {
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'listen-btn'; b.setAttribute('aria-label', 'Listen: Cassie reads this aloud');
    b.innerHTML = ICON + '<span>Listen</span>';
    b.addEventListener('click', (e) => { e.stopPropagation(); play(b, getText()); });
    return b;
  }
  // the words of an answer, without its buttons
  function words(bubble) {
    const copy = bubble.cloneNode(true);
    copy.querySelectorAll('button, .bubble-tools, .followups, .msg-actions, .listen-row, audio, video, svg, canvas, img').forEach((n) => n.remove());
    return copy.innerText || copy.textContent || '';
  }
  function dress() {
    log.querySelectorAll('.bubble-assistant').forEach((bubble) => {
      if (bubble.querySelector('.listen-btn') || bubble.querySelector('.typing-dots')) return;
      if (words(bubble).trim().length < 2) return;
      const row = bubble.querySelector('.bubble-tools');
      const b = button(() => words(bubble));
      if (row) row.prepend(b);
      else { const r = document.createElement('div'); r.className = 'listen-row'; r.appendChild(b); bubble.appendChild(r); }
    });
    // the 3D explorers' part card
    const sheet = document.querySelector('.x3d-sheet:not([hidden])');
    if (sheet && !sheet.querySelector('.listen-btn')) {
      const head = sheet.querySelector('.x3d-sheet-head') || sheet;
      head.appendChild(button(() => {
        const t = (sel) => (sheet.querySelector(sel) || {}).textContent || '';
        return [t('h3'), t('.x3d-like'), t('.x3d-does'), t('.x3d-what'), t('.x3d-only')].filter(Boolean).join('. ');
      }));
    }
  }
  let t = 0;
  const later = () => { if (!t) t = setTimeout(() => { t = 0; dress(); }, 350); }; // at most a few times a second (the page is never still for long)
  new MutationObserver(later).observe(log, { childList: true, subtree: true, characterData: true });
  new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });
  // a new conversation or a part card closing stops the reading
  document.addEventListener('click', (e) => { if (e.target.closest('#new-chat-btn, .x3d-x, .x3d-sheet-x')) stop(); });
  dress();
  window.CassieListen = { stop };
})();
