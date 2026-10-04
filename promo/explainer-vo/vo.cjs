// Voiceover with Kokoro (offline, Apache-2.0) via sherpa-onnx → vo/<key>.wav + timeline.json
const sherpa = require(process.env.TTS_DIR + '/node_modules/sherpa-onnx-node');
const fs = require('fs');
const M = process.env.TTS_DIR + '/probe/package/kokoro-int8-en-v0_19';
const tts = new sherpa.OfflineTts({ model: { kokoro: { model: M + '/model.int8.onnx', voices: M + '/voices.bin', tokens: M + '/tokens.txt', dataDir: M + '/espeak-ng-data' }, numThreads: 4, provider: 'cpu' } });
const VOICE = 1, SPEED = 1.06, LEAD = 0.35, TAIL = 0.55, MIN = 2.4;
const lines = JSON.parse(fs.readFileSync(__dirname + '/script.json', 'utf8'));
fs.mkdirSync(__dirname + '/vo', { recursive: true });
let t = 0; const out = [];
for (const [key, chapter, text] of lines) {
  const a = tts.generate({ text, sid: VOICE, speed: SPEED });
  // trim leading/trailing near-silence
  let s = 0, e = a.samples.length; while (s < e && Math.abs(a.samples[s]) < 0.004) s++; while (e > s && Math.abs(a.samples[e - 1]) < 0.004) e--;
  const samples = a.samples.slice(Math.max(0, s - 240), Math.min(a.samples.length, e + 240));
  sherpa.writeWave(`${__dirname}/vo/${key}.wav`, { samples, sampleRate: a.sampleRate });
  const voDur = samples.length / a.sampleRate;
  const dur = Math.max(MIN, Math.round((LEAD + voDur + TAIL) * 10) / 10);
  out.push({ key, chapter, text, t0: +t.toFixed(2), dur, vo: +(t + LEAD).toFixed(2), voDur: +voDur.toFixed(2) });
  t += dur;
}
fs.writeFileSync(__dirname + '/timeline.json', JSON.stringify(out, null, 1));
fs.writeFileSync(__dirname + '/timeline.js', 'window.TL = ' + JSON.stringify(out) + ';\n');
console.log('total', t.toFixed(1), 's,', out.length, 'scenes');
