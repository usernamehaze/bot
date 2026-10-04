/* Cassie usage stats — a Cloudflare Worker + D1 database (free tier).
 *
 *   POST /e          the app sends anonymous events here (no login, no names, no messages)
 *   GET  /           the dashboard (asks for your ADMIN_TOKEN)
 *   GET  /stats      the numbers behind the dashboard (needs the token)
 *
 * Bindings (Worker → Settings):
 *   DB           a D1 database (tables are created automatically)
 *   ADMIN_TOKEN  a secret you choose — the dashboard password
 * Optional:
 *   ALLOWED_ORIGINS  comma-separated sites allowed to send events
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
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'POST, OPTIONS', 'access-control-allow-headers': 'content-type', vary: 'origin' } : {};
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
  return json({ days, today, since, totals, today_: todayRow, week: weekRow, range: rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
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
