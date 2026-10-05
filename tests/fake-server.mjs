// Runs server/worker.js locally, the way Cloudflare would: D1 is node:sqlite in memory,
// Groq, Claude and Workers AI are fakes you can switch with POST /__mode {"groq": "ok" | "busy" | "down", "claude": "off" | "ok" | "down" | "refuse"}.
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
  const mode = { groq: 'ok', ai: 'ok', claude: 'off', calls: [], claudeCalls: [] };
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    if (u.startsWith('https://oauth2.googleapis.com/tokeninfo')) { // fake Google: credential "good-<sub>-<email>"
      const cred = decodeURIComponent(u.split('id_token=')[1] || '');
      const m = /^good-(\w+)-(.+)$/.exec(cred);
      if (!m) return Response.json({ error: 'invalid_token' }, { status: 400 });
      return Response.json({ aud: 'test-client-id', iss: 'https://accounts.google.com', exp: String(Math.floor(Date.now() / 1000) + 600), sub: m[1], email: m[2], email_verified: 'true', given_name: 'Gia' });
    }
    if (u.startsWith('https://api.anthropic.com/')) { // fake Claude: mode.claude 'ok' | 'down' | 'refuse'
      if (u.includes('/v1/models')) return Response.json({ data: [{ id: 'test-sonnet' }, { id: 'test-opus-newest' }, { id: 'test-opus-older' }] });
      const body = JSON.parse(init.body);
      mode.claudeCalls.push({ model: body.model, system: body.system, messages: body.messages, effort: body.output_config && body.output_config.effort, fallbacks: body.fallbacks, beta: init.headers['anthropic-beta'], key: init.headers['x-api-key'] });
      if (mode.claude === 'down') return Response.json({ type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } }, { status: 529 });
      if (mode.claude === 'refuse') return Response.json({ content: [], stop_reason: 'refusal' });
      return Response.json({ content: [{ type: 'thinking', thinking: '' }, { type: 'text', text: mode.claudeReply || 'Claude here: plants turn light into food.' }], stop_reason: 'end_turn' });
    }
    if (!u.startsWith('https://api.groq.com/')) return realFetch(url, init);
    if (u.endsWith('/models')) return Response.json({ data: [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'openai/gpt-oss-120b' }] });
    const body = JSON.parse(init.body);
    mode.calls.push({ model: body.model, auth: init.headers.authorization, last: body.messages.at(-1) });
    if (mode.groq === 'busy') return Response.json({ error: { message: 'Rate limit reached' } }, { status: 429, headers: { 'retry-after': '40' } });
    if (mode.groq === 'down') return Response.json({ error: { message: 'Service unavailable' } }, { status: 503 });
    return Response.json({ choices: [{ message: { role: 'assistant', content: mode.reply || 'Hello from the server! Photosynthesis is how plants make food from light.' } }] });
  };
  const env = {
    DB, ADMIN_TOKEN: 'test-token', GROQ_KEY: 'gsk_server_test', DAILY_LIMIT: '5', GOOGLE_CLIENT_ID: 'test-client-id', CLAUDE_DAILY_LIMIT: '3',
    get ANTHROPIC_KEY() { return mode.claude === 'off' ? undefined : 'sk-ant-test'; },
    AI: { async run(model, input) {
      if (mode.ai !== 'ok') throw new Error('AI down');
      if (/flux/.test(model)) { mode.lastImagePrompt = input.prompt; return { image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }; }
      return { response: 'Backup brain answer: plants use sunlight.' };
    } },
  };
  const ctx = { waitUntil() {} };
  const server = http.createServer((req, res) => handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) { /* the browser already left */ } }));
  async function handle(req, res) { // a browser may cancel a request halfway — that must not crash the server
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (req.url === '/__mode') {
      if (req.method === 'POST') Object.assign(mode, JSON.parse(body.toString() || '{}'));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ ...mode, calls: mode.calls.length, claudeCalls: mode.claudeCalls.slice(-5) }));
    }
    if (req.url === '/__reset') { sq.exec('DELETE FROM quota'); res.writeHead(204); return res.end(); }
    const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    res.end(Buffer.from(await r.arrayBuffer()));
  }
  await new Promise((ok) => server.listen(port, ok));
  return { mode, close: () => new Promise((ok) => server.close(ok)), port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const p = +process.argv[2] || 4630;
  startFakeServer(p).then(() => console.log(`fake Cassie server on ${p}`));
}
