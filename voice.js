/* Cassie's human voice — the player in the app.
   The voice itself is made in voice/voice-worker.js (Kokoro, on the device). This file
   asks it for one sentence at a time and plays each as soon as it's ready, while the
   next one is being made. Nothing is sent anywhere; once downloaded it works offline.
   window.CassieVoice = { supported, got, prepare, status, progress, onChange, say, VOICES } */
(function () {
  // Bella: the same voice as Cassie's explainer video (Kokoro af_bella); Michael for a man's voice
  const VOICES = { woman: 'af_bella', man: 'am_michael' };
  const FLAG = 'cassie.humanVoice';
  let worker = null;
  let status = 'off'; // off | loading | ready | failed
  let progress = 0;
  let readyP = null;
  let ctx = null;
  let turn = 0, seq = 0;
  let slowCount = 0;
  let lastError = '';
  const waiting = new Map();
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f({ status, progress }); } catch (e) { /* ignore */ } });

  const AC = window.AudioContext || window.webkitAudioContext;
  function audioCtx() {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Phones only let sound start inside a tap. Wake the speaker then, with a silent blip, so her
  // voice can play later; and on iPhone, play even when the ring/silent switch is on silent
  // (like a video does) — otherwise Safari mutes this kind of sound.
  let unlocked = false;
  function unlock() {
    try { if (navigator.audioSession && navigator.audioSession.type !== 'playback') navigator.audioSession.type = 'playback'; } catch (e) { /* older Safari */ }
    const ac = audioCtx();
    if (!ac || unlocked) return;
    try {
      const b = ac.createBuffer(1, 1, 22050), src = ac.createBufferSource();
      src.buffer = b; src.connect(ac.destination); src.start(0);
      if (ac.state === 'running') unlocked = true;
    } catch (e) { /* try again next tap */ }
  }
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, () => { if (supported()) unlock(); }, { capture: true, passive: true }));

  function supported() { return typeof Worker === 'function' && typeof WebAssembly === 'object' && !!AC; }
  function got() { try { return localStorage.getItem(FLAG) === 'got'; } catch (e) { return false; } }

  function fail(err) {
    status = 'failed';
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; readyP = null;
    waiting.forEach((w) => w.resolve({ error: 'stopped' })); waiting.clear();
    emit();
    return err;
  }

  function prepare() {
    if (readyP) return readyP;
    if (!supported()) { status = 'failed'; emit(); return Promise.reject(new Error('This browser can’t make the human voice.')); }
    status = 'loading'; progress = 0; emit();
    readyP = new Promise((resolve, reject) => {
      try { worker = new Worker(new URL('voice/voice-worker.js', document.baseURI), { type: 'module' }); }
      catch (e) { reject(fail(e)); return; }
      // if the voice engine goes quiet while starting (a blocked file, a stuck download), give up
      // so Cassie keeps talking with the device's voice
      let watchdog = 0;
      const quiet = () => { clearTimeout(watchdog); watchdog = setTimeout(() => { lastError = 'it took too long to load'; reject(fail(new Error('The voice took too long to load.'))); }, 90000); };
      quiet();
      worker.onmessage = (e) => {
        const m = e.data || {};
        if (status === 'loading') { if (m.type === 'ready' || m.type === 'failed') clearTimeout(watchdog); else quiet(); }
        if (m.type === 'progress') { progress = m.total ? Math.min(1, m.loaded / m.total) : 0; emit(); }
        else if (m.type === 'ready') { status = 'ready'; progress = 1; try { localStorage.setItem(FLAG, 'got'); } catch (err) { /* ignore */ } emit(); resolve(); }
        else if (m.type === 'failed') { lastError = m.error || ''; reject(fail(new Error(m.error || 'The voice did not load.'))); }
        else if (m.type === 'audio') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w.resolve(m); } }
      };
      worker.onerror = (e) => { clearTimeout(watchdog); lastError = (e && e.message) || 'the voice engine stopped'; if (e && e.preventDefault) e.preventDefault(); reject(fail(new Error((e && e.message) || 'The voice stopped.'))); };
      worker.postMessage({ type: 'load' });
    });
    readyP.catch(() => {});
    return readyP;
  }

  // Say these sentences. Returns { done, stop }. done resolves to
  // { status: 'done' | 'stopped' } or { status: 'error', at } — at = the first sentence not said,
  // so the caller can finish with the device's own voice.
  function say(chunks, opts = {}) {
    const myTurn = ++turn;
    const voice = VOICES[opts.gender] || VOICES.woman;
    let stopped = false, current = null, endNow = null;
    const reqs = (status === 'ready' && worker ? chunks : []).map((text) => {
      const id = ++seq;
      const p = new Promise((resolve) => waiting.set(id, { resolve }));
      worker.postMessage({ type: 'say', id, turn: myTurn, text, voice, speed: opts.speed || 1 });
      return { id, p };
    });
    const done = (async () => {
      if (!reqs.length) return chunks.length ? { status: 'error', at: 0 } : { status: 'done' };
      const ac = audioCtx();
      if (!ac) return { status: 'error', at: 0 };
      for (let i = 0; i < reqs.length; i++) {
        const m = await reqs[i].p;
        if (stopped) return { status: 'stopped' };
        if (!m || m.error || !m.audio || !m.audio.length) return { status: 'error', at: i };
        const secs = m.audio.length / m.rate;
        if (m.ms > secs * 1000 * 1.3) slowCount++; else slowCount = Math.max(0, slowCount - 1);
        let buf;
        try { buf = ac.createBuffer(1, m.audio.length, m.rate); buf.getChannelData(0).set(m.audio); }
        catch (e) { return { status: 'error', at: i }; }
        const src = ac.createBufferSource();
        src.buffer = buf; src.connect(ac.destination);
        if (i === 0 && opts.onStart) opts.onStart();
        await new Promise((resolve) => {
          // a phone that hasn't woken the speaker never says "ended": move on after the sentence's length
          const t = setTimeout(resolve, secs * 1000 + 1500);
          endNow = () => { clearTimeout(t); resolve(); };
          src.onended = endNow;
          current = src;
          try { src.start(); } catch (e) { endNow(); }
        });
        current = null;
        if (stopped) return { status: 'stopped' };
      }
      return { status: 'done' };
    })();
    return {
      done,
      stop() {
        if (stopped) return;
        stopped = true;
        if (worker) worker.postMessage({ type: 'stop', turn: myTurn + 1 });
        try { if (current) current.stop(); } catch (e) { /* ignore */ }
        if (endNow) endNow();
        reqs.forEach((r) => { const w = waiting.get(r.id); if (w) { waiting.delete(r.id); w.resolve(null); } });
      },
    };
  }

  window.CassieVoice = {
    VOICES,
    supported,
    got,
    prepare,
    status: () => status,
    progress: () => progress,
    slow: () => slowCount >= 3, // this device makes the voice slower than she talks
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    say,
    unlock,
    error: () => lastError,
  };
})();
