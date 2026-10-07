/* Cassie's human voice, made on the student's own device (no server, no limits).
   Kokoro-82M (Apache-2.0) through kokoro-js. The model (~86 MB) downloads once from
   Hugging Face and the browser keeps it; after that she speaks offline too.
   Runs in a worker so the app never freezes while she thinks of the sound. */
import { KokoroTTS, env } from './kokoro.web.js';

env.wasmPaths = new URL('./', import.meta.url).href; // the ONNX runtime is served with the app

const MODEL = 'onnx-community/Kokoro-82M-v1.0-ONNX';
let loading = null;
const files = {}; // file → { loaded, total } for one overall percentage

function load() {
  if (!loading) {
    loading = KokoroTTS.from_pretrained(MODEL, {
      dtype: 'q8',
      device: 'wasm',
      progress_callback: (p) => {
        if (!p || !p.file) return;
        if (p.status === 'progress' && p.total) files[p.file] = { loaded: p.loaded, total: p.total };
        else if (p.status === 'done' && files[p.file]) files[p.file].loaded = files[p.file].total;
        let loaded = 0, total = 0;
        for (const f of Object.values(files)) { loaded += f.loaded; total += f.total; }
        if (total) self.postMessage({ type: 'progress', loaded, total });
      },
    }).catch((e) => { loading = null; throw e; });
  }
  return loading;
}

// One sentence at a time, in order. Stopping Cassie drops what was still waiting.
let queue = Promise.resolve();
let stopBefore = 0; // requests with a lower turn number are skipped

self.onmessage = (e) => {
  const m = e.data || {};
  if (m.type === 'load') {
    load().then(() => self.postMessage({ type: 'ready' }), (err) => self.postMessage({ type: 'failed', error: String((err && err.message) || err) }));
  } else if (m.type === 'stop') {
    stopBefore = Math.max(stopBefore, m.turn || 0);
  } else if (m.type === 'say') {
    queue = queue.then(async () => {
      if (m.turn < stopBefore) return;
      try {
        const tts = await load();
        const t0 = performance.now();
        const out = await tts.generate(m.text, { voice: m.voice, speed: m.speed || 1 });
        const audio = out.audio;
        self.postMessage({ type: 'audio', id: m.id, turn: m.turn, audio, rate: out.sampling_rate, ms: performance.now() - t0 }, [audio.buffer]);
      } catch (err) {
        self.postMessage({ type: 'audio', id: m.id, turn: m.turn, error: String((err && err.message) || err) });
      }
    });
  }
};
