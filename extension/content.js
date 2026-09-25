'use strict';

(() => {
  const HOST_ID = 'cassie-ext-host-92f1';
  if (document.getElementById(HOST_ID)) return; // avoid double injection

  console.log('[Cassie] extension loaded on this page — highlight text to use it.');

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
    return escapeHtml(text)
      .replace(/`([^`]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
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
      } else {
        seg.split(/\n{2,}/).forEach((para) => {
          if (!para.trim()) return;
          const p = document.createElement('p');
          p.innerHTML = inlineFormat(para);
          body.appendChild(p);
        });
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
        setContent('Click the Cassie icon in your browser toolbar to add your free Google (Gemini) API key first.', { muted: true });
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
