'use strict';

(() => {
  const HOST_ID = 'cassie-ext-host-92f1';
  if (document.getElementById(HOST_ID)) return; // avoid double injection

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
      background: #6d28d9;
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
    .body p { margin: 0 0 8px; }
    .body p:last-child { margin-bottom: 0; }
    .body.muted { color: #6b6f8a; font-style: italic; }
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

  function setContent(text, { muted = false } = {}) {
    body.classList.toggle('muted', muted);
    body.innerHTML = '';
    text.split(/\n{2,}/).forEach((para) => {
      const p = document.createElement('p');
      p.textContent = para;
      body.appendChild(p);
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

  function runAutoExplain(text, rect) {
    const myGen = ++gen;
    popover.hidden = false;
    setContent('Thinking…', { muted: true });
    positionPopover(rect);

    chrome.runtime.sendMessage(
      { type: 'CASSIE_ASK', text: `Explain this, then give the answer:\n\n"${text}"` },
      (res) => {
        if (myGen !== gen) return; // superseded by a newer selection
        if (chrome.runtime.lastError) {
          setContent('Something went wrong talking to the extension. Try reloading the page.', { muted: true });
          positionPopover(rect);
          return;
        }
        if (res?.error === 'no-key') {
          setContent('Click the Cassie icon in your browser toolbar to add your Anthropic API key first.', { muted: true });
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
      }
    );
  }

  function checkSelection() {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) { hidePopover(); return; }
    const range = sel.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return; // ignore selecting our own popover text
    const text = sel.toString().trim();
    if (!text || text.length < 2 || text === lastAutoText) return;
    lastAutoText = text;
    runAutoExplain(text, range.getBoundingClientRect());
  }

  document.addEventListener('selectionchange', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(checkSelection, 450);
  });

  closeBtn.addEventListener('click', dismissPopover);

  document.addEventListener('mousedown', (e) => {
    // events from inside our shadow root are retargeted to `host` here
    if (e.target !== host) hidePopover();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !popover.hidden) dismissPopover();
  });
  window.addEventListener('scroll', hidePopover, true);
  window.addEventListener('resize', hidePopover);
})();
