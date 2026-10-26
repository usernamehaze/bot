/* Cassie's voice: Bella, her studio voice (ElevenLabs, through Cassie's server, which holds the key
   and counts the characters). It is the only voice she ever speaks in.
   One rule for every use (Listen, flashcards, voice chat, Teach me, Teach Cassie, the tour):
     - When a session starts (a lesson, a Listen, a voice chat), Bella speaks only if what is left of
       this month's studio allowance covers the whole session.
     - Otherwise Cassie types, from the start, and says so once in one plain line.
     - If Bella fails partway, Cassie goes on in text from that sentence, with the same line.
   She never switches to another voice and never stops to wait for the student.
   window.CassieVoice = { speak, stream, session, best, canSay, studio, played, unlock, supported, onChange, notice } */
(function () {
  const listeners = new Set();
  const emit = () => listeners.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });

  const AC = window.AudioContext || window.webkitAudioContext;
  let ctx = null;
  function audioCtx() {
    if (!AC) return null;
    if (!ctx) { try { ctx = new AC(); } catch (e) { return null; } }
    if (ctx.state === 'suspended') ctx.resume().catch(() => {});
    return ctx;
  }
  // Phones only let sound start inside a tap. Wake the speaker then, with a silent blip, so her
  // voice can play later; and on iPhone, play even when the ring/silent switch is on silent.
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
  ['pointerdown', 'keydown', 'touchend'].forEach((ev) => window.addEventListener(ev, () => { if (AC) unlock(); }, { capture: true, passive: true }));
  const supported = () => !!AC;

  /* ---------- the studio allowance: is Bella here, and how much can she still say? ---------- */
  // left: characters she can still say (this account's month, or the app's if that is less);
  // back: the day ('YYYY-MM-DD') it comes back when it runs out; guest: not signed in (no studio voice);
  // used / max: this account's month so far, and its plan's allowance
  let studio = { server: '', uid: '', token: null, on: false, left: 0, back: '', known: false, off: false, guest: false, used: 0, max: 0 };
  const authHeaders = () => { const t = typeof studio.token === 'function' ? studio.token() : ''; return t ? { authorization: 'Bearer ' + t } : {}; };
  function refresh() {
    if (!studio.server) return Promise.resolve(studio);
    return fetch(studio.server + '/speak?uid=' + encodeURIComponent(studio.uid || ''), { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d) studio = { ...studio, on: !!d.on, left: Math.max(0, +d.left || 0), back: typeof d.back === 'string' ? d.back : '', known: true, off: false, guest: !!d.guest, used: Math.max(0, +d.used || 0), max: Math.max(0, +d.max || 0), why: d.guest ? 'guest' : +d.left > 0 ? '' : studio.why };
        emit();
        return studio;
      })
      .catch(() => studio);
  }
  function setupStudio(o) { studio = { ...studio, ...o }; return refresh(); }
  // what a voice chat needs, when it starts (a few turns of short spoken answers)
  const CHAT_CHARS = 1200;
  function canSay(chars) { return studio.on && !studio.off && !!audioCtx() && studio.left >= Math.max(1, chars || 0); }
  async function studioClip(text, gender) {
    const r = await fetch(studio.server + '/speak', { method: 'POST', headers: { 'content-type': 'application/json', ...authHeaders() }, body: JSON.stringify({ text, voice: gender === 'man' ? 'man' : 'woman', uid: studio.uid }) });
    if (!r.ok) {
      // used up or off: she types until it's back (why: 'mine' = this account's month, 'month' = the app's credits, 'guest' = sign in)
      if (r.status === 401) { studio.off = true; studio.left = 0; studio.guest = true; studio.why = 'guest'; emit(); }
      if (r.status === 429 || r.status === 503) { studio.off = true; studio.left = 0; studio.why = r.headers.get('x-speak') || ''; if (studio.why === 'day') studio.back = dayFrom(1); emit(); refresh().then(() => { studio.off = true; studio.left = 0; }); }
      throw Object.assign(new Error('studio ' + r.status), { usedUp: r.status === 429 || r.status === 503 });
    }
    if (r.headers.get('x-speak') !== 'cache') { studio.left = Math.max(0, studio.left - text.length); studio.used += text.length; emit(); } // (said before: free)
    const buf = await r.arrayBuffer();
    return await new Promise((res, rej) => audioCtx().decodeAudioData(buf, res, rej));
  }

  /* ---------- the one line: Cassie types instead, said once (with why, and when she's back) ---------- */
  // a day in the Philippines ('YYYY-MM-DD'), n days from today
  function dayFrom(n) { return new Date(Date.now() + 8 * 3600e3 + n * 864e5).toISOString().slice(0, 10); }
  function backWhen(back) {
    if (!back || back === dayFrom(1)) return 'tomorrow';
    const d = /^\d{4}-\d{2}-\d{2}$/.test(back) ? new Date(back + 'T12:00:00') : null;
    return d ? d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long' }) : 'tomorrow';
  }
  const line = () => {
    const E = window.CassieErrors;
    if (!E) return 'Cassie’s voice isn’t available right now, so she’ll type her answers instead.';
    if (studio.why === 'guest' || studio.guest) return E.say('voice_signin');
    if (studio.why === 'mine') return E.say('voice_mine', { date: backWhen(studio.back) });
    if (studio.why === 'day' || (studio.known && studio.on && studio.left < 400 && studio.back === dayFrom(1))) return E.say('voice_today');
    if (studio.why === 'month' || (studio.known && studio.on && studio.left < 400)) return E.say('voice_resting', { date: backWhen(studio.back) });
    return E.say('voice_typing');
  };
  let noteBox = null, noteTimer = 0;
  function notice(where) {
    if (typeof where === 'function') { where(line()); return; }
    if (noteBox && noteBox.isConnected) { clearTimeout(noteTimer); noteTimer = setTimeout(hideNote, 7000); return; } // (already showing: never twice)
    noteBox = document.createElement('p');
    noteBox.className = 'cv-note'; noteBox.setAttribute('role', 'status');
    noteBox.textContent = line();
    document.body.appendChild(noteBox);
    noteTimer = setTimeout(hideNote, 7000);
  }
  function hideNote() { if (noteBox) { noteBox.remove(); noteBox = null; } }

  // sentences of a sensible size to say one at a time
  function sentences(text) {
    const out = [];
    for (const s of String(text || '').replace(/\s+/g, ' ').trim().match(/[^.!?]+[.!?]*\s*/g) || []) {
      const t = s.trim(); if (!t) continue;
      if (out.length && out[out.length - 1].length + t.length < 180) out[out.length - 1] += ' ' + t; else out.push(t);
    }
    return out;
  }

  /* ---------- a session: one decision for a whole lesson, Listen or conversation ---------- */
  const played = []; // the pieces said, and the voice that said each (to check it never changes)
  // opts: { gender, chars (what the session will say, or an estimate), onText(line) (where to show the
  // line; a small note on the screen if not given) }. It decides when it first speaks, so a lesson
  // can tell it how long it will be first (plan).
  function sessionState(opts) {
    return { kind: '', gender: opts.gender === 'man' ? 'man' : 'woman', need: opts.chars || 0, onText: opts.onText || null, told: false, live: new Set(), ended: false };
  }
  function decide(s, chars) {
    if (s.kind) return s.kind;
    s.kind = canSay(s.need || chars) ? 'studio' : 'text';
    if (s.kind === 'text') tell(s);
    return s.kind;
  }
  function tell(s) { if (s.told) return; s.told = true; notice(s.onText || undefined); }
  function session(opts = {}) {
    const s = sessionState(opts);
    return {
      get voice() { return s.kind || (canSay(s.need || CHAT_CHARS) ? 'studio' : 'text'); },
      get gender() { return s.gender; },
      get muted() { return s.kind === 'text'; },
      // how much the whole session will say (a lesson's steps, once they are known)
      plan(textOrChars) { if (!s.kind) s.need = typeof textOrChars === 'number' ? textOrChars : String(textOrChars || '').length; },
      start() { return decide(s, s.need || CHAT_CHARS); },
      stream: (o = {}) => run(s, o),
      speak: (text, o = {}) => run(s, { ...o, pieces: sentences(text) }),
      end() { s.ended = true; s.live.forEach((h) => h.stop()); },
    };
  }
  // Speak an answer while it is still being written: push(text) a piece at a time, end() when it's
  // all there. opts.session: the session it belongs to. Returns { push, end, done, stop, said, voice }.
  function stream(opts = {}) { return run(opts.session || sessionState({ ...opts, chars: opts.chars || CHAT_CHARS }), opts); }
  // Read anything aloud: the whole text decides it.
  function speak(text, opts = {}) {
    const pieces = sentences(text);
    if (opts.session) return run(opts.session, { ...opts, pieces });
    return run(sessionState({ ...opts, chars: pieces.join(' ').length }), { ...opts, pieces });
  }
  // done resolves to { status: 'done' | 'stopped' } or, when she types instead,
  // { status: 'text', muted: true, at } (at: the first piece not said aloud)
  function run(s, opts) {
    const pieces = (opts.pieces || []).map((text) => ({ text, job: null }));
    let ended = !!opts.pieces, stopped = false, wake = null, said = 0, srcNode = null, endNow = null;
    const nudge = () => { if (wake) { const w = wake; wake = null; w(); } };
    const need = () => pieces.reduce((n, p) => n + p.text.length, 0);
    // the studio voice downloads a couple of pieces ahead (it costs credits)
    const ahead = (i) => {
      if (s.kind !== 'studio') return;
      for (let j = i; j < pieces.length && j < i + 3; j++) if (!pieces[j].job) { pieces[j].job = studioClip(pieces[j].text, s.gender); pieces[j].job.catch(() => {}); }
    };
    const play = (buf) => new Promise((resolve) => {
      const src = audioCtx().createBufferSource(); src.buffer = buf; src.connect(audioCtx().destination);
      // a phone that hasn't woken the speaker never says "ended": move on after the piece's length
      const t = setTimeout(() => endNow && endNow(), buf.duration * 1000 + 1500);
      endNow = () => { clearTimeout(t); endNow = null; resolve(); };
      src.onended = () => endNow && endNow(); srcNode = src;
      try { src.start(); } catch (e) { endNow(); }
    });
    const handle = {
      done: null,
      get said() { return said; },
      get voice() { return s.kind || 'studio'; },
      live: true,
      push(text) { if (stopped || ended || !text || !String(text).trim()) return; pieces.push({ text: String(text).trim(), job: null }); if (s.kind) ahead(said); nudge(); },
      end() { ended = true; nudge(); },
      stop() {
        if (stopped) return;
        stopped = true;
        try { if (srcNode) srcNode.stop(); } catch (e) { /* ignore */ }
        if (endNow) endNow();
        nudge();
      },
    };
    s.live.add(handle);
    handle.done = (async () => {
      try {
        for (let i = 0; ; i++) {
          while (i >= pieces.length && !ended && !stopped) await new Promise((r) => { wake = r; });
          if (stopped || s.ended) return { status: 'stopped' };
          if (i >= pieces.length) return s.kind === 'text' ? { status: 'text', muted: true, at: 0 } : { status: 'done' };
          if (decide(s, need()) === 'text') return { status: 'text', muted: true, at: i }; // (the words are on screen)
          ahead(i);
          let buf = null;
          // a piece that fails is asked for once more, in Bella's voice; then the rest is typed
          for (let tries = 0; tries < 2 && !buf; tries++) {
            try { buf = await pieces[i].job; } catch (e) {
              if (e && e.usedUp) break;
              pieces.forEach((p, j) => { if (j >= i) p.job = null; });
              if (tries === 0) ahead(i);
            }
            if (stopped) return { status: 'stopped' };
          }
          if (!buf) { s.kind = 'text'; tell(s); return { status: 'text', muted: true, at: i }; }
          if (i === 0 && opts.onStart) opts.onStart('studio');
          played.push({ kind: 'studio', voice: 'bella', gender: s.gender }); if (played.length > 200) played.shift();
          await play(buf);
          srcNode = null; said = i + 1;
          if (stopped) return { status: 'stopped' };
        }
      } finally { s.live.delete(handle); }
    })();
    return handle;
  }
  // which voice the next session would use: Bella, or typing
  const best = (chars) => (canSay(chars || CHAT_CHARS) ? 'studio' : 'text');

  window.CassieVoice = {
    speak,
    stream,
    session,
    best,
    canSay,
    CHAT_CHARS,
    sentences,
    notice,
    played: () => played.slice(),
    studio: { setup: setupStudio, refresh, ready: () => canSay(1), on: () => studio.on, left: () => studio.left, back: () => studio.back, known: () => studio.known, guest: () => studio.guest, used: () => studio.used, max: () => studio.max },
    supported,
    unlock,
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
})();
