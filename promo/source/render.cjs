const { chromium } = require('/opt/node22/lib/node_modules/playwright');
const fs = require('fs');
(async () => {
  const [from, to, fps, outDir] = [+process.argv[2], +process.argv[3], +process.argv[4] || 30, process.argv[5] || 'frames'];
  fs.mkdirSync(__dirname + '/' + outDir, { recursive: true });
  const b = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
  const p = await (await b.newContext({ viewport: { width: 1920, height: 1080 } })).newPage();
  p.on('pageerror', (e) => console.log('PAGE ERROR:', e.message));
  await p.goto('file://' + __dirname + '/ad.html'); await p.waitForFunction(() => window.READY, null, { timeout: 20000 });
  await p.evaluate(() => document.fonts.ready);
  if (from === 0) fs.writeFileSync(__dirname + '/clicks.json', JSON.stringify(await p.evaluate(() => window.CLICKS)));
  const t0 = Date.now();
  for (let f = from; f < to; f++) {
    await p.evaluate((t) => window.seek(t), f / fps);
    await p.screenshot({ path: `${__dirname}/${outDir}/f_${String(f).padStart(5, '0')}.jpg`, type: 'jpeg', quality: 92 });
  }
  console.log(`rendered ${to - from} frames in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  await b.close();
})();
