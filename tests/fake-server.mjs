// Runs server/worker.js locally, the way Cloudflare would: D1 is node:sqlite in memory,
// Groq and Workers AI are fakes you can switch with POST /__mode {"groq": "ok" | "busy" | "down"}.
import { DatabaseSync } from 'node:sqlite';
import http from 'node:http';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

export async function startFakeServer(port = 4630) {
  const worker = (await import(pathToFileURL(path.resolve(import.meta.dirname, '../server/worker.js')).href)).default;
  const sq = new DatabaseSync(':memory:');
  const stmt = (q, args = []) => ({
    q, args,
    bind(...a) { return stmt(q, a); },
    async all() { return { results: sq.prepare(q).all(...args) }; },
    async first() { return sq.prepare(q).get(...args) || null; },
    async run() { sq.prepare(q).run(...args); return { success: true }; },
  });
  const DB = {
    prepare: (q) => stmt(q),
    async batch(list) {
      const out = [];
      for (const s of list) out.push(/^\s*SELECT|RETURNING/i.test(s.q) ? await s.all() : await s.run());
      return out;
    },
  };
  const mode = { groq: 'ok', ai: 'ok', calls: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (!u.startsWith('https://api.groq.com/')) return realFetch(url, init);
    if (u.endsWith('/models')) return Response.json({ data: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'openai/gpt-oss-120b' }] });
    const body = JSON.parse(init.body);
    mode.calls.push({ model: body.model, auth: init.headers.authorization, last: body.messages.at(-1) });
    if (mode.groq === 'busy') return Response.json({ error: { message: 'Rate limit reached' } }, { status: 429, headers: { 'retry-after': '40' } });
    if (mode.groq === 'down') return Response.json({ error: { message: 'Service unavailable' } }, { status: 503 });
    return Response.json({ choices: [{ message: { role: 'assistant', content: mode.reply || 'Hello from the server! Photosynthesis is how plants make food from light.' } }] });
  };
  const env = {
    DB, ADMIN_TOKEN: 'test-token', GROQ_KEY: 'gsk_server_test', DAILY_LIMIT: '5',
    AI: { async run(model, input) { if (mode.ai !== 'ok') throw new Error('AI down'); return { response: 'Backup brain answer: plants use sunlight.' }; } },
  };
  const ctx = { waitUntil() {} };
  const server = http.createServer(async (req, res) => {
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (req.url === '/__mode') {
      if (req.method === 'POST') Object.assign(mode, JSON.parse(body.toString() || '{}'));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ ...mode, calls: mode.calls.length }));
    }
    if (req.url === '/__reset') { sq.exec('DELETE FROM quota'); res.writeHead(204); return res.end(); }
    const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  });
  await new Promise((ok) => server.listen(port, ok));
  return { mode, close: () => new Promise((ok) => server.close(ok)), port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const p = +process.argv[2] || 4630;
  startFakeServer(p).then(() => console.log(`fake Cassie server on ${p}`));
}
