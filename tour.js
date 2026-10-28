/* The tour: about 90 seconds, once, after the first run (asked first), and again any time from
   Settings, then Help, then "Take the tour". At each stop Cassie's cursor glides to the real control,
   it gets a soft ring, and a card says what it is and when to use it (1 or 2 sentences). On a phone the
   stops follow the tab bar; on a computer, the top bar, the sidebar and Home. Only what is on this
   device is shown. The tour only points: it never opens a paid flow or changes a setting by itself.
   Her voice is Bella's studio voice or typing, never another voice (voice.js), and nothing waits.
   Escape or Skip puts the app back exactly where it was. Uses app.js's state, save, syncAccount,
   detourToElement, resumeFollowing, openSettings, closeSettings, voiceGender and cleanForSpeech.
   After the tour, on a computer, a short video shows how the Chrome extension works (once; again from
   Settings, then Help).
   window.CassieTour = { offer(after), start(), stop(), video(), get active } */
(function () {
  'use strict';
  const phone = () => document.documentElement.classList.contains('native');
  const seen = (el) => { if (!el || !el.isConnected) return false; const r = el.getBoundingClientRect(), cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none' && r.bottom > 0 && r.top < innerHeight && r.right > 0 && r.left < innerWidth; };
  const first = (sels) => { for (const s of sels) { const el = document.querySelector(s); if (el && (seen(el) || el.closest('#home'))) return el; } return null; };
  const micShown = () => seen(document.getElementById('mic-btn'));

  // The stops. Each one's words are what that part of the app really does.
  // tab: the phone's tab to show it on; at: where it is (the first that is on screen)
  const STOPS = [
    { id: 'ask', tab: 'chat', at: ['#prompt-input'],
      say: () => `Ask Cassie anything here, by typing${micShown() ? ' or with the mic' : ''}. Tap the clip to add photos or files, and she reads them too.` },
    { id: 'quiz', tab: 'chat', at: ['#quiz-btn', '[data-hub="quiz"]'],
      say: () => 'Quiz me makes a practice quiz on any topic you name. Questions you miss are saved, and come back later in Review my mistakes.' },
    { id: 'talk', tab: 'chat', at: ['#voice-btn', '[data-hub="talk"]'],
      say: () => 'Talk with Cassie is a real voice chat. Chat with her, teach her a topic, or let her quiz you out loud.' },
    { id: 'home', tab: 'home', phoneAt: ['#tabbar [data-tab="home"]'], at: ['#chat-log .hub-hero', '#chat-log .hub-boxes', '#side-nav [data-page="home"]', '#new-chat-btn'],
      say: () => `Home keeps all your tools in one place${phone() ? '' : ', in every new chat'}. Once you start studying, it also shows today’s tasks, your exam plans and your week.` },
    { id: 'labs', tab: 'labs', phoneAt: ['#tabbar [data-tab="labs"]'], at: ['#labs-btn'],
      say: () => 'Learn has simulations you can play with, like pendulums and pH. Explore 3D is there too, for the human body, cells and space.' },
    { id: 'games', tab: 'games', phoneAt: ['#tabbar [data-tab="games"]'], at: ['#games-btn'],
      say: () => 'Games has quick learning games and a new puzzle every day. They are a fun way to practise what you learn.' },
    { id: 'cards', tab: 'cards', phoneAt: ['#tabbar [data-tab="cards"]'], at: ['#side-tools .side-tool[data-tip="Flashcards"]', '[data-hub="cards"]', '#side-menu-toggle'],
      say: () => 'Flashcards bring each card back right before you would forget it. Make them from any answer, or write your own.' },
    { id: 'board', tab: 'home', phoneAt: ['#home [data-hub="board"]'], at: ['#board-btn'],
      say: () => 'The board is for drawing, sketching and graphs. Cassie can draw on it too, when a picture explains it better.' },
    { id: 'about', tab: 'chat', at: ['#mascot-btn'],
      say: () => 'Cassie uses AI to answer, so she can be wrong: check anything important. Your chats stay on this device and are never saved to an account.' },
    { id: 'settings', tab: null, phoneAt: ['#tabbar [data-tab="you"]'], at: ['#settings-btn'],
      say: () => `${phone() ? 'You has Settings and Plans' : 'Settings has your voice, your plan and more'}. To see this tour again, open Settings, then Help, then Take the tour.` },
  ];

  /* ---------- the offer: once, right after the first run ---------- */
  let offerBox = null, after = null;
  // after: runs once the offer is answered and the tour (and its video) is over
  const thenAfter = () => { const f = after; after = null; if (f) setTimeout(f, 300); };
  function offer(then) {
    if (then) after = then;
    if (state.tour || run || offerBox) { if (!run && !offerBox) thenAfter(); return; } // (asked once, ever: this device or the account)
    state.tour = 'offered'; save(); if (typeof syncAccount === 'function') syncAccount();
    offerBox = document.createElement('div');
    offerBox.className = 'tour-offer'; offerBox.setAttribute('role', 'dialog'); offerBox.setAttribute('aria-label', 'A quick tour');
    offerBox.innerHTML = '<p>Want a quick tour? It takes about 90 seconds.</p><div class="tour-row"><button type="button" class="tour-btn tour-main" data-t="go">Show me around</button><button type="button" class="tour-btn" data-t="later">Not now</button></div>';
    document.body.appendChild(offerBox);
    offerBox.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b) return;
      if (b.dataset.t === 'go') { closeOffer(); start(); return; }
      state.tour = 'later'; save(); if (typeof syncAccount === 'function') syncAccount();
      offerBox.innerHTML = '<p>Okay! You can take the tour any time: open Settings, then Help, then Take the tour.</p>';
      offerBox.setAttribute('role', 'status');
      setTimeout(closeOffer, 6000);
      if (after) setTimeout(() => { closeOffer(); thenAfter(); }, 2500); // (a moment to read it, then what comes next)
    });
    try { offerBox.querySelector('.tour-main').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  function closeOffer() { if (offerBox) { offerBox.remove(); offerBox = null; } }

  /* ---------- the tour itself ---------- */
  let run = null;
  function start() {
    closeOffer();
    if (run) return;
    const stops = STOPS.filter((s) => (phone() ? s.phoneAt || s.at : s.at));
    // where the app is now, to put it back exactly so at the end
    const setCard = document.querySelector('#settings-panel .settings-card');
    const before = { phone: phone(), tab: state.tab, settings: !settingsPanel.hidden ? (setCard && setCard.dataset.page) || 'all' : null, homeTop: (document.getElementById('home') || {}).scrollTop || 0, focus: document.activeElement };
    if (before.settings) closeSettings();
    // a brand-new student's Home shows 4 tools and More tools: the tour opens them all, so every stop is there
    if (window.hubMoreOpen === false && typeof refreshHub === 'function') { window.hubMoreOpen = true; refreshHub(); }
    // a computer's dashboard pages have no ask box: the tour shows a new chat, where every stop is
    if (!before.phone && document.body.classList.contains('desk-on') && typeof deskGo === 'function') { before.desk = deskPage; deskGo('chat'); }
    const root = document.documentElement;
    root.classList.add('touring');
    const veil = document.createElement('div'); veil.className = 'tour-veil'; // (taps on the app wait until the tour ends)
    const ring = document.createElement('div'); ring.className = 'tour-ring'; ring.setAttribute('aria-hidden', 'true');
    const card = document.createElement('div');
    card.className = 'tour-card'; card.setAttribute('role', 'dialog'); card.setAttribute('aria-label', 'Cassie’s tour');
    card.innerHTML = `<p class="tour-count"></p><p class="tour-say" aria-live="polite"></p><p class="tour-vnote" role="status" hidden></p>
      <div class="tour-row"><button type="button" class="tour-btn" data-t="back">Back</button><button type="button" class="tour-btn tour-main" data-t="next">Next</button></div>
      <div class="tour-row"><button type="button" class="tour-btn tour-voice" data-t="voice" aria-pressed="true">Voice on</button><button type="button" class="tour-btn" data-t="skip">Skip tour</button></div>`;
    document.body.append(veil, ring, card);
    const $ = (s) => card.querySelector(s);
    run = { stops, at: -1, before, veil, ring, card, timer: 0, talking: null, voice: null, target: null };
    const setVoice = (on) => { run.voiceOn = on; const b = $('.tour-voice'); b.setAttribute('aria-pressed', String(on)); b.textContent = on ? 'Voice on' : 'Voice off'; };
    setVoice(state.tourVoice !== 'off');
    // Bella's voice for the whole tour, or typing with one plain line (voice.js decides once, for all of it)
    const newVoice = () => {
      if (run.voice) run.voice.end();
      const CV = window.CassieVoice;
      run.voice = CV && CV.session ? CV.session({ gender: typeof voiceGender === 'function' ? voiceGender() : 'woman', onText: (line) => { const n = $('.tour-vnote'); n.textContent = line; n.hidden = false; } }) : null;
      if (run.voice) run.voice.plan(stops.slice(Math.max(0, run.at)).map((s) => s.say()).join(' '));
    };
    if (run.voiceOn) newVoice();
    card.addEventListener('click', (e) => {
      const b = e.target.closest('[data-t]');
      if (!b || !run) return;
      const t = b.dataset.t;
      if (t === 'next') { if (run.at < stops.length - 1) show(run.at + 1); else end('done'); }
      else if (t === 'back') show(Math.max(0, run.at - 1));
      else if (t === 'skip') end('skipped');
      else if (t === 'voice') {
        setVoice(!run.voiceOn); state.tourVoice = run.voiceOn ? 'on' : 'off'; save();
        hush();
        if (run.voiceOn) { newVoice(); say(stops[run.at]); } else { if (run.voice) { run.voice.end(); run.voice = null; } pace(stops[run.at]); }
      }
    });
    document.addEventListener('keydown', onKey, true);
    addEventListener('resize', place);
    if (typeof track === 'function') track('feature', 'tour');
    show(0);
    try { $('[data-t="next"]').focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }
  const onKey = (e) => { if (run && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end('skipped'); } };
  function hush() { if (!run) return; clearTimeout(run.timer); if (run.talking) { try { run.talking.stop(); } catch (e) { /* ignore */ } run.talking = null; } }
  // she moves on by herself once the stop is said (or read, at an easy pace); Next and Back work any time
  const readTime = (stop) => 1200 + stop.say().split(/\s+/).length * 400; // (an easy reading pace)
  function pace(stop) { clearTimeout(run.timer); run.timer = setTimeout(next, readTime(stop)); }
  function next() { if (!run) return; if (run.at < run.stops.length - 1) show(run.at + 1); }
  function say(stop) {
    if (!run.voiceOn || !run.voice) { pace(stop); return; }
    const me = run.talking = run.voice.speak(cleanForSpeech(stop.say())), t0 = Date.now();
    // on once she has said it, and never faster than it takes to read
    me.done.then((r) => { if (!run || run.talking !== me) return; run.talking = null; if (r && r.status === 'stopped') return; run.timer = setTimeout(next, Math.max(900, readTime(stop) - (Date.now() - t0))); });
  }
  async function show(k) {
    if (!run) return;
    hush();
    run.at = k;
    const stop = run.stops[k], card = run.card;
    // a phone: the stop's tab first (the tab bar is always there)
    if (run.before.phone && stop.tab && window.CassieNative) window.CassieNative.go(stop.tab);
    const sels = run.before.phone ? stop.phoneAt || stop.at : stop.at;
    let el = null;
    for (let i = 0; i < 30 && run && run.at === k && !(el = first(sels)); i++) await new Promise((r) => setTimeout(r, 100)); // (a tab can take a moment to open)
    if (!run || run.at !== k) return;
    if (!el) { run.stops.splice(k, 1); if (k < run.stops.length) show(k); else end('done'); return; } // (not on this device after all: that stop is left out)
    if (el && !seen(el)) { el.scrollIntoView({ block: 'center' }); await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); }
    run.target = el;
    card.querySelector('.tour-count').textContent = `Stop ${k + 1} of ${run.stops.length}`;
    card.querySelector('.tour-say').textContent = stop.say();
    card.querySelector('[data-t="back"]').disabled = k === 0;
    card.querySelector('[data-t="next"]').textContent = k === run.stops.length - 1 ? 'Done' : 'Next';
    card.dataset.stop = stop.id;
    place();
    if (el) detourToElement(el, { resumeAfter: 1e9 }); // (Cassie's cursor glides there; with Reduce Motion it just appears)
    // a control that is still moving (a tab growing its label, a list settling): the ring and the cursor keep up
    clearInterval(run.follow);
    let last = el ? JSON.stringify(el.getBoundingClientRect()) : '';
    run.follow = setInterval(() => {
      if (!run || !run.target || !run.target.isConnected) return;
      const now = JSON.stringify(run.target.getBoundingClientRect());
      if (now !== last) { last = now; run.ring.style.transition = 'none'; place(); void run.ring.offsetWidth; run.ring.style.transition = ''; detourToElement(run.target, { resumeAfter: 1e9 }); }
    }, 200);
    say(stop);
  }
  // the ring around the control, and the card where it doesn't cover it
  function place() {
    if (!run) return;
    const { ring, card, target } = run;
    if (!target || !seen(target)) { ring.hidden = true; card.classList.remove('tour-top'); return; }
    const r = target.getBoundingClientRect(), pad = 6;
    ring.hidden = false;
    Object.assign(ring.style, { left: r.left - pad + 'px', top: r.top - pad + 'px', width: r.width + pad * 2 + 'px', height: r.height + pad * 2 + 'px' });
    // the card goes where it covers neither the control nor its ring: the bottom (above a phone's tab
    // bar), the top, or else just below or just above the control
    card.style.top = ''; card.classList.remove('tour-top');
    const h = card.getBoundingClientRect().height, gap = 10, ringTop = r.top - pad, ringBottom = r.bottom + pad;
    const tab = document.getElementById('tabbar'), floor = (tab && tab.getClientRects().length ? Math.min(innerHeight, tab.getBoundingClientRect().top) : innerHeight) - 12;
    const clear = (y) => y >= 8 && y + h <= floor && (y + h <= ringTop - gap || y >= ringBottom + gap);
    const spots = [floor - h, 12, ringBottom + gap, ringTop - gap - h];
    const y = spots.find(clear);
    card.style.top = (y != null ? y : (r.top + r.height / 2 > innerHeight / 2 ? 12 : floor - h)) + 'px';
  }
  function end(how) {
    if (!run) return;
    const r = run;
    hush();
    clearInterval(r.follow);
    if (r.voice) r.voice.end();
    run = null;
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('resize', place);
    r.card.remove(); r.ring.remove(); r.veil.remove();
    document.documentElement.classList.remove('touring');
    resumeFollowing();
    state.tour = how === 'done' ? 'done' : 'skipped';
    save(); if (typeof syncAccount === 'function') syncAccount();
    // the app, exactly where it was
    const b = r.before;
    if (b.desk && !state.messages.length && typeof deskGo === 'function') deskGo(b.desk); // (back to the page you were on)
    if (b.phone && window.CassieNative) {
      window.CassieNative.go(b.tab === 'home' ? 'home' : 'chat');
      const home = document.getElementById('home'); if (home) requestAnimationFrame(() => { home.scrollTop = b.homeTop; });
    }
    if (b.settings) { openSettings('all'); if (b.settings !== 'all' && typeof setPage === 'function') setPage(b.settings); }
    try { if (b.focus && b.focus.isConnected) b.focus.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    if (how === 'done' && !b.phone && !phone() && !state.extVideoSeen) setTimeout(video, 400);
    else thenAfter();
  }

  /* ---------- the Chrome extension, in a 38 second video (computers only: it needs Chrome or Edge) ---------- */
  let videoBox = null;
  function video() {
    if (videoBox || run) return;
    state.extVideoSeen = true; save();
    const back = document.activeElement;
    const still = matchMedia('(prefers-reduced-motion: reduce)').matches;
    videoBox = document.createElement('div');
    videoBox.className = 'tour-video-wrap';
    videoBox.innerHTML = `<div class="tour-video" role="dialog" aria-modal="true" aria-labelledby="tv-h">
      <h2 id="tv-h">Cassie on every page you read</h2>
      <video poster="landing/extension-how.jpg" controls muted playsinline preload="metadata"${still ? '' : ' autoplay'} aria-label="How the Cassie Chrome extension works"><source src="landing/extension-how.webm" type="video/webm"><source src="landing/extension-how.mp4" type="video/mp4"></video>
      <p>With the Chrome extension, highlight any words and Cassie explains them, or tap Teach me and she teaches the whole page. Free, for Chrome and Edge on a computer.</p>
      <div class="tour-row"><a class="tour-btn tour-main" href="https://chromewebstore.google.com/detail/hnafgijhojdheggkcjliffbgpdhikbpj" target="_blank" rel="noopener" data-ext="label">Add to Chrome</a><button type="button" class="tour-btn" data-t="close">Close</button></div>
    </div>`;
    document.body.appendChild(videoBox);
    if (window.CassieExt) window.CassieExt.fix(videoBox); // (the right store and name for this browser)
    const close = () => {
      if (!videoBox) return;
      const v = videoBox.querySelector('video'); try { v.pause(); } catch (e) { /* ignore */ }
      videoBox.remove(); videoBox = null;
      document.removeEventListener('keydown', key, true);
      try { if (back && back.isConnected) back.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      thenAfter();
    };
    const key = (e) => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'Tab') { // (focus stays in the box)
        const f = [...videoBox.querySelectorAll('video, a, button')];
        const i = f.indexOf(document.activeElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); f[f.length - 1].focus(); } else if (!e.shiftKey && i === f.length - 1) { e.preventDefault(); f[0].focus(); }
      }
    };
    document.addEventListener('keydown', key, true);
    videoBox.addEventListener('click', (e) => { if (e.target === videoBox || e.target.closest('[data-t="close"]')) close(); });
    videoBox.querySelector('[data-t="close"]').focus({ preventScroll: true });
  }

  window.CassieTour = { offer, start, stop: () => end('skipped'), video, get active() { return !!run; }, get target() { return run && run.target; }, STOPS };
  const btn = document.getElementById('tour-btn');
  if (btn) btn.addEventListener('click', () => start());
  const vbtn = document.getElementById('ext-video-btn');
  if (vbtn) vbtn.addEventListener('click', () => video());
})();
