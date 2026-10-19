/* A mic beside any box where a student writes to Cassie: say it instead of typing. The same file is in
   the app (for Labs too) and in the extension (extension/mic.js), so there is one mic to keep up.
   Hearing: the browser's own speech recognition, so heard words appear in the box as they come. Where
   a browser has none, the app can record instead and have the words written down (setup({ transcribe })).
   Voice is listened to only while the mic is on. It is never kept and never logged, and the browser's
   own microphone prompt is the only ask.
     CassieMic.attach(box, { send, row }) → { button, stop() } (or nothing, when the box has one already)
       send(text): for boxes that ask Cassie. When the student stops talking (or taps Stop), the question
       is sent. Without send (notes, topics…), the words just stay in the box to edit and save.
       row: the one line ("Listening…", or why the mic can't work) goes after this (default: just under the box)
     CassieMic.watch(root, selector, opts) → stop()   a mic on every matching box, now and as boxes appear
     CassieMic.listen(onWords) → Promise<text>, with .stop()   (for the board: opts.hear)
     CassieMic.can()   whether this browser can listen at all (when it can't, no mic is shown)
     CassieMic.setup({ transcribe(blob) → Promise<text> }) */
(function () {
  if (window.CassieMic) return;
  const SR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
  let transcribe = null, current = null;
  const say = (key, fallback) => (window.CassieErrors ? window.CassieErrors.say(key) : fallback);
  const cantLine = () => say('mic_here', 'Cassie can’t use the microphone here. Type it instead.');
  const recorderOk = () => !!(transcribe && navigator.mediaDevices && navigator.mediaDevices.getUserMedia && window.MediaRecorder);
  const can = () => !!SR() || recorderOk();
  const micError = () => Object.assign(new Error(cantLine()), { code: 'mic_here' });

  // One thing said out loud. onWords(text so far) as they come; resolves to all of it ('' when nothing was said).
  function listen(onWords) {
    if (current) current.stop();
    let stopFn = () => {}, finish, fail, ended = false;
    const done = new Promise((res, rej) => {
      finish = (t) => { if (!ended) { ended = true; res(String(t || '').trim()); } };
      fail = (e) => { if (!ended) { ended = true; rej(e); } };
    });
    const me = { stop: () => stopFn() };
    current = me;
    done.then(() => { if (current === me) current = null; }, () => { if (current === me) current = null; });
    const Rec = SR();
    if (Rec) {
      let rec, got = '';
      try { rec = new Rec(); } catch (e) { fail(micError()); return Object.assign(done, me); }
      rec.continuous = false; rec.interimResults = true;
      rec.onresult = (e) => {
        let t = '';
        for (let i = 0; i < e.results.length; i++) t += e.results[i][0].transcript;
        got = t.trim();
        if (onWords) onWords(got);
      };
      rec.onerror = (e) => { if (e.error === 'no-speech' || e.error === 'aborted') finish(got); else fail(micError()); };
      rec.onend = () => finish(got);
      try { rec.start(); } catch (e) { fail(micError()); }
      stopFn = () => { try { rec.stop(); } catch (e) { finish(got); } };
    } else if (recorderOk()) {
      // no speech recognition here: record, stop after a pause (or Stop, or 15 seconds), then write it down
      let stopped = false;
      stopFn = () => { stopped = true; };
      navigator.mediaDevices.getUserMedia({ audio: true }).then((stream) => {
        const mr = new MediaRecorder(stream);
        let chunks = [], ac = null, timer = 0, quietFor = 0, spoke = false;
        const end = () => { clearInterval(timer); if (ac) ac.close().catch(() => {}); if (mr.state !== 'inactive') mr.stop(); };
        mr.ondataavailable = (e) => { if (e.data && e.data.size) chunks.push(e.data); };
        mr.onstop = async () => {
          stream.getTracks().forEach((t) => t.stop());
          const blob = chunks.length ? new Blob(chunks, { type: mr.mimeType || 'audio/webm' }) : null;
          chunks = []; // (the sound is gone once it is written down)
          try { const t = blob ? await transcribe(blob) : ''; if (t && onWords) onWords(String(t).trim()); finish(t); } catch (e) { fail(e); }
        };
        mr.start();
        stopFn = end;
        if (stopped) { end(); return; }
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) {
          try {
            ac = new AC();
            const an = ac.createAnalyser(), buf = new Uint8Array(an.fftSize);
            ac.createMediaStreamSource(stream).connect(an);
            timer = setInterval(() => {
              an.getByteTimeDomainData(buf);
              let sum = 0; for (const v of buf) sum += (v - 128) * (v - 128);
              const loud = Math.sqrt(sum / buf.length) > 6;
              if (loud) { spoke = true; quietFor = 0; } else quietFor += 100;
              if ((spoke && quietFor > 1600) || (!spoke && quietFor > 8000)) end();
            }, 100);
          } catch (e) { /* no pause detection: Stop, or 15 seconds */ }
        }
        setTimeout(end, 15000);
      }).catch(() => fail(micError()));
    } else fail(micError());
    return Object.assign(done, me);
  }

  const ICON = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/></svg>';
  const STOP = '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg><span>Stop</span>';
  const LOOK = { boxSizing: 'border-box', width: 'auto', minWidth: '44px', height: '44px', minHeight: '44px', padding: '0 10px', flex: '0 0 auto', alignSelf: 'flex-start', justifySelf: 'start', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px',
    border: '1px solid rgba(127,127,127,.45)', borderRadius: '99px', background: 'transparent', color: 'inherit', font: 'inherit', fontWeight: '600', cursor: 'pointer', margin: '0' };
  const LINE = { margin: '6px 0 0', fontSize: '.85em', lineHeight: '1.35', opacity: '.85', flexBasis: '100%' };

  function attach(box, opts = {}) {
    if (!box || box.__cassieMic) return box && box.__cassieMic;
    const doc = box.ownerDocument;
    const btn = doc.createElement('button');
    btn.type = 'button'; btn.className = 'cmic';
    Object.assign(btn.style, LOOK);
    const idle = () => { btn.innerHTML = ICON; btn.setAttribute('aria-label', 'Say it instead of typing'); btn.title = 'Say it instead of typing'; btn.removeAttribute('aria-pressed'); delete btn.dataset.on; };
    idle();
    if (!can()) { btn.hidden = true; btn.style.display = 'none'; } // (this browser can't listen: no mic, just the box)
    box.insertAdjacentElement('afterend', btn);
    let live = null, line = null, lineTimer = 0, placeholder = '';
    const showLine = (text, stay) => {
      clearTimeout(lineTimer);
      if (!line || !line.isConnected) {
        line = doc.createElement('p'); line.className = 'cmic-line'; line.setAttribute('role', 'status');
        Object.assign(line.style, LINE);
        // under the box: after its row when the box sits in a single row, else at the end of its label or group
        const p = box.parentElement, cs = p && (doc.defaultView || window).getComputedStyle(p);
        const inRow = cs && /flex/.test(cs.display) && /^row/.test(cs.flexDirection) && cs.flexWrap === 'nowrap';
        if (opts.row || inRow) (opts.row || p).insertAdjacentElement('afterend', line); else (p || box).insertAdjacentElement('beforeend', line);
      }
      line.textContent = text;
      if (!stay) lineTimer = setTimeout(hideLine, 7000);
    };
    const hideLine = () => { clearTimeout(lineTimer); if (line) { line.remove(); line = null; } };
    const typed = (e) => { if (live && e.isTrusted && e.inputType) live.stop(); }; // (typing always wins: the mic stops)
    async function start() {
      const before = box.value, sep = before && !/\s$/.test(before) ? ' ' : '';
      placeholder = box.placeholder;
      box.placeholder = 'Listening…';
      btn.innerHTML = STOP; btn.setAttribute('aria-label', 'Stop listening'); btn.title = 'Stop listening'; btn.setAttribute('aria-pressed', 'true'); btn.dataset.on = '1';
      showLine('Listening…', true);
      box.addEventListener('input', typed);
      const put = (words) => {
        if (!box.isConnected) return;
        box.value = before + (words ? sep + words : '');
        box.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      };
      let said = '', failed = null;
      try { live = listen(put); said = await live; } catch (e) { failed = e; }
      live = null;
      box.removeEventListener('input', typed);
      box.placeholder = placeholder;
      idle();
      if (failed) { showLine(failed.code === 'mic_here' || !failed.message ? cantLine() : (window.CassieErrors ? window.CassieErrors.explain(failed, 'not_heard') : failed.message)); return; }
      hideLine();
      if (!box.isConnected) return;
      if (said) put(said);
      const text = box.value.trim();
      if (said && opts.send) { opts.send(text); return; }
      try { box.focus({ preventScroll: true }); box.setSelectionRange(box.value.length, box.value.length); } catch (e) { /* not a text box */ }
    }
    btn.addEventListener('click', () => { if (live) live.stop(); else start(); });
    const api = { button: btn, stop: () => { if (live) live.stop(); } };
    box.__cassieMic = api;
    return api;
  }

  // a mic on every box that matches, including boxes drawn later (lists and forms that redraw themselves)
  function watch(root, selector, opts = {}) {
    if (!root) return () => {};
    const scan = () => root.querySelectorAll(selector).forEach((b) => { if (!b.__cassieMic) attach(b, typeof opts === 'function' ? opts(b) : opts); });
    scan();
    const mo = new MutationObserver(scan);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }

  window.CassieMic = { attach, watch, listen, can, setup(o = {}) { if (o.transcribe) transcribe = o.transcribe; } };
})();
