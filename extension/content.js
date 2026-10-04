'use strict';

(() => {
  const HOST_ID = 'cassie-ext-host-92f1';
  if (document.getElementById(HOST_ID)) return; // avoid double injection

  // Don't run on the Cassie web app itself — it already IS Cassie, and our
  // floating buttons would sit on top of its send button and block it.
  if (document.querySelector('meta[name="cassie-app"]') ||
      /(^|\.)askcassie\.pages\.dev$|(^|\.)usernamehaze\.github\.io$/.test(location.hostname)) {
    return;
  }

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
    .body .cassie-board { margin: 8px 0; border: 1px solid rgba(127,127,127,.35); border-radius: 10px; overflow: hidden; }
    .body .cb-head { display: flex; align-items: center; gap: 6px; padding: 6px 10px; font-weight: 700; font-size: 12px; border-bottom: 1px solid rgba(127,127,127,.3); }
    .body .cb-draw { margin-left: auto; background: none; border: 1px solid rgba(127,127,127,.45); color: inherit; border-radius: 999px; padding: 3px 9px; font: 600 11px/1.2 inherit; font-family: inherit; cursor: pointer; }
    .body .cb-draw:hover { background: rgba(127,127,127,.15); }
    .body .cb-body { padding: 8px 10px; }
    .body .cb-title { margin: 0 0 6px; font-weight: 700; font-size: 13px; white-space: normal; }
    .body .cb-note { margin: 6px 0 0; font-size: 12px; opacity: .75; white-space: normal; }
    .body .cb-canvas-wrap canvas { display: block; width: 100%; height: auto; border-radius: 6px; }
    .body .cb-geo { display: flex; flex-direction: column; gap: 6px; }
    .body .cb-geo-svg { width: 100%; max-height: 160px; }
    .body .cb-steps { margin: 0; padding-left: 18px; }
    .body .cb-steps li { opacity: 1; }
    .body .cb-drawing { opacity: .7; font-style: italic; margin: 8px 0; }
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
    /* Side dock: a slim tab on the right edge, out of the way of the page's own
       buttons (send buttons usually live bottom-right). Hover / tap opens it. */
    .dock { position: fixed; right: 0; top: 50%; z-index: 2147483646; display: flex; align-items: center; transform: translateY(-50%); }
    .dock[hidden] { display: none; }
    .dock-handle {
      width: 12px; height: 54px; padding: 0; border: none; border-radius: 10px 0 0 10px;
      background: rgba(28,28,36,.42); cursor: grab; touch-action: none;
      display: flex; align-items: center; justify-content: center; transition: background .15s, width .15s;
    }
    .dock-handle::before { content: ""; width: 3px; height: 22px; border-radius: 2px; background: rgba(255,255,255,.75); }
    .dock-handle:hover { background: rgba(28,28,36,.8); width: 16px; }
    .dock.dragging .dock-handle { cursor: grabbing; background: rgba(28,28,36,.9); }
    .dock-tray {
      display: none; flex-direction: column; align-items: center; gap: 8px; padding: 9px 8px;
      background: rgba(22,22,28,.94); border-radius: 14px 0 0 14px; box-shadow: -4px 6px 22px rgba(0,0,0,.35);
    }
    .dock.open .dock-tray { display: flex; }
    .dock.open .dock-handle { display: none; }
    .fab, .annotate-fab {
      width: 40px; height: 40px; border-radius: 50%; background: #34343e; border: none; cursor: pointer;
      display: flex; align-items: center; justify-content: center; padding: 0; transition: background .15s;
    }
    .fab:hover, .annotate-fab:hover { background: #4a4a56; }
    .fab svg { width: 20px; height: 20px; fill: #fff; }
    .annotate-fab svg { width: 21px; height: 21px; fill: none; stroke: #fff; stroke-width: 2.4; }
    .dock-grip { width: 26px; height: 10px; cursor: grab; touch-action: none; display: flex; align-items: center; justify-content: center; }
    .dock-grip::before { content: ""; width: 18px; height: 3px; border-radius: 2px; background: rgba(255,255,255,.45); }
    .dock-grip:hover::before { background: rgba(255,255,255,.8); }
    .dock-hide { background: none; border: none; color: rgba(255,255,255,.6); font: 600 10px/1.2 system-ui, sans-serif; cursor: pointer; padding: 2px 0 0; text-align: center; }
    .dock-hide:hover { color: #fff; }
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
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    }
    .board-card[hidden] { display: none; }
    .board-card .bc-head {
      display: flex; align-items: center; gap: 8px; padding: 10px 14px;
      border-bottom: 1px solid rgba(255,255,255,.12); font-weight: 700; font-size: 13.5px;
    }
    .board-card .bc-head .grow { flex: 1; }
    .board-card .bc-head .x { cursor: pointer; opacity: .7; font-size: 18px; line-height: 1; }
    .board-card .bc-head .x:hover { opacity: 1; }
    .board-card .bc-body { padding: 12px 14px; max-height: 46vh; overflow-y: auto; font-size: 14px; line-height: 1.5; }
    .board-card .bc-headline { font-weight: 700; margin: 0 0 10px; }
    .board-card .bc-snip { display: block; max-width: 100%; max-height: 120px; margin: 0 auto 10px; border-radius: 8px; border: 1px solid rgba(255,255,255,.18); background: #fff; }
    .board-card .bc-ask { margin-top: 10px; padding-top: 10px; border-top: 1px solid rgba(255,255,255,.12); }
    .board-card .bc-ask p { margin: 0 0 8px; font-weight: 600; }
    .board-card .bc-ask .row { display: flex; gap: 8px; }
    .board-card .bc-ask button { flex: 1; border-radius: 9px; padding: 7px 10px; font: 600 12.5px/1.2 inherit; font-family: inherit; cursor: pointer; border: 1px solid rgba(255,255,255,.3); background: transparent; color: inherit; }
    .board-card .bc-ask button.yes { background: #ececec; color: #1c1a26; border-color: #ececec; }
    .snip-rect { position: fixed; z-index: 2147483645; pointer-events: none; border: 2px solid #fff; border-radius: 4px;
      box-shadow: 0 0 0 100vmax rgba(10,8,16,.42); outline: 1px dashed rgba(0,0,0,.6); outline-offset: -4px; }
    .snip-rect[hidden] { display: none; }
    .pt-backdrop.dragging { background: transparent; backdrop-filter: none; }
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

  // Is this tab showing a file Cassie can read whole? (Chrome's PDF viewer,
  // Google Docs / Slides — pages where highlighting can't reach the text.)
  function fileTab() {
    if (/^image\//.test(document.contentType || '')) {
      const name = decodeURIComponent((location.pathname.split('/').pop() || 'photo').replace(/\?.*$/, '')) || 'photo';
      return { kind: 'image', url: location.href, name, mime: document.contentType, label: 'Explain this photo' };
    }
    const isPdf = document.contentType === 'application/pdf' || !!document.querySelector('embed[type="application/pdf"]');
    if (isPdf) {
      const name = decodeURIComponent((location.pathname.split('/').pop() || 'document.pdf').replace(/\?.*$/, '')) || 'document.pdf';
      return { kind: 'pdf', url: location.href, name: /\.pdf$/i.test(name) ? name : name + '.pdf', mime: 'application/pdf', label: 'Make a reviewer of this whole PDF in Cassie' };
    }
    if (location.hostname === 'docs.google.com') {
      const m = location.pathname.match(/^\/(document|presentation)\/d\/([^/]+)/);
      const title = (document.title || 'Google file').replace(/\s+-\s+Google (Docs|Slides)$/, '').trim() || 'Google file';
      if (m && m[1] === 'document') return { kind: 'gdoc', url: `https://docs.google.com/document/d/${m[2]}/export?format=docx`, name: title + '.docx', mime: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', label: 'Make a reviewer of this document in Cassie' };
      if (m && m[1] === 'presentation') return { kind: 'gslides', url: `https://docs.google.com/presentation/d/${m[2]}/export/pptx`, name: title + '.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', label: 'Make a reviewer of these slides in Cassie' };
    }
    return null;
  }

  // Send the whole file to the Cassie app (opens in a new tab) to make a reviewer.
  async function openFileInCassie(prompt) {
    const f = fileTab();
    if (!f) return 'This tab isn’t a PDF, Google Doc or Slides file.';
    try {
      let buf = null;
      try {
        const res = await fetch(f.url, { credentials: 'include' });
        if (res.ok) buf = await res.arrayBuffer();
      } catch (e) { buf = null; }
      if (!buf) {
        // Cross-site redirect (e.g. Google's download servers): let the background fetch it.
        const r = await chrome.runtime.sendMessage({ type: 'CASSIE_OPEN_IN_APP', name: f.name, mime: f.mime, url: f.url, prompt: prompt || 'Read this whole file and make me a complete reviewer of it.' });
        if (r && r.error) throw new Error(r.error);
        return '';
      }
      if (buf.byteLength > 30 * 1024 * 1024) return 'That file is over 30 MB — download it and attach it in the Cassie app instead.';
      let bin = '';
      const bytes = new Uint8Array(buf);
      for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const r = await chrome.runtime.sendMessage({ type: 'CASSIE_OPEN_IN_APP', name: f.name, mime: f.mime, base64: btoa(bin), prompt: prompt || 'Read this whole file and make me a complete reviewer of it.' });
      if (r && r.error) throw new Error(r.error);
      return '';
    } catch (e) {
      if (location.protocol === 'file:') return 'To read files from your computer, turn on “Allow access to file URLs” for Cassie in chrome://extensions — or attach the file in the Cassie app.';
      return 'I couldn’t download this file from the tab. Download it and attach it with the paperclip in the Cassie app.';
    }
  }

  // Side dock with the "ask about this page" and "snip" buttons — top frame only.
  // It sits as a slim tab on the right edge so it never covers a site's own
  // buttons (like a chat's Send). Hover or tap to open; drag it up or down;
  // "Hide here" turns it off for this site (the toolbar popup can bring it back).
  let fab = null;
  let annotateBtn = null;
  let dock = null;
  let dockBusy = false; // hidden while snipping / sketching
  function setDock(show) { dockBusy = !show; if (dock) dock.hidden = !show || dock.dataset.off === '1'; }
  if (window.top === window) {
    dock = document.createElement('div');
    dock.className = 'dock';
    dock.innerHTML = '<button type="button" class="dock-handle" title="Cassie — hover or tap. Drag to move." aria-label="Open Cassie tools"></button><div class="dock-tray"></div>';
    const handle = dock.querySelector('.dock-handle');
    const tray = dock.querySelector('.dock-tray');

    fab = document.createElement('button');
    fab.className = 'fab';
    fab.type = 'button';
    fab.title = 'Ask Cassie about this page';
    fab.innerHTML = '<svg viewBox="0 0 32 32"><path d="M6 2 L27 15 L17 17 L22 27 L17 29 L12 19 L6 24 Z"/></svg>';
    fab.addEventListener('click', () => { const r = dock.getBoundingClientRect(); closeDock(); showPageAsk({ left: r.left - 8, top: r.top, right: r.left - 8, bottom: r.bottom, width: 0, height: r.height }); });

    // "Snip & explain" — drag a box around a graph/picture/question.
    annotateBtn = document.createElement('button');
    annotateBtn.className = 'annotate-fab';
    annotateBtn.type = 'button';
    annotateBtn.title = 'Snip a graph, picture or question for Cassie to explain';
    annotateBtn.innerHTML = '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="8"/><line x1="12" y1="1" x2="12" y2="5"/><line x1="12" y1="19" x2="12" y2="23"/><line x1="1" y1="12" x2="5" y2="12"/><line x1="19" y1="12" x2="23" y2="12"/></svg>';
    annotateBtn.addEventListener('click', () => { closeDock(); enterPointMode(); });

    const hideBtn = document.createElement('button');
    hideBtn.className = 'dock-hide';
    hideBtn.type = 'button';
    hideBtn.textContent = 'Hide here';
    hideBtn.title = 'Hide these buttons on this site (highlighting still works)';
    // On a PDF / Google Doc / Slides tab: read the WHOLE file in the Cassie app.
    let fileBtn = null;
    if (fileTab()) {
      fileBtn = document.createElement('button');
      fileBtn.className = 'fab';
      fileBtn.type = 'button';
      fileBtn.title = fileTab().label || 'Make a reviewer of this whole file in Cassie';
      fileBtn.innerHTML = '<svg viewBox="0 0 24 24" style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><path d="M6 2h9l5 5v13a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"/><path d="M14 2v6h6"/><path d="M8 13h8M8 17h5"/></svg>';
      fileBtn.addEventListener('click', async () => {
        const ft = fileTab();
        if (ft && ft.kind === 'image' && window.CassieSketch) {
          // A photo opened in its own tab: read it on the board.
          closeDock();
          let url = null;
          const img = document.querySelector('img');
          try { const c = document.createElement('canvas'); c.width = img.naturalWidth; c.height = img.naturalHeight; c.getContext('2d').drawImage(img, 0, 0); url = c.toDataURL('image/jpeg', 0.9); }
          catch (e) { try { const r2 = await chrome.runtime.sendMessage({ type: 'CASSIE_FETCH_IMG', url: ft.url }); url = r2 && r2.dataUrl; } catch (e2) { url = null; } }
          const sess = await openSnipBoard(url, { headline: 'Your photo', steps: [] }, { loading: true });
          if (url) explainPicture(sess, url, 'A photo the student opened in a browser tab: ' + ft.name); else sess.showNote({ reply: 'I couldn’t open this photo. Save it and paste it here with Ctrl+V.' });
          return;
        }
        const r = dock.getBoundingClientRect();
        const at = { left: r.left - 8, top: r.top, right: r.left - 8, bottom: r.bottom, width: 0, height: r.height };
        closeDock();
        manualOpen = true;
        popover.hidden = false;
        setContent('Opening the whole file in Cassie…', { muted: true });
        positionPopover(at);
        const err = await openFileInCassie();
        setContent(err || 'Opened in a new Cassie tab — she’s reading the whole file and writing your reviewer there.', { muted: true });
        positionPopover(at);
      });
    }
    // Open Cassie's board (blank) in the side panel — draw or work things out beside the page.
    const boardBtn = document.createElement('button');
    boardBtn.className = 'fab';
    boardBtn.type = 'button';
    boardBtn.title = 'Open Cassie’s board beside this page';
    boardBtn.innerHTML = '<svg viewBox="0 0 24 24" style="fill:none;stroke:#fff;stroke-width:2;stroke-linecap:round;stroke-linejoin:round"><rect x="3" y="4" width="18" height="13" rx="2"/><path d="M8 21l4-4 4 4"/><path d="M7 13l3-3 2 2 4-4"/></svg>';
    boardBtn.addEventListener('click', () => { closeDock(); if (window.CassieSketch) openSnipBoard(null, { headline: 'Your board', steps: [] }); });
    const grip = document.createElement('div');
    grip.className = 'dock-grip';
    grip.title = 'Drag to move';
    tray.append(grip, ...(fileBtn ? [fileBtn] : []), fab, annotateBtn, boardBtn, hideBtn);
    shadow.appendChild(dock);

    const site = location.hostname || 'local';
    let closeTimer = null;
    function openDock() { clearTimeout(closeTimer); dock.classList.add('open'); }
    function closeDock() { clearTimeout(closeTimer); dock.classList.remove('open'); }
    dock.addEventListener('mouseenter', () => { if (!dragging) openDock(); });
    dock.addEventListener('mouseleave', () => { clearTimeout(closeTimer); closeTimer = setTimeout(closeDock, 450); });
    // tap outside closes it on touch screens
    document.addEventListener('pointerdown', (e) => {
      if (dock.classList.contains('open') && !(e.composedPath && e.composedPath().includes(dock))) closeDock();
    }, true);

    // position (fraction of the window height), remembered per site
    let yFrac = 0.5;
    function placeDock() {
      const h = 54, vh = window.innerHeight;
      const y = Math.min(vh - h / 2 - 8, Math.max(h / 2 + 8, yFrac * vh));
      dock.style.top = y + 'px';
    }
    // If the tab would sit on top of something clickable on the page, slide it to a free spot.
    const CLICKABLE = 'a, button, input, textarea, select, label, [role="button"], [role="link"], [contenteditable=""], [contenteditable="true"]';
    function pointBusy(y) {
      const els = document.elementsFromPoint(window.innerWidth - 6, y) || [];
      return els.some((el) => el !== host && !host.contains(el) && el.closest && el.closest(CLICKABLE));
    }
    // the whole tab (54px tall) plus a little breathing room must be clear
    function spotIsBusy(y) { for (let d = -34; d <= 34; d += 8) if (pointBusy(y + d)) return true; return false; }
    function avoidObstacles() {
      if (dock.hidden || dock.classList.contains('open')) return;
      const vh = window.innerHeight;
      const y0 = dock.getBoundingClientRect().top + 27;
      if (!spotIsBusy(y0)) return;
      for (let step = 1; step < 14; step++) {
        for (const dir of [-1, 1]) {
          const y = y0 + dir * step * 40;
          if (y < 40 || y > vh - 40) continue;
          if (!spotIsBusy(y)) { yFrac = y / vh; placeDock(); return; }
        }
      }
    }
    try {
      chrome.storage.local.get(['cassieDock'], ({ cassieDock }) => {
        const pref = (cassieDock || {})[site] || {};
        if (typeof pref.y === 'number') yFrac = pref.y;
        if (pref.off) { dock.dataset.off = '1'; dock.hidden = true; }
        placeDock();
        setTimeout(avoidObstacles, 800);
      });
    } catch (e) { placeDock(); }
    function savePref(patch) {
      try {
        chrome.storage.local.get(['cassieDock'], ({ cassieDock }) => {
          const all = cassieDock || {};
          all[site] = Object.assign({}, all[site], patch);
          chrome.storage.local.set({ cassieDock: all });
        });
      } catch (e) { /* storage unavailable */ }
    }
    hideBtn.addEventListener('click', () => {
      dock.dataset.off = '1'; dock.hidden = true; closeDock();
      savePref({ off: true });
    });
    try {
      chrome.storage.onChanged.addListener((changes) => {
        if (!changes.cassieDock) return;
        const pref = (changes.cassieDock.newValue || {})[site] || {};
        if (!pref.off && dock.dataset.off === '1') { delete dock.dataset.off; if (!dockBusy) dock.hidden = false; }
      });
    } catch (e) { /* ignore */ }
    window.addEventListener('resize', () => { placeDock(); avoidObstacles(); });
    let lastAvoid = 0;
    window.addEventListener('scroll', () => { const n = Date.now(); if (n - lastAvoid > 600) { lastAvoid = n; setTimeout(avoidObstacles, 250); } }, true);

    // drag the tab up/down the edge; a plain tap opens it
    let dragging = false, dragStart = null;
    function dragDown(e) {
      dragStart = { y: e.clientY, top: dock.getBoundingClientRect().top + dock.getBoundingClientRect().height / 2, target: e.currentTarget };
      dragging = false;
      try { e.currentTarget.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    }
    function dragMove(e) {
      if (!dragStart) return;
      if (!dragging && Math.abs(e.clientY - dragStart.y) > 5) { dragging = true; dock.classList.add('dragging'); }
      if (dragging) { yFrac = (dragStart.top + e.clientY - dragStart.y) / window.innerHeight; placeDock(); }
    }
    function dragUp() {
      if (dragging) { dock.classList.remove('dragging'); savePref({ y: yFrac }); }
      else if (dragStart && dragStart.target === handle) openDock(); // a tap on the tab opens it
      dragging = false; dragStart = null;
    }
    [handle, grip].forEach((el) => {
      el.addEventListener('pointerdown', dragDown);
      el.addEventListener('pointermove', dragMove);
      el.addEventListener('pointerup', dragUp);
      el.addEventListener('pointercancel', dragUp);
    });
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
    const segs = String(text).split('```');
    segs.forEach((seg, i) => {
      if (i % 2 === 1 && /^\s*cassie-board\b/.test(seg)) {
        // Cassie drew a graph — render it as a real chart, not text.
        const closed = i < segs.length - 1;
        let spec = null;
        try { spec = JSON.parse(seg.replace(/^\s*cassie-board\s*/, '').trim()); } catch (e) { spec = null; }
        if (spec && window.CassieBoard) {
          const dark = popover.classList.contains('dark');
          window.CassieBoard.renderInto(body, spec, { width: Math.max(240, Math.min(420, (body.clientWidth || 300) - 24)), colors: dark
            ? { '--surface': '#16171d', '--border': '#30313a', '--muted': '#9a9cab', '--text': '#e9e9ef', '--cb-accent': '#ececf2' }
            : { '--surface': '#ffffff', '--border': '#e6e6ea', '--muted': '#6d6f7c', '--text': '#1c1d2b', '--cb-accent': '#1c1c24' } });
        } else {
          const p = document.createElement('p'); p.className = 'cb-drawing';
          p.textContent = closed ? 'I couldn’t draw that graph — ask me again.' : 'Drawing the graph…';
          body.appendChild(p);
        }
        return;
      }
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
        navigator.clipboard.writeText(String(full).replace(/```cassie-board[\s\S]*?```/g, '').replace(/\n{3,}/g, '\n\n').trim()).then(done, () => {
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
    if (pageText.length < 200 || fileTab()) { askAboutScreen(q, rect); return; }
    const prompt = `Here is the text of the web page the user is currently viewing:\n\n"""\n${pageText}\n"""\n\nUsing that page, answer: ${q}`;
    convo = [{ role: 'user', content: prompt }];
    convoLabel = q;
    runConversation(rect);
  }

  // Pages whose text can't be read from the page itself (Chrome's PDF viewer,
  // Google Docs/Slides canvases, image-only pages): read what's on screen instead.
  async function askAboutScreen(q, rect) {
    setContent('Reading what’s on your screen…', { muted: true });
    positionPopover(rect);
    const myGen = ++gen;
    let image = null, capMsg = '';
    try { image = await captureRegion({ left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }); } catch (e) { image = null; capMsg = errorText(e); }
    if (myGen !== gen) return;
    popover.hidden = false;
    if (!image) { setContent(capMsg || 'I couldn’t read this page. Try reloading the tab.', { muted: true }); positionPopover(rect); return; }
    setEmotion('thinking');
    try {
      const reply = await askVision(image, `This is a screenshot of what a student is looking at (it may be a PDF page, slides, or a document). Read ALL the visible text, figures, tables and diagrams carefully, then answer their request: "${q}". Use short bullets with bold key terms. If it's a question, teach the reasoning step by step. Only use what you can actually see.`, null, 1400);
      if (myGen !== gen) return;
      convo = [{ role: 'user', content: `About the page on my screen: ${q}` }, { role: 'assistant', content: reply }];
      convoLabel = q;
      saveToHistory(q, reply);
      setEmotion('happy');
      const extra = fileTab() ? '\n\n*I can only see the part on your screen. For the whole file, open the right-edge tab and tap the page icon — I’ll read all of it in the Cassie app.*' : '';
      renderAnswerView(reply + extra, rect);
    } catch (e) {
      if (myGen !== gen) return;
      setEmotion('sad');
      const m = errorText(e);
      setContent(m, { muted: true });
      positionPopover(rect);
    }
  }

  // ===== "Explain a graphic": point at something, Cassie draws over it =====
  const SVGNS = 'http://www.w3.org/2000/svg';
  let ptBackdrop = null, ptHint = null, annSvg = null, boardCard = null;

  let snipRect = null, snipStart = null;
  function ensureOverlayEls() {
    if (ptBackdrop) return;
    ptBackdrop = document.createElement('div'); ptBackdrop.className = 'pt-backdrop'; ptBackdrop.hidden = true;
    ptHint = document.createElement('div'); ptHint.className = 'pt-hint'; ptHint.hidden = true;
    ptHint.innerHTML = '<span>Drag to snip a graph, picture or question — or tap one</span><span class="x" role="button" aria-label="Cancel">&times;</span>';
    snipRect = document.createElement('div'); snipRect.className = 'snip-rect'; snipRect.hidden = true;
    annSvg = document.createElementNS(SVGNS, 'svg'); annSvg.setAttribute('class', 'ann-svg'); annSvg.style.display = 'none';
    boardCard = document.createElement('div'); boardCard.className = 'board-card'; boardCard.hidden = true;
    shadow.appendChild(ptBackdrop); shadow.appendChild(snipRect); shadow.appendChild(annSvg); shadow.appendChild(boardCard); shadow.appendChild(ptHint);
    ptBackdrop.addEventListener('pointerdown', onSnipDown);
    ptBackdrop.addEventListener('pointermove', onSnipMove);
    ptBackdrop.addEventListener('pointerup', onSnipUp);
    ptHint.querySelector('.x').addEventListener('click', (e) => { e.stopPropagation(); exitPointMode(); });
  }

  function enterPointMode() {
    ensureOverlayEls();
    hidePopover();
    closeBoard();
    setDock(false);
    ptBackdrop.hidden = false; ptHint.hidden = false;
    document.addEventListener('keydown', escPoint, true);
  }
  function escPoint(e) { if (e.key === 'Escape') exitPointMode(); }
  function exitPointMode() {
    if (ptBackdrop) { ptBackdrop.hidden = true; ptBackdrop.classList.remove('dragging'); }
    if (ptHint) ptHint.hidden = true;
    if (snipRect) snipRect.hidden = true;
    snipStart = null;
    setDock(true);
    document.removeEventListener('keydown', escPoint, true);
  }

  // Drag = snip a rectangle (like a snipping tool). Tap = pick the thing under the finger.
  function onSnipDown(e) {
    e.preventDefault(); e.stopPropagation();
    snipStart = { x: e.clientX, y: e.clientY };
    try { ptBackdrop.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
  }
  function snipBox(e) {
    const x1 = Math.min(snipStart.x, e.clientX), y1 = Math.min(snipStart.y, e.clientY);
    return { left: x1, top: y1, width: Math.abs(e.clientX - snipStart.x), height: Math.abs(e.clientY - snipStart.y) };
  }
  function onSnipMove(e) {
    if (!snipStart) return;
    const r = snipBox(e);
    if (r.width < 6 && r.height < 6) return;
    ptBackdrop.classList.add('dragging');
    ptHint.hidden = true;
    Object.assign(snipRect.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px' });
    snipRect.hidden = false;
  }
  function onSnipUp(e) {
    if (!snipStart) return;
    e.preventDefault(); e.stopPropagation();
    let r = snipBox(e);
    const tap = r.width < 8 && r.height < 8;
    const cx = tap ? e.clientX : r.left + r.width / 2, cy = tap ? e.clientY : r.top + r.height / 2;
    ptBackdrop.style.pointerEvents = 'none';
    const el = document.elementFromPoint(cx, cy);
    ptBackdrop.style.pointerEvents = '';
    exitPointMode();
    if (tap) {
      if (!el || (host && host.contains(el)) || el === document.documentElement) return;
      const b = el.getBoundingClientRect();
      const vw = window.innerWidth, vh = window.innerHeight;
      r = { left: Math.max(0, b.left - 6), top: Math.max(0, b.top - 6) };
      r.width = Math.min(vw, b.right + 6) - r.left; r.height = Math.min(vh, b.bottom + 6) - r.top;
      // a whole-page wrapper isn't what they meant — take the area around the tap instead
      if (r.width * r.height > vw * vh * 0.6 || r.width < 20 || r.height < 20) {
        r = { left: Math.max(0, cx - 230), top: Math.max(0, cy - 160), width: 460, height: 320 };
      }
    }
    snipAndExplain(r, el, cx, cy);
  }

  const loadImg = (src) => new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = () => rej(new Error('picture failed to load')); i.src = src; });
  const nap = (ms) => new Promise((res) => setTimeout(res, ms));

  // Ask the background for a screenshot of the visible tab (our own overlay hidden).
  async function grabScreen(hideHost = true) {
    if (hideHost) host.style.visibility = 'hidden';
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 70))));
    let shot;
    try { shot = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP' }); }
    catch (e) { throw new Error('reload'); }
    finally { host.style.visibility = ''; }
    if (!shot || !shot.dataUrl) throw new Error((shot && shot.error) || 'capture failed');
    return loadImg(shot.dataUrl);
  }

  // Average brightness + spread of a picture (tiny 40x40 sample).
  function lumStats(src) {
    return (typeof src === 'string' ? loadImg(src) : Promise.resolve(src)).then((i) => {
      const c = document.createElement('canvas'); c.width = 40; c.height = 40;
      const x = c.getContext('2d', { willReadFrequently: true }); x.drawImage(i, 0, 0, 40, 40);
      const d = x.getImageData(0, 0, 40, 40).data;
      let sum = 0, sq = 0; const n = d.length / 4;
      for (let k = 0; k < d.length; k += 4) { const l = 0.299 * d[k] + 0.587 * d[k + 1] + 0.114 * d[k + 2]; sum += l; sq += l * l; }
      const mean = sum / n;
      return { mean, std: Math.sqrt(Math.max(0, sq / n - mean * mean)) };
    }).catch(() => ({ mean: 128, std: 50 }));
  }
  const isFlat = (src) => lumStats(src).then((st) => st.std < 2.5);

  // Cut a rectangle (viewport coordinates) out of a screenshot → JPEG data URL.
  function cropFrom(img, r) {
    // Scale each axis on its own (zoom / scrollbars can make them differ) and
    // keep the crop inside the screenshot so no black edges sneak in.
    const kx = img.width / window.innerWidth, ky = img.height / window.innerHeight;
    const sx = Math.max(0, Math.round(r.left * kx)), sy = Math.max(0, Math.round(r.top * ky));
    const sw = Math.min(img.width - sx, Math.max(1, Math.round(r.width * kx)));
    const sh = Math.min(img.height - sy, Math.max(1, Math.round(r.height * ky)));
    if (sw < 4 || sh < 4) throw new Error('That box is outside the visible page.');
    const scale = Math.min(1, 1400 / Math.max(sw, sh));
    const c = document.createElement('canvas');
    c.width = Math.max(1, Math.round(sw * scale)); c.height = Math.max(1, Math.round(sh * scale));
    const cx = c.getContext('2d', { willReadFrequently: true });
    cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(img, sx, sy, sw, sh, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  // Whole-frame JPEG (used when a screen share isn't the tab itself, so we can't crop reliably).
  function wholeToJpeg(img) {
    const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
    const c = document.createElement('canvas'); c.width = Math.round(img.width * scale); c.height = Math.round(img.height * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/jpeg', 0.9);
  }

  // Is there visible text or a picture inside this box on the page itself?
  function boxHasContent(r) {
    const nx = 6, ny = 5;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = r.left + (i + 0.5) / nx * r.width, y = r.top + (j + 0.5) / ny * r.height;
      const el = (document.elementsFromPoint(x, y) || []).find((e) => e !== host && !host.contains(e));
      if (!el || el === document.documentElement || el === document.body) continue;
      if (el.closest('img, svg, canvas, video, picture, math, mjx-container, .katex')) return true;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim().length > 0);
      if (own) return true;
      if (document.caretRangeFromPoint) {
        const cr = document.caretRangeFromPoint(x, y);
        const n = cr && cr.startContainer;
        if (n && n.nodeType === 3 && n.textContent.trim() && !host.contains(n.parentNode)) {
          const rr = document.createRange(); rr.selectNodeContents(n);
          if ([...rr.getClientRects()].some((b) => x >= b.left - 2 && x <= b.right + 2 && y >= b.top - 2 && y <= b.bottom + 2)) return true;
        }
      }
    }
    return false;
  }

  // Plan B when Chrome's quick screenshot is black: ask for a ONE-TIME screen share of this tab
  // (Chrome shows its own "Share this tab" box), take a single frame, stop sharing.
  async function grabViaShare() {
    const md = navigator.mediaDevices;
    if (!md || !md.getDisplayMedia) throw new Error('screen sharing unavailable');
    // Don't wait forever if nobody answers Chrome's "Share this tab" box.
    let waitMs = 30000;
    try { const o = await chrome.storage.local.get(['cassieShareTimeout']); if (o.cassieShareTimeout) waitMs = o.cassieShareTimeout; } catch (e) { /* ignore */ }
    let timedOut = false, timer;
    const pending = md.getDisplayMedia({ video: true, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include', surfaceSwitching: 'exclude' });
    pending.then((late) => { if (timedOut) late.getTracks().forEach((t) => t.stop()); }, () => {});
    const stream = await Promise.race([pending, new Promise((_, rej) => { timer = setTimeout(() => { timedOut = true; rej(new Error('no answer')); }, waitMs); })]);
    clearTimeout(timer);
    try {
      host.style.visibility = 'hidden';
      const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream;
      await v.play();
      await nap(450); // let a real frame arrive and our overlay disappear from it
      const w = v.videoWidth, h = v.videoHeight;
      if (!w || !h) throw new Error('no frame');
      const c = document.createElement('canvas'); c.width = w; c.height = h;
      c.getContext('2d').drawImage(v, 0, 0, w, h);
      const img = await loadImg(c.toDataURL('image/png'));
      // Is this frame the tab itself? (same shape as the viewport) — otherwise it's a window/screen.
      const same = Math.abs(w / h - window.innerWidth / window.innerHeight) / (window.innerWidth / window.innerHeight) < 0.06;
      return { img, whole: !same };
    } finally {
      host.style.visibility = '';
      stream.getTracks().forEach((t) => t.stop());
    }
  }

  // Screenshot + crop with sanity checks. On some machines Chrome hands extensions a black
  // screenshot (whole picture, or at least the part we cut out). We notice, retry, then fall
  // back to a one-time screen share. status: 'ok' | 'empty' (the box is genuinely blank) | 'broken'.
  const CAP = { tabBroken: false, shareBroken: false }; // what doesn't work on this machine (this page)
  const waitFrames = () => new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(res, 70))));

  // Plan B: draw the box straight from the page (html2canvas) — no screenshot involved, so it
  // works even where Chrome's screenshots come back blank. Cross-origin pictures in the box are
  // downloaded by the extension and swapped in so they show up too.
  async function renderRegion(r) {
    if (!window.html2canvas) {
      let res; try { res = await chrome.runtime.sendMessage({ type: 'CASSIE_H2C' }); } catch (e) { throw new Error('reload'); }
      if (!window.html2canvas) throw new Error((res && res.error) || 'renderer unavailable');
    }
    const box = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
    const hits = (el) => { const b = el.getBoundingClientRect(); return b.width > 4 && b.height > 4 && b.right > box.left && b.left < box.right && b.bottom > box.top && b.top < box.bottom; };
    const imgs = [...document.images]; const swap = new Map();
    for (let i = 0; i < imgs.length && swap.size < 12; i++) {
      const im = imgs[i], src = im.currentSrc || im.src;
      if (!src || src.startsWith('data:') || !hits(im)) continue;
      try { if (new URL(src, location.href).origin === location.origin) continue; } catch (e) { continue; }
      try { const res = await chrome.runtime.sendMessage({ type: 'CASSIE_FETCH_IMG', url: src }); if (res && res.dataUrl) swap.set(i, res.dataUrl); } catch (e) { /* ignore */ }
    }
    const pick = (el) => { const c = el && getComputedStyle(el).backgroundColor; return c && !/rgba\(0, 0, 0, 0\)|transparent/.test(c) ? c : null; };
    const bg = pick(document.body) || pick(document.documentElement) || '#ffffff';
    const canvas = await window.html2canvas(document.documentElement, {
      x: window.scrollX + r.left, y: window.scrollY + r.top, width: Math.round(r.width), height: Math.round(r.height),
      windowWidth: document.documentElement.clientWidth, windowHeight: window.innerHeight,
      scale: Math.min(2, window.devicePixelRatio || 1), useCORS: true, logging: false, backgroundColor: bg, imageTimeout: 6000,
      ignoreElements: (el) => el === host,
      onclone: (doc) => { const ci = doc.images; swap.forEach((url, i) => { if (ci[i]) { ci[i].removeAttribute('srcset'); ci[i].src = url; } }); },
    });
    const k = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
    const out = document.createElement('canvas'); out.width = Math.max(1, Math.round(canvas.width * k)); out.height = Math.max(1, Math.round(canvas.height * k));
    const ox = out.getContext('2d', { willReadFrequently: true }); ox.fillStyle = bg; ox.fillRect(0, 0, out.width, out.height); ox.drawImage(canvas, 0, 0, out.width, out.height);
    return out.toDataURL('image/jpeg', 0.92);
  }

  // Get a real picture of the snipped box, trying several independent ways. Some machines hand
  // extensions a blank screenshot (black, or just the page background), so every result is checked.
  // status: 'ok' | 'empty' (the box is genuinely blank) | 'broken' (no usable picture).
  async function captureSnip(r, hooks = {}) {
    const diag = [];
    // 1) Chrome's quick screenshot, cropped in the extension's background.
    if (!CAP.tabBroken) {
      let out = null;
      host.style.visibility = 'hidden';
      await waitFrames();
      try { out = await chrome.runtime.sendMessage({ type: 'CASSIE_SNIP', rect: { left: r.left, top: r.top, width: r.width, height: r.height }, vw: window.innerWidth, vh: window.innerHeight }); }
      catch (e) { host.style.visibility = ''; throw new Error('reload'); }
      host.style.visibility = '';
      if (out && out.dataUrl && out.full) {
        const flatAll = out.full.std < 4;
        diag.push(`tab ${out.w}x${out.h}${flatAll ? ` flat(${Math.round(out.full.mean)})` : ''}`);
        if (!flatAll) {
          if (out.crop.std >= 2.5) return { image: out.dataUrl, status: 'ok', diag };
          if (!boxHasContent(r)) return { image: out.dataUrl, status: 'empty', diag };
          diag.push(`box blank(${Math.round(out.crop.mean)}) but page has content`);
        }
      } else diag.push('tab: ' + ((out && out.error) || 'no picture'));
      CAP.tabBroken = true;
    } else diag.push('tab skipped');
    // 2) Draw the box from the page itself.
    try {
      const img = await renderRegion(r);
      const st = await lumStats(img);
      diag.push(`render${st.std < 2.5 ? ' blank' : ''}`);
      if (st.std >= 2.5) return { image: img, status: 'ok', diag };
      if (!boxHasContent(r)) return { image: img, status: 'empty', diag };
    } catch (e) { if (e.message === 'reload') throw e; diag.push('render: ' + (e.message || 'error').slice(0, 60)); }
    // 3) One-time screen share of this tab.
    if (hooks.onNeedShare && !CAP.shareBroken) {
      try {
        hooks.onNeedShare();
        const { img, whole } = await grabViaShare();
        hooks.onShareDone && hooks.onShareDone();
        const st = await lumStats(img);
        diag.push(`share${st.std < 4 ? ' flat' : ''}`);
        if (st.std >= 4) {
          const image = whole ? wholeToJpeg(img) : cropFrom(img, r);
          if ((await lumStats(image)).std >= 2.5) return { image, status: 'ok', diag };
        }
        CAP.shareBroken = true;
      } catch (e) {
        hooks.onShareDone && hooks.onShareDone(); diag.push('share: ' + (e.name || e.message || 'cancelled'));
        if (e.name === 'NotSupportedError' || e.name === 'NotAllowedError' || /unavailable/.test(e.message || '')) CAP.shareBroken = true;
      }
    }
    return { image: null, status: 'broken', diag };
  }

  // Back-compat: just the picture (throws if Chrome gave nothing usable).
  async function captureRegion(r) {
    const c = await captureSnip(r);
    if (c.status === 'broken') throw new Error(BLANK_SHOT_MSG);
    return c.image;
  }
  const BLANK_SHOT_MSG = 'Chrome gave Cassie a blank (black) screenshot of this tab, so I can’t see the page. Tip: press Win+Shift+S (Cmd+Shift+4 on Mac) to snip, then open Cassie’s board and press Ctrl+V — I’ll read it.';

  // When the screenshot is unusable: read what's inside the box straight from the page —
  // the text, plus any SVG / canvas / image there (graphs are often SVG or canvas).
  async function domRegion(r) {
    const els = [];
    const nx = 8, ny = 6;
    for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
      const x = r.left + (i + 0.5) / nx * r.width, y = r.top + (j + 0.5) / ny * r.height;
      const el = (document.elementsFromPoint(x, y) || []).find((e) => e !== host && !host.contains(e) && e !== document.documentElement && e !== document.body);
      let n = el, hops = 0;
      while (n && n !== document.body && hops++ < 6) {
        const t = (n.innerText || '').replace(/\s+/g, ' ').trim();
        if (t.length >= 8 && t.length <= 800) { if (!els.includes(n)) els.push(n); break; }
        n = n.parentElement;
      }
    }
    const inBox = (e) => { const b = e.getBoundingClientRect(); const w = Math.min(b.right, r.left + r.width) - Math.max(b.left, r.left), h = Math.min(b.bottom, r.top + r.height) - Math.max(b.top, r.top); return b.width >= 40 && b.height >= 40 && w > 0 && h > 0 && (w * h) / (b.width * b.height) > 0.3; };
    els.sort((a, b) => { const p = a.getBoundingClientRect(), q = b.getBoundingClientRect(); return (p.top - q.top) || (p.left - q.left); });
    let texts = els.map((e) => e.innerText.replace(/\s+/g, ' ').trim());
    texts = texts.filter((t, i) => !texts.some((u, j) => j !== i && u.length > t.length && u.includes(t)));
    const alts = [...document.querySelectorAll('img[alt], [aria-label]')].filter((e) => !host.contains(e) && inBox(e)).map((e) => (e.getAttribute('alt') || e.getAttribute('aria-label') || '').trim()).filter((t) => t.length > 3);
    if (alts.length) texts.push('Picture labels: ' + [...new Set(alts)].slice(0, 6).join(' | '));
    const text = [...new Set(texts)].join('\n').slice(0, 3500);

    const pics = [];
    for (const e of document.querySelectorAll('svg, canvas, img')) {
      if (pics.length >= 2 || host.contains(e) || !inBox(e)) continue;
      try {
        const b = e.getBoundingClientRect();
        const c = document.createElement('canvas'); const k = Math.min(1, 1200 / Math.max(b.width, b.height));
        c.width = Math.round(b.width * k); c.height = Math.round(b.height * k);
        const cx = c.getContext('2d'); cx.fillStyle = '#fff'; cx.fillRect(0, 0, c.width, c.height);
        if (e.tagName === 'svg') {
          const clone = e.cloneNode(true); clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg'); clone.setAttribute('width', b.width); clone.setAttribute('height', b.height);
          const im = await loadImg('data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(clone)));
          cx.drawImage(im, 0, 0, c.width, c.height);
        } else cx.drawImage(e, 0, 0, c.width, c.height);
        const url = c.toDataURL('image/png'); // throws if the picture is cross-origin (tainted)
        if (!(await isFlat(url))) pics.push(url);
      } catch (err) {
        // A cross-origin <img> taints the canvas — have the extension download it instead.
        if (e.tagName === 'IMG' && (e.currentSrc || e.src)) {
          try {
            const r2 = await chrome.runtime.sendMessage({ type: 'CASSIE_FETCH_IMG', url: e.currentSrc || e.src });
            if (r2 && r2.dataUrl) pics.push(r2.dataUrl);
          } catch (e2) { /* ignore */ }
        }
      }
    }
    return { text, pics };
  }

  // Turn any failure code/message into a sentence a student can act on.
  function errorText(err) {
    const m = String((err && err.message) || err || '');
    if (m === 'no-key') return 'Add your free Groq key first — click the Cassie icon in the toolbar.';
    if (m === 'no-vision') return 'Your Groq key has no picture-reading model right now. Add a free Google (Gemini) key in the Cassie toolbar popup and I can read snips.';
    if (m === 'reload' || /context invalidated|receiving end does not exist|Could not establish connection/i.test(m)) return 'Cassie was just updated — refresh this tab (F5) and try again.';
    return m || 'Something went wrong — please try again.';
  }

  async function askVision(image, prompt, system, maxTokens) {
    let r;
    try { r = await chrome.runtime.sendMessage({ type: 'CASSIE_VISION', image, prompt, system, maxTokens }); }
    catch (e) { throw new Error('reload'); }
    if (!r || r.error) throw new Error((r && r.error) || 'Cassie didn’t answer — please try again.');
    return r.reply;
  }

  const SNIP_PROMPT = (ctx) => `A student snipped this part of a webpage to study it (a graph, diagram, picture, equation, or question). Page context:\n"""\n${ctx}\n"""\n\nLook at the picture carefully and teach it like a friendly step-by-step tutor: what it shows, how to read it, and the reasoning behind it. If it is a question, work it out step by step and give the answer. Reply with ONLY minified JSON — no prose, no code fence — exactly: {"headline":"one short sentence naming what this is","steps":["step 1","step 2","step 3"]}. Give 3 to 6 short steps, max ~20 words each. Read every label and number you can see; don't invent ones you can't.`;

  // Explain a picture (a snip, or one pasted/dropped on the board) into the side board.
  async function explainPicture(sess, image, ctx = '') {
    const say = (n) => sess && sess.showNote(n);
    say({ reply: 'Cassie is reading your picture…' });
    try {
      const data = parseBoardJSON(await askVision(image, SNIP_PROMPT(ctx || (document.title ? 'Page: ' + document.title : '')), null, 800));
      if (sess) { sess.setTitle(data.headline || 'Your snip'); sess.showNote({ headline: data.headline, steps: data.steps }); }
    } catch (e) {
      const text = ctx && ctx.length > 40 ? ctx : '';
      if (text && (e.message === 'no-vision' || /unavailable|empty/i.test(e.message))) explainFromText(sess, text, 'To read the picture itself, add a free Google (Gemini) key in the Cassie toolbar popup.');
      else say({ reply: errorText(e) });
    }
  }
  function explainFromText(sess, text, footer = '', header = '') {
    const say = (n) => sess && sess.showNote(n);
    say({ reply: (header ? header + '\n\n' : '') + 'Reading the text in your box…' });
    askStream([{ role: 'user', content: `A student is on a webpage and snipped part of it. Here is the text in that part:\n"""\n${text}\n"""\nExplain what it is about and how to work through it, step by step, in under 150 words. If it is a question, give the answer with the reasoning.` }], {
      onDelta() {},
      onDone(full) { say({ reply: [header, full, footer].filter(Boolean).join('\n\n') }); },
      onError(err) { say({ reply: errorText(err) }); },
    });
  }

  async function snipAndExplain(r, el, x, y) {
    const rect = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height };
    let cap = { image: null, status: 'broken', diag: [] }, capErr = '';
    const at = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height, width: r.width, height: r.height };
    try {
      cap = await captureSnip(r, {
        onNeedShare: () => { manualOpen = true; popover.hidden = false; setContent('Chrome blocked Cassie’s quick screenshot. In the box Chrome shows next, choose “This tab” and press Share — I take one picture and stop sharing.', { muted: true }); positionPopover(at); },
        onShareDone: () => { hidePopover(); },
      });
    } catch (e) { capErr = errorText(e); }
    const ctx = el && !(host && host.contains(el)) ? gatherContext(el) : (document.title ? 'Page: ' + document.title : '');
    if (!window.CassieSketch) { explainTarget(el, x, y, rect, cap.image); return; }

    // Nothing usable from the screenshot → read the box straight from the page instead.
    if (cap.status === 'broken' || !cap.image) {
      const dom = await domRegion(r);
      const sess = await openSnipBoard(dom.pics[0] || null, { headline: 'Your snip', steps: [] }, { loading: true });
      const why = capErr ? `I couldn’t capture the screen (${capErr}).` : 'Chrome gave me a blank screenshot of this tab.';
      const tip = 'Tip: press Win+Shift+S (Cmd+Shift+4 on Mac), snip, then click here and press Ctrl+V — I’ll read your screenshot.';
      const diag = cap.diag.length ? `(capture: ${cap.diag.join(', ')})` : '';
      if (dom.pics[0]) { sess.showNote({ reply: `${why} I found a picture in your box and I’m reading that instead…` }); explainPicture(sess, dom.pics[0], dom.text); }
      else if (dom.text.length >= 25) explainFromText(sess, dom.text, `${tip}\n${diag}`.trim(), `${why} I read the text in your box instead.`);
      else sess.showNote({ reply: `${why} I also couldn’t find readable text in that box.\n\n${tip}\n${diag}`.trim() });
      return;
    }
    if (cap.status === 'empty') {
      const sess = await openSnipBoard(null, { headline: 'Your board', steps: [] }, { loading: true });
      sess.showNote({ reply: `That box looks empty. Close this and drag a box around the question, graph or picture you want me to read — or press Ctrl+V to paste a screenshot here.\n(capture: ${cap.diag.join(', ')})` });
      return;
    }
    // The snip and Cassie's explanation open TOGETHER in the side board.
    const sess = await openSnipBoard(cap.image, { headline: 'Your snip', steps: [] }, { loading: true });
    explainPicture(sess, cap.image, ctx);
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

  function explainTarget(el, x, y, rect, image) {
    rect = rect || el.getBoundingClientRect();
    const ctx = el ? gatherContext(el) : (document.title || '');
    if (!image) openBoardLoading(rect, x, y, null);
    const prompt = `A student is viewing a webpage and pointed at one specific graphic on it (a graph, diagram, shape, equation, or illustration). Surrounding context:\n\n"""\n${ctx}\n"""\n\nExplain what this graphic shows and how to read it, like a friendly step-by-step tutor. Reply with ONLY minified JSON — no prose, no code fence — exactly: {"headline":"one short sentence naming what this is","steps":["step 1","step 2","step 3"]}. Give 3 to 6 short steps, max ~14 words each. If context is thin, still give your best explanation of that kind of graphic.`;
    askStream([{ role: 'user', content: prompt }], {
      onDelta() {},
      onDone(full) { renderBoard(rect, x, y, parseBoardJSON(full), image); },
      onError(err) {
        renderBoard(rect, x, y, { headline: errorText(err), steps: [] }, image);
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
    return '<div class="bc-head"><span class="grow">Cassie</span><span class="x" role="button" aria-label="Close">&times;</span></div>';
  }
  function snipThumb(image) {
    if (!image) return null;
    const im = document.createElement('img'); im.className = 'bc-snip'; im.alt = 'Your snip'; im.src = image;
    return im;
  }
  function openBoardLoading(rect, x, y, image) {
    ensureOverlayEls();
    boardCard.hidden = false;
    boardCard.innerHTML = boardHead() + '<div class="bc-body"><p style="opacity:.7;margin:0">Looking at this…</p></div>';
    const th = snipThumb(image);
    if (th) boardCard.querySelector('.bc-body').prepend(th);
    boardCard.querySelector('.x').addEventListener('click', closeBoard);
    positionBoard(rect);
    drawPointer(x, y);
  }
  function renderBoard(rect, x, y, data, image) {
    ensureOverlayEls();
    boardCard.hidden = false;
    boardCard.innerHTML = boardHead();
    const bodyEl = document.createElement('div'); bodyEl.className = 'bc-body';
    const th = snipThumb(image);
    if (th) bodyEl.appendChild(th);
    if (data.headline) { const h = document.createElement('p'); h.className = 'bc-headline'; h.textContent = data.headline; bodyEl.appendChild(h); }
    const ol = document.createElement('ol'); ol.className = 'board-steps';
    const items = (data.steps || []).map((s) => { const li = document.createElement('li'); li.textContent = s; ol.appendChild(li); return li; });
    bodyEl.appendChild(ol);
    // Cassie asks: put it on the board so you can write / sketch on it?
    if (window.CassieSketch && (data.steps || []).length) {
      const ask = document.createElement('div'); ask.className = 'bc-ask';
      ask.innerHTML = '<p>Want to put this on my board so you can write or sketch on it?</p><div class="row"><button type="button" class="yes">Open board</button><button type="button" class="no">No thanks</button></div>';
      ask.querySelector('.yes').addEventListener('click', (e) => { e.stopPropagation(); openSnipBoard(image, data); });
      ask.querySelector('.no').addEventListener('click', (e) => { e.stopPropagation(); ask.remove(); });
      bodyEl.appendChild(ask);
    }
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

  // "Draw on this" under a graph Cassie drew in the popover.
  if (window.CassieBoard) {
    window.CassieBoard.onDraw = (boardEl, spec) => {
      const canvas = boardEl.querySelector('canvas');
      let image = null;
      if (canvas) image = canvas.toDataURL('image/png');
      else {
        const svgEl = boardEl.querySelector('svg');
        if (svgEl) image = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(new XMLSerializer().serializeToString(svgEl));
      }
      openSnipBoard(image, { headline: spec.title || 'Your board', steps: [] });
    };
  }

  // The student's own board, docked beside the page so there's no tab switching.
  function openSnipBoard(image, data, opts = {}) {
    closeBoard();
    setDock(false);
    const topic = () => (data && data.headline && data.headline !== 'Your snip' ? `Topic: ${data.headline}. ` : '');
    let sess = null;
    const opened = window.CassieSketch.open({
      root: shadow,
      onImage: (url) => { if (url) explainPicture(sess, url, ''); },
      image: image || null,
      dark: image ? false : undefined,
      dock: 'side',
      allowDock: true,
      title: opts.loading ? 'Your snip' : (data && data.headline ? data.headline : 'Your board'),
      note: !opts.loading && data && (data.steps || []).length ? { headline: data.headline, steps: data.steps } : null,
      checkLabel: 'Check my work',
      extra: [{ label: 'New snip', title: 'Snip something else from the page', onClick: () => { const cur = window.CassieSketch; cur.close(); setTimeout(enterPointMode, 50); } }],
      onAsk: async (png, q) => {
        try {
          return await askVision(png, `This is a student's board: ${image ? 'a snip from their lesson, possibly with their own writing and sketches on top' : 'their own sketch / working'}. ${topic()}Their question: "${q}". Answer it clearly and kindly like a tutor, in under 150 words, plain text. If they ask you to check their work, say what is right, what is wrong and why, and give a hint for the next step.`, null, 600);
        } catch (e) { return errorText(e); }
      },
      askPlaceholder: 'Ask Cassie about this snip…',
      onCheck: async (png) => {
        try {
          return await askVision(png, `This is a student's board: ${image ? 'a snip from their lesson with their own writing and sketches on top' : 'their own sketch / working'}. ${topic()}Check their work like a kind but honest tutor: say what is right, point out any mistake and why, and give a hint for the next step. Keep it short (under 120 words), plain text.`, null, 500);
        } catch (e) { return errorText(e); }
      },
      onClose: () => setDock(true),
    });
    opened.then((x) => { sess = x; });
    return opened;
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
