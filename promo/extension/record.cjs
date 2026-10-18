// Records "Cassie for Chrome: how it works", the video the app shows after its tour (on computers).
// The real extension runs on a study page (promo/extension/page.html), with the AI faked so the answers
// are always the same. Captions and a mouse pointer are drawn on the page for the recording only.
//   node promo/extension/record.cjs   →   landing/extension-how.webm, .mp4 (for Safari) and .jpg
// (needs the tests' Playwright: cd tests && npm install; and ffmpeg: imageio_ffmpeg's, or one on PATH)
const path = require('path'), fs = require('fs'), os = require('os'), http = require('http'), { execFileSync } = require('child_process');
const ROOT = path.resolve(__dirname, '../..');
const { chromium } = require(path.join(ROOT, 'tests/node_modules/playwright'));
const OUT = path.join(ROOT, 'landing/extension-how.mp4'), WEBM = path.join(ROOT, 'landing/extension-how.webm'), POSTER = path.join(ROOT, 'landing/extension-how.jpg');
const FFMPEG = (() => {
  try { return execFileSync('python3', ['-c', 'import imageio_ffmpeg; print(imageio_ffmpeg.get_ffmpeg_exe())']).toString().trim(); } catch (e) { return 'ffmpeg'; }
})();

// the page, served from this folder
const server = http.createServer((q, r) => { const f = path.join(__dirname, path.basename(q.url.split('?')[0]) || 'page.html'); fs.readFile(f, (e, d) => { r.writeHead(e ? 404 : 200, { 'content-type': 'text/html' }); r.end(e ? '' : d); }); });

// drawn on the page for the video: a caption at the top, a title card, and the mouse pointer
const OVERLAY = () => {
  const css = document.createElement('style');
  css.textContent = `
    #v-cap { position: fixed; z-index: 2147483647; left: 50%; top: 18px; transform: translateX(-50%); max-width: 860px; padding: 12px 22px; border-radius: 14px; background: rgba(14,14,16,.92); color: #fff; font: 600 22px/1.35 system-ui, -apple-system, sans-serif; text-align: center; opacity: 0; transition: opacity .35s; pointer-events: none; }
    #v-card { position: fixed; inset: 0; z-index: 2147483647; display: flex; flex-direction: column; align-items: center; justify-content: center; gap: 10px; background: #0e0e10; color: #fff; font-family: system-ui, -apple-system, sans-serif; text-align: center; transition: opacity .5s; pointer-events: none; }
    #v-card b { font-size: 48px; } #v-card span { font-size: 24px; color: #c9c9d2; }
    #v-ptr { position: fixed; z-index: 2147483647; left: 0; top: 0; width: 22px; height: 22px; pointer-events: none; transform: translate(-50px, -50px); }`;
  document.documentElement.appendChild(css);
  const ptr = document.createElement('div'); ptr.id = 'v-ptr';
  ptr.innerHTML = '<svg viewBox="0 0 32 32" width="22" height="22"><path d="M6 2 L27 15 L17 17 L22 27 L17 29 L12 19 L6 24 Z" fill="#111" stroke="#fff" stroke-width="2" stroke-linejoin="round"/></svg>';
  document.documentElement.appendChild(ptr);
  addEventListener('mousemove', (e) => { ptr.style.transform = `translate(${e.clientX - 3}px, ${e.clientY - 2}px)`; }, true);
  const cap = document.createElement('div'); cap.id = 'v-cap'; document.documentElement.appendChild(cap);
  window.__cap = (t) => { cap.style.opacity = t ? '1' : '0'; if (t) cap.textContent = t; };
  window.__card = (big, small) => {
    let c = document.getElementById('v-card');
    if (!big) { if (c) { c.style.opacity = '0'; setTimeout(() => c.remove(), 600); } return; }
    if (!c) { c = document.createElement('div'); c.id = 'v-card'; document.documentElement.appendChild(c); }
    c.style.opacity = '1'; c.innerHTML = '<b></b><span></span>'; c.querySelector('b').textContent = big; c.querySelector('span').textContent = small;
  };
};

(async () => {
  await new Promise((ok) => server.listen(4699, ok));
  const ext = path.join(ROOT, 'extension'), profile = fs.mkdtempSync(path.join(os.tmpdir(), 'cassie-video-')), vids = fs.mkdtempSync(path.join(os.tmpdir(), 'cassie-video-out-'));
  const exe = fs.existsSync('/opt/pw-browsers/chromium') ? { executablePath: '/opt/pw-browsers/chromium' } : { channel: 'chromium' };
  const ctx = await chromium.launchPersistentContext(profile, { headless: true, ...exe, viewport: { width: 1280, height: 720 },
    args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`] });
    try {
    let sw = null;
    for (let i = 0; i < 80 && !sw; i++) { for (const w of ctx.serviceWorkers()) if (/\/background\.js$/.test(w.url()) && await w.evaluate(() => typeof readPicture === 'function').catch(() => false)) { sw = w; break; } if (!sw) await new Promise((r) => setTimeout(r, 250)); }
    if (!sw) throw new Error('the extension did not start');
    // the AI, faked: an explanation that streams in, and a three step lesson on this page
    await sw.evaluate(() => {
      self.answerAny = async (input, keys, onDelta) => {
        const text = 'Glucose is the sugar the plant makes. It stores the energy from sunlight, and the plant uses it to grow and to live.';
        for (const w of text.match(/\S+\s*/g)) { if (onDelta) onDelta(w); await new Promise((r) => setTimeout(r, 70)); }
        return text;
      };
      self.speakLeft = async () => ({ on: false, left: 0 });
      self.readPicture = async (keys, msg) => {
        const p = String(msg.prompt || ''), num = (what) => { const m = p.match(new RegExp('^(\\d+)\\. ' + what, 'm')); return m ? +m[1] : 0; };
        const h = num('heading "Photosynthesis"'), stages = num('heading "The two stages"'), t = num('table heading "Stage"');
        return JSON.stringify({ steps: [
          { say: 'This page is about photosynthesis: how plants make their own food from light.', point: h, draw: [{ shape: 'circle', el: h }] },
          { say: 'There are two stages. This table shows where each one happens.', point: t, draw: [{ shape: 'box', el: t }, { shape: 'arrow', to_el: t }] },
          { say: 'First the light reactions, then the Calvin cycle makes the glucose.', point: stages, draw: [{ shape: 'underline', el: stages }] },
        ] });
      };
      return chrome.storage.local.set({ teachVoice: 'off', teachAuto: 'off' });
    });
    const page = ctx.pages()[0] || await ctx.newPage();
    await ctx.addInitScript(OVERLAY);
    await page.goto('http://localhost:4699/page.html');
    if (!(await page.evaluate(() => typeof window.__card === 'function'))) await page.evaluate(OVERLAY); // (a page that loaded before the script was added)
    await page.waitForTimeout(600);
    // the video is made of screenshots, each kept on screen until the next one (headless Chrome's own
    // video recording leaves parts of the frame unpainted)
    const frames = []; let rolling = true;
    const shooting = (async () => {
      while (rolling) {
        try { frames.push({ t: Date.now(), buf: await page.screenshot({ type: 'jpeg', quality: 90 }) }); } catch (e) { await new Promise((r) => setTimeout(r, 30)); }
      }
    })();
    const say = (t) => page.evaluate((x) => window.__cap(x), t);
    const wait = (ms) => page.waitForTimeout(ms);
    const glide = async (x, y, steps = 25) => page.mouse.move(x, y, { steps });
    await page.evaluate(() => window.__card('Cassie for Chrome', 'How it works, in under a minute'));
    await page.mouse.move(640, 600);
    await wait(2600);
    await page.evaluate(() => window.__card(null));
    await wait(500);
    // 1. she waits on the side of every page
    await say('Cassie waits on the side of every page you read.');
    const handle = await page.locator('.dock-handle').boundingBox();
    await glide(handle.x + handle.width / 2, handle.y + handle.height / 2, 30);
    await wait(2600);
    await glide(600, 420, 20);
    await wait(500);
    // 2. highlight words: she explains them
    await say('Highlight any words, and she explains them right there.');
    const pick = await page.evaluate(() => { const r = document.getElementById('pick').getBoundingClientRect(); return [r.left, r.top + r.height / 2, r.right]; });
    await glide(pick[0] + 2, pick[1], 25); await wait(300);
    await page.mouse.down(); await page.mouse.move(pick[2] - 2, pick[1], { steps: 30 }); await page.mouse.up();
    await page.waitForSelector('#cassie-ext-host-92f1 >> .choice-btn[data-mode="explain"]', { timeout: 5000 }).catch(() => {});
    await wait(900);
    const ex = await page.locator('.choice-btn[data-mode="explain"]').boundingBox();
    await glide(ex.x + ex.width / 2, ex.y + ex.height / 2, 20); await wait(300);
    await page.mouse.click(ex.x + ex.width / 2, ex.y + ex.height / 2);
    await wait(4200);
    await page.keyboard.press('Escape');
    await page.evaluate(() => getSelection().removeAllRanges());
    await wait(400);
    // 3. Teach me this page: she points and draws, step by step
    await say('Tap Teach me, and she teaches the page step by step, pointing and drawing.');
    await glide(handle.x + handle.width / 2, handle.y + handle.height / 2, 30);
    await page.waitForSelector('.dock.open .fab-teach', { timeout: 5000 });
    const tb = await page.locator('.fab-teach').boundingBox();
    await glide(tb.x + tb.width / 2, tb.y + tb.height / 2, 12); await wait(300);
    await page.mouse.click(tb.x + tb.width / 2, tb.y + tb.height / 2);
    await page.waitForSelector('#cassie-teach-host-92f1', { state: 'attached', timeout: 15000 });
    await wait(3800);
    for (let k = 0; k < 2; k++) {
      const nx = await page.locator('#cassie-teach-host-92f1 .ct-next').boundingBox();
      await glide(nx.x + nx.width / 2, nx.y + nx.height / 2, 18); await wait(250);
      await page.mouse.click(nx.x + nx.width / 2, nx.y + nx.height / 2);
      await wait(3800);
    }
    // 4. closed: the lesson is kept in the side panel
    await say('Close it when you are done. Every lesson is saved in the Cassie side panel.');
    const x = await page.locator('#cassie-teach-host-92f1 .ct-x').boundingBox();
    await glide(x.x + x.width / 2, x.y + x.height / 2, 18); await wait(300);
    await page.mouse.click(x.x + x.width / 2, x.y + x.height / 2);
    await wait(2800);
    // 5. her cursor beside your mouse
    await say('And her little cursor stays beside your mouse, ready when you need her.');
    for (const [px, py] of [[420, 300], [760, 360], [520, 520], [880, 260]]) await glide(px, py, 35);
    await wait(800);
    await say('');
    await page.evaluate(() => window.__card('Get Cassie for Chrome', 'Free, for Chrome and Edge on a computer'));
    await wait(3000);
    rolling = false; await shooting;
    const end = Date.now();
    // to WebM (Chrome, Edge, Firefox) and MP4 (Safari), 25 frames a second
    const list = frames.map((f, i) => {
      const name = path.join(vids, `f${String(i).padStart(5, '0')}.jpg`);
      fs.writeFileSync(name, f.buf);
      return `file '${name}'\nduration ${(((frames[i + 1] ? frames[i + 1].t : end) - f.t) / 1000).toFixed(3)}`;
    });
    list.push(`file '${path.join(vids, `f${String(frames.length - 1).padStart(5, '0')}.jpg`)}'`); // (the concat reader needs the last one twice)
    fs.writeFileSync(path.join(vids, 'list.txt'), list.join('\n') + '\n');
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'concat', '-safe', '0', '-i', path.join(vids, 'list.txt'), '-vf', 'fps=25,scale=1280:720', '-c:v', 'libx264', '-preset', 'slow', '-crf', '27', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', '-an', OUT]);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', OUT, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '40', '-row-mt', '1', '-deadline', 'good', '-an', WEBM]);
    execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-ss', '9', '-i', OUT, '-frames:v', '1', '-q:v', '4', POSTER]);
    console.log(`wrote ${path.relative(ROOT, WEBM)} (${(fs.statSync(WEBM).size / 1e6).toFixed(1)} MB), ${path.relative(ROOT, OUT)} (${(fs.statSync(OUT).size / 1e6).toFixed(1)} MB, ${Math.round((end - frames[0].t) / 1000)} s, ${frames.length} frames) and ${path.relative(ROOT, POSTER)}`);
  } finally {
    try { await ctx.close(); } catch (e) { /* closed */ }
    server.close();
    fs.rmSync(profile, { recursive: true, force: true }); fs.rmSync(vids, { recursive: true, force: true });
  }
})().catch((e) => { console.error(e); process.exit(1); });
