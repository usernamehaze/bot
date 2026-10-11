/* Cassie's human voice — the player in the app.
   The voice itself is made in voice/voice-worker.js (Kokoro, on the device). This file
   asks it for one sentence at a time and plays each as soon as it's ready, while the
   next one is being made. Nothing is sent anywhere; once downloaded it works offline.
   window.CassieVoice = { supported, got, prepare, status, progress, onChange, say, sayStream, VOICES } */
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
  let info = { isolated: false, cores: 1 };
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
        else if (m.type === 'ready') { info = { isolated: !!m.isolated, cores: m.cores || 1 }; status = 'ready'; progress = 1; try { localStorage.setItem(FLAG, 'got'); } catch (err) { /* ignore */ } emit(); resolve(); }
        else if (m.type === 'failed') { lastError = m.error || ''; reject(fail(new Error(m.error || 'The voice did not load.'))); }
        else if (m.type === 'audio') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w.resolve(m); } }
      };
      worker.onerror = (e) => { clearTimeout(watchdog); lastError = (e && e.message) || 'the voice engine stopped'; if (e && e.preventDefault) e.preventDefault(); reject(fail(new Error((e && e.message) || 'The voice stopped.'))); };
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      worker.postMessage({ type: 'load', oneThread: ios });
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

  // Like say(), but the sentences arrive one by one while the answer is still being written:
  // push(text) adds a sentence (it's made at once and played in turn), end() says no more are coming.
  // Returns { push, end, done, stop, said }; done resolves like say()'s.
  function sayStream(opts = {}) {
    const myTurn = ++turn;
    const voice = VOICES[opts.gender] || VOICES.woman;
    const reqs = [];
    let ended = false, stopped = false, current = null, endNow = null, wake = null, said = 0;
    const nudge = () => { if (wake) { const w = wake; wake = null; w(); } };
    const ac = status === 'ready' && worker ? audioCtx() : null;
    const done = (async () => {
      if (!ac) return { status: 'error', at: 0 };
      for (let i = 0; ; i++) {
        while (i >= reqs.length && !ended && !stopped) await new Promise((r) => { wake = r; });
        if (stopped) return { status: 'stopped' };
        if (i >= reqs.length) return { status: 'done' };
        const m = await reqs[i].p;
        if (stopped) return { status: 'stopped' };
        if (!m || m.error || !m.audio || !m.audio.length) return { status: 'error', at: i };
        const secs = m.audio.length / m.rate;
        if (m.ms > secs * 1000 * 1.3) slowCount++; else slowCount = Math.max(0, slowCount - 1);
        let buf;
        try { buf = ac.createBuffer(1, m.audio.length, m.rate); buf.getChannelData(0).set(m.audio); } catch (e) { return { status: 'error', at: i }; }
        const src = ac.createBufferSource();
        src.buffer = buf; src.connect(ac.destination);
        if (i === 0 && opts.onStart) opts.onStart();
        await new Promise((resolve) => {
          const t = setTimeout(resolve, secs * 1000 + 1500);
          endNow = () => { clearTimeout(t); resolve(); };
          src.onended = endNow; current = src;
          try { src.start(); } catch (e) { endNow(); }
        });
        current = null; said = i + 1;
        if (stopped) return { status: 'stopped' };
      }
    })();
    return {
      done,
      get said() { return said; },
      get live() { return !!ac; },
      push(text) {
        if (stopped || ended || !ac || !text) return;
        const id = ++seq;
        const p = new Promise((resolve) => waiting.set(id, { resolve }));
        worker.postMessage({ type: 'say', id, turn: myTurn, text, voice, speed: opts.speed || 1 });
        reqs.push({ id, p }); nudge();
      },
      end() { ended = true; nudge(); },
      stop() {
        if (stopped) return;
        stopped = true;
        if (worker) worker.postMessage({ type: 'stop', turn: myTurn + 1 });
        try { if (current) current.stop(); } catch (e) { /* ignore */ }
        if (endNow) endNow();
        reqs.forEach((r) => { const w = waiting.get(r.id); if (w) { waiting.delete(r.id); w.resolve(null); } });
        nudge();
      },
    };
  }

  // The device's own voice — only while Bella isn't ready on this device (still downloading, or her
  // engine can't run here), so Cassie never goes silent. Picks the most natural voice it has:
  // Apple's Premium/Enhanced voices, Google's and Microsoft's natural ones, then a known good name.
  const synth = window.speechSynthesis;
  const NICE = { woman: ['Ava', 'Samantha', 'Allison', 'Zoe', 'Susan', 'Karen', 'Moira', 'Serena', 'Aria', 'Jenny', 'Google US English'], man: ['Evan', 'Nathan', 'Tom', 'Daniel', 'Alex', 'Aaron', 'Arthur', 'Guy', 'Ryan', 'Google UK English Male'] };
  function deviceVoice(gender) {
    const all = synth ? synth.getVoices() : [];
    const lang = (navigator.language || 'en').slice(0, 2);
    const names = NICE[gender] || NICE.woman, other = NICE[gender === 'man' ? 'woman' : 'man'];
    let best = null, bestScore = -1;
    for (const v of all) {
      if (!/^en/i.test(v.lang) && v.lang.slice(0, 2) !== lang) continue;
      let sc = /^en/i.test(v.lang) ? 1 : 0;
      if (/premium|enhanced|neural|natural|siri/i.test(v.name)) sc += 6;
      const i = names.findIndex((n) => v.name.includes(n));
      if (i >= 0) sc += 4 - i * 0.2;
      if (other.some((n) => v.name.includes(n))) sc -= 5;
      if (/novelty|whisper|bad news|bells|boing|bubbles|cellos|jester|organ|trinoids|zarvox|albert|fred|junior|ralph|kathy|superstar|grandpa|grandma|eddy|flo|reed|rocko|sandy|shelley/i.test(v.name)) sc -= 20;
      if (v.localService) sc += 0.5;
      if (sc > bestScore) { bestScore = sc; best = v; }
    }
    return best;
  }
  if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', () => {}); // loads the list early
  function deviceSay(text, opts = {}) {
    let stopped = false, finish;
    const done = new Promise((r) => { finish = r; });
    if (!synth || !text) { finish({ status: 'done' }); return { done, stop() {} }; }
    // one sentence at a time: long utterances get cut off on some phones
    const parts = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
    let i = 0;
    const next = () => {
      if (stopped) return;
      if (i >= parts.length) { finish({ status: 'done' }); return; }
      try {
        const u = new SpeechSynthesisUtterance(parts[i++].trim());
        const v = deviceVoice(opts.gender);
        if (v) { try { u.voice = v; } catch (e) { /* not a voice this browser knows */ } u.lang = v.lang; }
        u.rate = opts.rate || 1; u.pitch = 1;
        u.onstart = () => { if (i === 1 && opts.onStart) opts.onStart(); };
        u.onend = next;
        u.onerror = next;
        synth.speak(u);
      } catch (e) { finish({ status: 'done' }); } // never leave Cassie stuck
    };
    try { synth.cancel(); } catch (e) { /* ignore */ }
    setTimeout(next, 30);
    return { done, stop() { stopped = true; try { synth.cancel(); } catch (e) { /* ignore */ } finish({ status: 'stopped' }); } };
  }
  // phones: speech has to start once inside a tap — do it with a silent word on the first tap
  let synthWoken = false;
  ['pointerdown', 'touchend'].forEach((ev) => window.addEventListener(ev, () => {
    if (synthWoken || !synth) return; synthWoken = true;
    try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; synth.speak(u); } catch (e) { /* ignore */ }
  }, { capture: true, passive: true }));

  // Cassie's studio voice: ElevenLabs, through Cassie's server (it holds the key and counts the
  // credits). The most natural of her voices, so it goes first when the server has it; when it's
  // off, used up for the day or offline, Bella (on the device) or the device's voice carries on.
  let studio = { server: '', uid: '', on: false, off: false };
  function setupStudio(o) {
    studio = { ...studio, ...o };
    if (!studio.server) return;
    fetch(studio.server + '/speak').then((r) => (r.ok ? r.json() : null)).then((d) => { studio.on = !!(d && d.on); emit(); }).catch(() => {});
  }
  const studioReady = () => studio.on && !studio.off && !!audioCtx();
  async function studioClip(text, gender) {
    const r = await fetch(studio.server + '/speak', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text, voice: gender === 'man' ? 'man' : 'woman', uid: studio.uid }) });
    if (!r.ok) { if (r.status === 429 || r.status === 503) studio.off = true; throw new Error('studio ' + r.status); } // used up / off: the other voices for the rest of the visit
    const buf = await r.arrayBuffer();
    return await new Promise((res, rej) => audioCtx().decodeAudioData(buf, res, rej));
  }
  // say these sentences in the studio voice; the next one downloads while this one plays
  function studioSay(parts, opts = {}) {
    let stopped = false, src = null, finish;
    const done = new Promise((r) => { finish = r; });
    (async () => {
      const ac = audioCtx();
      let next = studioClip(parts[0], opts.gender);
      for (let i = 0; i < parts.length; i++) {
        let buf;
        try { buf = await next; } catch (e) { return finish({ status: 'error', at: i }); }
        if (stopped) return;
        if (i + 1 < parts.length) { next = studioClip(parts[i + 1], opts.gender); next.catch(() => {}); }
        await new Promise((res) => {
          src = ac.createBufferSource(); src.buffer = buf; src.connect(ac.destination);
          src.onended = res;
          if (i === 0 && opts.onStart) opts.onStart();
          try { src.start(0); } catch (e) { res(); }
        });
        if (stopped) return;
      }
      finish({ status: 'done' });
    })();
    return { done, stop() { stopped = true; try { if (src) src.stop(); } catch (e) { /* ignore */ } finish({ status: 'stopped' }); } };
  }
  // sentences of a sensible size to say one at a time
  function sentences(text) {
    const out = [];
    for (const s of String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || []) {
      const t = s.trim(); if (!t) continue;
      if (out.length && out[out.length - 1].length + t.length < 180) out[out.length - 1] += ' ' + t; else out.push(t);
    }
    return out;
  }
  // Read anything aloud with the best voice there is: the studio voice, else Bella, else the
  // device's — and if one fails partway, the next carries on from that sentence.
  function speak(text, opts = {}) {
    const parts = sentences(text);
    let stopped = false, cur = null, finish;
    const done = new Promise((r) => { finish = r; });
    (async () => {
      if (!parts.length) return finish({ status: 'done' });
      let from = 0;
      if (studioReady()) {
        cur = studioSay(parts, opts); const r = await cur.done;
        if (stopped) return; if (r.status !== 'error') return finish(r); from = r.at;
      }
      if (status === 'ready' && worker && from < parts.length) {
        cur = say(parts.slice(from), opts); const r = await cur.done;
        if (stopped) return; if (r.status !== 'error') return finish(r); from += r.at;
      }
      cur = deviceSay(parts.slice(from).join(' '), opts);
      finish(await cur.done);
    })();
    return { done, stop() { stopped = true; if (cur) cur.stop(); finish({ status: 'stopped' }); } };
  }

  window.CassieVoice = {
    speak,
    studio: { setup: setupStudio, ready: studioReady, on: () => studio.on, say: studioSay },
    device: { say: deviceSay, voice: deviceVoice, supported: () => !!synth },
    sayStream,
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
    info: () => info,
  };
})();
