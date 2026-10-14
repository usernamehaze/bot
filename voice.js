/* Cassie's human voice — the player in the app.
   The voice itself is made in voice/voice-worker.js (Kokoro, on the device). This file
   asks it for one sentence at a time and plays each as soon as it's ready, while the
   next one is being made. Nothing is sent anywhere; once downloaded it works offline.
   window.CassieVoice = { speak, stream, session, best, supported, got, prepare, status, progress, onChange, say, sayStream, VOICES } */
(function () {
  // Bella: the same voice as Cassie's explainer video (Kokoro af_bella); George, a calm British voice, for a man's
  const VOICES = { woman: 'af_bella', man: 'bm_george' };
  const FLAG = 'cassie.humanVoice';
  let worker = null;
  let status = 'off'; // off | loading | ready | failed
  let progress = 0;
  let warming = false; // downloaded, now being set up (this can take a while on a phone)
  let retried = false;
  let readyP = null;
  let ctx = null;
  let turn = 0, seq = 0;
  let slowCount = 0;
  let lastError = '';
  let info = { isolated: false, cores: 1 };
  const waiting = new Map();
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f({ status, progress, warming }); } catch (e) { /* ignore */ } });

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
    status = 'failed'; warming = false;
    if (worker) { try { worker.terminate(); } catch (e) { /* ignore */ } }
    worker = null; readyP = null;
    waiting.forEach((w) => w.resolve({ error: 'stopped' })); waiting.clear();
    emit();
    return err;
  }

  function prepare() {
    if (readyP) return readyP;
    if (!supported()) { status = 'failed'; emit(); return Promise.reject(new Error('This browser can’t make the human voice.')); }
    status = 'loading'; progress = 0; warming = false; emit();
    readyP = start().catch((err) => {
      // a phone often manages it the second time (the download is kept): try once more by itself
      if (retried) throw err;
      retried = true; readyP = null; status = 'loading'; emit();
      return prepare();
    });
    readyP.catch(() => {});
    return readyP;
  }
  function start() {
    return new Promise((resolve, reject) => {
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
        else if (m.type === 'warming') { warming = true; progress = 1; emit(); }
        else if (m.type === 'ready') { info = { isolated: !!m.isolated, cores: m.cores || 1 }; status = 'ready'; progress = 1; warming = false; try { localStorage.setItem(FLAG, 'got'); } catch (err) { /* ignore */ } emit(); resolve(); }
        else if (m.type === 'failed') { lastError = m.error || ''; reject(fail(new Error(m.error || 'The voice did not load.'))); }
        else if (m.type === 'audio') { const w = waiting.get(m.id); if (w) { waiting.delete(m.id); w.resolve(m); } }
      };
      worker.onerror = (e) => { clearTimeout(watchdog); lastError = (e && e.message) || 'the voice engine stopped'; if (e && e.preventDefault) e.preventDefault(); reject(fail(new Error((e && e.message) || 'The voice stopped.'))); };
      const ios = /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
      worker.postMessage({ type: 'load', oneThread: ios });
    });
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

  // The device's own voice: only when neither Bella nor the studio voice is there when a lesson
  // starts (still downloading, or her engine can't run here), so Cassie never goes silent. Picks the most natural voice it has:
  // Apple's Premium/Enhanced voices, Google's and Microsoft's natural ones, then a known good name.
  const synth = window.speechSynthesis;
  const NICE = { woman: ['Ava', 'Samantha', 'Allison', 'Zoe', 'Susan', 'Karen', 'Moira', 'Serena', 'Aria', 'Jenny', 'Google US English'], man: ['Daniel', 'Arthur', 'Oliver', 'Google UK English Male', 'Ryan', 'Evan', 'Nathan', 'Tom', 'Alex', 'Aaron', 'Guy'] };
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
      if (/espeak|mbrola|festival|pico|flite/i.test(v.name)) sc -= 20; // robotic engines
      // a voice that says it is a woman's or a man's
      const female = /\bfemale\b|\bwoman\b/i.test(v.name), male = !female && /\bmale\b|\bman\b/i.test(v.name);
      if (gender === 'man' ? male : female) sc += 3;
      if (gender === 'man' ? female : male) sc -= 6;
      if (gender === 'man' && /en-GB/i.test(v.lang)) sc += 2; // the man's voice is British
      if (v.localService) sc += 0.5;
      if (sc > bestScore) { bestScore = sc; best = v; }
    }
    return best;
  }
  if (synth && synth.addEventListener) synth.addEventListener('voiceschanged', () => {}); // loads the list early
  // the device's list of voices can arrive a moment late: wait for it (briefly) before picking one
  function deviceVoiceSoon(gender) {
    if (!synth || synth.getVoices().length) return Promise.resolve(deviceVoice(gender));
    return new Promise((resolve) => {
      const done = () => { clearTimeout(t); try { synth.removeEventListener('voiceschanged', done); } catch (e) { /* ignore */ } resolve(deviceVoice(gender)); };
      const t = setTimeout(done, 1500);
      try { synth.addEventListener('voiceschanged', done); } catch (e) { /* ignore */ }
    });
  }
  // Say it with the device's voice. opts.voice: the exact voice to use (one voice for a whole lesson);
  // otherwise the best one for opts.gender, picked once for all of it. done resolves to
  // { status: 'done' | 'stopped' } or { status: 'error', at } when a sentence could not be said.
  function deviceSay(text, opts = {}) {
    let stopped = false, finish;
    const done = new Promise((r) => { finish = r; });
    if (!synth || !text) { finish({ status: 'done' }); return { done, stop() {} }; }
    // one sentence at a time: long utterances get cut off on some phones
    const parts = String(text).match(/[^.!?]+[.!?]*\s*/g) || [String(text)];
    const v = 'voice' in opts ? opts.voice : deviceVoice(opts.gender);
    let i = 0;
    const next = () => {
      if (stopped) return;
      if (i >= parts.length) { finish({ status: 'done' }); return; }
      try {
        const u = new SpeechSynthesisUtterance(parts[i++].trim());
        if (v) { try { u.voice = v; } catch (e) { /* not a voice this browser knows */ } u.lang = v.lang; }
        u.rate = opts.rate || 1; u.pitch = 1;
        u.onstart = () => { if (i === 1 && opts.onStart) opts.onStart(); };
        u.onend = next;
        u.onerror = (e) => { if (stopped) return; if (e && /interrupted|canceled/.test(e.error)) next(); else finish({ status: 'error', at: i - 1 }); };
        synth.speak(u);
      } catch (e) { finish({ status: 'error', at: i - 1 }); } // never leave Cassie stuck
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
  // off, used up for the day or offline, the next lesson starts with Bella (on the device) or the
  // device's voice (a lesson that already started keeps its voice: see session()).
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
  // Which voice speaks: Cassie's own (Bella or Edward) once she's on this device, no limits. Until then
  // the studio voice stands in (when Cassie's server has it and today's allowance isn't used up), else
  // the device's own best voice for her gender.
  const has = (k) => (k === 'bella' ? status === 'ready' && !!worker : k === 'studio' ? studioReady() : k === 'device' && !!synth);
  function best() { return has('bella') ? 'bella' : has('studio') ? 'studio' : 'device'; }
  function bellaClip(text, voice, myTurn, speed) {
    if (!worker) return Promise.reject(new Error('her voice stopped'));
    const id = ++seq;
    const p = new Promise((resolve) => waiting.set(id, { resolve }));
    worker.postMessage({ type: 'say', id, turn: myTurn, text, voice, speed: speed || 1 });
    return p.then((m) => {
      if (!m || m.error || !m.audio || !m.audio.length) throw new Error((m && m.error) || 'no sound');
      const secs = m.audio.length / m.rate;
      if (m.ms > secs * 1000 * 1.3) slowCount++; else slowCount = Math.max(0, slowCount - 1);
      const b = audioCtx().createBuffer(1, m.audio.length, m.rate); b.getChannelData(0).set(m.audio);
      return b;
    });
  }

  /* One voice for a whole lesson or conversation. It is picked when the lesson starts and never
     changes until it ends: not when the studio voice runs out, not when her own voice finishes
     downloading, not when a sentence fails. A sentence that fails is tried once more in the same
     voice; if it fails again Cassie pauses and says so, with a Keep going button. When the studio
     voice is used up for the day, Keep going carries on with the words on screen (never in a
     different voice); the next lesson starts with another voice. */
  const played = []; // the last pieces said and the voice that said each (for checking it never changes)
  function session(opts = {}) {
    const s = sessionState(opts);
    return {
      get voice() { return s.kind; },
      get gender() { return s.gender; },
      get muted() { return s.muted; },
      stream: (o = {}) => stream({ ...o, session: s }),
      speak: (text, o = {}) => speak(text, { ...o, session: s }),
      end() { s.ended = true; s.live.forEach((h) => h.stop()); },
    };
  }
  // the pause note: what happened, in plain words, and a Keep going button
  let pauseBox = null;
  function pauseNote(usedUp) {
    let close;
    const keep = new Promise((resolve) => { close = resolve; });
    if (pauseBox) pauseBox.remove();
    const box = document.createElement('div');
    box.className = 'cv-pause'; box.setAttribute('role', 'alertdialog'); box.setAttribute('aria-label', 'Cassie’s voice stopped');
    const p = document.createElement('p');
    p.textContent = usedUp
      ? 'Cassie’s studio voice is used up for today. She keeps the same voice for the whole lesson, so she will show the rest on screen. Next time she will start with another voice.'
      : 'Cassie’s voice stopped working for a moment. Tap Keep going and she will carry on in the same voice.';
    const btn = document.createElement('button');
    btn.type = 'button'; btn.textContent = 'Keep going';
    const end = () => { if (pauseBox === box) pauseBox = null; box.remove(); close(); };
    btn.addEventListener('click', end);
    box.append(p, btn);
    document.body.appendChild(box);
    pauseBox = box;
    try { btn.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    return { keep, close: end };
  }
  // after a failure, give the same voice a moment to come back
  async function revive(kind) {
    if (kind !== 'bella' || (status === 'ready' && worker)) return;
    await Promise.race([prepare().catch(() => {}), new Promise((r) => setTimeout(r, 20000))]);
  }
  // Speak an answer while it is still being written: push(text) a piece at a time, end() when it's
  // all there. Uses the lesson's voice (opts.session), or picks one for this answer alone.
  // Returns { push, end, done, stop, said, voice }.
  function stream(opts = {}) {
    return run(opts.session || sessionState(opts), opts);
  }
  // the voice is picked here; the device's is chosen once, the best one for her gender, and kept
  function sessionState(opts) {
    const gender = opts.gender === 'man' ? 'man' : 'woman';
    let kind = has(opts.voice) ? opts.voice : best();
    if (kind !== 'device' && !audioCtx()) kind = 'device';
    const s = { kind, gender, muted: false, live: new Set(), ended: false, spoke: false };
    s.devReady = kind === 'device' ? deviceVoiceSoon(gender).then((v) => { s.dev = v; }) : Promise.resolve();
    return s;
  }
  function run(s, opts) {
    const myTurn = ++turn, bv = VOICES[s.gender] || VOICES.woman;
    const pieces = [];
    let ended = false, stopped = false, wake = null, said = 0, srcNode = null, dev = null, endNow = null, paused = null;
    const nudge = () => { if (wake) { const w = wake; wake = null; w(); } };
    const make = (text) => (s.kind === 'bella' ? bellaClip(text, bv, myTurn, opts.speed) : studioClip(text, s.gender));
    // the studio voice downloads a couple of pieces ahead (it costs credits); Bella makes them all in turn
    const ahead = (i) => {
      if (s.kind === 'device' || s.muted) return;
      for (let j = i; j < pieces.length && (s.kind === 'bella' || j < i + 3); j++) if (!pieces[j].job) { pieces[j].job = make(pieces[j].text); pieces[j].job.catch(() => {}); }
    };
    const play = (buf) => new Promise((resolve) => {
      const src = audioCtx().createBufferSource(); src.buffer = buf; src.connect(audioCtx().destination);
      // a phone that hasn't woken the speaker never says "ended": move on after the piece's length
      const t = setTimeout(() => endNow && endNow(), buf.duration * 1000 + 1500);
      endNow = () => { clearTimeout(t); endNow = null; resolve(); };
      src.onended = () => endNow && endNow(); srcNode = src;
      try { src.start(); } catch (e) { endNow(); }
    });
    // one piece in the lesson's voice: true when said, false when it failed
    const once = async (i) => {
      if (s.kind === 'device') {
        await s.devReady;
        if (stopped) return true;
        dev = deviceSay(pieces[i].text, { voice: s.dev || null, gender: s.gender, rate: opts.rate, onStart: () => { if (i === 0 && opts.onStart) opts.onStart(s.kind); } });
        const r = await dev.done; dev = null;
        if (r.status === 'error') return false;
        played.push({ kind: 'device', voice: s.dev ? s.dev.name : '', gender: s.gender }); if (played.length > 200) played.shift();
        s.spoke = true;
        return true;
      }
      ahead(i);
      let buf;
      try { buf = await pieces[i].job; } catch (e) { return false; }
      if (stopped) return true;
      if (i === 0 && opts.onStart) opts.onStart(s.kind);
      played.push({ kind: s.kind, voice: s.kind === 'bella' ? bv : s.gender, gender: s.gender }); if (played.length > 200) played.shift();
      s.spoke = true;
      await play(buf);
      return true;
    };
    const handle = {
      done: null,
      get said() { return said; },
      get voice() { return s.kind; },
      live: true,
      push(text) { if (stopped || ended || !text || !String(text).trim()) return; pieces.push({ text: String(text).trim(), job: null }); ahead(said); nudge(); },
      end() { ended = true; nudge(); },
      stop() {
        if (stopped) return;
        stopped = true;
        if (s.kind === 'bella' && worker) worker.postMessage({ type: 'stop', turn: myTurn + 1 });
        try { if (srcNode) srcNode.stop(); } catch (e) { /* ignore */ }
        if (endNow) endNow();
        if (dev) dev.stop();
        if (paused) paused.close();
        nudge();
      },
    };
    s.live.add(handle);
    handle.done = (async () => {
      try {
        for (let i = 0; ; i++) {
          while (i >= pieces.length && !ended && !stopped) await new Promise((r) => { wake = r; });
          if (stopped || s.ended) return { status: 'stopped' };
          if (i >= pieces.length) return { status: 'done', muted: s.muted };
          if (s.muted) { said = i + 1; continue; } // (the words are on screen)
          for (let tries = 0; ; tries++) {
            if (await once(i)) break;
            if (stopped) return { status: 'stopped' };
            if (s.kind === 'bella' && worker) worker.postMessage({ type: 'stop', turn: myTurn + 1 });
            pieces.forEach((p, j) => { if (j >= i) p.job = null; });
            // the studio voice was already used up before she said a word: that is still the start,
            // so the lesson picks its voice again (and keeps that one)
            if (!s.spoke && s.kind === 'studio' && studio.off) {
              const k = best(); s.kind = k !== 'device' && !audioCtx() ? 'device' : k;
              s.devReady = s.kind === 'device' ? deviceVoiceSoon(s.gender).then((v) => { s.dev = v; }) : Promise.resolve();
              tries = -1; continue;
            }
            // a device with no voices at all has nothing to keep going with: the words stay on screen
            if (s.kind === 'device' && !s.dev && !(synth && synth.getVoices().length)) { s.muted = true; break; }
            if (tries === 0) { await revive(s.kind); continue; } // try once more, in the same voice
            // it failed twice: pause and say so; Keep going tries again (or, used up, shows the words)
            const usedUp = s.kind === 'studio' && studio.off;
            if (opts.onPause) opts.onPause(true);
            paused = pauseNote(usedUp);
            await paused.keep;
            paused = null;
            if (stopped) return { status: 'stopped' };
            if (opts.onPause) opts.onPause(false);
            if (usedUp) { s.muted = true; break; }
            tries = -1;
          }
          srcNode = null; said = i + 1;
          if (stopped) return { status: 'stopped' };
        }
      } finally { s.live.delete(handle); }
    })();
    return handle;
  }
  // Read anything aloud (see best()). opts.session: the lesson's voice.
  function speak(text, opts = {}) {
    const st = stream(opts);
    sentences(text).forEach((p) => st.push(p));
    st.end();
    return st;
  }


  window.CassieVoice = {
    speak,
    stream,
    session,
    best,
    played: () => played.slice(),
    warming: () => warming,
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
