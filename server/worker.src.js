/* Cassie server — one Cloudflare Worker (free tier) that does three jobs:
 *
 *   POST /chat       answers questions for people who haven't added their own Groq key,
 *                    using YOUR Groq key (kept secret here), with Cloudflare Workers AI as
 *                    an automatic backup when Groq is busy or out of free questions
 *   POST /e          anonymous usage counts (no login, no names, no messages)
 *   POST /f          thumbs up / down on answers and "Report a problem" notes
 *   GET  /           your dashboard (asks for your ADMIN_TOKEN)
 *   GET  /stats      the numbers behind the dashboard (needs the token)
 *
 * Bindings (Worker → Settings → Bindings / Variables and Secrets):
 *   DB           a D1 database (tables are created automatically)
 *   ADMIN_TOKEN  secret — a password you choose for the dashboard
 *   GROQ_KEY     secret — your Groq API key (console.groq.com/keys)
 *   AI           Workers AI binding — the backup brain (optional but recommended)
 * Optional variables:
 *   DAILY_LIMIT      questions per person per day through your key (default 150)
 *   MINUTE_LIMIT     questions per person per minute (default 12)
 *   ALLOWED_ORIGINS  comma-separated sites allowed to use this server
 *                    (default: askcassie.pages.dev, usernamehaze.github.io, localhost)
 * Days are counted in Philippine time (UTC+8).
 */

const TZ_OFFSET_H = 8;
const DEFAULT_ORIGINS = ['https://askcassie.pages.dev', 'https://usernamehaze.github.io', 'http://localhost'];
const EVENTS = new Set(['open', 'feature', 'signup']);

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (uid TEXT PRIMARY KEY, first_day TEXT, last_day TEXT, opens INTEGER DEFAULT 0, uses INTEGER DEFAULT 0,
     role TEXT, grade TEXT, age TEXT, platform TEXT, lang TEXT)`,
  `CREATE TABLE IF NOT EXISTS events (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, uid TEXT, event TEXT, name TEXT)`,
  `CREATE INDEX IF NOT EXISTS events_day ON events(day)`,
  `CREATE TABLE IF NOT EXISTS words (day TEXT, word TEXT, n INTEGER, PRIMARY KEY (day, word))`,
  `CREATE TABLE IF NOT EXISTS feedback (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER, day TEXT, uid TEXT, kind TEXT, feature TEXT, text TEXT, ctx TEXT)`,
  `CREATE INDEX IF NOT EXISTS feedback_day ON feedback(day)`,
  `CREATE TABLE IF NOT EXISTS quota (k TEXT PRIMARY KEY, day TEXT, n INTEGER)`,
  `CREATE TABLE IF NOT EXISTS chats (day TEXT, src TEXT, n INTEGER, PRIMARY KEY (day, src))`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  schemaReady = true;
}

const dayOf = (ms) => new Date(ms + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
const clean = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, n);

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS);
  const ok = allowed.some((a) => origin === a || (a === 'http://localhost' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)));
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', 'access-control-expose-headers': 'retry-after, x-cassie-source, x-cassie-left', vary: 'origin' } : {};
}
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });

async function ingest(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = cors(origin, env);
  if (origin && !h['access-control-allow-origin']) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 16000) return new Response('too big', { status: 413, headers: h });
  let body; try { body = JSON.parse(text); } catch (e) { return new Response('bad json', { status: 400, headers: h }); }
  const uid = clean(body.uid, 64);
  if (!/^[\w-]{8,64}$/.test(uid)) return new Response('bad id', { status: 400, headers: h });
  const ctx = body.ctx || {};
  const now = Date.now(), today = dayOf(now);
  const events = (Array.isArray(body.events) ? body.events : []).slice(0, 50)
    .filter((e) => e && EVENTS.has(e.e))
    .map((e) => ({ e: e.e, n: clean(e.n, 40), t: Math.min(now, Math.max(now - 7 * 864e5, +e.t || now)) }));
  const words = (Array.isArray(body.words) ? body.words : []).slice(0, 50)
    .map((w) => clean(w, 24).toLowerCase()).filter((w) => /^\p{L}{4,24}$/u.test(w));
  if (!events.length && !words.length) return new Response(null, { status: 204, headers: h });

  const db = env.DB;
  await ensureSchema(db);
  const opens = events.filter((e) => e.e === 'open').length, uses = events.filter((e) => e.e === 'feature').length;
  const stmts = [
    db.prepare(`INSERT INTO users (uid, first_day, last_day, opens, uses, role, grade, age, platform, lang) VALUES (?1, ?2, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
      ON CONFLICT(uid) DO UPDATE SET last_day = ?2, opens = opens + ?3, uses = uses + ?4,
        role = COALESCE(NULLIF(?5, ''), role), grade = COALESCE(NULLIF(?6, ''), grade), age = COALESCE(NULLIF(?7, ''), age),
        platform = COALESCE(NULLIF(?8, ''), platform), lang = COALESCE(NULLIF(?9, ''), lang)`)
      .bind(uid, today, opens, uses, clean(ctx.role, 12), clean(ctx.grade, 30), clean(ctx.age, 12), clean(ctx.platform, 20), clean(ctx.lang, 8)),
    ...events.map((e) => db.prepare('INSERT INTO events (ts, day, uid, event, name) VALUES (?, ?, ?, ?, ?)').bind(e.t, dayOf(e.t), uid, e.e, e.n)),
    ...words.map((w) => db.prepare('INSERT INTO words (day, word, n) VALUES (?, ?, 1) ON CONFLICT(day, word) DO UPDATE SET n = n + 1').bind(today, w)),
  ];
  await db.batch(stmts);
  return new Response(null, { status: 204, headers: h });
}

/* ------------------------------------------------------------------ chat */
const GROQ = 'https://api.groq.com/openai/v1';
const CHAT_MODELS = ['openai/gpt-oss-120b', 'llama-3.3-70b-versatile', 'openai/gpt-oss-20b'];
const BACKUP_MODEL = '@cf/meta/llama-3.3-70b-instruct-fp8-fast'; // Workers AI
const minuteHits = new Map(); // per-person counts for the current minute (per Worker instance)
let vision = { id: '', at: 0 };

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = cors(origin, env);
  return h['access-control-allow-origin'] ? h : null;
}
function msUntilMidnightPH(now) {
  const ph = new Date(now + TZ_OFFSET_H * 3600e3);
  return 864e5 - ((ph.getUTCHours() * 3600 + ph.getUTCMinutes() * 60 + ph.getUTCSeconds()) * 1000);
}
function chatError(message, status, h, extra = {}) {
  return json({ error: { message } }, status, { ...h, ...extra });
}
// Groq's picture-reading model changes over time — ask Groq which one it has now.
async function visionModel(env) {
  if (vision.id && Date.now() - vision.at < 6 * 3600e3) return vision.id;
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${env.GROQ_KEY}` } });
    const ids = ((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
    vision = { id: ids.find((id) => /llama-4-scout/i.test(id)) || ids.find((id) => /llama-4|vision|maverick/i.test(id)) || '', at: Date.now() };
  } catch (e) { /* keep the old one */ }
  return vision.id;
}
function cleanMessages(list) {
  if (!Array.isArray(list) || !list.length || list.length > 40) return null;
  let chars = 0, image = false;
  const out = [];
  for (const m of list) {
    if (!m || !['system', 'user', 'assistant'].includes(m.role)) return null;
    if (typeof m.content === 'string') { chars += m.content.length; out.push({ role: m.role, content: m.content }); continue; }
    if (!Array.isArray(m.content)) return null;
    const parts = [];
    for (const p of m.content.slice(0, 8)) {
      if (p && p.type === 'text' && typeof p.text === 'string') { chars += p.text.length; parts.push({ type: 'text', text: p.text }); }
      else if (p && p.type === 'image_url' && p.image_url && /^data:image\//.test(p.image_url.url || '')) { image = true; parts.push({ type: 'image_url', image_url: { url: p.image_url.url } }); }
    }
    out.push({ role: m.role, content: parts });
  }
  if (chars > 120000) return null;
  return { messages: out, image };
}
const textOnly = (messages) => messages.map((m) => ({ role: m.role, content: typeof m.content === 'string' ? m.content : m.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n') }));

async function countChat(env, day, src) {
  try { await env.DB.prepare('INSERT INTO chats (day, src, n) VALUES (?, ?, 1) ON CONFLICT(day, src) DO UPDATE SET n = n + 1').bind(day, src).run(); } catch (e) { /* stats only */ }
}

async function chat(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 8e6) return chatError('That photo or file is too big to send — try a smaller one.', 413, h);
  let body; try { body = JSON.parse(text); } catch (e) { return chatError('Bad request.', 400, h); }
  const cleaned = cleanMessages(body.messages);
  if (!cleaned) return chatError('That message is too long — try a shorter question or start a new chat.', 413, h);

  // Fair use: each person gets a daily allowance through this shared key.
  const now = Date.now(), today = dayOf(now);
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perMin = +env.MINUTE_LIMIT || 12, perDay = +env.DAILY_LIMIT || 150;
  const minute = Math.floor(now / 60e3), mk = `${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  if (minuteHits.size > 5000) minuteHits.clear();
  if (n > perMin) return chatError('Whoa, lots of questions! Give me a few seconds, then ask again.', 429, h, { 'retry-after': String(60 - Math.floor((now / 1000) % 60)) });
  await ensureSchema(env.DB);
  const bump = (k) => env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind(k, today);
  const [u, i] = await env.DB.batch([bump('u:' + uid), bump('i:' + ip)]);
  const usedU = u.results?.[0]?.n || 0, usedI = i.results?.[0]?.n || 0;
  if (Math.random() < 0.01) ctx.waitUntil(env.DB.prepare('DELETE FROM quota WHERE day < ?').bind(today).run());
  if ((uid !== 'anon' && usedU > perDay) || usedI > perDay * 25) {
    const secs = Math.ceil(msUntilMidnightPH(now) / 1000);
    return chatError(`You've used today's ${perDay} free questions. They come back at midnight — or add your own free Groq key in Settings to keep going right now.`, 429, h, { 'retry-after': String(secs), 'x-cassie-daily': '1' });
  }
  const left = { 'x-cassie-left': String(Math.max(0, perDay - usedU)) };

  const maxTokens = Math.min(Math.max(+body.max_tokens || 2048, 64), 4000);
  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1.2) : 0.6;
  let lastStatus = 503, lastDetail = '';
  if (env.GROQ_KEY) {
    let models;
    if (cleaned.image || body.model === 'vision') { const v = await visionModel(env); models = v ? [v] : []; }
    else models = [CHAT_MODELS.includes(body.model) ? body.model : CHAT_MODELS[0], ...CHAT_MODELS].filter((m, k, a) => a.indexOf(m) === k);
    for (const model of models) {
      const payload = { model, messages: cleaned.messages, max_tokens: maxTokens, temperature };
      if (/gpt-oss/.test(model) && ['low', 'medium', 'high'].includes(body.reasoning_effort)) payload.reasoning_effort = body.reasoning_effort;
      let r;
      try {
        r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify(payload) });
      } catch (e) { lastStatus = 503; continue; }
      if (r.ok) {
        ctx.waitUntil(countChat(env, today, 'groq'));
        return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json', ...h, ...left, 'x-cassie-source': 'groq' } });
      }
      lastStatus = r.status;
      try { lastDetail = (await r.json()).error?.message || ''; } catch (e) { lastDetail = ''; }
      // too long / bad request: the app trims the chat and retries, so hand it back
      if (r.status === 400 || r.status === 413) return chatError(lastDetail || 'Too long.', r.status, h);
      // 429 / 5xx / retired model: try the next model, then the backup
    }
  }
  if (env.AI && !cleaned.image) {
    try {
      const out = await env.AI.run(BACKUP_MODEL, { messages: textOnly(cleaned.messages), max_tokens: Math.min(maxTokens, 2048), temperature });
      const reply = (out && (out.response ?? out.result?.response)) || '';
      if (reply) {
        ctx.waitUntil(countChat(env, today, 'backup'));
        return json({ choices: [{ index: 0, message: { role: 'assistant', content: String(reply) }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'backup' });
      }
    } catch (e) { lastDetail = lastDetail || String(e && e.message || e); }
  }
  ctx.waitUntil(countChat(env, today, 'failed'));
  // an unanswered question shouldn't use up the person's daily allowance
  ctx.waitUntil(env.DB.batch(['u:' + uid, 'i:' + ip].map((k) => env.DB.prepare('UPDATE quota SET n = MAX(0, n - 1) WHERE k = ?').bind(k))));
  if (cleaned.image && !env.GROQ_KEY) return chatError('Reading photos needs a Groq or Gemini key — add one in Settings.', 503, h);
  return chatError(lastStatus === 429 ? 'Cassie is very busy right now — try again in a minute.' : 'Cassie can’t reach her brain right now — try again in a moment.', lastStatus === 429 ? 429 : 503, h, { 'retry-after': '20' });
}

/* ------------------------------------------------------------------ feedback */
const FEEDBACK = new Set(['up', 'down', 'report']);
async function feedback(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 8000) return new Response('too big', { status: 413, headers: h });
  let b; try { b = JSON.parse(text); } catch (e) { return new Response('bad json', { status: 400, headers: h }); }
  const uid = clean(b.uid, 64);
  if (!/^[\w-]{8,64}$/.test(uid) || !FEEDBACK.has(b.kind)) return new Response('bad', { status: 400, headers: h });
  const c = b.ctx || {};
  const ctxText = [c.role, c.grade, c.age, c.platform, c.version].map((v) => clean(v, 30)).filter(Boolean).join(' · ');
  await ensureSchema(env.DB);
  const now = Date.now();
  await env.DB.prepare('INSERT INTO feedback (ts, day, uid, kind, feature, text, ctx) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .bind(now, dayOf(now), uid, b.kind, clean(b.feature, 40), String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500), ctxText).run();
  return new Response(null, { status: 204, headers: h });
}

async function stats(request, env) {
  const url = new URL(request.url);
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || auth !== env.ADMIN_TOKEN) return json({ error: 'wrong token' }, 401);
  const days = Math.min(365, Math.max(1, +url.searchParams.get('days') || 30));
  const db = env.DB;
  await ensureSchema(db);
  const now = Date.now(), today = dayOf(now), since = dayOf(now - (days - 1) * 864e5), week = dayOf(now - 6 * 864e5);
  const all = (q, ...b) => db.prepare(q).bind(...b).all().then((r) => r.results || []);
  const one = (q, ...b) => db.prepare(q).bind(...b).first();
  const [totals, todayRow, weekRow, rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top] = await Promise.all([
    one(`SELECT COUNT(*) AS users, COALESCE(SUM(opens),0) AS opens, COALESCE(SUM(uses),0) AS uses, SUM(CASE WHEN last_day > first_day THEN 1 ELSE 0 END) AS came_back FROM users`),
    one(`SELECT COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens FROM events WHERE day = ?`, today),
    one(`SELECT COUNT(DISTINCT uid) AS active FROM events WHERE day >= ?`, week),
    one(`SELECT COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens, SUM(event = 'feature') AS uses FROM events WHERE day >= ?`, since),
    all(`SELECT day, COUNT(DISTINCT uid) AS active, SUM(event = 'open') AS opens, SUM(event = 'feature') AS uses FROM events WHERE day >= ? GROUP BY day ORDER BY day`, since),
    all(`SELECT first_day AS day, COUNT(*) AS n FROM users WHERE first_day >= ? GROUP BY first_day ORDER BY first_day`, since),
    all(`SELECT name, COUNT(*) AS n, COUNT(DISTINCT uid) AS users FROM events WHERE event = 'feature' AND day >= ? GROUP BY name ORDER BY n DESC LIMIT 40`, since),
    all(`SELECT word, SUM(n) AS n FROM words WHERE day >= ? GROUP BY word ORDER BY n DESC LIMIT 50`, since),
    all(`SELECT COALESCE(NULLIF(role,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(grade,''),'—') AS k, COUNT(*) AS n FROM users WHERE role = 'student' GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(age,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(platform,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT substr(uid,1,8) AS id, opens, uses, first_day, last_day, role, grade, age FROM users ORDER BY opens + uses DESC LIMIT 25`),
  ]);
  const [ratings, reports, chats] = await Promise.all([
    all(`SELECT COALESCE(NULLIF(feature,''),'chat') AS name, SUM(kind = 'up') AS up, SUM(kind = 'down') AS down FROM feedback WHERE day >= ? AND kind IN ('up','down') GROUP BY name ORDER BY up + down DESC LIMIT 20`, since),
    all(`SELECT ts, kind, feature, text, ctx FROM feedback WHERE day >= ? AND text != '' ORDER BY ts DESC LIMIT 60`, since),
    all(`SELECT src, SUM(n) AS n FROM chats WHERE day >= ? GROUP BY src ORDER BY n DESC`, since),
  ]);
  return json({ days, today, since, totals, today_: todayRow, week: weekRow, range: rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top, ratings, reports, chats });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (request.method === 'POST' && url.pathname === '/chat') return await chat(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
      if (request.method === 'POST' && url.pathname === '/f') return await feedback(request, env);
      if (request.method === 'GET' && url.pathname === '/stats') return await stats(request, env);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return new Response(DASHBOARD, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      return new Response('not found', { status: 404 });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* ------------------------------------------------------------------ dashboard */
const DASHBOARD = `__DASHBOARD_HTML__`;
