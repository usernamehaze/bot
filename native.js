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
    if (t === 'home' || t === 'chat') {
      closeOthers(t);
      if (t === base && t === 'home') home.scrollTo({ top: 0, behavior: 'smooth' }); // tap Home again: back to the top
      base = t; state.tab = t; save();
      if (t === 'chat') requestAnimationFrame(() => { chatLog.scrollTop = chatLog.scrollHeight; });
    } else if (t === 'labs' || t === 'games') { closeOthers(t); press(t === 'games' ? '#games-btn' : '#labs-btn'); }
    else if (t === 'cards') { closeOthers('cards'); if (window.CassieCards) window.CassieCards.open(); }
    else if (t === 'you') { closeOthers('you'); if (settings.hidden) press('#settings-btn'); }
    sync();
  }
  bar.addEventListener('click', (e) => { const b = e.target.closest('[data-tab]'); if (b) go(b.dataset.tab); });

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
    if (on && base === 'home' && !home.hidden) fill();
  }
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(sync); } };
  phone.addEventListener('change', later);
  // overlays opening and closing (Labs, Flashcards, Settings, a lab inside Labs)
  new MutationObserver(later).observe(root, { attributes: true, attributeFilter: ['class'] });
  new MutationObserver(later).observe(document.body, { attributes: true, attributeFilter: ['hidden'], subtree: true });

  /* ---------- Home ---------- */
  const ago = (t) => {
    const s = (Date.now() - (t || 0)) / 1000;
    if (s < 60) return 'just now';
    if (s < 3600) return Math.round(s / 60) + ' min ago';
    if (s < 86400) return Math.round(s / 3600) + ' h ago';
    const d = Math.round(s / 86400);
    return d === 1 ? 'yesterday' : d < 7 ? d + ' days ago' : new Date(t).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  };
  function fill() {
    const p = state.profile || {};
    const name = (p.name || '').trim().split(/\s+/)[0];
    $('#home-name').textContent = name || 'there';
    $('#home-initial').textContent = (name || 'C')[0].toUpperCase();
    $('#home-sub span').textContent = [p.grade || p.level, p.role === 'pro' || p.role === 'professional' ? 'Professional' : p.role ? 'Student' : ''].filter(Boolean).join(' · ') || 'Your study buddy';
    const now = new Date();
    $('#home-day').textContent = now.toLocaleDateString(undefined, { weekday: 'long' });
    $('#home-date').textContent = now.getDate();
    $('#home-month').textContent = now.toLocaleDateString(undefined, { month: 'short' });
    const due = window.CassieCards ? window.CassieCards.dueCount() : 0, all = window.CassieCards ? window.CassieCards.count() : 0;
    $('#home-due').textContent = due;
    $('#home-due-txt').textContent = all ? (due === 1 ? 'card due today' : 'cards due today') : 'Make cards from any answer';
    $('#home-due-go').textContent = due ? 'Review now ›' : all ? 'All done ✓' : 'Open ›';
    const list = $('#home-recent');
    const chats = state.chats.filter((c) => c.messages && c.messages.length).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).slice(0, 3);
    list.replaceChildren();
    if (!chats.length) {
      const e = document.createElement('button'); e.type = 'button'; e.className = 'recent empty';
      e.innerHTML = '<i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg></i><span><b>Ask your first question</b><small>Cassie explains it step by step</small></span>';
      e.addEventListener('click', () => ask());
      list.appendChild(e);
      return;
    }
    chats.forEach((c) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'recent';
      b.innerHTML = '<i><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5.5A1.5 1.5 0 0 1 5.5 4h13A1.5 1.5 0 0 1 20 5.5v9a1.5 1.5 0 0 1-1.5 1.5H9l-5 4z"/></svg></i><span><b></b><small></small></span><svg class="recent-go" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';
      b.querySelector('b').textContent = c.title || deriveTitle(c.messages) || 'Chat';
      const n = c.messages.length;
      b.querySelector('small').textContent = `${n} message${n === 1 ? '' : 's'} · ${ago(c.updatedAt)}`;
      b.addEventListener('click', () => { selectChat(c.id); go('chat'); });
      list.appendChild(b);
    });
  }
  function ask() { go('chat'); setTimeout(() => promptInput.focus(), 60); }
  $('#home-ask').addEventListener('click', ask);
  $('#home-new').addEventListener('click', () => { createNewChat(); go('chat'); });
  $('#home-me').addEventListener('click', () => go('you'));
  $('#home-all').addEventListener('click', () => { go('chat'); press('#menu-btn'); });
  home.addEventListener('click', (e) => {
    const b = e.target.closest('[data-go]'); if (!b) return;
    const k = b.dataset.go;
    if (k === 'labs' || k === 'cards') return go(k);
    if (k === 'board') return press('#board-btn');
    if (k === 'talk') return press('#voice-btn');
    go('chat');
    press(k === 'quiz' ? '#quiz-btn' : '#research-btn');
  });

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
