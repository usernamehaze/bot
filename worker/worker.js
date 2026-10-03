/*
 * Cassie proxy — a Cloudflare Worker that lets Cassie answer questions
 * WITHOUT each user needing their own Groq key.
 *
 * It holds ONE Groq key (stored as a secret, never in this code) and forwards
 * Cassie's requests to Groq. To protect that shared key it:
 *   - only allows the chat-completions call and a fixed list of models,
 *   - caps max_tokens,
 *   - rate-limits per visitor IP (when a KV namespace named RL is bound).
 *
 * Set up (see worker/README.md):
 *   1. Paste this as a Cloudflare Worker.
 *   2. Add a secret named GROQ_KEY = your fresh Groq key.
 *   3. (Recommended) bind a KV namespace as RL for rate limiting.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const ALLOWED_MODELS = new Set([
  'openai/gpt-oss-120b',
  'llama-3.3-70b-versatile',
  'openai/gpt-oss-20b',
]);
const DEFAULT_MODEL = 'openai/gpt-oss-120b';

const MAX_TOKENS_CAP = 2048;
const RL_MAX = 20;      // max requests …
const RL_WINDOW = 60;   // … per this many seconds, per IP

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'POST, OPTIONS',
  'access-control-allow-headers': 'content-type',
  'access-control-max-age': '86400',
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json', ...CORS },
  });
}

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (request.method !== 'POST') return json({ error: 'Use POST.' }, 405);
    if (!env.GROQ_KEY) return json({ error: 'Proxy is missing its GROQ_KEY secret.' }, 500);

    // Per-IP rate limit (only if a KV namespace called RL is bound).
    if (env.RL) {
      const ip = request.headers.get('cf-connecting-ip') || 'unknown';
      const bucket = `rl:${ip}:${Math.floor(Date.now() / 1000 / RL_WINDOW)}`;
      const count = parseInt((await env.RL.get(bucket)) || '0', 10);
      if (count >= RL_MAX) {
        return json({ error: 'Too many requests — slow down and try again in a moment.' }, 429);
      }
      ctx.waitUntil(env.RL.put(bucket, String(count + 1), { expirationTtl: RL_WINDOW * 2 }));
    }

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'Bad JSON.' }, 400); }

    // Rebuild the payload ourselves so the proxy can't be used for anything
    // other than a normal Cassie chat request.
    const messages = Array.isArray(body.messages) ? body.messages.slice(-14) : [];
    if (!messages.length) return json({ error: 'No messages.' }, 400);
    const payload = {
      model: ALLOWED_MODELS.has(body.model) ? body.model : DEFAULT_MODEL,
      messages,
      max_tokens: Math.min(Number(body.max_tokens) || MAX_TOKENS_CAP, MAX_TOKENS_CAP),
      temperature: typeof body.temperature === 'number' ? body.temperature : 0.7,
      stream: !!body.stream,
    };

    const groqRes = await fetch(GROQ_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` },
      body: JSON.stringify(payload),
    });

    // Pass Groq's response straight back (streaming or JSON), with CORS +
    // the rate-limit headers Cassie reads to show a friendly reset time.
    const headers = { ...CORS };
    const ct = groqRes.headers.get('content-type');
    if (ct) headers['content-type'] = ct;
    for (const h of ['retry-after', 'x-ratelimit-reset-requests', 'x-ratelimit-reset-tokens']) {
      const v = groqRes.headers.get(h);
      if (v) headers[h] = v;
    }
    return new Response(groqRes.body, { status: groqRes.status, headers });
  },
};
