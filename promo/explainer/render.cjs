// node render.cjs <fromFrame> <toFrame> [fps=30] [outDir=frames]   — frame-exact capture
// node render.cjs --stills 1.5,7,12 [outDir]                        — preview stills
const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const stills = process.argv[2] === '--stills' ? process.argv[3].split(',').map(Number) : null;
  const [from, to, fps, outDir] = stills ? [0, 0, 30, process.argv[4] || 'stills'] : [+process.argv[2], +process.argv[3], +process.argv[4] || 30, process.argv[5] || 'frames'];
  fs.mkdirSync(__dirname + '/' + outDir, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium', args: ['--use-gl=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
  const p = await (await b.newContext({ viewport: { width: 1080, height: 1920 } })).newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await p.goto('file://' + __dirname + '/reel.html');
  await p.waitForFunction(() => window.READY, null, { timeout: 60000 });
  await p.evaluate(() => document.fonts.ready);
  const t0 = Date.now();
  const shot = (name) => p.screenshot({ path: `${__dirname}/${outDir}/${name}.jpg`, type: 'jpeg', quality: 90 });
  if (stills) {
    for (const T of stills) {
      for (let f = Math.max(0, Math.round((T - 1) * fps)); f <= Math.round(T * fps); f++) await p.evaluate((t) => window.seek(t), f / fps);
      await shot('s_' + String(T).replace('.', '_'));
    }
  } else {
    for (let f = Math.max(0, from - fps); f < from; f++) await p.evaluate((t) => window.seek(t), f / fps); // run-up so motion is settled
    for (let f = from; f < to; f++) {
      await p.evaluate((t) => window.seek(t), f / fps);
      await shot('f_' + String(f).padStart(5, '0'));
    }
  }
  console.log(`done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await b.close();
})();
