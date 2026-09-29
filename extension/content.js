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
    /* one font across the whole popover, including buttons and inputs */
    .popover, .popover *, .fab {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
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
    }
    .popover[hidden] { display: none; }
    .header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 9px 8px 9px 15px;
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
      padding: 14px 15px;
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
    .body sup, .body sub { line-height: 0; font-size: .75em; }
    .body .frac { display: inline-flex; flex-direction: column; text-align: center; vertical-align: -0.55em; margin: 0 2px; font-size: .95em; }
    .body .frac-n { border-bottom: 1px solid currentColor; padding: 0 4px; line-height: 1.25; }
    .body .frac-d { padding: 0 4px; line-height: 1.25; }
    /* dark theme — applied when the page it sits on has a dark background */
    .popover.dark { background: #1e1f26; color: #e9e9ef; border-color: #3a3b44; }
    .popover.dark .header { background: #0f0f14; }
    .popover.dark .body.muted { color: #a0a3b8; }
    .popover.dark .page-input, .popover.dark .followup-input { border-color: #4a4b55; }
    .popover.dark .copy-btn { border-color: #4a4b55; }
    .popover.dark .choice-btn, .popover.dark .followup-send, .popover.dark .page-ask-btn { background: #3a3b44; }
    .popover.dark .choice-btn:hover, .popover.dark .followup-send:hover, .popover.dark .page-ask-btn:hover { background: #565764; }
    .question { font-weight: 600; font-size: 11px; margin-bottom: 6px; }
    .choice-row { display: flex; gap: 4px; }
    .choice-btn {
      flex: 1;
      background: #1c1c24;
      color: #fff;
      border: none;
      border-radius: 5px;
      padding: 4px 0;
      font-size: 10px;
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
    .answer-actions { display: flex; align-items: center; gap: 8px; margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(127,127,127,.25); }
    .copy-btn { background: none; border: 1px solid rgba(127,127,127,.4); color: inherit; border-radius: 6px; padding: 3px 9px; font-size: 11px; font-weight: 600; cursor: pointer; font-family: inherit; }
    .copy-btn:hover { background: rgba(127,127,127,.12); }
    .followup-row { display: flex; gap: 6px; margin-top: 8px; }
    .followup-input { flex: 1; box-sizing: border-box; padding: 6px 9px; border: 1px solid rgba(127,127,127,.4); border-radius: 6px; font-size: 12px; font-family: inherit; background: transparent; color: inherit; }
    .followup-send { background: #1c1c24; color: #fff; border: none; border-radius: 6px; padding: 0 11px; font-size: 12px; font-weight: 600; cursor: pointer; }
    .followup-send:hover { background: #000; }

    /* --- "Explain a graphic" overlay: Cassie draws on top of the page --- */
    .annotate-fab {
      position: fixed; right: 16px; bottom: 68px; width: 44px; height: 44px;
      border-radius: 50%; background: #5a5a5a; border: none; cursor: pointer;
      z-index: 2147483646; opacity: .62; transition: opacity .15s;
      box-shadow: 0 4px 14px rgba(0,0,0,.35);
      display: flex; align-items: center; justify-content: center; padding: 0;
    }
    .annotate-fab:hover { opacity: 1; }
    .annotate-fab[hidden] { display: none; }
    .annotate-fab svg { width: 22px; height: 22px; fill: none; stroke: #fff; stroke-width: 2.4; }
    .pt-backdrop {
      position: fixed; inset: 0; z-index: 2147483644; cursor: crosshair;
      background: rgba(10,8,16,.28); backdrop-filter: blur(.5px);
    }
    .pt-backdrop[hidden] { display: none; }
    .pt-hint {
      position: fixed; left: 50%; top: 20px; transform: translateX(-50%);
      background: #1c1a26; color: #fff; border: 1.5px solid rgba(255,255,255,.22); border-radius: 12px;
      padding: 10px 16px; font-size: 14px; font-weight: 600; z-index: 2147483647;
      box-shadow: 0 8px 24px rgba(0,0,0,.3); display: flex; align-items: center; gap: 8px;
    }
    .pt-hint[hidden] { display: none; }
    .pt-hint .x { margin-left: 6px; cursor: pointer; opacity: .7; font-size: 17px; }
    .pt-hint .x:hover { opacity: 1; }
    .ann-svg { position: fixed; inset: 0; width: 100%; height: 100%; pointer-events: none; z-index: 2147483645; }
    .ann-svg path, .ann-svg line { stroke: #1c1c24; fill: none; stroke-width: 3; stroke-linecap: round; }
    .ann-dot { fill: #1c1c24; }
    .ann-dot-ring { fill: none; stroke: #1c1c24; stroke-width: 2; opacity: .6; }
    .board-card {
      position: fixed; z-index: 2147483646; width: 300px; max-width: calc(100vw - 24px);
      background: #1c1a26; color: #ecebf5; border: 1.5px solid rgba(255,255,255,.22); border-radius: 16px;
      box-shadow: 0 14px 40px rgba(0,0,0,.4); overflow: hidden;
    }
    .board-card[hidden] { display: none; }
    .board-card .bc-head {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,.12); font-weight: 700; font-size: 13.5px;
    }
    .board-card .bc-head .face {
      width: 22px; height: 22px; border-radius: 6px; background: linear-gradient(160deg,#fff,#ffd9ec);
      border: 1.5px solid #ffb8dd; position: relative; flex-shrink: 0;
    }
    .board-card .bc-head .face::before, .board-card .bc-head .face::after {
      content: ""; position: absolute; top: 7px; width: 3px; height: 5px; border-radius: 2px; background: #d0d0d0;
    }
    .board-card .bc-head .face::before { left: 6px } .board-card .bc-head .face::after { right: 6px }
    .board-card .bc-head .grow { flex: 1; }
    .board-card .bc-head .x { cursor: pointer; opacity: .7; font-size: 18px; line-height: 1; }
    .board-card .bc-head .x:hover { opacity: 1; }
    .board-card .bc-body { padding: 12px 14px; max-height: 46vh; overflow-y: auto; font-size: 14px; line-height: 1.5; }
    .board-card .bc-headline { font-weight: 700; margin: 0 0 10px; }
    .board-steps { list-style: none; margin: 0; padding: 0; counter-reset: bs; }
    .board-steps li {
      position: relative; padding: 8px 10px 8px 34px; margin-bottom: 6px; border-radius: 10px;
      border: 1px solid transparent; opacity: 0; transform: translateY(4px);
      transition: opacity .35s ease, transform .35s ease;
    }
    .board-steps li.show { opacity: 1; transform: none; }
    .board-steps li::before {
      counter-increment: bs; content: counter(bs); position: absolute; left: 8px; top: 7px;
      width: 19px; height: 19px; border-radius: 50%; background: #2a2836; border: 1px solid rgba(255,255,255,.15);
      color: #b9b7c9; font-size: 11px; font-weight: 700; display: flex; align-items: center; justify-content: center;
    }
    .board-steps li.done { opacity: .62; }
    .board-steps li.active { background: rgba(255,255,255,.12); border-color: rgba(255,255,255,.35); }
    .board-steps li.active::before { background: #e0e0e0; color: #1c1a26; border-color: #e0e0e0; }

    /* --- draggable header + emotional mini-bot avatar --- */
    .header { cursor: grab; touch-action: none; }
    .header:active { cursor: grabbing; }
    .header button { cursor: pointer; }
    .hleft { display: flex; align-items: center; gap: 8px; }
    .hint-key {
      display: inline-block; margin-top: 8px; font-size: 11px; color: #8a8a93;
    }
    .hint-key kbd {
      font-family: inherit; font-size: 10px; background: rgba(127,127,127,.16);
      border: 1px solid rgba(127,127,127,.3); border-radius: 4px; padding: 1px 5px; margin: 0 1px;
    }
  `;
  shadow.appendChild(style);

  const popover = document.createElement('div');
  popover.className = 'popover';
  popover.hidden = true;
  popover.innerHTML = `
    <div class="header">
      <span class="hleft"><span>Cassie</span></span>
      <button type="button" aria-label="Close">&times;</button>
    </div>
    <div class="body"></div>
  `;
  shadow.appendChild(popover);

  const header = popover.querySelector('.header');
  const closeBtn = popover.querySelector('.header button');
  const body = popover.querySelector('.body');
  const avatar = popover.querySelector('.cassie-ava');
  // Cassie's little face reacts: curious when she opens, thinking while she
  // works, happy when she's done, sad if something breaks.
  function setEmotion(name) { if (avatar) avatar.dataset.emo = name || 'idle'; }

  // Feature: drag the popover anywhere by its header (it then stays put).
  let dragging = false, dragDX = 0, dragDY = 0;
  header.addEventListener('pointerdown', (e) => {
    if (e.target.closest('button')) return; // let the close button work
    dragging = true;
    const r = popover.getBoundingClientRect();
    dragDX = e.clientX - r.left; dragDY = e.clientY - r.top;
    popover.dataset.moved = '1';
    try { header.setPointerCapture(e.pointerId); } catch (_) { /* ignore */ }
    e.preventDefault();
  });
  header.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    const w = popover.offsetWidth, h = popover.offsetHeight;
    const left = Math.max(6, Math.min(e.clientX - dragDX, window.innerWidth - w - 6));
    const top = Math.max(6, Math.min(e.clientY - dragDY, window.innerHeight - h - 6));
    popover.style.left = left + 'px'; popover.style.top = top + 'px';
  });
  function endDrag(e) { dragging = false; try { header.releasePointerCapture(e.pointerId); } catch (_) { /* ignore */ } }
  header.addEventListener('pointerup', endDrag);
  header.addEventListener('pointercancel', endDrag);

  // Feature: remember the cursor so the hotkey HUD appears where you're looking.
  let lastMouse = { x: Math.round(window.innerWidth / 2), y: Math.round(window.innerHeight / 2) };
  document.addEventListener('mousemove', (e) => { lastMouse = { x: e.clientX, y: e.clientY }; }, { passive: true });
  function cursorRect() {
    return { left: lastMouse.x, top: lastMouse.y, right: lastMouse.x, bottom: lastMouse.y, width: 0, height: 0 };
  }

  // Feature: hotkey — double-tap Ctrl summons Cassie at the cursor
  // (Clicky-style). Ctrl alone does nothing, so a quick double tap is clean
  // and never clashes with a real shortcut like Ctrl+C. If text is selected it
  // opens Explain/Answer/Code for it; otherwise the "ask about this page" box.
  function summonHud() {
    const sel = window.getSelection();
    const text = sel ? selectionText(sel) : '';
    const inOurs = sel && sel.rangeCount && host.contains(sel.getRangeAt(0).commonAncestorContainer);
    popover.hidden = false;
    setEmotion('curious');
    if (text && text.length > 1 && !inOurs) { lastAutoText = text; showChoice(text, cursorRect()); }
    else { showPageAsk(cursorRect()); }
  }
  let lastCtrlTap = 0;      // when Ctrl was last released as a clean tap
  let ctrlUsedWithKey = false; // was another key pressed during this Ctrl hold?
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Control') { if (!e.repeat) ctrlUsedWithKey = false; }
    else if (e.ctrlKey) { ctrlUsedWithKey = true; } // Ctrl+<something> — not a tap
  }, true);
  document.addEventListener('keyup', (e) => {
    if (e.key !== 'Control' || ctrlUsedWithKey) return;
    const now = Date.now();
    if (now - lastCtrlTap < 450) { lastCtrlTap = 0; summonHud(); }
    else lastCtrlTap = now;
  }, true);

  // Floating "ask about this page" button — top frame only, so there's just one.
  let fab = null;
  let annotateBtn = null;
  if (window.top === window) {
    fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.title = 'Ask Cassie about this page';
    fab.innerHTML = '<svg viewBox="0 0 32 32"><path d="M6 2 L27 15 L17 17 L22 27 L17 29 L12 19 L6 24 Z"/></svg>';
    shadow.appendChild(fab);
    fab.addEventListener('click', showPageAsk);

    // "Explain a graphic" — point at a graph/diagram and Cassie draws on it.
    annotateBtn = document.createElement('button');
    annotateBtn.className = 'annotate-fab';
    annotateBtn.type = 'button';
    annotateBtn.title = 'Explain a graph or diagram on this page';
    annotateBtn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>';
    shadow.appendChild(annotateBtn);
    annotateBtn.addEventListener('click', enterPointMode);
  }

  let lastAutoText = '';
  let gen = 0;
  let selTimer = null;
  // True while the HUD was opened deliberately (hotkey / "ask about this page"),
  // so a selection change on the page doesn't auto-dismiss it.
  let manualOpen = false;

  function hidePopover() {
    popover.hidden = true;
    lastAutoText = '';
    manualOpen = false;
    delete popover.dataset.moved; // a fresh open re-anchors to the selection
    setEmotion('idle');
    gen++;
  }

  // Match the popover to the page it sits on: dark popover on dark pages,
  // light on light. Reads the first opaque background from body/html, and
  // falls back to the OS colour-scheme preference.
  function isDarkBg() {
    try {
      for (const el of [document.body, document.documentElement]) {
        if (!el) continue;
        const bg = getComputedStyle(el).backgroundColor;
        const m = bg && bg.match(/rgba?\(([^)]+)\)/);
        if (!m) continue;
        const p = m[1].split(',').map((s) => parseFloat(s));
        if (p.length >= 4 && p[3] === 0) continue; // transparent — try next
        const lum = 0.299 * p[0] + 0.587 * p[1] + 0.114 * p[2];
        return lum < 128;
      }
    } catch (e) { /* ignore */ }
    try { return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches; } catch (e) { return false; }
  }
  function applyTheme() { popover.classList.toggle('dark', isDarkBg()); }

  function dismissPopover() {
    window.getSelection()?.removeAllRanges();
    hidePopover();
  }

  function escapeHtml(str) {
    const d = document.createElement('div');
    d.textContent = str;
    return d.innerHTML;
  }

  // Turn LaTeX-style math (which we don't render) into readable plain text.
  // Only touches text that actually looks like LaTeX.
  const LATEX_SYMBOLS = {
    times: '×', cdot: '·', div: '÷', pm: '±', mp: '∓', neq: '≠', ne: '≠',
    leq: '≤', le: '≤', geq: '≥', ge: '≥', approx: '≈', equiv: '≡', propto: '∝', infty: '∞',
    sum: 'Σ', prod: '∏', int: '∫', partial: '∂', nabla: '∇', cdots: '…', ldots: '…', dots: '…', vdots: '⋮',
    Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔', rightarrow: '→', leftarrow: '←', to: '→', mapsto: '↦',
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε', zeta: 'ζ', eta: 'η',
    theta: 'θ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', rho: 'ρ', sigma: 'σ',
    tau: 'τ', phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
    in: '∈', notin: '∉', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
    emptyset: '∅', forall: '∀', exists: '∃', land: '∧', lor: '∨', neg: '¬', angle: '∠', deg: '°',
    prime: '′', bullet: '•', circ: '∘', ast: '*', star: '*',
  };
  function deLatex(text) {
    if (!/\\(frac|dfrac|tfrac|sqrt|begin|end|left|right|displaystyle|text|mathrm|mathbf|operatorname|[a-zA-Z]+)|\\\[|\\\]|\\\(|\\\)|\^\{|_\{/.test(text)) {
      return text;
    }
    let t = text;
    t = t.replace(/\\\\?\s*\[\s*[0-9]+\s*(pt|ex|em|mu)\s*\]/g, '\n');
    t = t.replace(/\\\[|\\\]|\\\(|\\\)|\$\$/g, ' ');
    t = t.replace(/\\\\\s*/g, '\n');
    t = t.replace(/\\(begin|end)\{[^}]*\}/g, '');
    t = t.replace(/\\left|\\right/g, '');
    t = t.replace(/\\(displaystyle|textstyle|scriptstyle|limits|nonumber|quad|qquad|,|;|:|!)/g, ' ');
    t = t.replace(/\\(text|mathrm|mathbf|mathit|mathsf|mathcal|mathbb|operatorname)\s*\{([^{}]*)\}/g, '$2');
    for (let i = 0; i < 5; i++) {
      t = t.replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '($1)/($2)');
      t = t.replace(/\\[dt]?frac\s*([0-9A-Za-z])\s*([0-9A-Za-z])/g, '($1)/($2)');
      t = t.replace(/\\sqrt\s*\{([^{}]*)\}/g, '√($1)');
      t = t.replace(/\^\{([^{}]*)\}/g, '^($1)');
      t = t.replace(/_\{([^{}]*)\}/g, '_($1)');
    }
    t = t.replace(/\\([a-zA-Z]+)/g, (m, w) => (Object.prototype.hasOwnProperty.call(LATEX_SYMBOLS, w) ? LATEX_SYMBOLS[w] : w));
    t = t.replace(/\\([%&#_${}])/g, '$1');
    t = t.replace(/&/g, ' ');
    t = t.replace(/[{}]/g, '');
    t = t.replace(/^[ \t]*\[[ \t]+/gm, '').replace(/[ \t]+\][ \t]*$/gm, '');
    t = t.replace(/[ \t]{2,}/g, ' ').replace(/\n{3,}/g, '\n\n');
    return t;
  }

  // Read the current selection as text, preserving math a plain toString()
  // would flatten (x² -> "x2", stacked fractions -> "13"). Reconstructs
  // <sup>/<sub>, KaTeX, and MathML into readable ^/_ and fraction notation
  // so the model receives real exponents instead of a broken problem.
  function selectionText(sel) {
    if (!sel || sel.rangeCount === 0) return '';
    let box;
    try {
      box = document.createElement('div');
      for (let i = 0; i < sel.rangeCount; i++) box.appendChild(sel.getRangeAt(i).cloneContents());
      // KaTeX: use the original TeX annotation, dropping the duplicated render.
      box.querySelectorAll('.katex').forEach((k) => {
        const tex = k.querySelector('annotation[encoding="application/x-tex"]');
        k.replaceWith(document.createTextNode(tex ? ' ' + tex.textContent + ' ' : k.textContent));
      });
      // MathML: convert structure innermost-first into ^ / _ / fractions.
      const mnodes = Array.prototype.slice.call(box.querySelectorAll('msup, msub, msubsup, mfrac, msqrt, mroot'));
      for (let i = mnodes.length - 1; i >= 0; i--) {
        const el = mnodes[i], k = el.children, tag = el.tagName.toLowerCase();
        let r = el.textContent;
        if (tag === 'msup' && k.length >= 2) r = k[0].textContent + '^(' + k[1].textContent + ')';
        else if (tag === 'msub' && k.length >= 2) r = k[0].textContent + '_(' + k[1].textContent + ')';
        else if (tag === 'msubsup' && k.length >= 3) r = k[0].textContent + '_(' + k[1].textContent + ')^(' + k[2].textContent + ')';
        else if (tag === 'mfrac' && k.length >= 2) r = '(' + k[0].textContent + ')/(' + k[1].textContent + ')';
        else if (tag === 'msqrt') r = '√(' + el.textContent + ')';
        else if (tag === 'mroot' && k.length >= 2) r = '(' + k[1].textContent + ')√(' + k[0].textContent + ')';
        el.replaceWith(document.createTextNode(r));
      }
      box.querySelectorAll('sup').forEach((s) => s.replaceWith(document.createTextNode('^(' + s.textContent + ')')));
      box.querySelectorAll('sub').forEach((s) => s.replaceWith(document.createTextNode('_(' + s.textContent + ')')));
    } catch (e) { return sel.toString().trim(); }
    const text = (box.textContent || '').replace(/[ \t]+/g, ' ').replace(/\s*\n\s*/g, ' ').trim();
    return text || sel.toString().trim();
  }

  function prettifyMath(html) {
    html = html.replace(/\^\(([^()]{1,40})\)/g, '<sup>$1</sup>');
    html = html.replace(/\^(-?\d+|[A-Za-z])/g, '<sup>$1</sup>');
    html = html.replace(/_\(([^()]{1,40})\)/g, '<sub>$1</sub>');
    html = html.replace(/_(\d+)/g, '<sub>$1</sub>');
    html = html.replace(/\(([^()]{1,40})\)\s*\/\s*\(([^()]{1,40})\)/g,
      '<span class="frac"><span class="frac-n">$1</span><span class="frac-d">$2</span></span>');
    return html;
  }

  function inlineFormat(text) {
    let html = escapeHtml(text);
    const codes = [], escaped = [];
    html = html.replace(/`([^`]+)`/g, (m, c) => `\u0000${codes.push(c) - 1}\u0000`);
    html = html.replace(/\\([\\*_`#|~[\]()>.\-])/g, (m, ch) => `\u0001${escaped.push(ch) - 1}\u0001`);
    html = html
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/\*([^*\n]+)\*/g, '<em>$1</em>');
    html = prettifyMath(html);
    html = html.replace(/\u0001(\d+)\u0001/g, (m, i) => escaped[+i]);
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
        renderProse(body, deLatex(seg));
      }
    });
  }

  // Ask Groq via a streaming port so the answer appears as it's written.
  // `payload` is a single prompt string or a [{role, content}] history.
  // handlers: onDelta(fullTextSoFar), onDone(fullText), onError(code|message).
  function askStream(payload, handlers) {
    let port;
    try { port = chrome.runtime.connect({ name: 'cassie-stream' }); }
    catch (e) { handlers.onError('reload'); return; }
    let acc = '';
    let finished = false;
    port.onMessage.addListener((m) => {
      if (m.delta != null) { acc += m.delta; handlers.onDelta(acc); }
      else if (m.done) { finished = true; handlers.onDone(m.reply != null ? m.reply : acc); try { port.disconnect(); } catch (e) {} }
      else if (m.error) { finished = true; handlers.onError(m.error); try { port.disconnect(); } catch (e) {} }
    });
    port.onDisconnect.addListener(() => { if (!finished) handlers.onError('reload'); });
    const msg = Array.isArray(payload) ? { type: 'CASSIE_ASK', messages: payload } : { type: 'CASSIE_ASK', text: payload };
    try { port.postMessage(msg); }
    catch (e) { handlers.onError('reload'); }
  }

  // --- conversation state for follow-up questions in the popover ---
  let convo = [];          // [{role, content}] sent to the model
  let convoLabel = '';     // the human-readable question, for the history log
  let convoRect = null;    // where to anchor the popover for this conversation

  // Save each completed Q&A to local history (capped), for the popup to show.
  function saveToHistory(question, answer) {
    try {
      chrome.storage.local.get(['cassieHistory'], ({ cassieHistory }) => {
        const list = Array.isArray(cassieHistory) ? cassieHistory : [];
        list.unshift({ q: (question || '').slice(0, 400), a: (answer || '').slice(0, 4000), url: location.href, ts: Date.now() });
        chrome.storage.local.set({ cassieHistory: list.slice(0, 50) });
      });
    } catch (e) { /* storage unavailable */ }
  }

  // Render a finished answer plus a Copy button and a follow-up input.
  function renderAnswerView(full, rect) {
    setContent(full);
    const actions = document.createElement('div');
    actions.className = 'answer-actions';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'copy-btn';
    copyBtn.textContent = 'Copy';
    copyBtn.addEventListener('click', () => {
      const done = () => { copyBtn.textContent = 'Copied ✓'; setTimeout(() => { copyBtn.textContent = 'Copy'; }, 1500); };
      try {
        navigator.clipboard.writeText(full).then(done, () => {
          const ta = document.createElement('textarea'); ta.value = full; document.body.appendChild(ta); ta.select();
          try { document.execCommand('copy'); done(); } catch (e) {} document.body.removeChild(ta);
        });
      } catch (e) { /* clipboard blocked */ }
    });
    actions.appendChild(copyBtn);
    body.appendChild(actions);

    const row = document.createElement('div');
    row.className = 'followup-row';
    const input = document.createElement('input');
    input.className = 'followup-input';
    input.type = 'text';
    input.placeholder = 'Ask a follow-up…';
    const send = document.createElement('button');
    send.type = 'button';
    send.className = 'followup-send';
    send.textContent = 'Ask';
    const go = () => {
      const q = input.value.trim();
      if (!q) return;
      convo.push({ role: 'user', content: q });
      convoLabel = q;
      runConversation(rect);
    };
    send.addEventListener('click', go);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); go(); } });
    row.appendChild(input);
    row.appendChild(send);
    body.appendChild(row);
    positionPopover(rect);
    input.focus();
  }

  // Run (or continue) the current conversation, streaming the answer.
  function runConversation(rect) {
    convoRect = rect;
    const myGen = ++gen;
    setContent('Thinking…', { muted: true });
    setEmotion('thinking');
    positionPopover(rect);
    let positioned = false;
    askStream(convo, {
      onDelta: (soFar) => {
        if (myGen !== gen) return;
        setContent(soFar);
        if (!positioned) { positionPopover(rect); positioned = true; }
        body.scrollTop = body.scrollHeight;
      },
      onDone: (full) => {
        if (myGen !== gen) return;
        convo.push({ role: 'assistant', content: full });
        saveToHistory(convoLabel, full);
        setEmotion('happy');
        renderAnswerView(full || '(no response)', rect);
      },
      onError: (err) => {
        if (myGen !== gen) return;
        setEmotion('sad');
        if (err === 'no-key') setContent('Click the Cassie icon in your browser toolbar to add your free Groq API key first.', { muted: true });
        else if (err === 'reload') setContent('Something went wrong talking to the extension. Try reloading the page.', { muted: true });
        else setContent(err, { muted: true });
        positionPopover(rect);
      },
    });
  }

  function positionPopover(rect) {
    applyTheme();
    if (popover.dataset.moved) return; // user dragged it — leave it where they put it
    const width = popover.offsetWidth || 300;
    const estHeight = popover.offsetHeight || 90;
    let left = rect.left + rect.width / 2 - width / 2;
    left = Math.max(12, Math.min(left, window.innerWidth - width - 12));
    popover.style.left = `${left}px`;

    const isPoint = rect.width === 0 && rect.height === 0; // cursor/hotkey anchor
    let top;
    if (isPoint) {
      top = rect.top + 16; // sit just below the cursor
      if (top + estHeight > window.innerHeight - 12) top = rect.top - estHeight - 12; // flip up if no room
    } else {
      top = rect.top > estHeight + 16
        ? rect.top - estHeight - 8
        : Math.min(rect.bottom + 8, window.innerHeight - estHeight - 12);
    }
    popover.style.top = `${Math.max(8, top)}px`;
  }

  // A rect near the bottom-right (just above the FAB) to anchor the page popover.
  function bottomRightRect() {
    const x = window.innerWidth - 30;
    const y = window.innerHeight - 70;
    return { left: x, top: y, right: x, bottom: y, width: 0, height: 0 };
  }

  function showPageAsk(rect) {
    // The FAB passes a click event, not a rect — fall back to the corner then.
    rect = (rect && typeof rect.left === 'number' && typeof rect.width === 'number') ? rect : bottomRightRect();
    manualOpen = true;
    body.classList.remove('muted');
    setEmotion('curious');
    body.innerHTML = `
      <div class="question">Ask about this page</div>
      <input type="text" class="page-input" placeholder="e.g. Summarize this page">
      <button type="button" class="page-ask-btn">Ask</button>
      <div class="hint-key">Tip: double-tap <kbd>Ctrl</kbd> anywhere to summon me</div>
    `;
    popover.hidden = false;
    positionPopover(rect);
    const input = body.querySelector('.page-input');
    const askBtn = body.querySelector('.page-ask-btn');
    input.focus();
    const run = () => runPageAsk(input.value.trim(), rect);
    askBtn.addEventListener('click', run);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') run(); });
  }

  function runPageAsk(question, rect) {
    rect = rect || bottomRightRect();
    const q = question || 'Summarize this page and list the key points.';
    setContent('Reading the page…', { muted: true });
    positionPopover(rect);
    const pageText = ((document.body && document.body.innerText) || '')
      .replace(/\n{3,}/g, '\n\n').trim().slice(0, 8000);
    if (!pageText) { setContent('This page has no readable text.', { muted: true }); positionPopover(rect); return; }
    const prompt = `Here is the text of the web page the user is currently viewing:\n\n"""\n${pageText}\n"""\n\nUsing that page, answer: ${q}`;
    convo = [{ role: 'user', content: prompt }];
    convoLabel = q;
    runConversation(rect);
  }

  // ===== "Explain a graphic": point at something, Cassie draws over it =====
  const SVGNS = 'http://www.w3.org/2000/svg';
  let ptBackdrop = null, ptHint = null, annSvg = null, boardCard = null;

  function ensureOverlayEls() {
    if (ptBackdrop) return;
    ptBackdrop = document.createElement('div'); ptBackdrop.className = 'pt-backdrop'; ptBackdrop.hidden = true;
    ptHint = document.createElement('div'); ptHint.className = 'pt-hint'; ptHint.hidden = true;
    ptHint.innerHTML = '<span>Tap the graph, diagram or equation you want explained</span><span class="x" role="button" aria-label="Cancel">&times;</span>';
    annSvg = document.createElementNS(SVGNS, 'svg'); annSvg.setAttribute('class', 'ann-svg'); annSvg.style.display = 'none';
    boardCard = document.createElement('div'); boardCard.className = 'board-card'; boardCard.hidden = true;
    shadow.appendChild(ptBackdrop); shadow.appendChild(annSvg); shadow.appendChild(boardCard); shadow.appendChild(ptHint);
    ptBackdrop.addEventListener('click', onPointClick);
    ptHint.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); exitPointMode(); });
  }

  function enterPointMode() {
    ensureOverlayEls();
    hidePopover();
    closeBoard();
    if (fab) fab.hidden = true;
    if (annotateBtn) annotateBtn.hidden = true;
    ptBackdrop.hidden = false; ptHint.hidden = false;
    document.addEventListener('keydown', escPoint, true);
  }
  function escPoint(e) { if (e.key === 'Escape') exitPointMode(); }
  function exitPointMode() {
    if (ptBackdrop) ptBackdrop.hidden = true;
    if (ptHint) ptHint.hidden = true;
    if (fab) fab.hidden = false;
    if (annotateBtn) annotateBtn.hidden = false;
    document.removeEventListener('keydown', escPoint, true);
  }

  function onPointClick(e) {
    e.preventDefault(); e.stopPropagation();
    const x = e.clientX, y = e.clientY;
    ptBackdrop.style.pointerEvents = 'none';
    let el = document.elementFromPoint(x, y);
    ptBackdrop.style.pointerEvents = '';
    exitPointMode();
    if (!el || (host && host.contains(el)) || el === document.documentElement) return;
    explainTarget(el, x, y);
  }

  // Read the text around the pointed-at element so Cassie knows what it is.
  function gatherContext(el) {
    const parts = [];
    if (document.title) parts.push('Page: ' + document.title);
    const fig = el.closest('figure, section, article, table, .figure, .graph, .chart') || el.parentElement;
    const cap = fig && fig.querySelector && fig.querySelector('figcaption');
    if (cap && cap.innerText) parts.push('Caption: ' + cap.innerText.trim().slice(0, 300));
    const alt = el.getAttribute && (el.getAttribute('alt') || el.getAttribute('aria-label') || el.getAttribute('title'));
    if (alt) parts.push('Label: ' + alt.trim().slice(0, 300));
    let h = null, n = el;
    for (let i = 0; i < 8 && n; i++) {
      n = n.previousElementSibling || n.parentElement;
      if (!n) break;
      if (/^H[1-6]$/.test(n.tagName || '')) { h = n; break; }
      if (n.querySelector) { const hh = n.querySelector('h1,h2,h3,h4'); if (hh) { h = hh; break; } }
    }
    if (h && h.innerText) parts.push('Section: ' + h.innerText.trim().slice(0, 160));
    const own = ((el.innerText || '') || (fig && fig.innerText) || '').replace(/\s+/g, ' ').trim().slice(0, 900);
    if (own) parts.push('What is shown: ' + own);
    return parts.join('\n');
  }

  function explainTarget(el, x, y) {
    const rect = el.getBoundingClientRect();
    const ctx = gatherContext(el);
    openBoardLoading(rect, x, y);
    const prompt = `A student is viewing a webpage and pointed at one specific graphic on it (a graph, diagram, shape, equation, or illustration). Surrounding context:\n\n"""\n${ctx}\n"""\n\nExplain what this graphic shows and how to read it, like a friendly step-by-step tutor. Reply with ONLY minified JSON — no prose, no code fence — exactly: {"headline":"one short sentence naming what this is","steps":["step 1","step 2","step 3"]}. Give 3 to 6 short steps, max ~14 words each. If context is thin, still give your best explanation of that kind of graphic.`;
    askStream([{ role: 'user', content: prompt }], {
      onDelta() {},
      onDone(full) { renderBoard(rect, x, y, parseBoardJSON(full)); },
      onError(err) {
        renderBoard(rect, x, y, {
          headline: err === 'no-key' ? 'Add your free Groq key first — click the Cassie toolbar icon.' : 'Couldn’t reach Cassie — please try again.',
          steps: [],
        });
      },
    });
  }

  function parseBoardJSON(text) {
    try { const m = String(text).match(/\{[\s\S]*\}/); if (m) return JSON.parse(m[0]); } catch (e) { /* fall through */ }
    const lines = String(text).split('\n').map((s) => s.replace(/^[-*\d.)\s]+/, '').trim()).filter(Boolean);
    return { headline: lines[0] || 'Here’s how to read this', steps: lines.slice(1, 6) };
  }

  function closeBoard() {
    if (boardCard) boardCard.hidden = true;
    if (annSvg) { annSvg.style.display = 'none'; while (annSvg.firstChild) annSvg.removeChild(annSvg.firstChild); }
    document.removeEventListener('click', outsideBoard, true);
    window.removeEventListener('scroll', closeBoard, true);
  }
  function outsideBoard(e) {
    const path = e.composedPath ? e.composedPath() : [];
    if (path.includes(boardCard)) return;
    closeBoard();
  }

  function boardHead() {
    return '<div class="bc-head"><span class="face"></span><span class="grow">Cassie</span><span class="x" role="button" aria-label="Close">&times;</span></div>';
  }
  function openBoardLoading(rect, x, y) {
    ensureOverlayEls();
    boardCard.hidden = false;
    boardCard.innerHTML = boardHead() + '<div class="bc-body"><p style="opacity:.7;margin:0">Looking at this…</p></div>';
    boardCard.querySelector('.x').addEventListener('click', closeBoard);
    positionBoard(rect);
    drawPointer(x, y);
  }
  function renderBoard(rect, x, y, data) {
    ensureOverlayEls();
    boardCard.hidden = false;
    boardCard.innerHTML = boardHead();
    const bodyEl = document.createElement('div'); bodyEl.className = 'bc-body';
    if (data.headline) { const h = document.createElement('p'); h.className = 'bc-headline'; h.textContent = data.headline; bodyEl.appendChild(h); }
    const ol = document.createElement('ol'); ol.className = 'board-steps';
    const items = (data.steps || []).map((s) => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); return li; });
    bodyEl.appendChild(ol);
    boardCard.appendChild(bodyEl);
    boardCard.querySelector('.x').addEventListener('click', closeBoard);
    positionBoard(rect);
    drawPointer(x, y);
    let k = 0;
    (function step() {
      items.forEach((li, i) => { li.classList.toggle('show', i <= k); li.classList.toggle('active', i === k); li.classList.toggle('done', i < k); });
      k++;
      if (k < items.length) setTimeout(step, 750);
      else setTimeout(() => items.forEach((li) => li.classList.remove('active')), 800);
    })();
    setTimeout(() => { document.addEventListener('click', outsideBoard, true); window.addEventListener('scroll', closeBoard, true); }, 60);
  }

  function positionBoard(rect) {
    const w = 300, margin = 12;
    let left = rect.left + rect.width / 2 - w / 2;
    left = Math.max(margin, Math.min(left, window.innerWidth - w - margin));
    boardCard.style.left = left + 'px';
    const h = boardCard.offsetHeight || 200;
    let top = rect.top - h - 14;
    if (top < margin) top = Math.min(rect.bottom + 14, window.innerHeight - h - margin);
    boardCard.style.top = Math.max(margin, top) + 'px';
  }

  // A curved pink arrow from the board down to the exact spot the student tapped.
  function drawPointer(x, y) {
    while (annSvg.firstChild) annSvg.removeChild(annSvg.firstChild);
    annSvg.style.display = 'block';
    const b = boardCard.getBoundingClientRect();
    const startX = Math.max(b.left + 22, Math.min(x, b.right - 22));
    const below = b.top < y; // board is above the target → start from its bottom
    const startY = below ? b.bottom : b.top;
    const midY = (startY + y) / 2;
    const path = document.createElementNS(SVGNS, 'path');
    path.setAttribute('d', `M ${startX} ${startY} C ${startX} ${midY}, ${x} ${midY}, ${x} ${y - 10}`);
    annSvg.appendChild(path);
    const head = document.createElementNS(SVGNS, 'path');
    head.setAttribute('d', `M ${x} ${y} l -6 -10 M ${x} ${y} l 6 -10`);
    annSvg.appendChild(head);
    const ring = document.createElementNS(SVGNS, 'circle');
    ring.setAttribute('class', 'ann-dot-ring'); ring.setAttribute('cx', x); ring.setAttribute('cy', y); ring.setAttribute('r', 14);
    annSvg.appendChild(ring);
    const dot = document.createElementNS(SVGNS, 'circle');
    dot.setAttribute('class', 'ann-dot'); dot.setAttribute('cx', x); dot.setAttribute('cy', y); dot.setAttribute('r', 5);
    annSvg.appendChild(dot);
  }

  let pendingText = '';
  let pendingRect = null;

  function showChoice(text, rect) {
    pendingText = text;
    pendingRect = rect;
    manualOpen = false; // this HUD tracks a selection
    setEmotion('curious');
    body.classList.remove('muted');
    body.innerHTML = `
      <div class="question">What should I do with this?</div>
      <div class="choice-row">
        <button type="button" class="choice-btn" data-mode="explain">Explain</button>
        <button type="button" class="choice-btn" data-mode="answer">Answer</button>
        <button type="button" class="choice-btn" data-mode="code">Code</button>
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
    let prompt;
    if (mode === 'answer') {
      prompt = `Work out the correct answer to this carefully and double-check it before responding, then give ONLY the final answer — no explanation, no extra words. If it's multiple choice, give the correct option:\n\n"${text}"`;
    } else if (mode === 'code') {
      prompt = `Write clean, well-commented code that correctly solves or implements this. Pick a sensible language if none is stated, put the code in a fenced code block, make sure it actually works, and briefly explain how it works:\n\n"${text}"`;
    } else {
      prompt = `Work through this carefully step by step and double-check your result, then give the answer followed by a clear explanation of why/how:\n\n"${text}"`;
    }
    convo = [{ role: 'user', content: prompt }];
    convoLabel = text;
    runConversation(rect);
  }

  function checkSelection() {
    if (manualOpen) return; // a deliberately-summoned HUD isn't driven by the selection
    const sel = window.getSelection();
    // No selection (e.g. the user clicked elsewhere and it collapsed) — leave the
    // popover exactly as it is. It only closes via × or Escape.
    if (!sel || sel.isCollapsed || sel.rangeCount === 0) return;
    const range = sel.getRangeAt(0);
    if (host.contains(range.commonAncestorContainer)) return; // ignore selecting our own popover text
    const text = selectionText(sel);
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

  // The popover stays open once shown; it only closes when the user clicks the
  // × (below) or presses Escape. Clicking or scrolling elsewhere leaves it up,
  // and highlighting new text replaces it with a fresh one.
  closeBtn.addEventListener('click', dismissPopover);
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
    const text = selectionText(sel);
    if (!text || text.length < 2) return;
    e.preventDefault();
    lastAutoText = text;
    const rect = { left: e.clientX, top: e.clientY, right: e.clientX, bottom: e.clientY, width: 0, height: 0 };
    popover.hidden = false;
    showChoice(text, rect);
  });

})();
