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
  const mode = { groq: 'ok', ai: 'ok', aiVision: 'ok', claude: 'off', gemini: 'off', groqVision: 'ok', calls: [], claudeCalls: [], geminiCalls: [] };
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
    // A question's "known answer", for the brain check and realistic replies
    const smart = (msgs) => {
      const last = msgs.at(-1), text = typeof last.content === 'string' ? last.content : last.content.filter((p) => p.type === 'text').map((p) => p.text || '').join(' ');
      const pic = typeof last.content !== 'string' && last.content.some((p) => p.type === 'image_url' || p.inlineData);
      if (/17 × 23/.test(text)) return '391';
      if (/graph y = x\^2 - 4/.test(text)) return '```cassie-board\n{"type":"graph","title":"y = x^2 - 4","fn":"x^2 - 4","xrange":[-4,4]}\n```';
      if (pic && /sum in this picture/.test(text)) return '56';
      return null;
    };
    if (u.startsWith('https://generativelanguage.googleapis.com/')) { // the server's own Gemini (mode.gemini)
      if (!init.body) { // the list of models this key can use; gemini-2.5-flash is retired, like on real keys now
        mode.geminiListed = (mode.geminiListed || 0) + 1;
        const gen = ['generateContent', 'countTokens'];
        return Response.json({ models: [
          { name: 'models/gemini-2.5-flash', supportedGenerationMethods: gen }, { name: 'models/gemini-9.0-flash-image', supportedGenerationMethods: gen },
          { name: 'models/gemini-9.0-flash', supportedGenerationMethods: gen }, { name: 'models/gemini-9.0-flash-lite', supportedGenerationMethods: gen },
          { name: 'models/gemini-9.0-pro-preview', supportedGenerationMethods: gen }, { name: 'models/text-embedding-004', supportedGenerationMethods: ['embedContent'] },
        ] });
      }
      const body = JSON.parse(init.body);
      if (/gemini-2\.5-flash:/.test(u)) return Response.json({ error: { code: 404, message: 'This model models/gemini-2.5-flash is no longer available to new users.' } }, { status: 404 });
      mode.geminiCalls.push(u.match(/models\/([^:]+)/)[1]);
      if (mode.gemini !== 'ok') return Response.json({ error: { code: 503, message: 'This model is currently experiencing high demand.' } }, { status: 503 });
      const parts = body.contents.at(-1).parts;
      const asMsgs = [{ role: 'user', content: parts.map((p) => (p.inlineData ? { type: 'image_url' } : { type: 'text', text: p.text })) }];
      return Response.json({ candidates: [{ content: { parts: [{ text: smart(asMsgs) || mode.geminiReply || 'Gemini on the server read it.' }] } }] });
    }
    if (!u.startsWith('https://api.groq.com/')) return realFetch(url, init);
    if (u.endsWith('/models')) { // mode.groqVision: 'ok' | 'second' (first picture model broken) | 'retired' (none left)
      const vision = mode.groqVision === 'retired' ? [] : mode.groqVision === 'renamed' ? [{ id: 'meta-llama/llama-guard-4-12b' }, { id: 'acme/new-eyes-9b' }] : [{ id: 'meta-llama/llama-4-scout-17b-16e-instruct' }, { id: 'qwen/qwen3-vl-32b' }];
      return Response.json({ data: [...vision, { id: 'openai/gpt-oss-120b' }, { id: 'whisper-large-v3' }] });
    }
    if (u.endsWith('/audio/transcriptions')) { mode.heardCalls = (mode.heardCalls || 0) + 1; mode.heardPrompt = init.body && init.body.get ? init.body.get('prompt') : ''; return Response.json({ text: mode.heard || 'What is osmosis?' }); }
    const body = JSON.parse(init.body);
    mode.calls.push({ model: body.model, auth: init.headers.authorization, last: body.messages.at(-1) });
    if (mode.groq === 'busy') return Response.json({ error: { message: 'Rate limit reached' } }, { status: 429, headers: { 'retry-after': '40' } });
    if (mode.groq === 'down') return Response.json({ error: { message: 'Service unavailable' } }, { status: 503 });
    // 'limit2': like Groq's free plan in a rush — only the first 2 questions this minute get through
    if (mode.groq === 'limit2' && (mode.groqCount = (mode.groqCount || 0) + 1) > 2) return Response.json({ error: { message: `Rate limit reached for model \`${body.model}\` on tokens per minute (TPM). Please try again in 7.5s.` } }, { status: 429, headers: { 'retry-after': '8' } });
    if (mode.groqVision === 'retired' && /scout|-vl-/.test(body.model)) return Response.json({ error: { message: `The model \`${body.model}\` does not exist or you do not have access to it.` } }, { status: 404 });
    // like Groq: a picture sent to a model that can't read pictures is refused
    const hasPic = typeof body.messages.at(-1).content !== 'string' && body.messages.at(-1).content.some((p) => p.type === 'image_url');
    if (hasPic && !/scout|-vl-|new-eyes/.test(body.model)) return Response.json({ error: { message: "'messages.0' : for 'role:user' the following must be satisfied[('messages.0.content' : value must be a string)]" } }, { status: 400 });
    if (mode.groqVision === 'second' && /llama-4-scout/.test(body.model)) return Response.json({ error: { message: 'The model `meta-llama/llama-4-scout-17b-16e-instruct` has been decommissioned.' } }, { status: 400 });
    return Response.json({ choices: [{ message: { role: 'assistant', content: smart(body.messages) || mode.reply || 'Hello from the server! Photosynthesis is how plants make food from light.' } }] });
  };
  const env = {
    DB, ADMIN_TOKEN: 'test-token', GROQ_KEY: 'gsk_server_test', DAILY_LIMIT: '5', GOOGLE_CLIENT_ID: 'test-client-id', CLAUDE_DAILY_LIMIT: '3',
    get ANTHROPIC_KEY() { return mode.claude === 'off' ? undefined : 'sk-ant-test'; },
    get GEMINI_KEY() { return mode.gemini === 'off' ? undefined : 'AIza_server_test'; },
    AI: { async run(model, input) {
      if (mode.ai !== 'ok') throw new Error('AI down');
      if (/scout|gemma-3/.test(model)) { // Workers AI picture readers (mode.aiVision)
        if (mode.aiVision !== 'ok') throw new Error('AiError: 5007: No such model');
        const last = input.messages.at(-1), text = Array.isArray(last.content) ? last.content.map((p) => p.text || '').join(' ') : last.content;
        return { response: /sum in this picture/.test(text) ? '56' : 'Workers AI read the picture.' };
      }
      if (/flux/.test(model)) { mode.lastImagePrompt = input.prompt; return { image: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' }; }
      return { response: /17 × 23/.test(JSON.stringify(input.messages)) ? '391' : 'Backup brain answer: plants use sunlight.' };
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
      return res.end(JSON.stringify({ ...mode, calls: mode.calls.length, lastCalls: mode.calls.slice(-6).map((c) => c.model), claudeCalls: mode.claudeCalls.slice(-5), geminiCalls: mode.geminiCalls.slice(-6) }));
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
