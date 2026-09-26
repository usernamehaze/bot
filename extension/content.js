'use strict';

(() => {
  const HOST_ID = 'cassie-ext-host-92f1';
  if (document.getElementById(HOST_ID)) return; // avoid double injection

  console.log('[Cassie] extension loaded on this page — highlight text to use it.');

  // Let the popup ask for the text of the page the user is viewing (top frame only).
  if (window.top === window) {
    chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
      if (msg && msg.type === 'CASSIE_GET_PAGE') {
        const raw = (document.body && document.body.innerText) || '';
        sendResponse({ text: raw.replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000) });
      }
    });
  }

  const host = document.createElement('div');
  host.id = HOST_ID;
  document.documentElement.appendChild(host);
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    .popover {
      position: fixed;
      width: 300px;
      max-width: calc(100vw - 24px);
      background: #ffffff;
      color: #1c1d2b;
      border: 1px solid #e6e2f5;
      border-radius: 12px;
      box-shadow: 0 10px 30px rgba(0, 0, 0, .28);
      z-index: 2147483647;
      overflow: hidden;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .popover[hidden] { display: none; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 6px 7px 12px;
      background: #1c1c24;
      color: #fff;
      font-size: 12px;
      font-weight: 700;
      letter-spacing: .02em;
      text-transform: uppercase;
    }
    .header button {
      background: none;
      border: none;
      color: #fff;
      font-size: 18px;
      line-height: 1;
      padding: 4px 8px;
      cursor: pointer;
      opacity: .85;
    }
    .header button:hover { opacity: 1; }
    .body {
      padding: 11px 13px;
      font-size: 14px;
      line-height: 1.45;
      max-height: 260px;
      overflow-y: auto;
    }
    .body p { margin: 0 0 8px; white-space: pre-wrap; }
    .body p:last-child { margin-bottom: 0; }
    .body.muted { color: #6b6f8a; font-style: italic; }
    .body pre {
      background: #0d0d12; color: #f2f2f5; padding: 10px 12px;
      border-radius: 8px; overflow-x: auto; margin: 8px 0; white-space: pre;
    }
    .body pre code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5; background: none; padding: 0; }
    .body code { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: .9em; background: rgba(127,127,127,.18); padding: 1px 4px; border-radius: 4px; }
    .body .table-wrap { overflow-x: auto; margin: 8px 0; }
    .body table.md-table { border-collapse: collapse; width: 100%; font-size: 13px; }
    .body table.md-table th, .body table.md-table td { text-align: left; padding: 6px 9px; border-bottom: 1px solid rgba(127,127,127,.35); vertical-align: top; }
    .body table.md-table thead th { font-weight: 600; border-bottom: 2px solid rgba(127,127,127,.5); }
    .body table.md-table tbody tr:last-child td { border-bottom: none; }
    .body ul, .body ol { margin: 6px 0 8px; padding-left: 20px; }
    .body li { margin: 2px 0; }
    .body p.md-label { margin: 10px 0 4px; font-weight: 600; }
    .body p.md-label:first-child { margin-top: 0; }
    .body hr { border: none; border-top: 1px solid rgba(127,127,127,.35); margin: 10px 0; }
    .question { font-weight: 600; margin-bottom: 10px; }
    .choice-row { display: flex; gap: 8px; }
    .choice-btn {
      flex: 1;
      background: #1c1c24;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 0;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .choice-btn:hover { background: #000000; }
    .fab {
      position: fixed;
      right: 16px;
      bottom: 16px;
      width: 44px;
      height: 44px;
      border-radius: 50%;
      background: #1c1c24;
      border: none;
      cursor: pointer;
      z-index: 2147483646;
      opacity: .55;
      transition: opacity .15s;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
      display: flex;
      align-items: center;
      justify-content: center;
      padding: 0;
    }
    .fab:hover { opacity: 1; }
    .fab[hidden] { display: none; }
    .fab svg { width: 22px; height: 22px; fill: #fff; }
    .page-input {
      width: 100%;
      box-sizing: border-box;
      padding: 8px 10px;
      border: 1px solid #e6e2f5;
      border-radius: 8px;
      font-size: 13px;
      margin-bottom: 8px;
      font-family: inherit;
    }
    .page-ask-btn {
      width: 100%;
      background: #1c1c24;
      color: #fff;
      border: none;
      border-radius: 8px;
      padding: 9px 0;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .page-ask-btn:hover { background: #000; }
  `;
  shadow.appendChild(style);

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="header"><span>Cassie</span><button type="button" aria-label="Close">&times;</button></div>
    <div class="body"></div>
  `;
  shadow.appendChild(popover);

  const closeBtn = popover.querySelector('.header button');
  const body = popover.querySelector('.body');

  // Floating "ask about this page" button — top frame only, so there's just one.
  let fab = null;
  if (window.top === window) {
    fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.title = 'Ask Cassie about this page';
    fab.innerHTML = '<svg viewBox="0 0 32 32"><path d="M6 2 L27 15 L17 17 L22 27 L17 29 L12 19 L6 24 Z"/></svg>';
    shadow.appendChild(fab);
    fab.addEventListener('click', showPageAsk);
  }

  let lastAutoText = '';
  let gen = 0;
  let selTimer = null;

  function hidePopover() {
    popover.hidden = true;
    lastAutoText = '';
    gen++;
  }

  function dismissPopover() {
    window.getSelection()?.removeAllRanges();
    hidePopover();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }
  function inlineFormat(text) {
    let html = escapeHtml(text);
    const codes = [];
    html = html.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    return html.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[+i]}</code>`);
  }

  function isTableSeparator(line) {
    return line.includes('-') && /^\s*\|?[\s:|-]*-[\s:|-]*\|?\s*$/.test(line);
  }
  function splitTableRow(line) {
    let s = line.trim();
    if (s.startsWith('|')) s = s.slice(1);
    if (s.endsWith('|')) s = s.slice(0, -1);
    return s.split('|').map((c) => c.trim());
  }

  // Render a prose block (no ```fences```) into clean HTML: real tables,
  // bold labels instead of #/##/### headings, italics, lists, rules.
  function renderProse(container, text) {
    const lines = String(text).replace(/\r/g, '').split('\n');
    let i = 0, listEl = null, listType = null;
    const flushList = () => { if (listEl) container.appendChild(listEl); listEl = null; listType = null; };
    while (i < lines.length) {
      const line = lines[i], trimmed = line.trim();
      if (!trimmed) { flushList(); i++; continue; }
      if (line.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) {
        flushList();
        const header = splitTableRow(line);
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].trim() && lines[i].includes('|')) { rows.push(splitTableRow(lines[i])); i++; }
        const wrap = document.createElement('div'); wrap.className = 'table-wrap';
        const table = document.createElement('table'); table.className = 'md-table';
        const thead = document.createElement('thead'), htr = document.createElement('tr');
        header.forEach((h) => { const th = document.createElement('th'); th.innerHTML = inlineFormat(h); htr.appendChild(th); });
        thead.appendChild(htr); table.appendChild(thead);
        const tbody = document.createElement('tbody');
        rows.forEach((r) => {
          const tr = document.createElement('tr');
          for (let c = 0; c < header.length; c++) { const td = document.createElement('td'); td.innerHTML = inlineFormat(r[c] || ''); tr.appendChild(td); }
          tbody.appendChild(tr);
        });
        table.appendChild(tbody); wrap.appendChild(table); container.appendChild(wrap);
        continue;
      }
      if (/^\s*([-*_])\1{2,}\s*$/.test(line)) { flushList(); container.appendChild(document.createElement('hr')); i++; continue; }
      const h = trimmed.match(/^#{1,6}\s+(.*)$/);
      if (h) { flushList(); const p = document.createElement('p'); p.className = 'md-label'; p.innerHTML = '<strong>' + inlineFormat(h[1].replace(/#+\s*$/, '').trim()) + '</strong>'; container.appendChild(p); i++; continue; }
      const bullet = line.match(/^\s*[-*+]\s+(.*)$/);
      if (bullet) { if (listType !== 'ul') { flushList(); listEl = document.createElement('ul'); listType = 'ul'; } const li = document.createElement('li'); li.innerHTML = inlineFormat(bullet[1]); listEl.appendChild(li); i++; continue; }
      const num = line.match(/^\s*\d+[.)]\s+(.*)$/);
      if (num) { if (listType !== 'ol') { flushList(); listEl = document.createElement('ol'); listType = 'ol'; } const li = document.createElement('li'); li.innerHTML = inlineFormat(num[1]); listEl.appendChild(li); i++; continue; }
      flushList();
      const buf = [trimmed]; i++;
      while (i < lines.length) {
        const nl = lines[i], nt = nl.trim();
        if (!nt) break;
        if (/^#{1,6}\s+/.test(nt)) break;
        if (/^\s*[-*+]\s+/.test(nl) || /^\s*\d+[.)]\s+/.test(nl)) break;
        if (/^\s*([-*_])\1{2,}\s*$/.test(nl)) break;
        if (nl.includes('|') && i + 1 < lines.length && isTableSeparator(lines[i + 1])) break;
        buf.push(nt); i++;
      }
      const p = document.createElement('p'); p.innerHTML = inlineFormat(buf.join(' ')); container.appendChild(p);
    }
    flushList();
  }

  function setContent(text, { muted = false } = {}) {
    body.classList.toggle('muted', muted);
    body.innerHTML = '';
    String(text).split('```').forEach((seg, i) => {
      if (i % 2 === 1) {
        let code = seg;
        const nl = seg.indexOf('\n');
        if (nl !== -1) {
          const first = seg.slice(0, nl).trim();
          if (/^[a-zA-Z0-9+#.\-]{0,15}$/.test(first)) code = seg.slice(nl + 1);
        }
        const pre = document.createElement('pre');
        const c = document.createElement('code');
        c.textContent = code.replace(/\n$/, '');
        pre.appendChild(c);
        body.appendChild(pre);
      } else if (seg.trim()) {
        renderProse(body, seg);
      }
    });
  }

  function positionPopover(rect) {
    const width = popover.offsetWidth || 300;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;

    const estHeight = popover.offsetHeight || 90;
    const spaceAbove = rect.top;
    const top = spaceAbove > estHeight + 16
      ? rect.top - estHeight - 8
      : Math.min(rect.bottom + 8, window.innerHeight - estHeight - 12);
    popover.style.top = `${Math.max(8, top)}px`;
  }

  // A rect near the bottom-right (just above the FAB) to anchor the page popover.
  function bottomRightRect() {
    const x = window.innerWidth - 30;
    const y = window.innerHeight - 70;
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function showPageAsk() {
    const rect = bottomRightRect();
    body.classList.remove('muted');
    body.innerHTML = `
      <div class="question">Ask about this page</div>
      <input type="text" class="page-input" placeholder="e.g. Summarize this page">
      <button type="button" class="page-ask-btn">Ask</button>
    `;
    popover.hidden = false;
    positionPopover(rect);
    const input = body.querySelector('.page-input');
    const askBtn = body.querySelector('.page-ask-btn');
    input.focus();
    const run = () => runPageAsk(input.value.trim());
    askBtn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  function runPageAsk(question) {
    const rect = bottomRightRect();
    const q = question || 'Summarize this page and list the key points.';
    const myGen = ++gen;
    setContent('Reading the page…', { muted: true });
    positionPopover(rect);
    const pageText = ((document.body && document.body.innerText) || '')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    if (!pageText) { setContent('This page has no readable text.', { muted: true }); positionPopover(rect); return; }
    const prompt = `Here is the text of the web page the user is currently viewing:\n\n"""\n${pageText}\n"""\n\nUsing that page, answer: ${q}`;
    chrome.runtime.sendMessage({ type: 'CASSIE_ASK', text: prompt }, (res) => {
      if (myGen !== gen) return;
      if (chrome.runtime.lastError) { setContent('Something went wrong. Reload the page and try again.', { muted: true }); positionPopover(rect); return; }
      if (res?.error === 'no-key') { setContent('Click the Cassie toolbar icon to add your free Groq API key first.', { muted: true }); positionPopover(rect); return; }
      if (res?.error) { setContent(res.error, { muted: true }); positionPopover(rect); return; }
      setContent(res.reply || '(no response)');
      positionPopover(rect);
    });
  }

  let pendingText = '';
  let pendingRect = null;

  function showChoice(text, rect) {
    pendingText = text;
    pendingRect = rect;
    body.classList.remove('muted');
    body.innerHTML = `
      <div class="question">What should I do with this?</div>
      <div class="choice-row">
        <button type="button" class="choice-btn" data-mode="explain">Explain</button>
        <button type="button" class="choice-btn" data-mode="answer">Answer</button>
        <button type="button" class="choice-btn" data-mode="code">Code it</button>
      </div>
    `;
    positionPopover(rect);
  }

  body.addEventListener('click', (e) => {
    const btn = e.target.closest('.choice-btn');
    if (!btn) return;
    runExplainOrAnswer(pendingText, pendingRect, btn.dataset.mode);
  });

  function runExplainOrAnswer(text, rect, mode) {
    const myGen = ++gen;
    setContent('Thinking…', { muted: true });
    positionPopover(rect);

    let prompt;
    if (mode === 'answer') {
      prompt = `Give only the direct answer to this — no explanation, no extra words:\n\n"${text}"`;
    } else if (mode === 'code') {
      prompt = `Write clean, well-commented code that solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, and briefly explain how it works:\n\n"${text}"`;
    } else {
      prompt = `Answer this and explain your reasoning — give the answer, then explain why/how:\n\n"${text}"`;
    }

    chrome.runtime.sendMessage({ type: 'CASSIE_ASK', text: prompt }, (res) => {
      if (myGen !== gen) return; // superseded by a newer selection
      if (chrome.runtime.lastError) {
        setContent('Something went wrong talking to the extension. Try reloading the page.', { muted: true });
        positionPopover(rect);
        return;
      }
      if (res?.error === 'no-key') {
        setContent('Click the Cassie icon in your browser toolbar to add your free Groq API key first.', { muted: true });
        positionPopover(rect);
        return;
      }
      if (res?.error) {
        setContent(`Something went wrong: ${res.error}`, { muted: true });
        positionPopover(rect);
        return;
      }
      setContent(res.reply || '(no response)');
      positionPopover(rect);
    });
  }

  function checkSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hidePopover(); return; }
    const range = sel.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return; // ignore selecting our own popover text
    const text = sel.toString().trim();
    if (!text || text.length < 2 || text === lastAutoText) return;
    lastAutoText = text;
    popover.hidden = false;
    showChoice(text, range.getBoundingClientRect());
  }

  // Primary trigger: mouseup is the reliable "user finished selecting with the
  // mouse" signal across sites. A tiny delay lets the browser finalize the
  // selection before we read it.
  document.addEventListener('mouseup', (e) => {
    if (e.target === host) return; // clicks inside our own popover
    setTimeout(checkSelection, 10);
  });

  // Backup trigger: keyboard selection (shift+arrows) fires no mouseup, so
  // still watch selectionchange, debounced.
  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 500);
  });

  closeBtn.addEventListener('click', dismissPopover);

  // Hide when the user starts a fresh interaction elsewhere (but not the
  // mousedown that begins a new selection inside a page — checkSelection on
  // the following mouseup will re-show it).
  document.addEventListener('mousedown', (e) => {
    if (e.target !== host) hidePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) dismissPopover();
  });

  // Right-click (or two-finger tap) on selected text shows the Explain / Answer
  // buttons at the pointer instead of the browser's menu. Only when there's a
  // selection; edit fields keep their native menu.
  document.addEventListener('contextmenu', (e) => {
    if (e.target === host) return;
    if (e.target.closest && e.target.closest('input, textarea')) return;
    const sel = window.getSelection();
    const text = sel ? sel.toString().trim() : '';
    if (!text || text.length < 2) return;
    e.preventDefault();
    lastAutoText = text;
    const rect = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
    popover.hidden = false;
    showChoice(text, rect);
  });

  window.addEventListener('scroll', hidePopover, true);
  window.addEventListener('resize', hidePopover);
})();
