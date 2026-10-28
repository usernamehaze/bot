/* The phone app: a Home screen and a floating tab bar, so Cassie feels like an iPhone app and not
   a web page. Built to Apple's Human Interface Guidelines: the tab bar moves between sections and
   never does actions, floats on glass above the content, keeps its labels, and steps aside only
   for full-screen views (a lab, the 3D explorers, the board, a voice chat). Only on narrow
   screens; computers keep their layout. Uses app.js's globals (state, save, selectChat, …) and
   presses its existing buttons, so every feature keeps working the one way it already does. */
(function () {
  'use strict';
  const root = document.documentElement, $ = (s) => document.querySelector(s), $$ = (s) => [...document.querySelectorAll(s)];
  const home = $('#home'), bar = $('#tabbar'), settings = $('#settings-panel');
  if (!home || !bar) return;
  const phone = matchMedia('(max-width: 760px)');
  const press = (sel) => { const b = $(sel); if (b) b.click(); };

  // where to start: the tab you were on last (Home for someone new); a shared link opens the chat
  // (the address the page was opened with: app.js tidies location before this runs)
  const nav = performance.getEntriesByType && performance.getEntriesByType('navigation')[0];
  const asked = new URL((nav && nav.name) || location.href).searchParams;
  let base = ['text', 'url', 'q', 'title', 'room', 'shared'].some((k) => asked.has(k)) ? 'chat' : (state.tab === 'chat' ? 'chat' : 'home');

  /* ---------- the tabs ---------- */
  const shown = () => {
    if (root.classList.contains('labs-open')) return $('.labs') && $('.labs').dataset.section === 'games' ? 'games' : 'labs';
    if (root.classList.contains('fc-open')) return 'cards';
    if (settings && !settings.hidden) return 'you';
    return base;
  };
  function closeOthers(keep) {
    if (keep !== 'labs' && keep !== 'games' && root.classList.contains('labs-open')) press('.labs .labs-x');
    if (keep !== 'cards' && root.classList.contains('fc-open') && window.CassieCards) window.CassieCards.close();
    if (keep !== 'you' && settings && !settings.hidden) press('#settings-close-btn');
  }
  function go(t) {
    if (t === 'home') forceFill = true; // (Home tapped: always fresh)
    if (t === 'home' || t === 'chat') {
      closeOthers(t);
      if (t === base && t === 'home') home.scrollTo({ top: 0, behavior: 'smooth' }); // tap Home again: back to the top
      base = t; state.tab = t; save();
      if (t === 'chat') requestAnimationFrame(() => { chatLog.scrollTop = chatLog.scrollHeight; });
    } else if (t === 'labs' || t === 'games') { closeOthers(t); press(t === 'games' ? '#games-btn' : '#labs-btn'); }
    else if (t === 'cards') { closeOthers('cards'); if (window.CassieCards) window.CassieCards.open(); }
    else if (t === 'you') { closeOthers('you'); if (settings.hidden) openSettings('profile'); } // (You: the profile first)
    sync();
  }
  // the tapped tab's own icon moves (style.css: tab-anim, tab-anim-home…); Reduce Motion or Lite mode: only its colour changes
  bar.querySelectorAll('.tab svg path').forEach((p) => p.setAttribute('pathLength', '1')); // (so the stroke can draw itself in)
  function wiggle(b) {
    if (document.documentElement.classList.contains('lite') || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    const cls = 'tab-anim-' + b.dataset.tab;
    b.classList.remove('tab-anim', cls); void b.offsetWidth; // (again from the start on a second tap)
    b.classList.add('tab-anim', cls);
    clearTimeout(b._anim); b._anim = setTimeout(() => b.classList.remove('tab-anim', cls), 520);
  }
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) { wiggle(b); go(b.dataset.tab); } });

  let queued = false;
  function sync() {
    queued = false;
    const on = phone.matches;
    root.classList.toggle('native', on);
    const t = shown();
    root.classList.toggle('tab-home', on && base === 'home');
    root.classList.toggle('tab-chat', on && base === 'chat');
    // inside a lab (not the shelf) the lab has the whole screen, like a modal view
    const lab = $('.labs .lab-view');
    root.classList.toggle('lab-in', !!(lab && !lab.hidden && root.classList.contains('labs-open')));
    home.hidden = !(on && base === 'home');
    bar.querySelectorAll('[data-tab]').forEach((b) => { const me = b.dataset.tab === t; b.classList.toggle('on', me); if (me) b.setAttribute('aria-current', 'page'); else b.removeAttribute('aria-current'); });
    // Home is drawn again when it comes into view, when Home is tapped, or when what it shows has
    // changed (your chats, cards, name, plan or colours), not on every change elsewhere on the page
    // (redrawing it each time restarted its moving previews)
    const showing = on && base === 'home' && !home.hidden;
    if (showing) { const sig = homeSig(); if (!homeShown || forceFill || sig !== lastSig) { lastSig = sig; fill(); } }
    homeShown = showing; forceFill = false;
  }
  let homeShown = false, forceFill = false, lastSig = '';
  const homeSig = () => { try {
    const chats = state.chats || [], cards = window.CassieCards;
    return JSON.stringify([chats.length, chats.reduce((m, c) => Math.max(m, c.updatedAt || 0), 0), (state.cards || []).length, cards ? cards.dueCount() : 0,
      state.profile && [state.profile.name, state.profile.gender, state.profile.grade, state.profile.role], state.plan, state.accent, window.CassieMemory ? window.CassieMemory.stats().streak : 0]);
  } catch (e) { return String(Math.random()); } };
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  phone.addEventListener('change', later);
  // overlays opening and closing (Labs, Flashcards, Settings, a lab inside Labs)
  new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  /* ---------- Home ---------- */
  function fill() { renderHub($('#home-hub')); } // (the hub: app.js)
  window.CassieNative = { go };

  // a new message (sent from anywhere: a tile, the extension, a share) opens the chat
  let seen = state.messages.length;
  new MutationObserver(() => {
    if (state.messages.length > seen && base === 'home' && phone.matches) go('chat');
    seen = state.messages.length;
  }).observe(chatLog, { childList: true, subtree: true });

  // while the keyboard is up it needs the room: the tab bar steps aside. (Only when the keyboard is
  // really open — the visible area shrinks — not just because the chat box has focus.)
  const vv = window.visualViewport;
  const keyboard = () => {
    const up = document.activeElement === promptInput && !!vv && window.innerHeight - vv.height > 140;
    root.classList.toggle('typing', up);
  };
  if (vv) vv.addEventListener('resize', keyboard);
  promptInput.addEventListener('focus', () => setTimeout(keyboard, 250));
  promptInput.addEventListener('blur', () => setTimeout(keyboard, 120));

  // the top bar floats over the chat (Liquid Glass): the chat scrolls under it, so it needs the bar's height
  const topbar = $('.topbar'), app = $('#app');
  if (topbar && app && 'ResizeObserver' in window) new ResizeObserver(() => app.style.setProperty('--topbar-h', topbar.offsetHeight + 'px')).observe(topbar);

  sync();
})();
