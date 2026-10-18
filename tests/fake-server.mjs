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
  // a test signing key for "Google" and one for "Apple" (their real keys are never used in tests)
  const idp = {};
  for (const name of ['google', 'apple']) {
    const pair = await crypto.subtle.generateKey({ name: 'RSASSA-PKCS1-v1_5', modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: 'SHA-256' }, true, ['sign', 'verify']);
    const jwk = await crypto.subtle.exportKey('jwk', pair.publicKey);
    idp[name] = { kid: 'test-' + name, priv: pair.privateKey, pub: { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', use: 'sig', kid: 'test-' + name } };
  }
  const b64u = (buf) => Buffer.from(buf).toString('base64url');
  // an ID token like Google's or Apple's: { provider, sub, email, verified, nonce, aud, iss, exp, badSig }
  async function idToken(o) {
    const p = idp[o.provider === 'apple' ? 'apple' : 'google'], now = Math.floor(Date.now() / 1000);
    const claims = { iss: o.iss || (o.provider === 'apple' ? 'https://appleid.apple.com' : 'https://accounts.google.com'), aud: o.aud || (o.provider === 'apple' ? 'test.apple.services' : 'test-client-id'),
      sub: o.sub || 'sub1', email: o.email, email_verified: o.verified === false ? 'false' : 'true', iat: now, exp: o.exp || now + 600, ...(o.nonce ? { nonce: o.nonce } : {}), ...(o.provider === 'apple' ? {} : { given_name: 'Gia' }) };
    const head = b64u(JSON.stringify({ alg: 'RS256', kid: p.kid, typ: 'JWT' })), body = b64u(JSON.stringify(claims));
    const sig = b64u(await crypto.subtle.sign('RSASSA-PKCS1-v1_5', p.priv, Buffer.from(head + '.' + body)));
    return `${head}.${body}.${o.badSig ? sig.slice(0, -6) + 'AAAAAA' : sig}`;
  }
  const mode = { groq: 'ok', ai: 'ok', aiVision: 'ok', claude: 'off', gemini: 'off', groqVision: 'ok', calls: [], claudeCalls: [], geminiCalls: [] };
  // Cloudflare's cache (the studio voice keeps each sentence it made): a small one in memory
  if (!globalThis.caches) { const kept = new Map(); globalThis.caches = { default: { async match(req) { const r = kept.get(req.url); return r ? r.clone() : undefined; }, async put(req, res) { kept.set(req.url, res.clone()); } } }; }
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const u = String(url);
    // fake Google and Apple public keys: ID tokens are made by POST /__idtoken with the test keys below
    if (u === 'https://www.googleapis.com/oauth2/v3/certs') return Response.json({ keys: [idp.google.pub] });
    if (u === 'https://appleid.apple.com/auth/keys') return Response.json({ keys: [idp.apple.pub] });
    if (u.startsWith('https://api.elevenlabs.io/')) { mode.elevenCalls = (mode.elevenCalls || 0) + 1; return new Response(new Uint8Array([73, 68, 51, 4, 0, 0]), { headers: { 'content-type': 'audio/mpeg' } }); } // fake ElevenLabs: a few bytes of "MP3"
    if (u.startsWith('https://api.anthropic.com/')) { // fake Claude: mode.claude 'ok' | 'down' | 'refuse'
      if (u.includes('/v1/models')) return Response.json({ data: [{ id: 'test-haiku' }, { id: 'test-sonnet' }, { id: 'test-opus-newest' }, { id: 'test-opus-older' }] });
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
      if (mode.gemini === 'location') return Response.json({ error: { code: 400, message: 'User location is not supported for the API use.', status: 'FAILED_PRECONDITION' } }, { status: 400 });
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
      if (/image/.test(u.match(/models\/([^:]+)/)[1])) { // Gemini pictures: mode.geminiPictures 'ok' | 'nobilling'
        const parts = body.contents.at(-1).parts;
        mode.geminiPics = [...(mode.geminiPics || []), { model: u.match(/models\/([^:]+)/)[1], ref: parts.some((p) => p.inlineData), prompt: (parts.find((p) => p.text) || {}).text || '' }].slice(-5);
        if (mode.geminiPictures === 'nobilling') return Response.json({ error: { code: 429, message: 'Quota exceeded for metric: generate_content_free_tier_requests, limit: 0' } }, { status: 429 });
        return Response.json({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=' } }] } }] });
      }
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
    const answer = smart(body.messages) || mode.reply || 'Hello from the server! Photosynthesis is how plants make food from light.';
    if (body.stream) { // like Groq: server-sent events, a few words at a time, then [DONE]
      mode.streamed = (mode.streamed || 0) + 1;
      const words = answer.match(/\S+\s*/g) || [answer];
      const enc = new TextEncoder();
      return new Response(new ReadableStream({ async start(c) {
        for (const w of words) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: w } }] })}\n\n`)); await new Promise((r) => setTimeout(r, 15)); }
        c.enqueue(enc.encode('data: [DONE]\n\n')); c.close();
      } }), { headers: { 'content-type': 'text/event-stream' } });
    }
    return Response.json({ choices: [{ message: { role: 'assistant', content: answer } }] });
  };
  const env = {
    DB, ADMIN_TOKEN: 'test-admin-token-0123456789', GROQ_KEY: 'gsk_server_test', get DAILY_LIMIT() { return mode.dailyAll == null ? '5' : String(mode.dailyAll); }, get FREE_DAILY_QUESTIONS() { return mode.freeQuestions == null ? '20' : String(mode.freeQuestions); }, get GOOGLE_CLIENT_ID() { return mode.noGoogle ? undefined : 'test-client-id'; }, get APPLE_SERVICES_ID() { return mode.noApple ? undefined : 'test.apple.services'; },
    get FREE_CLAUDE_LIMIT() { return mode.freeClaude == null ? '3' : String(mode.freeClaude); }, // (real default: 10)
    get ANTHROPIC_KEY() { return mode.claude === 'off' ? undefined : 'sk-ant-test'; },
    get GEMINI_KEY() { return mode.gemini === 'off' ? undefined : 'AIza_server_test'; },
    get ELEVENLABS_API_KEY() { return mode.speakOn ? 'not-a-real-elevenlabs-key' : undefined; }, // (mode.speakOn: the studio voice is switched on)
    get SPEAK_MONTHLY_CHARS() { return mode.speakMonth == null ? undefined : String(mode.speakMonth); },
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
  // background work (ctx.waitUntil) is kept track of, so /__dump can wait for it to finish
  const pending = new Set();
  const ctx = { waitUntil(p) { const q = Promise.resolve(p).catch(() => {}); pending.add(q); q.finally(() => pending.delete(q)); } };
  // what the server writes to the console (on Cloudflare that's what its logs keep)
  const logs = [];
  for (const k of ['log', 'info', 'warn', 'error', 'debug']) {
    const orig = console[k].bind(console);
    console[k] = (...a) => { logs.push(a.map((x) => (typeof x === 'string' ? x : (() => { try { return JSON.stringify(x); } catch (e) { return String(x); } })())).join(' ')); orig(...a); };
  }
  const server = http.createServer((req, res) => handle(req, res).catch(() => { try { res.writeHead(500); res.end(); } catch (e) { /* the browser already left */ } }));
  async function handle(req, res) { // a browser may cancel a request halfway — that must not crash the server
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    if (req.url === '/__mode') {
      if (req.method === 'POST') Object.assign(mode, JSON.parse(body.toString() || '{}'));
      res.writeHead(200, { 'content-type': 'application/json', 'access-control-allow-origin': '*' });
      return res.end(JSON.stringify({ ...mode, calls: mode.calls.length, lastCalls: mode.calls.slice(-6).map((c) => c.model), claudeCalls: mode.claudeCalls.slice(-5), claudeCount: mode.claudeCalls.length, geminiCalls: mode.geminiCalls.slice(-6) }));
    }
    if (req.url === '/__idtoken' && req.method === 'POST') {
      res.writeHead(200, { 'content-type': 'text/plain', 'access-control-allow-origin': '*' });
      return res.end(await idToken(JSON.parse(body.toString() || '{}')));
    }
    // every row of every table, and every console line so far (for "nothing was kept" tests)
    if (req.url === '/__dump') {
      await Promise.allSettled([...pending]);
      const tables = {};
      for (const { name } of sq.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) tables[name] = sq.prepare(`SELECT * FROM "${name}"`).all();
      res.writeHead(200, { 'content-type': 'application/json' });
      // (and, kept apart, what the fake AI services were sent: that's where a question should go)
      return res.end(JSON.stringify({ tables, logs, sentToAI: JSON.stringify([mode.calls.map((c) => c.last), mode.claudeCalls, mode.geminiCalls]) }));
    }
    // make what's stored a day older (rooms, and the daily limit counts), as if a day went by
    if (req.url === '/__age') {
      sq.exec(`UPDATE rooms SET created = created - 25 * 3600000; UPDATE room_here SET ts = ts - 25 * 3600000;
        UPDATE quota SET day = '2000-01-01' WHERE length(day) = 10 AND k NOT LIKE 'gpic:%'; UPDATE quota SET day = '2000-01-01T00' WHERE length(day) = 13;
        INSERT OR REPLACE INTO quota (k, day, n) VALUES ('SP:month', strftime('%Y-%m', 'now', '+8 hours'), 5)`); // (and this month's studio voice allowance, used a little)
      res.writeHead(204); return res.end();
    }
    // the Cron Trigger, as Cloudflare would run it
    if (req.url === '/__cron') {
      ctx.waitUntil(worker.scheduled({ cron: 'test' }, env, ctx));
      await Promise.allSettled([...pending]);
      res.writeHead(204); return res.end();
    }
    // Google sign-in when Cassie's server breaks: POST /__mode {"googleAuth": "error" | "hang" | "ok"}
    if (req.url === '/auth/google' && req.method === 'POST' && mode.googleAuth === 'error') {
      res.writeHead(500, { 'content-type': 'application/json', 'access-control-allow-origin': req.headers.origin || '*' });
      return res.end(JSON.stringify({ error: 'Internal error' }));
    }
    if (req.url === '/auth/google' && req.method === 'POST' && mode.googleAuth === 'hang') return; // never answers
    if (req.url === '/__reset') { sq.exec('DELETE FROM quota'); res.writeHead(204); return res.end(); }
    if (req.url === '/__reset-scores') { try { sq.exec('DELETE FROM scores'); } catch (e) { /* no table yet */ } res.writeHead(204); return res.end(); }
    const r = await worker.fetch(new Request(`http://localhost:${port}${req.url}`, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body }), env, ctx);
    res.writeHead(r.status, Object.fromEntries(r.headers));
    if (/event-stream/.test(r.headers.get('content-type') || '') && r.body) { // pass a stream on as it comes, like Cloudflare does
      const rd = r.body.getReader();
      for (;;) { const { done, value } = await rd.read(); if (done) break; res.write(Buffer.from(value)); }
      return res.end();
    }
    res.end(Buffer.from(await r.arrayBuffer()));
  }
  await new Promise((ok) => server.listen(port, ok));
  return { mode, close: () => new Promise((ok) => server.close(ok)), port };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const p = +process.argv[2] || 4630;
  startFakeServer(p).then(() => console.log(`fake Cassie server on ${p}`));
}
