/* Cassie server — one Cloudflare Worker (free tier) that does three jobs:
 *
 *   GET  /config     tells the app what this server can do (for example, whether Claude is on)
 *   GET  /ask?text=  a quick plain-text answer for the iPhone "Ask Cassie" Shortcut (shown in a
 *                    pop-up over the app the student is in, with no new browser tab)
 *   POST /chat       answers questions for people who haven't added their own Groq key,
 *                    using YOUR Groq key (kept secret here), with Cloudflare Workers AI as
 *                    an automatic backup when Groq is busy or out of free questions
 *   POST /e          anonymous usage counts (no login, no names, no messages)
 *   POST /image      makes a picture with Workers AI when the free picture service is busy
 *   POST /f          "Report a problem" notes
 *   POST /auth/...   Cassie accounts: sign up, sign in (email + password, or Google),
 *                    and the profile / saved mistakes that follow a person to every device
 *   GET  /           your dashboard (asks for your ADMIN_TOKEN)
 *   GET  /stats      the numbers behind the dashboard (needs the token)
 *   GET  /health     the "brain check": asks every AI real questions with known answers (needs
 *                    the token). Also runs once a day with a Cron Trigger (see server/README.md)
 *
 * Bindings (Worker → Settings → Bindings / Variables and Secrets):
 *   DB           a D1 database (tables are created automatically)
 *   ADMIN_TOKEN  secret — a password you choose for the dashboard (16+ characters)
 *   GROQ_KEY     secret — your Groq API key (console.groq.com/keys)
 *   AI           Workers AI binding — the backup brain (optional but recommended)
 *   GOOGLE_CLIENT_ID  (optional) turns on "Continue with Google" — see server/README.md
 *   GEMINI_KEY        (optional) secret — your Google AI Studio key: a second brain for photos and
 *                     text when Groq can't (aistudio.google.com/apikey). With billing on for the key,
 *                     it also makes Cassie's pictures (Gemini's image model; ~$0.07 a picture).
 *                     FREE_PICTURES_WEEK (3) / PLUS_PICTURES_DAY (5) / PRO_PICTURES_DAY (20) set how many;
 *                     GEMINI_PICTURES=off turns pictures off; GEMINI_IMAGE_MODEL picks the model.
 *   ANTHROPIC_KEY     (optional) secret — makes Claude Cassie's brain for the main chat and
 *                     photos (console.anthropic.com → API keys). Groq and Workers AI stay as backup.
 * Optional variables:
 *   FREE_DAILY_QUESTIONS  questions a free student asks a day (default 20; the website says 20)
 *   DAILY_LIMIT      all requests per free student per day, including file sections and helpers
 *                    (default 150 — a ceiling against abuse, not the "questions" students see)
 *   PLUS_DAILY_QUESTIONS / PRO_DAILY_QUESTIONS  fair use on paid plans (default 100 / 150)
 *   MINUTE_LIMIT     questions per person per minute (default 12)
 *   IMAGE_LIMIT      backup pictures per person per day (default 20)
 *   Claude is for paid plans (rows in the plans table — see /admin/plan below):
 *   FREE_CLAUDE_LIMIT   Claude answers a day for free students (default 10, on Haiku: about $0.001 each;
 *                       0 = none, Groq answers)
 *   PLUS_CLAUDE_LIMIT   Claude Haiku answers a day on Plus (default 100)
 *   PRO_CLAUDE_LIMIT    Claude Sonnet answers a day on Pro (default 15), then Haiku (PRO_HAIKU_LIMIT, 100)
 *   CLAUDE_MODEL     one Claude model for everyone (default: the newest Haiku / Sonnet for each
 *                    plan, looked up automatically from the Models API)
 *   CLAUDE_EFFORT    how hard Claude thinks: low, medium or high (default medium)
 *   ASK_LIMIT        Shortcut answers per network per day (default 40)
 *   TRANSCRIBE_DAILY_LIMIT  voice recordings written down per network per day (default 3000)
 *   ELEVENLABS_API_KEY  (secret) Cassie's studio voice: reads answers, quizzes and flashcards aloud
 *   SPEAK_DAILY_CHARS   characters of studio voice per student per day (default 12000, about 15 minutes)
 *   SPEAK_MONTHLY_CHARS characters of studio voice for the whole app per month (default 9500)
 *   ELEVENLABS_VOICE_WOMAN / ELEVENLABS_VOICE_MAN / ELEVENLABS_MODEL  optional voice and model choices
 *   ALLOW_EXTENSION  set to "off" to stop the Chrome / Edge extension using this server
 *   ALLOWED_ORIGINS  comma-separated sites allowed to use this server
 *                    (default: askcassie.study, www.askcassie.study, localhost)
 * Days are counted in Philippine time (UTC+8).
 */

const TZ_OFFSET_H = 8;
/* Cassie's care response (care.js, put here by build.py): a student who says they want to hurt or
   kill themselves gets care before anything else, from any app, the extension or the Shortcut. */
/*__CARE_JS__*/
const Care = globalThis.CassieCare;
// the student's own words in a question (not a file's text that came with it)
function studentWords(messages) {
  const last = [...messages].reverse().find((m) => m.role === 'user');
  if (!last) return '';
  const t = typeof last.content === 'string' ? last.content : last.content.filter((p) => p.type === 'text').map((p) => p.text).join('\n');
  return t.replace(/^\[I attached[^\]]*\]\s*/, '').split(/\n\n\(Excerpt from|\n\[Picture from/)[0];
}
/* ------------------------------------------------------------------ reminders (web push)
   A student turns reminders on in Settings. The browser gives a push address, and Cassie keeps it with the hour
   they picked, their time zone, their quiet hours, and two facts the app sends: when their next flashcard is due,
   and their streak (its length and last day). No names and no card words. Once an hour the Cron Trigger sends an
   EMPTY push to anyone whose hour it is: at most once a day, never in quiet hours, and only when a card is due
   today or the streak ends tonight. The phone writes the words itself from what's saved on it.
   Keys (Worker → Settings → Variables and Secrets): VAPID_PUBLIC_KEY (Text) and VAPID_PRIVATE_KEY (Secret);
   scripts/make-vapid-keys.mjs makes a pair. VAPID_SUBJECT (Text, optional): a mailto: for the push services. */
const b64uDec = (s) => Uint8Array.from(atob(String(s).replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (String(s).length % 4)) % 4)), (c) => c.charCodeAt(0)); // (b64u, below, writes it)
// only the browsers' own push services (never any other address)
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|push\.services\.mozilla\.com|push\.apple\.com|notify\.windows\.com)$/;
const pushOn = (env) => !!(env.DB && env.VAPID_PUBLIC_KEY && env.VAPID_PRIVATE_KEY);
let vapidKey = null;
async function vapidAuth(env, endpoint) {
  if (!vapidKey || vapidKey.pub !== env.VAPID_PUBLIC_KEY) {
    const pub = b64uDec(env.VAPID_PUBLIC_KEY); // (65 bytes: 4, then x and y)
    const jwk = { kty: 'EC', crv: 'P-256', d: env.VAPID_PRIVATE_KEY, x: b64u(pub.slice(1, 33)), y: b64u(pub.slice(33, 65)), ext: true };
    vapidKey = { pub: env.VAPID_PUBLIC_KEY, key: await crypto.subtle.importKey('jwk', jwk, { name: 'ECDSA', namedCurve: 'P-256' }, false, ['sign']) };
  }
  const enc = (o) => b64u(new TextEncoder().encode(JSON.stringify(o)));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const claims = enc({ aud: new URL(endpoint).origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: env.VAPID_SUBJECT || 'mailto:askcassie.study@gmail.com' });
  const sig = await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, vapidKey.key, new TextEncoder().encode(`${head}.${claims}`));
  return `vapid t=${head}.${claims}.${b64u(sig)}, k=${env.VAPID_PUBLIC_KEY}`;
}
const hourIn = (v, d) => (Number.isInteger(+v) && +v >= 0 && +v <= 23 ? +v : d);
const inQuiet = (h, from, to) => (from === to ? false : from < to ? h >= from && h < to : h >= from || h < to);
async function push(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (request.method === 'GET' && url.pathname === '/push/key') return json(pushOn(env) ? { on: true, key: env.VAPID_PUBLIC_KEY } : { on: false }, 200, h);
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  if (!pushOn(env)) return json({ error: 'Reminders aren’t switched on yet.' }, 503, h);
  let b; try { b = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  const id = /^[\w-]{8,64}$/.test(String(b.id || '')) ? String(b.id) : '';
  if (!id) return json({ error: 'bad id' }, 400, h);
  await ensureSchema(env.DB);
  const facts = [Math.max(0, Math.floor(+b.nextDue || 0)), Math.max(0, Math.min(10000, Math.floor(+b.streak || 0))), /^\d{4}-\d{2}-\d{2}$/.test(String(b.streakDay || '')) ? String(b.streakDay) : ''];
  if (url.pathname === '/push/subscribe') {
    let ep; try { ep = new URL(String(b.endpoint || '')); } catch (e) { return json({ error: 'bad endpoint' }, 400, h); }
    if (ep.protocol !== 'https:' || !PUSH_HOSTS.test(ep.hostname) || ep.href.length > 1000) return json({ error: 'bad endpoint' }, 400, h);
    const tz = Math.max(-840, Math.min(840, Math.round(+b.tz || 0)));
    await env.DB.prepare('INSERT OR REPLACE INTO push_subs (id, endpoint, hour, tz, qfrom, qto, next_due, streak, streak_day, last_sent, at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(id, ep.href, hourIn(b.hour, 19), tz, hourIn(b.quietFrom, 22), hourIn(b.quietTo, 7), ...facts, '', Date.now()).run();
    return json({ on: true }, 200, h);
  }
  if (url.pathname === '/push/state') { await env.DB.prepare('UPDATE push_subs SET next_due = ?, streak = ?, streak_day = ? WHERE id = ?').bind(...facts, id).run(); return json({ ok: true }, 200, h); }
  if (url.pathname === '/push/unsubscribe') { await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(id).run(); return json({ on: false }, 200, h); }
  return new Response('not found', { status: 404, headers: h });
}
// once an hour (the Cron Trigger): the reminders whose hour it is
async function sendReminders(env, now = Date.now()) {
  if (!pushOn(env)) return 0;
  await ensureSchema(env.DB);
  const { results } = await env.DB.prepare('SELECT id, endpoint, hour, tz, qfrom, qto, next_due, streak, streak_day, last_sent FROM push_subs LIMIT 5000').all();
  let sent = 0;
  for (const s of results || []) {
    const local = new Date(now + s.tz * 60e3), hour = local.getUTCHours(), day = local.toISOString().slice(0, 10);
    if (hour !== s.hour || s.last_sent === day || inQuiet(hour, s.qfrom, s.qto)) continue;
    const yesterday = new Date(now + s.tz * 60e3 - 864e5).toISOString().slice(0, 10);
    const dueToday = s.next_due > 0 && s.next_due <= now + (24 - hour) * 3600e3; // (due before the day ends)
    const streakEnds = s.streak > 0 && s.streak_day === yesterday; // (studied yesterday, not yet today)
    if (!dueToday && !streakEnds) continue;
    let r = null;
    try { r = await fetch(s.endpoint, { method: 'POST', headers: { authorization: await vapidAuth(env, s.endpoint), ttl: '14400', urgency: 'normal', 'content-length': '0' } }); } catch (e) { /* tried again next hour */ }
    if (r && (r.status === 404 || r.status === 410)) await env.DB.prepare('DELETE FROM push_subs WHERE id = ?').bind(s.id).run(); // (turned off in the browser)
    else if (r && r.ok) { await env.DB.prepare('UPDATE push_subs SET last_sent = ? WHERE id = ?').bind(day, s.id).run(); sent++; }
  }
  return sent;
}

// counted with nothing else: no words, no id
const countCare = (env, ctx) => ctx.waitUntil(countChat(env, dayOf(Date.now()), 'care').catch(() => {}));

const DEFAULT_ORIGINS = ['https://askcassie.study', 'https://www.askcassie.study', 'http://localhost'];
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
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, salt TEXT, google TEXT UNIQUE, name TEXT, data TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT, created INTEGER, seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS health (k TEXT PRIMARY KEY, ts INTEGER, data TEXT)`,
  // live board rooms: a code, who's in, and every drawing step in order (rooms last a day)
  `CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created INTEGER, owner TEXT, title TEXT)`,
  `CREATE TABLE IF NOT EXISTS room_members (code TEXT, uid TEXT, name TEXT, seen INTEGER, PRIMARY KEY (code, uid))`,
  // paid plans: an account's plan and when it ends (written by the owner's /admin/plan, later by payments)
  `CREATE TABLE IF NOT EXISTS plans (account TEXT PRIMARY KEY, plan TEXT, until INTEGER, note TEXT, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS room_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, uid TEXT, ts INTEGER, op TEXT)`,
  // where each person's pointer is right now (and their laser pointer's trail) — kept, not logged
  `CREATE TABLE IF NOT EXISTS room_here (code TEXT, uid TEXT, ts INTEGER, p TEXT, PRIMARY KEY (code, uid))`,
  // daily puzzles: each student's first finish of each puzzle, each day (lower value = better)
  `CREATE TABLE IF NOT EXISTS scores (day TEXT, game TEXT, uid TEXT, name TEXT, value REAL, shown TEXT, ts INTEGER, PRIMARY KEY (day, game, uid))`,
  `CREATE INDEX IF NOT EXISTS room_ops_code ON room_ops(code, id)`,
  // sign-in with Google or Apple: which provider and its id for the person (nothing else is kept)
  `CREATE TABLE IF NOT EXISTS identities (provider TEXT, sub TEXT, account TEXT, PRIMARY KEY (provider, sub))`,
  // reminders: a push address and when to use it (no names, no card words)
  `CREATE TABLE IF NOT EXISTS push_subs (id TEXT PRIMARY KEY, endpoint TEXT, hour INTEGER, tz INTEGER, qfrom INTEGER, qto INTEGER, next_due INTEGER, streak INTEGER, streak_day TEXT, last_sent TEXT, at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS identities_account ON identities(account)`,
  // the Pasado Pass early list: an email to tell when it opens, which plan, where they joined (nothing else)
  `CREATE TABLE IF NOT EXISTS early (email TEXT PRIMARY KEY, plan TEXT, src TEXT, account TEXT, at INTEGER)`,
  // payments (PayMongo): who bought which pass, for how much, and PayMongo's payment number (never card details)
  `CREATE TABLE IF NOT EXISTS payments (id TEXT PRIMARY KEY, session TEXT, account TEXT, plan TEXT, bill TEXT, php INTEGER, shown TEXT, status TEXT, pay_ref TEXT, method TEXT, live INTEGER, created INTEGER, paid INTEGER)`,
  `CREATE INDEX IF NOT EXISTS payments_session ON payments(session)`,
  `INSERT OR IGNORE INTO identities (provider, sub, account) SELECT 'google', google, id FROM accounts WHERE google IS NOT NULL`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  schemaReady = true;
}

const dayOf = (ms) => new Date(ms + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
// One more use of something counted per period (a day, an hour, a week, a month): adds `by` and
// gives back the new total, in one query. A new period starts the count again.
const QUOTA_SQL = `INSERT INTO quota (k, day, n) VALUES (?1, ?2, ?3)
  ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + ?3 ELSE ?3 END, day = ?2 RETURNING n`;
const countUseQuery = (db, key, period, by = 1) => db.prepare(QUOTA_SQL).bind(key, period, by);
async function countUse(db, key, period, by = 1) { const r = await countUseQuery(db, key, period, by).first(); return (r && r.n) || 0; }
// …and give uses back (one each) when what was counted didn't happen
const uncountUses = (db, keys) => db.batch(keys.map((k) => db.prepare('UPDATE quota SET n = MAX(0, n - 1) WHERE k = ?').bind(k)));
const clean = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, n);
// feature and event names are short labels like "quiz" or "labs: pendulum" — anything else is dropped
const label = (v, n = 40) => { const t = clean(v, n); return /^[\w .:/+&()'’-]*$/u.test(t) ? t : ''; };

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS);
  const ok = allowed.some((a) => origin === a || (a === 'http://localhost' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))
    || (env.ALLOW_EXTENSION !== 'off' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)); // the Cassie extension (Chrome and Edge)
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-expose-headers': 'retry-after, x-cassie-source, x-cassie-left, x-cassie-plan, x-speak', vary: 'origin' } : {};
}
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', ...extra } });
// The dashboard page: only its own script may run (a fresh one-time code each visit), it can't be
// put in another site's frame, and it can only talk to this server.
function dashboard() {
  const nonce = randomToken(16);
  return new Response(DASHBOARD.replace('<script>', `<script nonce="${nonce}">`), { headers: {
    'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline'; img-src data:; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
    'x-frame-options': 'DENY', 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer',
    'strict-transport-security': 'max-age=31536000',
  } });
}

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
    .map((e) => ({ e: e.e, n: label(e.n, 40), t: Math.min(now, Math.max(now - 7 * 864e5, +e.t || now)) }));
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
// A per-network speed limit for everything that writes to the database, so nobody can flood it.
// (Counted per Worker instance, so it's a guard rail, not an exact number.)
const SPEED = { '/push/': 60, '/e': 400, '/f': 100, '/scores/': 200, '/room/create': 30, '/room': 3000, '/auth/': 200, '/transcribe': 300, '/image': 100, '/speak': 240 };
function tooFast(request, path) {
  const rule = Object.keys(SPEED).find((p) => (p.endsWith('/') ? path.startsWith(p) : path === p || path.startsWith(p + '/')));
  if (!rule) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'unknown', minute = Math.floor(Date.now() / 60e3), k = `s|${rule}|${ip}`;
  const hit = minuteHits.get(k);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(k, { m: minute, n });
  if (minuteHits.size > 5000) minuteHits.clear();
  return n > SPEED[rule];
}
let vision = { ids: [], at: 0, all: [] };

function allowedOrigin(request, env) {
  const origin = request.headers.get('origin') || '';
  const h = cors(origin, env);
  return h['access-control-allow-origin'] ? h : null;
}
function msUntilMidnightPH(now) {
  const ph = new Date(now + TZ_OFFSET_H * 3600e3);
  return 864e5 - ((ph.getUTCHours() * 3600 + ph.getUTCMinutes() * 60 + ph.getUTCSeconds()) * 1000);
}
function chatError(message, status, h, extra = {}, code) {
  return json({ error: code ? { message, code } : { message } }, status, { ...h, ...extra });
}
// Groq's picture-reading models change over time — ask Groq which ones it has now, best first.
async function visionModels(env, fresh = false) {
  // an empty answer is remembered too (6 h), so photos don't wait on a fresh search every time
  if (!fresh && vision.at && Date.now() - vision.at < (vision.ids.length ? 3600e3 : 6 * 3600e3)) return vision.ids;
  try {
    const r = await fetch(`${GROQ}/models`, { headers: { authorization: `Bearer ${env.GROQ_KEY}` }, signal: AbortSignal.timeout(10000) });
    const ids = ((await r.json()).data || []).filter((m) => m.active !== false).map((m) => m.id);
    const score = (id) => (/llama-4-scout/i.test(id) ? 0 : /llama-4-maverick/i.test(id) ? 1 : /vision|llava|pixtral|(^|[-/])vl([-/]|$)|-vl-|multimodal|llama-4|gemma-?3/i.test(id) ? 2 : 9);
    let list = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed/i.test(id) && score(id) < 9).sort((a, b) => score(a) - score(b));
    if (!list.length) {
      // no name looks like a picture reader (Groq renames them): show each model a tiny picture of 7 × 8 once
      const maybe = ids.filter((id) => !/whisper|tts|guard|playai|orpheus|embed|compound/i.test(id)).slice(0, 8);
      const probe = [{ role: 'user', content: [{ type: 'text', text: 'Read the sum in this picture and work it out. Reply with only the number.' }, { type: 'image_url', image_url: { url: CHECK_PNG } }] }];
      const seen = await Promise.all(maybe.map((m) => groqAsk(env, m, probe, 400).then((t) => (/\b56\b/.test(t) ? m : null), () => null)));
      list = seen.filter(Boolean);
    }
    vision = { ids: list, at: Date.now(), all: ids };
  } catch (e) { /* keep the old list */ }
  return vision.ids;
}

/* Gemini (the owner's optional GEMINI_KEY): a second brain for photos and text.
   Google retires model names often, so the server asks which models this key can use
   (once every 6 hours) and picks the newest Flash ones. GEMINI_MODEL still goes first. */
const GEMINI_FALLBACK = ['gemini-flash-latest', 'gemini-flash-lite-latest'];
let gemini = { ids: [], at: 0, all: [] };
const geminiGone = new Set(); // names Google has retired ("no longer available"): never tried again
// Google refuses its free Gemini API from some places (Cloudflare can run Cassie in Hong Kong,
// for one). When it does, Cassie skips Gemini for a while instead of asking every model in turn.
let geminiBlocked = { until: 0, where: '' };
let lastColo = ''; // the Cloudflare data centre running this request (from request.cf)
const LOCATION_BLOCKED = /location is not supported/i;
function rankGemini(models) {
  const ids = models.filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
    .map((m) => String(m.name || '').replace(/^models\//, ''))
    .filter((id) => /^gemini-/.test(id) && !/image|tts|audio|live|embed|thinking|computer|robotics|native|aqa|learnlm|banana/i.test(id));
  const ver = (id) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [0, 0])[1]) || 0;
  const rank = (id) => (/flash-lite/.test(id) ? 2 : /flash/.test(id) ? 0 : /pro/.test(id) ? 4 : 6) + (/preview|exp/.test(id) ? 1 : 0);
  return ids.sort((a, b) => rank(a) - rank(b) || ver(b) - ver(a) || a.length - b.length);
}
async function geminiModels(env) {
  if (gemini.ids.length && Date.now() - gemini.at < 6 * 3600e3) return gemini.ids;
  try {
    const r = await fetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=200', { headers: { 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(10000) });
    if (r.ok) {
      const models = (await r.json()).models || [];
      const ids = rankGemini(models);
      if (ids.length) gemini = { ids: ids.filter((id) => !geminiGone.has(id)).slice(0, 4), at: Date.now(), all: models.map((m) => String(m.name || '').replace(/^models\//, '')) };
    } else {
      let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
      if (LOCATION_BLOCKED.test(m)) geminiBlocked = { until: Date.now() + 10 * 60e3, where: lastColo };
    }
  } catch (e) { /* use the fallback names */ }
  return gemini.ids.length ? gemini.ids : GEMINI_FALLBACK;
}
async function askGemini(env, messages, maxTokens = 2048) {
  if (!env.GEMINI_KEY) return { reply: null, detail: '' };
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const contents = messages.filter((m) => m.role !== 'system').map((m) => ({
    role: m.role === 'assistant' ? 'model' : 'user',
    parts: (typeof m.content === 'string' ? [{ type: 'text', text: m.content }] : m.content).map((p) => {
      const d = p.type === 'image_url' && /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(p.image_url.url);
      return d ? { inlineData: { mimeType: d[1], data: d[2] } } : { text: p.text || '' };
    }),
  }));
  while (contents.length && contents[0].role !== 'user') contents.shift();
  if (geminiBlocked.until > Date.now()) return { reply: null, detail: geminiBlockedText(), blocked: true };
  let detail = '';
  const list = await geminiModels(env);
  if (geminiBlocked.until > Date.now()) return { reply: null, detail: geminiBlockedText(), blocked: true };
  for (const model of [...new Set(env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...list] : list)].filter((m) => !geminiGone.has(m)).slice(0, 4)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(30000),
        body: JSON.stringify({ ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}), contents, generationConfig: { maxOutputTokens: Math.max(4096, maxTokens * 2), temperature: 0.5 } }),
      });
      if (r.ok) {
        const parts = (await r.json()).candidates?.[0]?.content?.parts || [];
        const reply = parts.filter((x) => !x.thought).map((x) => x.text || '').join('').trim();
        if (reply) return { reply, detail: '' };
        detail += `${model}: empty answer · `;
      } else {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        if (LOCATION_BLOCKED.test(m)) { geminiBlocked = { until: Date.now() + 10 * 60e3, where: lastColo }; return { reply: null, detail: geminiBlockedText(), blocked: true }; }
        if (r.status === 404) { gemini.at = 0; if (/no longer available|not found/i.test(m)) geminiGone.add(model); } // a retired name: never again
        detail += `${model}: ${reasonOf(r.status, m)} · `;
      }
    } catch (e) { detail += `${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : reasonOf(0, e.message)} · `; }
  }
  return { reply: null, detail: detail ? 'Gemini ' + detail.replace(/ · $/, '') : '' };
}

function geminiBlockedText() {
  return `Google doesn't allow its free Gemini API from where Cloudflare is running Cassie right now${geminiBlocked.where ? ` (data centre ${geminiBlocked.where})` : ''}. Groq and Workers AI answer instead. Fix: Cloudflare → Workers & Pages → cassie → Settings → Placement → Smart.`;
}

/* Cloudflare Workers AI picture readers (the AI binding): the last backup for photos, with
   none of Groq's or Google's free-tier limits. */
const AI_VISION = ['@cf/meta/llama-4-scout-17b-16e-instruct', '@cf/google/gemma-3-12b-it'];
async function aiVision(env, messages, maxTokens = 1500) {
  if (!env.AI) return { reply: null, detail: '' };
  let detail = '';
  for (const model of env.AI_VISION_MODEL ? [env.AI_VISION_MODEL, ...AI_VISION] : AI_VISION) {
    try {
      const o = await env.AI.run(model, { messages, max_tokens: Math.min(maxTokens, 2048), temperature: 0.4 });
      const reply = String((o && (o.response ?? o.result?.response)) || '').trim();
      if (reply) return { reply, detail: '' };
      detail += `${model}: empty answer · `;
    } catch (e) { detail += `${model}: ${reasonOf(0, e.message || e)} · `; }
  }
  return { reply: null, detail: 'Workers AI ' + detail.replace(/ · $/, '') };
}

/* Problems the server hit, for the dashboard (a few hundred a day at most, no messages).
   What went wrong at a service is a short reason picked here: a service's own error text is never
   kept, because it can quote the request (a student's question, file or photo). */
function reasonOf(status, msg = '') {
  const m = String(msg || '');
  const why = /timeout|timed out|no answer in/i.test(m) ? 'no answer in time'
    : /location|region|country/i.test(m) && /not supported|allow|available/i.test(m) ? 'not allowed from this location'
    : /billing|payment|credit/i.test(m) ? 'billing'
    : /rate.?limit|too many|resource.?exhausted|quota|limit:/i.test(m) || status === 429 ? 'over its limit'
    : /decommission|no longer|not found|does not exist|unknown model|model_not_found/i.test(m) || status === 404 ? 'model not found'
    : /too large|too long|payload|context length|maximum/i.test(m) || status === 413 ? 'too large'
    : /safety|blocked|policy/i.test(m) ? 'blocked by its safety rules'
    : /api.?key|unauthori|permission|forbidden|invalid.?auth/i.test(m) || status === 401 || status === 403 ? 'key not accepted'
    : /image|vision|picture/i.test(m) ? 'can’t read pictures'
    : status >= 500 ? 'service error' : status ? 'refused' : 'no connection';
  return status ? `${status} ${why}` : why;
}
let problemDay = '', problemCount = 0;
async function logProblem(env, where, detail) {
  try {
    const day = dayOf(Date.now());
    if (day !== problemDay) { problemDay = day; problemCount = 0; }
    if (++problemCount > 300) return;
    await ensureSchema(env.DB);
    await env.DB.prepare('INSERT INTO feedback (ts, day, uid, kind, feature, text, ctx) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(Date.now(), day, 'server', 'error', String(where).slice(0, 40), String(detail || '').slice(0, 600), 'server').run();
  } catch (e) { /* the dashboard is best-effort */ }
}
/* Tidy-up: what is only kept for a while goes when its time is up, whether or not anyone uses the
   feature again: study rooms after a day, the daily and hourly limit counts (they hold IP
   addresses) once their day is over, puzzle scores after 14 days. (Weekly and monthly allowances
   stay until their week or month ends.) Runs every 10 minutes while the server is busy, and from
   the Cron Trigger. */
let tidiedAt = 0;
async function tidy(env) {
  if (!env.DB) return;
  await ensureSchema(env.DB);
  const now = Date.now(), old = now - ROOM_HOURS * 3600e3, today = dayOf(now);
  await env.DB.batch([
    env.DB.prepare('DELETE FROM room_ops WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
    env.DB.prepare('DELETE FROM room_members WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
    env.DB.prepare('DELETE FROM room_here WHERE ts < ?').bind(old),
    env.DB.prepare('DELETE FROM rooms WHERE created < ?').bind(old),
    // a day (2026-10-14) or an hour (2026-10-14T05) that is over; weeks (gpic:) and months (2026-10) stay
    env.DB.prepare("DELETE FROM quota WHERE day < ? AND length(day) IN (10, 13) AND k NOT LIKE 'gpic:%'").bind(today),
    env.DB.prepare('DELETE FROM scores WHERE day < ?').bind(dayOf(now - 14 * 86400e3)),
    env.DB.prepare("DELETE FROM payments WHERE status = 'pending' AND created < ?").bind(now - 2 * 864e5), // (checkouts never paid)
  ]);
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

/* ------------------------------------------------------------------ Claude
   With an ANTHROPIC_KEY secret, questions from the app's main chat (body.brain === 'claude')
   go to Claude first. Raw HTTP to Anthropic's Messages API: a Worker pasted into the
   dashboard can't load npm packages. Groq and Workers AI stay as the backup. */
const ANTHROPIC = 'https://api.anthropic.com/v1';
let claudeIds = { ids: [], at: 0 };
const anthropicHeaders = (env) => ({ 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' });
// Anthropic's newest model of a family — haiku, sonnet or opus (the Models API lists newest
// first) — unless CLAUDE_MODEL picks one for everyone.
async function claudeModel(env, family = 'opus') {
  if (env.CLAUDE_MODEL) return env.CLAUDE_MODEL;
  if (!claudeIds.ids.length || Date.now() - claudeIds.at > 6 * 3600e3) {
    try {
      const r = await fetch(`${ANTHROPIC}/models?limit=100`, { headers: anthropicHeaders(env), signal: AbortSignal.timeout(10000) });
      const ids = ((await r.json()).data || []).map((m) => m.id);
      if (ids.length) claudeIds = { ids, at: Date.now() };
    } catch (e) { /* keep the old list */ }
  }
  const ids = claudeIds.ids;
  return ids.find((x) => x.toLowerCase().includes(family)) || ids[0] || '';
}
// Groq-style messages → Claude: the system prompt goes on its own, pictures become image blocks,
// and turns alternate user / assistant starting with the user.
function toClaude(messages) {
  const system = messages.filter((m) => m.role === 'system').map((m) => (typeof m.content === 'string' ? m.content : '')).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    const blocks = typeof m.content === 'string'
      ? [{ type: 'text', text: m.content }]
      : m.content.map((p) => {
        const d = p.type === 'image_url' && /^data:(image\/[\w.+-]+);base64,(.+)$/.exec(p.image_url.url);
        return d ? { type: 'image', source: { type: 'base64', media_type: d[1], data: d[2] } } : { type: 'text', text: p.text || '' };
      });
    const content = blocks.filter((b) => b.type !== 'text' || b.text.trim());
    if (!content.length) continue;
    const last = out[out.length - 1];
    if (last && last.role === m.role) last.content.push(...content);
    else out.push({ role: m.role, content });
  }
  while (out.length && out[0].role !== 'user') out.shift();
  return { system, messages: out };
}
async function askClaude(env, cleaned, family = 'opus') {
  const model = await claudeModel(env, family);
  if (!model) return null;
  const { system, messages } = toClaude(cleaned.messages);
  if (!messages.length) return null;
  const base = { model, max_tokens: 16000, messages, ...(system ? { system } : {}) };
  const effort = ['low', 'medium', 'high'].includes(env.CLAUDE_EFFORT) ? env.CLAUDE_EFFORT : 'medium';
  // effort, plus a server-side fallback model if a safety check declines a harmless study question
  let r;
  try {
    r = await fetch(`${ANTHROPIC}/messages`, {
      method: 'POST', headers: { ...anthropicHeaders(env), 'anthropic-beta': 'server-side-fallback-2026-07-01' },
      body: JSON.stringify({ ...base, output_config: { effort }, fallbacks: 'default' }), signal: AbortSignal.timeout(120000),
    });
    // a model picked in CLAUDE_MODEL may not take those options: ask it plainly
    if (r.status === 400) r = await fetch(`${ANTHROPIC}/messages`, { method: 'POST', headers: anthropicHeaders(env), body: JSON.stringify(base), signal: AbortSignal.timeout(120000) });
  } catch (e) { return null; } // no answer in 2 minutes: the backup brain answers
  if (!r.ok) return null;
  const data = await r.json();
  if (data.stop_reason === 'refusal') return null; // let the backup brain try
  const text = (data.content || []).filter((b) => b.type === 'text').map((b) => b.text).join('').trim();
  return text || null;
}
/* ------------------------------------------------------------------ plans
   Free, Plus or Pro. A plan belongs to an account (sign in to subscribe), so it follows the
   student to every device. The owner can give one with /admin/plan; payments will write here too. */
// (one read on every signed-in question: the session and its plan, not the whole account)
async function planOf(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{20,100}$/.test(token)) return { plan: 'free' };
  try {
    const row = await env.DB.prepare('SELECT s.account, s.created, p.plan, p.until, p.note FROM sessions s JOIN accounts a ON a.id = s.account LEFT JOIN plans p ON p.account = s.account AND p.until > ? WHERE s.token = ?')
      .bind(Date.now(), await sha256(token)).first();
    if (!row || Date.now() - row.created > SESSION_DAYS * 864e5) return { plan: 'free' };
    return { ...paidPlan(row), account: row.account };
  } catch (e) { return { plan: 'free' }; }
}
const paidPlan = (row) => (row && ['plus', 'pro'].includes(row.plan) ? { plan: row.plan, until: row.until, bill: (/\bpaid (month|sem|year)\b/.exec(row.note || '') || [])[1] || '' } : { plan: 'free', until: 0 });
const planQuery = (env, id) => env.DB.prepare('SELECT plan, until, note FROM plans WHERE account = ? AND until > ?').bind(id, Date.now());
async function accountPlan(env, id) { return paidPlan(await planQuery(env, id).first()); }
// what each plan gets a day: questions the student sees, every request (a ceiling against abuse),
// and Claude answers (family, then a second family once the first runs out)
function limitsFor(env, plan) {
  const n = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  if (plan === 'pro') return { questions: n(env.PRO_DAILY_QUESTIONS, 150), all: n(env.PRO_DAILY_LIMIT, 600), claude: [['sonnet', n(env.PRO_CLAUDE_LIMIT, 15)], ['haiku', n(env.PRO_HAIKU_LIMIT, 100)]] };
  if (plan === 'plus') return { questions: n(env.PLUS_DAILY_QUESTIONS, 100), all: n(env.PLUS_DAILY_LIMIT, 400), claude: [['haiku', n(env.PLUS_CLAUDE_LIMIT, 100)]] };
  return { questions: n(env.FREE_DAILY_QUESTIONS, 20), all: n(env.DAILY_LIMIT, 150), claude: [['haiku', n(env.FREE_CLAUDE_LIMIT, 10)]] };
}
// The Pasado Pass early list: POST /early {email, plan, src}. Signed in, the account's own email is used
// (an email typed instead is fine too). Only the email, the plan, where they joined and when are kept.
async function early(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  await ensureSchema(env.DB);
  if (!(await authAllowed(request, env, 'early:' + (request.headers.get('cf-connecting-ip') || 'unknown'), 20))) return json({ error: 'Too many tries. Wait a while, then try again.' }, 429, h);
  const b = await request.json().catch(() => ({}));
  const { account } = await planOf(request, env);
  let email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  if (!email && account) email = String(((await env.DB.prepare('SELECT email FROM accounts WHERE id = ?').bind(account).first()) || {}).email || '').toLowerCase();
  if (!EMAIL_RE.test(email) || DISPOSABLE_RE.test(email)) return json({ error: 'Type the email you check, like juan@gmail.com.' }, 400, h);
  const plan = ['plus', 'pro'].includes(b.plan) ? b.plan : 'plus';
  const src = /^[a-z0-9-]{1,24}$/.test(String(b.src || '')) ? String(b.src) : 'site';
  await env.DB.prepare('INSERT INTO early (email, plan, src, account, at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(email) DO UPDATE SET plan = excluded.plan, account = COALESCE(excluded.account, early.account)')
    .bind(email, plan, src, account || null, Date.now()).run();
  return json({ ok: true, email }, 200, h);
}
// the owner's early list (dashboard password): how many, from where, and the emails to write to when it opens
async function adminEarly(request, env) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  const r = await env.DB.prepare('SELECT email, plan, src, at FROM early ORDER BY at DESC LIMIT 5000').all();
  return json({ n: (r.results || []).length, list: r.results || [] });
}
/* ------------------------------------------------------------------ payments (PayMongo)
   Every plan is a pass: one payment for a set time, and it never renews (Monthly 30 days, Semester
   152 days, Yearly 365). The prices live here only (a page never sends its own). PayMongo charges in
   pesos, so a US$ plan is charged its fixed peso price (US$ × USD_PHP_RATE, rounded up to …9).
   Cloudflare Secrets: PAYMONGO_SECRET_KEY, PAYMONGO_WEBHOOK_SECRET; optional PAYMONGO_METHODS. */
const PAY_DAYS = { month: 30, sem: 152, year: 365 };
const PAY_PHP = { plus: { month: 149, sem: 599, year: 1490 }, pro: { month: 499, sem: 1999, year: 4990 } };
const PAY_USD = { plus: { month: 7.99, sem: 31.99, year: 79.9 }, pro: { month: 14.99, sem: 59.99, year: 149.9 } };
const PAY_LONG = { month: '30 days', sem: 'the semester (5 months)', year: '12 months' };
const payOn = (env) => !!env.PAYMONGO_SECRET_KEY;
function payPrice(env, plan, bill, cur) {
  if (!PAY_PHP[plan] || !PAY_DAYS[bill]) return null;
  if (cur === 'usd') {
    const rate = +env.USD_PHP_RATE > 20 && +env.USD_PHP_RATE < 200 ? +env.USD_PHP_RATE : 61.5, usd = PAY_USD[plan][bill];
    return { php: Math.ceil((usd * rate) / 10) * 10 - 1, shown: `US$${usd.toFixed(2)}` };
  }
  return { php: PAY_PHP[plan][bill], shown: `₱${PAY_PHP[plan][bill].toLocaleString('en-PH')}` };
}
const hmacHex = async (secret, text) => {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return [...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(text)))].map((b) => b.toString(16).padStart(2, '0')).join('');
};
async function pay(request, env, url, ctx) {
  if (request.method === 'POST' && url.pathname === '/pay/webhook') return payWebhook(request, env, ctx);
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  await ensureSchema(env.DB);
  if (!payOn(env)) return json({ error: 'Paid plans are almost here. Everything on Free works today.', code: 'pay_off' }, 503, h);
  const acc = await accountFromRequest(request, env);
  if (!acc) return json({ error: 'Sign in first, so the plan has an account to belong to.', code: 'signin' }, 401, h);
  // the student's own payment, after PayMongo sends them back (the plan arrives with PayMongo's message)
  if (request.method === 'GET' && url.pathname === '/pay/status') {
    const row = await env.DB.prepare('SELECT status, plan, bill, php, shown FROM payments WHERE id = ? AND account = ?').bind(String(url.searchParams.get('id') || '').slice(0, 40), acc.id).first();
    if (!row) return json({ error: 'No such payment.' }, 404, h);
    return json({ ...row, ...(row.status === 'paid' ? { until: (await accountPlan(env, acc.id)).until } : {}) }, 200, h);
  }
  if (!(request.method === 'POST' && url.pathname === '/pay/checkout')) return new Response('not found', { status: 404, headers: h });
  if (!(await authAllowed(request, env, 'pay:' + acc.id, 20))) return json({ error: 'Too many tries. Wait a while, then try again.' }, 429, h);
  const b = await request.json().catch(() => ({}));
  const plan = ['plus', 'pro'].includes(b.plan) ? b.plan : '', bill = PAY_DAYS[b.bill] ? b.bill : '', cur = b.cur === 'usd' ? 'usd' : 'php';
  const price = payPrice(env, plan, bill, cur);
  if (!price) return json({ error: 'Pick a plan first.' }, 400, h);
  const id = 'cas_' + [...crypto.getRandomValues(new Uint8Array(12))].map((x) => x.toString(16).padStart(2, '0')).join('');
  const back = (() => { try { return new URL(request.headers.get('origin')).origin; } catch (e) { return 'https://askcassie.study'; } })();
  const name = `Cassie ${plan === 'pro' ? 'Pro' : 'Plus'}, ${PAY_LONG[bill]}`;
  const note = cur === 'usd' ? `${price.shown}, charged as ₱${price.php.toLocaleString('en-PH')} (PHP). One payment, never renews.` : 'One payment. Never renews.';
  const methods = cur === 'usd' ? ['card'] : String(env.PAYMONGO_METHODS || 'card,gcash,paymaya').split(',').map((x) => x.trim()).filter(Boolean);
  let res, out;
  try {
    res = await fetch('https://api.paymongo.com/v1/checkout_sessions', {
      method: 'POST',
      headers: { 'content-type': 'application/json', accept: 'application/json', authorization: 'Basic ' + btoa(String(env.PAYMONGO_SECRET_KEY) + ':') },
      body: JSON.stringify({ data: { attributes: {
        line_items: [{ currency: 'PHP', amount: price.php * 100, name, quantity: 1, description: note }],
        payment_method_types: methods, description: `${name}. ${note}`, reference_number: id,
        success_url: `${back}/app.html?paid=${id}`, cancel_url: `${back}/app.html?paid=cancel`,
        send_email_receipt: true, show_description: true, show_line_items: true,
        ...(acc.email ? { billing: { email: acc.email, name: acc.name || acc.email.split('@')[0] } } : {}),
      } } }),
    });
    out = await res.json().catch(() => ({}));
  } catch (e) { res = null; }
  const session = out && out.data && out.data.id, checkoutUrl = out && out.data && out.data.attributes && out.data.attributes.checkout_url;
  if (!res || !res.ok || !session || !checkoutUrl) {
    // (only the status and PayMongo's error code: never the request, which names the student)
    ctx.waitUntil(logProblem(env, 'pay: checkout', `PayMongo ${res ? res.status : 'unreachable'} ${((out && out.errors && out.errors[0]) || {}).code || ''}`).catch(() => {}));
    return json({ error: 'Payments aren’t working right now. Try again in a few minutes.', code: 'pay_down' }, 502, h);
  }
  await env.DB.prepare('INSERT INTO payments (id, session, account, plan, bill, php, shown, status, live, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(id, session, acc.id, plan, bill, price.php, price.shown, 'pending', /^sk_live_/.test(String(env.PAYMONGO_SECRET_KEY)) ? 1 : 0, Date.now()).run();
  return json({ url: checkoutUrl, id, php: price.php, shown: price.shown }, 200, h);
}
// PayMongo's message that a checkout was paid: checked with the webhook's secret (HMAC-SHA256 of
// "timestamp.body", compared with te in test mode and li when live), then the plan is given once.
async function payWebhook(request, env, ctx) {
  if (!env.PAYMONGO_WEBHOOK_SECRET) return new Response('not set up', { status: 503 });
  await ensureSchema(env.DB);
  const raw = await request.text();
  const sig = Object.fromEntries(String(request.headers.get('paymongo-signature') || '').split(',').map((x) => x.trim().split('=')).filter((x) => x.length === 2));
  let evt; try { evt = JSON.parse(raw); } catch (e) { return new Response('bad', { status: 400 }); }
  const a = (evt && evt.data && evt.data.attributes) || {};
  const want = await hmacHex(String(env.PAYMONGO_WEBHOOK_SECRET), `${sig.t}.${raw}`);
  if (!sig.t || !sameText(String((a.livemode ? sig.li : sig.te) || ''), want)) return new Response('bad signature', { status: 401 });
  if (a.type !== 'checkout_session.payment.paid') return new Response(null, { status: 204 }); // (other events: nothing to do)
  const cs = a.data || {}, ca = cs.attributes || {};
  const row = await env.DB.prepare('SELECT * FROM payments WHERE session = ? OR id = ?').bind(String(cs.id || ''), String(ca.reference_number || '')).first();
  if (!row) { ctx.waitUntil(logProblem(env, 'pay: webhook', 'a paid checkout Cassie has no record of').catch(() => {})); return new Response(null, { status: 204 }); }
  if (row.status === 'paid') return new Response(null, { status: 204 }); // (PayMongo may send it twice: the plan is given once)
  const p = (ca.payments || [])[0] || {}, pa = p.attributes || {};
  const amount = pa.amount != null ? +pa.amount : (ca.line_items || []).reduce((t, x) => t + (+x.amount || 0) * (+x.quantity || 1), 0);
  if (amount && amount !== row.php * 100) { // never a plan for a different amount than its price
    await env.DB.prepare("UPDATE payments SET status = 'mismatch', paid = ? WHERE id = ?").bind(Date.now(), row.id).run();
    ctx.waitUntil(logProblem(env, 'pay: webhook', `amount ${amount} for a ${row.php * 100} plan`).catch(() => {}));
    return new Response(null, { status: 204 });
  }
  // the plan: the same plan still running gets the days added on; otherwise it starts now
  const now = Date.now(), cur = await env.DB.prepare('SELECT plan, until FROM plans WHERE account = ?').bind(row.account).first();
  const from = cur && cur.plan === row.plan && cur.until > now ? cur.until : now, until = from + PAY_DAYS[row.bill] * 864e5;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO plans (account, plan, until, note, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account) DO UPDATE SET plan = excluded.plan, until = excluded.until, note = excluded.note, updated = excluded.updated')
      .bind(row.account, row.plan, until, `paid ${row.bill} ${row.id}`, now),
    env.DB.prepare("UPDATE payments SET status = 'paid', paid = ?, pay_ref = ?, method = ?, live = ? WHERE id = ?")
      .bind(now, String(p.id || '').slice(0, 60), String((pa.source && pa.source.type) || ca.payment_method_used || '').slice(0, 20), a.livemode ? 1 : 0, row.id),
  ]);
  return new Response(null, { status: 204 });
}

// The owner gives (or ends) a plan: POST /admin/plan {"email": "...", "plan": "pro", "days": 30}
// with the dashboard password; GET /admin/plan?email=... shows it.
async function adminPlan(request, env, url) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  const b = request.method === 'POST' ? await request.json().catch(() => ({})) : { email: url.searchParams.get('email') };
  const email = String(b.email || '').trim().toLowerCase().slice(0, 200);
  const acc = email && await env.DB.prepare('SELECT id, email, name FROM accounts WHERE email = ?').bind(email).first();
  if (!acc) return json({ error: 'No Cassie account with that email. They need to sign up first.' }, 404);
  if (request.method === 'POST') {
    const plan = ['free', 'plus', 'pro'].includes(b.plan) ? b.plan : null;
    if (!plan) return json({ error: 'plan must be free, plus or pro' }, 400);
    const days = Math.max(0, Math.min(3660, +b.days || 30)), until = plan === 'free' ? 0 : Date.now() + days * 864e5;
    await env.DB.prepare('INSERT INTO plans (account, plan, until, note, updated) VALUES (?, ?, ?, ?, ?) ON CONFLICT(account) DO UPDATE SET plan = excluded.plan, until = excluded.until, note = excluded.note, updated = excluded.updated')
      .bind(acc.id, plan, until, String(b.note || 'given by the owner').slice(0, 200), Date.now()).run();
  }
  const row = await env.DB.prepare('SELECT plan, until, note FROM plans WHERE account = ?').bind(acc.id).first();
  const active = row && row.until > Date.now() ? row.plan : 'free';
  return json({ email: acc.email, name: acc.name, plan: active, until: active === 'free' ? null : new Date(row.until).toISOString(), note: row ? row.note : '' });
}

async function config(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  // with payments on: every pass's price, in pesos and in US$ (with the pesos it is charged as), from the server's own table
  const prices = payOn(env) ? Object.fromEntries(['php', 'usd'].map((c) => [c, Object.fromEntries(['plus', 'pro'].map((pl) => [pl, Object.fromEntries(Object.keys(PAY_DAYS).map((bi) => [bi, payPrice(env, pl, bi, c)]))]))])) : null;
  return json({ claude: !!env.ANTHROPIC_KEY, pictures: geminiPicturesOn(env), pay: payOn(env), prices }, 200, { ...h, 'cache-control': 'max-age=300' });
}

/* ---------------------------------------------------------------- talking with Cassie
   Voice chat on phones whose browser can't turn speech into text by itself (and on
   Firefox): the app records what the student says and sends it here. Groq's Whisper
   writes it down; Cloudflare's own Whisper is the backup. Nothing is kept. */
const WHISPER = ['whisper-large-v3-turbo', 'whisper-large-v3'];
async function transcribe(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  let form;
  try { form = await request.formData(); } catch (e) { return chatError('Send the recording as a form.', 400, h); }
  const file = form.get('file');
  if (!file || typeof file === 'string' || !file.size) return chatError('No recording.', 400, h);
  if (file.size > 8 * 1024 * 1024) return chatError('That recording is too long. Talk in shorter bits.', 413, h);
  const uid = /^[\w-]{8,64}$/.test(String(form.get('uid') || '')) ? String(form.get('uid')) : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now(), minute = Math.floor(now / 60e3), mk = `t|${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  if (n > (+env.TRANSCRIBE_MINUTE_LIMIT || 20)) return chatError('Lots of talking! Give me a few seconds.', 429, h, { 'retry-after': '20' });
  if (env.DB) {
    await ensureSchema(env.DB);
    if (await countUse(env.DB, 't:' + ip, dayOf(now)) > (+env.TRANSCRIBE_DAILY_LIMIT || 3000)) return chatError('That’s a lot of voice for today. Type for now, and voice comes back tomorrow.', 429, h);
  }
  const lang = /^[a-z]{2}$/.test(String(form.get('language') || '')) ? String(form.get('language')) : '';
  const hint = String(form.get('prompt') || '').slice(0, 600); // words from the conversation, so Whisper spells them right
  const problems = [];
  if (env.GROQ_KEY) {
    for (const model of WHISPER) {
      const fd = new FormData();
      fd.append('file', file, file.name || 'speech.webm');
      fd.append('model', model);
      fd.append('response_format', 'json');
      if (lang) fd.append('language', lang);
      if (hint) fd.append('prompt', hint);
      try {
        const r = await fetch(`${GROQ}/audio/transcriptions`, { method: 'POST', headers: { authorization: `Bearer ${env.GROQ_KEY}` }, body: fd, signal: AbortSignal.timeout(30000) });
        if (r.ok) { const text = String((await r.json()).text || '').trim(); ctx.waitUntil(countChat(env, dayOf(now), 'voice')); return json({ text }, 200, h); }
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        problems.push(`Groq ${model}: ${reasonOf(r.status, m)}`);
      } catch (e) { problems.push(`Groq ${model}: ${reasonOf(0, e.message)}`); }
    }
  }
  if (env.AI) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      let bin = ''; for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
      const o = await env.AI.run('@cf/openai/whisper-large-v3-turbo', { audio: btoa(bin), ...(lang ? { language: lang } : {}), ...(hint ? { initial_prompt: hint } : {}) });
      const text = String((o && (o.text ?? o.result?.text)) || '').trim();
      ctx.waitUntil(countChat(env, dayOf(now), 'voice-backup'));
      return json({ text }, 200, h);
    } catch (e) { problems.push(`Workers AI whisper: ${reasonOf(0, e && e.message || e)}`); }
  }
  ctx.waitUntil(logProblem(env, 'voice: transcribe', problems.join(' | ') || 'no speech-to-text set up'));
  return chatError('I couldn’t hear that clearly. Try again, or type it.', 503, h);
}

/* ---------------------------------------------------------------- the iPhone Shortcut
   GET /ask?text=…  → plain text. Shortcuts shows it in a pop-up over Safari / a PDF, so no new
   browser tab opens. Shortcuts sends no Origin header, so this route has its own small daily
   cap per network instead of the site check. */
const MATH_NOTE = 'The text was copied on a phone, so maths may be flattened: "x2" usually means x², "x3" means x³, a number on the line under another number is often a fraction, and symbols like √, π, ∫ or exponents may be missing or split across lines. Rebuild the intended expression first and say it in one line ("I read this as: …"), then solve it carefully and double-check the result.';
const ASK_SYSTEM = `You are Cassie, a warm, sharp study buddy. A student selected some text on their phone (from a PDF, a document or a web page) and wants help with it. Do what it needs: if it is a question or a problem, solve it, giving the answer first and then the key steps; otherwise explain it simply, with a short example. Keep it under 180 words. Plain text only: no markdown symbols (no **, #, tables) and no LaTeX; write maths with ordinary symbols (x², √, ½, ≤, π). ${MATH_NOTE}` + '\n\n' + Care.INSTRUCTION;
const plainText = (t) => String(t).replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/```[\s\S]*?```/g, '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
async function ask(request, env, ctx) {
  const url = new URL(request.url);
  const out = (t, status = 200) => new Response(t, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const text = (url.searchParams.get('text') || '').trim().slice(0, 4000);
  if (!text) return out('Select some words first, then Share → Ask Cassie.');
  const now = Date.now(), today = dayOf(now), ip = request.headers.get('cf-connecting-ip') || 'unknown';
  await ensureSchema(env.DB);
  const care = Care.check(text); // safety first
  if (care) { countCare(env, ctx); return out(Care.reply(care.lang)); }
  const used = await countUse(env.DB, 'a:' + ip, today);
  const limit = +env.ASK_LIMIT || 40;
  if (used > limit) return out(`That's today's ${limit} quick answers from this network. Open Cassie for more: askcassie.study`, 429);
  const messages = [{ role: 'system', content: ASK_SYSTEM }, { role: 'user', content: text }];
  let reply = null, src = 'shortcut';
  if (env.ANTHROPIC_KEY) { try { reply = await askClaude(env, { messages }, 'haiku'); } catch (e) { reply = null; } if (reply) src = 'shortcut-claude'; }
  for (const model of env.GROQ_KEY && !reply ? CHAT_MODELS : []) {
    try {
      const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify({ model, messages, max_tokens: 2500, temperature: 0.4 }) });
      if (r.ok) { reply = (await r.json()).choices?.[0]?.message?.content || null; if (reply) break; }
    } catch (e) { /* next model */ }
  }
  if (!reply && env.GEMINI_KEY) { const g = await askGemini(env, messages, 1500); reply = g.reply; if (reply) src = 'shortcut-gemini'; }
  if (!reply && env.AI) {
    try { const o = await env.AI.run(BACKUP_MODEL, { messages, max_tokens: 1200, temperature: 0.4 }); reply = (o && (o.response ?? o.result?.response)) || null; } catch (e) { reply = null; }
  }
  const flagged = reply && Care.fromAI(reply);
  if (flagged) { countCare(env, ctx); return out(Care.reply(Care.langOf(text), flagged.aiWords)); }
  if (!reply) { ctx.waitUntil(logProblem(env, 'iPhone Shortcut', 'no AI answered')); return out('Cassie is very busy right now. Try again in a minute.', 503); }
  ctx.waitUntil(countChat(env, today, src));
  return out(`${plainText(reply)}\n\nCassie · askcassie.study`);
}

async function chat(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  const text = await request.text();
  if (text.length > 8e6) return chatError('That photo or file is too big to send. Try a smaller one.', 413, h);
  let body; try { body = JSON.parse(text); } catch (e) { return chatError('Bad request.', 400, h); }
  const cleaned = cleanMessages(body.messages);
  if (!cleaned) return chatError('That message is too long. Try a shorter question or start a new chat.', 413, h);
  // Safety first: before any limit or AI, a student at risk gets care (a question they typed, not a file)
  const care = body.q === 1 || body.q === true ? Care.check(studentWords(cleaned.messages)) : null;
  if (care) {
    if (env.DB) { await ensureSchema(env.DB); countCare(env, ctx); }
    return json({ choices: [{ index: 0, message: { role: 'assistant', content: Care.reply(care.lang) }, finish_reason: 'stop' }] }, 200, { ...h, 'x-cassie-source': 'care', 'access-control-expose-headers': 'x-cassie-source' });
  }

  // Fair use: each person gets a daily allowance through this shared key.
  const now = Date.now(), today = dayOf(now);
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perMin = +env.MINUTE_LIMIT || 12;
  const minute = Math.floor(now / 60e3), mk = `${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  // the whole network too (made-up ids can't get around the minute limit; a classroom shares one address)
  const ipHit = minuteHits.get('ip|' + ip);
  const nIp = ipHit && ipHit.m === minute ? ipHit.n + 1 : 1;
  minuteHits.set('ip|' + ip, { m: minute, n: nIp });
  if (minuteHits.size > 5000) minuteHits.clear();
  if (n > perMin || nIp > perMin * 10) return chatError('Whoa, lots of questions! Give me a few seconds, then ask again.', 429, h, { 'retry-after': String(60 - Math.floor((now / 1000) % 60)) });
  await ensureSchema(env.DB);
  // the student's plan (free unless they're signed in to a paid account) sets their allowance
  const { plan, account } = await planOf(request, env), L = limitsFor(env, plan), perDay = L.all;
  const who = account ? 'a:' + account : uid; // a paid plan counts per account, across devices
  const bump = (k) => countUseQuery(env.DB, k, today);
  // no id → the allowance is per network ("anon" is never one shared pool)
  const question = body.q === 1 || body.q === true; // something the student asked (not a file section)
  const keys = [who === 'anon' ? 'an:' + ip : 'u:' + who, 'i:' + ip, ...(question ? ['q:' + (who === 'anon' ? 'an:' + ip : who)] : [])];
  const counts = (await env.DB.batch(keys.map(bump))).map((r) => r.results?.[0]?.n || 0);
  const [usedU, usedI, usedQ = 0] = counts;
  const refund = () => uncountUses(env.DB, keys);
  if (usedU > perDay || usedI > Math.max(perDay, 150) * 25 || usedQ > L.questions) {
    const secs = Math.ceil(msUntilMidnightPH(now) / 1000), shown = usedQ > L.questions ? L.questions : perDay;
    if (question && usedQ > L.questions) ctx.waitUntil(refund().catch(() => {})); // a refused question isn't counted
    return chatError(plan === 'free'
      ? `You've used today's ${shown} free questions. Want to keep going? The Pasado Pass gives you 100 a day until your exam, and the early list gets it first. Your free questions come back at midnight, or add your own free Groq key in Settings.`
      : `You've reached today's fair-use limit (${shown}). It resets at midnight. Thanks for studying so hard!`, 429, h, { 'retry-after': String(secs), 'x-cassie-daily': '1' }, plan === 'free' ? 'daily_free' : 'daily');
  }
  const left = { 'x-cassie-left': String(Math.max(0, question ? L.questions - usedQ : perDay - usedU)), 'x-cassie-plan': plan };

  // Claude first for the main chat: Free gets Haiku for its first answers each day (FREE_CLAUDE_LIMIT),
  // then Groq; Pro gets Sonnet for its first answers each day, then Haiku; Plus gets Haiku
  if (env.ANTHROPIC_KEY && body.brain === 'claude' && uid !== 'anon') {
    let family = null;
    for (const [fam, max] of L.claude) {
      if (!(max > 0)) continue;
      let usedC = Infinity, usedCi = Infinity;
      try { [usedC, usedCi] = (await env.DB.batch([bump('c:' + fam + ':' + who), bump('ci:' + ip)])).map((r) => r.results?.[0]?.n || 0); } catch (e) { /* treat as used up */ }
      if (usedC <= max && usedCi <= Math.max(max, 40) * 25) { family = fam; break; }
    }
    if (family) {
      let reply = null;
      try { reply = await askClaude(env, cleaned, family); } catch (e) { reply = null; }
      if (reply) {
        ctx.waitUntil(countChat(env, today, 'claude'));
        return json({ choices: [{ index: 0, message: { role: 'assistant', content: reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'claude' });
      }
    }
  }

  const maxTokens = Math.min(Math.max(+body.max_tokens || 2048, 64), 4000);
  const temperature = typeof body.temperature === 'number' ? Math.min(Math.max(body.temperature, 0), 1.2) : 0.6;
  let lastStatus = 503, lastDetail = '';
  const problems = [];
  if (env.GROQ_KEY) {
    let models;
    if (cleaned.image || body.model === 'vision') { models = (await visionModels(env)).slice(0, 4); if (!models.length) problems.push('Groq: no picture-reading model on this key'); }
    else models = [CHAT_MODELS.includes(body.model) ? body.model : CHAT_MODELS[0], ...CHAT_MODELS].filter((m, k, a) => a.indexOf(m) === k);
    // stream: true (Talk with Cassie) — the answer comes back word by word, so she starts speaking
    // as soon as the first sentence is written instead of waiting for all of it
    const stream = body.stream === true && !cleaned.image;
    for (const model of models) {
      const payload = { model, messages: cleaned.messages, max_tokens: maxTokens, temperature, ...(stream ? { stream: true } : {}) };
      if (/gpt-oss/.test(model) && ['low', 'medium', 'high'].includes(body.reasoning_effort)) payload.reasoning_effort = body.reasoning_effort;
      let r;
      try {
        r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      } catch (e) { lastStatus = 503; problems.push(`Groq ${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : reasonOf(0, e.message)}`); continue; }
      if (r.ok) {
        ctx.waitUntil(countChat(env, today, 'groq'));
        return new Response(r.body, { status: 200, headers: { 'content-type': stream ? 'text/event-stream' : 'application/json', 'cache-control': 'no-store', ...h, ...left, 'x-cassie-source': 'groq' } });
      }
      lastStatus = r.status;
      try { lastDetail = (await r.json()).error?.message || ''; } catch (e) { lastDetail = ''; }
      problems.push(`Groq ${model}: ${reasonOf(r.status, lastDetail)}`);
      // too long: the app trims the chat and retries, so hand it back (a picture the model can't take tries the next one)
      if (r.status === 413 || (r.status === 400 && !cleaned.image && !/model|decommission|not found|does not exist|vision|image/i.test(lastDetail))) return chatError(lastDetail || 'Too long.', r.status, h);
      // 429 / 5xx / retired model / picture refused: try the next model, then the backups
    }
  }
  // Gemini (your GEMINI_KEY): reads pictures and answers text when Groq couldn't
  if (env.GEMINI_KEY) {
    const g = await askGemini(env, cleaned.messages, maxTokens);
    if (g.reply) {
      ctx.waitUntil(countChat(env, today, 'gemini'));
      return json({ choices: [{ index: 0, message: { role: 'assistant', content: g.reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'gemini' });
    }
    problems.push(g.detail);
  }
  if (env.AI && cleaned.image) {
    const v = await aiVision(env, cleaned.messages, maxTokens);
    if (v.reply) {
      ctx.waitUntil(countChat(env, today, 'backup-picture'));
      return json({ choices: [{ index: 0, message: { role: 'assistant', content: v.reply }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'backup-picture' });
    }
    problems.push(v.detail);
  }
  if (env.AI && !cleaned.image) {
    try {
      const out = await env.AI.run(BACKUP_MODEL, { messages: textOnly(cleaned.messages), max_tokens: Math.min(maxTokens, 2048), temperature });
      const reply = (out && (out.response ?? out.result?.response)) || '';
      if (reply) {
        ctx.waitUntil(countChat(env, today, 'backup'));
        return json({ choices: [{ index: 0, message: { role: 'assistant', content: String(reply) }, finish_reason: 'stop' }] }, 200, { ...h, ...left, 'x-cassie-source': 'backup' });
      }
    } catch (e) { lastDetail = lastDetail || String(e && e.message || e); problems.push(`Workers AI: ${reasonOf(0, e && e.message || e)}`); }
  }
  ctx.waitUntil(countChat(env, today, 'failed'));
  ctx.waitUntil(logProblem(env, cleaned.image ? 'chat: picture' : 'chat: text', problems.filter(Boolean).join(' | ') || `status ${lastStatus}`));
  // an unanswered question shouldn't use up the person's daily allowance
  ctx.waitUntil(refund());
  if (cleaned.image && !env.GROQ_KEY && !env.GEMINI_KEY) return chatError('Reading photos needs a Groq or Gemini key. Add one in Settings.', 503, h);
  if (cleaned.image) vision.at = 0; // look again for picture readers next time
  return lastStatus === 429
    ? chatError('Cassie is very busy right now. Try again in a minute.', 429, h, { 'retry-after': '20' })
    : chatError(cleaned.image ? 'I couldn’t read that picture just now. Try again in a minute, or type the question instead.' : 'Cassie can’t reach her brain right now. Try again in a moment.', 503, h);
}

/* ------------------------------------------------------------------ pictures */
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'; // Workers AI, fast and free-tier friendly
/* Gemini pictures (Google's image model, "Nano Banana"), with the owner's GEMINI_KEY. Google only
   makes pictures for a key with billing on, so this is tried first and anything else falls back.
   It can start from the student's own photo ("a photo of the answer": their slide, redrawn with the
   answer marked on it). A plan gets so many: Free a few a week, Plus and Pro a few a day.
   GEMINI_PICTURES=off turns it off; GEMINI_IMAGE_MODEL picks the model;
   FREE_PICTURES_WEEK / PLUS_PICTURES_DAY / PRO_PICTURES_DAY set the numbers. */
const geminiPicturesOn = (env) => !!env.GEMINI_KEY && env.GEMINI_PICTURES !== 'off';
let geminiPicGone = false, geminiPicGoneAt = 0; // a key without billing: don't ask again for a while
function pictureAllowance(env, plan) {
  const n = (v, d) => (v != null && v !== '' && Number.isFinite(+v) ? +v : d);
  if (plan === 'pro') return { per: 'day', n: n(env.PRO_PICTURES_DAY, 20) };
  if (plan === 'plus') return { per: 'day', n: n(env.PLUS_PICTURES_DAY, 5) };
  return { per: 'week', n: n(env.FREE_PICTURES_WEEK, 3) };
}
const weekOf = (ms) => { const d = new Date(ms + TZ_OFFSET_H * 3600e3); d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7)); return d.toISOString().slice(0, 10); };
function geminiImageModels(env) {
  if (env.GEMINI_IMAGE_MODEL) return [env.GEMINI_IMAGE_MODEL];
  const ver = (id) => parseFloat((/gemini-(\d+(?:\.\d+)?)/.exec(id) || [0, 0])[1]) || 0;
  const found = (gemini.all || []).filter((id) => /^gemini-.*image/.test(id) && !/pro|tts|audio/.test(id))
    .sort((a, b) => ver(b) - ver(a) || (/preview/.test(a) ? 1 : 0) - (/preview/.test(b) ? 1 : 0) || (/lite/.test(a) ? 1 : 0) - (/lite/.test(b) ? 1 : 0));
  return [...new Set([...found, 'gemini-3.1-flash-image-preview', 'gemini-2.5-flash-image'])].slice(0, 3);
}
async function geminiPicture(env, prompt, ref) {
  await geminiModels(env); // learns the model names this key can use
  const parts = [];
  if (ref) parts.push({ inlineData: { mimeType: ref.mimeType, data: ref.data } });
  parts.push({ text: prompt });
  let last = '';
  for (const model of geminiImageModels(env)) {
    try {
      const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-goog-api-key': env.GEMINI_KEY }, signal: AbortSignal.timeout(90000),
        body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '4:3' } } }),
      });
      if (!r.ok) {
        let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ }
        last = `${model}: ${reasonOf(r.status, m)}`;
        if (r.status === 429 && /limit:\s*0|billing|free tier/i.test(m)) { geminiPicGone = true; geminiPicGoneAt = Date.now(); return { error: 'no-billing', detail: last }; }
        continue;
      }
      const got = ((await r.json()).candidates?.[0]?.content?.parts || []).find((p) => p.inlineData && p.inlineData.data);
      if (got) return { image: got.inlineData.data, mimeType: got.inlineData.mimeType || 'image/png', model };
      last = `${model}: no picture came back`;
    } catch (e) { last = `${model}: ${reasonOf(0, e.message)}`; }
  }
  return { error: 'failed', detail: last };
}

async function image(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  let body; try { body = JSON.parse(await request.text()); } catch (e) { return chatError('Bad request.', 400, h); }
  const prompt = String(body.prompt || '').replace(/\s+/g, ' ').trim().slice(0, body.gemini ? 6000 : 1500);
  if (prompt.length < 2) return chatError('What should the picture show?', 400, h);
  await ensureSchema(env.DB);
  const today = dayOf(Date.now());
  // Gemini first, when asked ("gemini": true). If it can't (no billing, none left, a hiccup), say so: the app has other ways.
  if (body.gemini) {
    const no = (msg, extra = {}) => json({ error: { message: msg }, fallback: true, ...extra }, 503, { ...h, 'access-control-expose-headers': 'x-cassie-left' });
    if (!geminiPicturesOn(env) || (geminiPicGone && Date.now() - geminiPicGoneAt < 30 * 60e3)) return no('Gemini pictures aren’t on.');
    const { plan, account } = await planOf(request, env);
    const allow = pictureAllowance(env, plan);
    const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : '';
    const who = account ? 'a:' + account : uid ? 'u:' + uid : 'ip:' + (request.headers.get('cf-connecting-ip') || 'unknown');
    const period = allow.per === 'week' ? weekOf(Date.now()) : today, key = `gpic:${who}`;
    const usedPics = await countUse(env.DB, key, period);
    if (usedPics > allow.n) {
      await uncountUses(env.DB, [key]);
      return no(allow.per === 'week' ? `You’ve made this week’s ${allow.n} Gemini pictures.` : `You’ve made today’s ${allow.n} Gemini pictures.`, { used: true, per: allow.per, plan });
    }
    const ref = typeof body.ref === 'string' && /^data:image\/(png|jpeg|webp);base64,/.test(body.ref) && body.ref.length < 7e6
      ? { mimeType: /^data:(image\/\w+)/.exec(body.ref)[1], data: body.ref.split(',')[1] } : null;
    const out = await geminiPicture(env, prompt, ref);
    if (!out.image) {
      await uncountUses(env.DB, [key]);
      ctx.waitUntil(logProblem(env, 'gemini-picture', out.detail || out.error));
      return no('Gemini couldn’t make that picture.');
    }
    ctx.waitUntil(countChat(env, today, ref ? 'gemini-picture-photo' : 'gemini-picture'));
    return json({ image: out.image, mimeType: out.mimeType, source: 'gemini', left: Math.max(0, allow.n - usedPics), per: allow.per }, 200, h);
  }
  if (!env.AI) return chatError('Pictures aren’t set up on this server.', 503, h);
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perDay = +env.IMAGE_LIMIT || 20;
  const bump = (k) => countUseQuery(env.DB, k, today);
  const mine = uid === 'anon' ? 'img:an:' + ip : 'img:u:' + uid; // (counted per network without an id)
  const [u, i] = await env.DB.batch([bump(mine), bump('img:i:' + ip)]);
  if ((u.results?.[0]?.n || 0) > perDay || (i.results?.[0]?.n || 0) > perDay * 25) {
    return chatError(`You've made today's ${perDay} pictures. More tomorrow, or add a free Gemini key in Settings for your own picture allowance.`, 429, h);
  }
  try {
    const out = await env.AI.run(IMAGE_MODEL, { prompt, steps: 6 });
    const b64 = out && (out.image || out.result?.image);
    if (!b64) throw new Error('empty');
    ctx.waitUntil(countChat(env, today, 'image'));
    return json({ image: b64, mimeType: 'image/jpeg' }, 200, h);
  } catch (e) {
    ctx.waitUntil(uncountUses(env.DB, [mine, 'img:i:' + ip])); // (given back to the one it was counted to)
    return chatError('Couldn’t make that picture right now. Try again in a minute, or describe it more simply.', 503, h);
  }
}

/* ------------------------------------------------------------------ feedback */
const FEEDBACK = new Set(['up', 'down', 'report', 'auto']); // auto: an error the app hit (the message only)
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
    .bind(now, dayOf(now), uid, b.kind, label(b.feature, 40), b.kind === 'auto' ? autoCode(b.text) : String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500), ctxText).run();
  return new Response(null, { status: 204, headers: h });
}

// An automatic error report keeps only which message the app showed ("file_kind", "network"):
// the words themselves can hold a file's name or a service's reply.
const autoCode = (t) => (/^[a-z][a-z0-9_]{0,39}$/.test(String(t || '')) ? String(t) : 'other');

/* ------------------------------------------------------------------ Cassie's studio voice */
// Reads text aloud with ElevenLabs when the secret ELEVENLABS_API_KEY is set (Cloudflare → the
// worker → Settings → Variables and Secrets; never in the app). GET /speak?uid=… says whether it's
// on, how many studio characters are left (this month's, or this student's today if that is less),
// and the day the allowance comes back; POST /speak { text, voice: 'woman' | 'man', uid } answers with an MP3.
// Credits cost money, so: each student gets SPEAK_DAILY_CHARS a day (default 12000, about 15 minutes of talk), the whole app
// SPEAK_MONTHLY_CHARS a month (default 9500, under ElevenLabs' free 10,000), and the same words
// (a flashcard, a quiz question) are kept in Cloudflare's cache for 30 days, so they're paid for
// once. When it's off or used up, the app types instead: Cassie never speaks in another voice.
const ELEVEN = 'https://api.elevenlabs.io/v1/text-to-speech';
// Sarah, and Daniel for the man's voice: calm, precise, British — an "AI butler" feel (ElevenLabs' own voices;
// George is the spare if Daniel ever isn't there)
// ElevenLabs' standard voices (every account has them): Jessica (bright, warm) and Chris (down-to-earth); George if Chris is missing
const ELEVEN_VOICES = { woman: 'cgSgspJ2msm6clMCkdW9', man: 'iP95p4xoKVk53GoZ742B', manSpare: 'JBFqnCBsd6RMkjVDRZzb' };
// What's left of the studio voice, read without counting a use: the app decides at the start of a
// lesson, a Listen or a voice chat whether Bella can say all of it. Only numbers and a date go back.
/* What the ElevenLabs account itself has left (its credits) and the day they come back: asked at most every
   10 minutes per server copy, and set to none at once when ElevenLabs says the credits are gone. Cassie's
   own counts (SPEAK_MONTHLY_CHARS) can't see credits used elsewhere (the ElevenLabs website, another app,
   a plan change), so without this she kept asking a voice with nothing left. A key that can't read its
   subscription leaves only Cassie's own counts. */
let elevenCredits = null;
const SPEAK_DAY = 12000; // (3000 ran out after about 5 minutes of voice chat)
async function elevenLeft(env) {
  if (elevenCredits && Date.now() - elevenCredits.at < 10 * 60e3) return elevenCredits;
  try {
    const r = await fetch('https://api.elevenlabs.io/v1/user/subscription', { headers: { 'xi-api-key': env.ELEVENLABS_API_KEY }, signal: AbortSignal.timeout(5000) });
    if (!r.ok) return null;
    const d = await r.json();
    if (!Number.isFinite(+d.character_limit) || !Number.isFinite(+d.character_count)) return null;
    const reset = +d.next_character_count_reset_unix;
    elevenCredits = { at: Date.now(), left: Math.max(0, +d.character_limit - +d.character_count), back: reset > 0 ? dayOf(reset * 1000) : '' };
    return elevenCredits;
  } catch (e) { return null; }
}
async function speakLeft(env, uidRaw) {
  if (!env.ELEVENLABS_API_KEY) return { on: false, left: 0 };
  const monthMax = +env.SPEAK_MONTHLY_CHARS || 9500, dayMax = +env.SPEAK_DAILY_CHARS || SPEAK_DAY;
  const now = Date.now(), day = dayOf(now), month = day.slice(0, 7);
  const uid = /^[\w-]{8,64}$/.test(String(uidRaw || '')) ? String(uidRaw) : 'anon';
  let usedMonth = 0, usedDay = 0;
  if (env.DB) {
    await ensureSchema(env.DB);
    const read = (k, period) => env.DB.prepare('SELECT n FROM quota WHERE k = ? AND day = ?').bind(k, period).first().then((r) => (r && r.n) || 0);
    [usedMonth, usedDay] = await Promise.all([read('SP:month', month), read('sp:' + uid, day)]);
  }
  const monthLeft = Math.max(0, monthMax - usedMonth), dayLeft = Math.max(0, dayMax - usedDay);
  const [y, m] = month.split('-').map(Number);
  const nextMonth = `${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, '0')}-01`;
  const tomorrow = dayOf(now + 864e5);
  const mine = { on: true, left: Math.min(monthLeft, dayLeft), back: monthLeft <= dayLeft ? nextMonth : tomorrow };
  // the account's own credits, when they're the smaller (back: the day ElevenLabs renews them)
  const credits = await elevenLeft(env);
  return credits && credits.left < mine.left ? { on: true, left: credits.left, back: credits.back || nextMonth } : mine; // (a key that can't say when: the 1st)
}
async function speak(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (request.method === 'GET') return json(await speakLeft(env, new URL(request.url).searchParams.get('uid')), 200, h);
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  if (!env.ELEVENLABS_API_KEY) return chatError('Cassie’s studio voice isn’t set up.', 503, h, { 'x-speak': 'off' });
  let b; try { b = await request.json(); } catch (e) { return chatError('bad json', 400, h); }
  const text = String(b.text || '').replace(/\s+/g, ' ').trim().slice(0, 700);
  if (!text) return chatError('Nothing to say.', 400, h);
  const uid = /^[\w-]{8,64}$/.test(String(b.uid || '')) ? String(b.uid) : 'anon';
  const voice = b.voice === 'man' ? (env.ELEVENLABS_VOICE_MAN || ELEVEN_VOICES.man) : (env.ELEVENLABS_VOICE_WOMAN || ELEVEN_VOICES.woman);
  const model = env.ELEVENLABS_MODEL || 'eleven_flash_v2_5';
  const audio = (body, extra = {}) => new Response(body, { status: 200, headers: { ...h, 'content-type': 'audio/mpeg', 'cache-control': 'private, max-age=86400', ...extra } });
  // said before? then it's free
  const key = new Request('https://speak.cassie/' + (await sha256(`${voice}|${model}|${text}`)));
  const cache = caches.default;
  const hit = await cache.match(key);
  if (hit) return audio(hit.body, { 'x-speak': 'cache' });
  const now = Date.now(), day = dayOf(now), month = day.slice(0, 7);
  if (elevenCredits && elevenCredits.left < text.length && Date.now() - elevenCredits.at < 10 * 60e3) return chatError('Cassie’s studio voice is resting until its credits come back.', 429, h, { 'x-speak': 'month' });
  if (env.DB) {
    await ensureSchema(env.DB);
    const [mine, all] = await Promise.all([countUse(env.DB, 'sp:' + uid, day, text.length), countUse(env.DB, 'SP:month', month, text.length)]);
    if (all > (+env.SPEAK_MONTHLY_CHARS || 9500)) return chatError('Cassie’s studio voice is resting until next month.', 429, h, { 'x-speak': 'month' });
    if (mine > (+env.SPEAK_DAILY_CHARS || SPEAK_DAY)) return chatError('That’s a lot of listening today. Cassie types her answers until tomorrow.', 429, h, { 'x-speak': 'day' });
  }
  let r;
  // the man's voice is steady and measured; Cassie's own stays lively
  // (Eleven v4 takes only stability and similarity: no style)
  const settings = b.voice === 'man' ? { stability: 0.72, similarity_boost: 0.8, ...(/^eleven_v4/.test(model) ? {} : { style: 0.05 }) } : { stability: 0.5, similarity_boost: 0.75 };
  const say = (v) => fetch(`${ELEVEN}/${v}?output_format=mp3_44100_64`, {
    method: 'POST', headers: { 'xi-api-key': env.ELEVENLABS_API_KEY, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({ text, model_id: model, voice_settings: settings }), signal: AbortSignal.timeout(20000),
  });
  try {
    r = await say(voice);
    if ((r.status === 404 || r.status === 400) && voice === ELEVEN_VOICES.man) r = await say(ELEVEN_VOICES.manSpare);
  } catch (e) { ctx.waitUntil(logProblem(env, 'voice: elevenlabs', reasonOf(0, e && e.message || e)).catch(() => {})); return chatError('The studio voice didn’t answer.', 502, h); }
  if (!r.ok) {
    let m = ''; try { m = JSON.stringify(await r.json()).slice(0, 300); } catch (e) { /* not JSON */ }
    // the account's credits are gone: resting until they come back (said once, not asked again and again)
    if (/quota_exceeded|credits remaining/i.test(m)) {
      if (!elevenCredits || elevenCredits.left > 0) ctx.waitUntil(logProblem(env, 'voice: elevenlabs', 'out of credits').catch(() => {}));
      elevenCredits = { at: Date.now(), left: 0, back: (elevenCredits && elevenCredits.back) || '' };
      return chatError('Cassie’s studio voice is resting until its credits come back.', 429, h, { 'x-speak': 'month' });
    }
    ctx.waitUntil(logProblem(env, 'voice: elevenlabs', reasonOf(r.status, m)).catch(() => {}));
    return chatError('The studio voice didn’t work just now.', 502, h, { 'x-speak': 'error' });
  }
  const buf = await r.arrayBuffer();
  ctx.waitUntil(cache.put(key, new Response(buf, { headers: { 'content-type': 'audio/mpeg', 'cache-control': 'public, max-age=2592000' } })));
  ctx.waitUntil(countChat(env, day, 'speak').catch(() => {}));
  return audio(buf, { 'x-speak': 'new' });
}

/* ------------------------------------------------------------------ live board rooms */
// A study room is a shared drawing board. Someone creates it and gets a 6-letter code; up
// to ROOM_MAX classmates join with the code (or the link) and everyone's strokes appear on
// everyone's board. Clients send their strokes and ask for new ones about once a second.
// Rooms and their drawings are deleted after a day. Only drawings are shared — no chat.
const ROOM_MAX = 12, ROOM_HOURS = 24, ROOM_OPS_MAX = 6000, ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
// studying together in a room (app.js / study-room.js): chat, Cassie's answers shared with the
// group, shared flashcards, a group quiz, pinned notes and a shared timer — steps like the drawing's
const STUDY_OPS = ['msg', 'share', 'deck', 'card', 'grade', 'quiz', 'ans', 'note', 'unnote', 'timer'];
async function room(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.DB) return json({ error: 'Study rooms can’t open right now because Cassie’s server isn’t answering. Try again in a moment.', code: 'room_unavailable' }, 503, h);
  await ensureSchema(env.DB);
  const db = env.DB, now = Date.now();
  const okUid = (u) => /^[\w-]{8,64}$/.test(u);
  const okCode = (c) => /^[A-Z0-9]{6}$/.test(c);
  const liveQuery = (code) => db.prepare('SELECT code, title, created FROM rooms WHERE code = ? AND created > ?').bind(code, now - ROOM_HOURS * 3600e3);
  const membersQuery = (code) => db.prepare('SELECT uid, name FROM room_members WHERE code = ? AND seen > ? ORDER BY name').bind(code, now - 25000);
  const live = async (code) => liveQuery(code).first();
  const members = async (code) => (await membersQuery(code).all()).results || [];

  if (request.method === 'GET' && url.pathname === '/room/poll') {
    const code = clean(url.searchParams.get('code'), 6).toUpperCase(), uid = clean(url.searchParams.get('uid'), 64);
    const since = Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0);
    if (!okCode(code) || !okUid(uid)) return json({ error: 'bad request' }, 400, h);
    // the pointer: where you are and what you're doing (a cursor, a laser trail), replaced each time
    let p = url.searchParams.get('p');
    try { if (!p || p.length > 4000 || typeof JSON.parse(p) !== 'object') p = null; } catch (e) { p = null; }
    // everything in one trip to the database (a room polls about once a second per person)
    const [room, , , ops, here, people] = await db.batch([
      liveQuery(code),
      // "I'm still here" at most every 10 s (a write only when it's due)
      db.prepare('UPDATE room_members SET seen = ? WHERE code = ? AND uid = ? AND seen < ?').bind(now, code, uid, now - 10000),
      // (only a member's pointer is kept)
      p ? db.prepare('INSERT INTO room_here (code, uid, ts, p) SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM room_members WHERE code = ? AND uid = ?) ON CONFLICT(code, uid) DO UPDATE SET ts = excluded.ts, p = excluded.p').bind(code, uid, now, p, code, uid)
        : db.prepare('SELECT 1'),
      db.prepare('SELECT id, uid, ts, op FROM room_ops WHERE code = ? AND id > ? ORDER BY id LIMIT 400').bind(code, since),
      db.prepare('SELECT uid, ts, p FROM room_here WHERE code = ? AND uid != ? AND ts > ?').bind(code, uid, now - 6000),
      membersQuery(code),
    ]);
    // (a room that has ended: what was written above is about a room nobody can open, and the tidy-up removes it)
    if (!(room.results || []).length) return json({ error: 'That room has ended, so it can’t be joined. Rooms last one day. Ask for a new code.', code: 'room_gone', gone: true }, 404, h);
    const rows = ops.results || [];
    return json({ ops: rows.map((r) => ({ id: r.id, uid: r.uid, ts: r.ts, op: JSON.parse(r.op) })), members: people.results || [], here: (here.results || []).map((r) => ({ uid: r.uid, ts: r.ts, p: JSON.parse(r.p) })), more: rows.length === 400, now }, 200, h);
  }
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  const text = await request.text();
  if (text.length > 200000) return json({ error: 'Too much at once.' }, 413, h);
  let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  const uid = clean(b.uid, 64), name = clean(b.name, 30).trim() || 'Classmate';
  if (!okUid(uid)) return json({ error: 'bad request' }, 400, h);

  if (url.pathname === '/room/create') {
    // (rooms older than a day, and their drawings, go in tidy(): every 10 minutes and each night)
    const old = now - ROOM_HOURS * 3600e3;
    const mine = await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner = ? AND created > ?').bind(uid, old).first();
    if (mine && mine.n >= 10) return json({ error: 'You’ve made 10 rooms today, which is the most for one day. Use one of those, or make a new one tomorrow.', code: 'room_limit' }, 429, h);
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const c = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => ROOM_LETTERS[x % ROOM_LETTERS.length]).join('');
      if (!(await db.prepare('SELECT 1 FROM rooms WHERE code = ?').bind(c).first())) code = c;
    }
    if (!code) return json({ error: 'Study rooms can’t open right now because Cassie’s server isn’t answering. Try again in a moment.', code: 'room_unavailable' }, 503, h);
    await db.batch([
      db.prepare('INSERT INTO rooms (code, created, owner, title) VALUES (?, ?, ?, ?)').bind(code, now, uid, clean(b.title, 60) || `${name}’s study room`),
      db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?)').bind(code, uid, name, now),
    ]);
    return json({ code, title: clean(b.title, 60) || `${name}’s study room` }, 200, h);
  }
  const code = clean(b.code, 6).toUpperCase();
  if (!okCode(code)) return json({ error: 'Room codes have 6 letters and numbers, like K7M2QX. Check the code your classmate shared.', code: 'room_code' }, 400, h);
  const r = await live(code);
  if (!r) return json({ error: 'There’s no room with that code. Rooms last one day, so it may have ended. Check the code, or ask for a new one.', code: 'room_none', gone: true }, 404, h);

  if (url.pathname === '/room/join') {
    const here = await members(code);
    if (here.length >= ROOM_MAX && !here.some((m) => m.uid === uid)) return json({ error: `The room is full (${ROOM_MAX} people).` }, 409, h);
    await db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?) ON CONFLICT(code, uid) DO UPDATE SET name = excluded.name, seen = excluded.seen').bind(code, uid, name, now).run();
    return json({ code, title: r.title, members: await members(code) }, 200, h);
  }
  if (url.pathname === '/room/ops') {
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 40) : [];
    if (!ops.length) return json({ ok: true }, 200, h);
    const [inRoom, counted] = await db.batch([db.prepare('SELECT 1 FROM room_members WHERE code = ? AND uid = ?').bind(code, uid), db.prepare('SELECT COUNT(*) AS n FROM room_ops WHERE code = ?').bind(code)]);
    if (!(inRoom.results || []).length) return json({ error: 'You aren’t in this room yet, so you can’t draw here. Join with the room code first.', code: 'room_join_first' }, 403, h);
    const count = (counted.results || [])[0];
    if (count && count.n + ops.length > ROOM_OPS_MAX) return json({ error: 'This board is full, so nothing more fits. Save it, then start a new room.', code: 'room_full_board', full: true }, 409, h);
    const rows = [];
    for (const op of ops) {
      if (!op || !(['add', 'del', 'clearmine'].includes(op.t) || STUDY_OPS.includes(op.t))) continue;
      const t = JSON.stringify(op);
      if (t.length > (STUDY_OPS.includes(op.t) ? 24000 : 60000)) continue; // one huge step is dropped, not the room
      rows.push(db.prepare('INSERT INTO room_ops (code, uid, ts, op) VALUES (?, ?, ?, ?)').bind(code, uid, now, t));
    }
    if (rows.length) await db.batch(rows);
    return json({ ok: true, n: rows.length }, 200, h);
  }
  return new Response('not found', { status: 404, headers: h });
}

/* ------------------------------------------------------------------ daily puzzle score board */
// Everyone gets the same puzzles each day (a "puzzle day" starts at midnight Philippine time).
// A student's first finish of each puzzle counts; places earn points (1st 100, 2nd 80, 3rd 65,
// then 50, 45, 40… down to 10 just for finishing). The board shows today's top three.
const PUZZLES = { sudoku: 20, nonogram: 15, hashi: 15, pipes: 10, mirrors: 8, equation: 1, geography: 1 }; // fastest believable finish, in seconds (or points)
const puzzleDay = (ms) => new Date(ms + 8 * 3600e3).toISOString().slice(0, 10);
const placePoints = (rank) => (rank === 1 ? 100 : rank === 2 ? 80 : rank === 3 ? 65 : Math.max(10, 50 - (rank - 4) * 5));
async function scores(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.DB) return json({ error: 'The score board needs the server database.' }, 503, h);
  await ensureSchema(env.DB);
  const db = env.DB, now = Date.now(), today = puzzleDay(now);
  const okUid = (u) => /^[\w-]{8,64}$/.test(u);
  let me = clean(url.searchParams.get('uid'), 64), day = clean(url.searchParams.get('day'), 10) || today;
  if (request.method === 'POST' && url.pathname === '/scores/submit') {
    const text = await request.text();
    if (text.length > 2000) return json({ error: 'too big' }, 413, h);
    let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, h); }
    const uid = clean(b.uid, 64), game = clean(b.game, 20), name = clean(b.name, 24).trim() || 'Student';
    const value = Number(b.value);
    if (!okUid(uid) || !(game in PUZZLES) || !Number.isFinite(value)) return json({ error: 'bad request' }, 400, h);
    // only today's puzzle (a finish just after midnight still counts for the day it started)
    if (b.day !== today && b.day !== puzzleDay(now - 10 * 60e3)) return json({ error: 'That was another day’s puzzle.' }, 409, h);
    if (value < PUZZLES[game] || value > 86400 * 1000) return json({ error: 'That result doesn’t look right.' }, 422, h);
    await db.prepare('INSERT OR IGNORE INTO scores (day, game, uid, name, value, shown, ts) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(b.day, game, uid, name, value, clean(b.shown, 40), now).run();
    // (old days go after two weeks, in tidy())
    me = uid; day = b.day;
  } else if (!(request.method === 'GET' && url.pathname === '/scores/today')) return new Response('not found', { status: 404, headers: h });
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return json({ error: 'bad day' }, 400, h);
  // every player's points in each game (by where they placed), and their total
  const tally = (rows) => {
    const players = new Map();
    let lastKey = '', rank = 0;
    for (const r of rows) {
      const key = (r.day || '') + '|' + r.game;
      if (key !== lastKey) { lastKey = key; rank = 0; }
      rank++;
      const p = placePoints(rank);
      const pl = players.get(r.uid) || { uid: r.uid, name: r.name, games: {}, total: 0, played: 0 };
      pl.name = r.name; pl.total += p; pl.played++;
      pl.games[r.game] = (pl.games[r.game] || 0) + p;
      if (r.uid === me && (!r.day || r.day === day)) pl.mine = { ...(pl.mine || {}), [r.game]: { rank, points: p, shown: r.shown } };
      players.set(r.uid, pl);
    }
    return [...players.values()].sort((a, b) => b.total - a.total || b.played - a.played);
  };
  // the week's results in one read, newest day first (so a limit would leave out the oldest day, never today);
  // today's board is the day's part of it
  const weekFrom = puzzleDay(Date.parse(day + 'T12:00:00Z') - 6 * 86400e3);
  const weekRows = (await db.prepare('SELECT day, game, uid, name, value, shown FROM scores WHERE day >= ? AND day <= ? ORDER BY day DESC, game, value, ts LIMIT 50000').bind(weekFrom, day).all()).results || [];
  const board = tally(weekRows.filter((r) => r.day === day));
  const at = board.findIndex((p) => p.uid === me);
  const week = tally(weekRows);
  const wAt = week.findIndex((p) => p.uid === me);
  // the top 50, plus your own row if you're further down
  const list = (all, i, row) => { const out = all.slice(0, 50).map((p, k) => row(p, k)); if (i >= 50) out.push(row(all[i], i)); return out; };
  return json({
    day, players: board.length,
    top: board.slice(0, 3).map((p) => ({ name: p.name, points: p.total, me: p.uid === me })),
    me: at >= 0 ? { rank: at + 1, points: board[at].total, games: board[at].mine || {} } : null,
    table: list(board, at, (p, k) => ({ rank: k + 1, name: p.name, me: p.uid === me, games: p.games, total: p.total })),
    week: { from: weekFrom, players: week.length, table: list(week, wAt, (p, k) => ({ rank: k + 1, name: p.name, me: p.uid === me, games: p.games, played: p.played, total: p.total })) },
  }, 200, h);
}

/* ------------------------------------------------------------------ accounts */
// Passwords are never stored: only a salted PBKDF2 hash. Sessions are random
// tokens; only their SHA-256 is stored, so a leaked database can't sign anyone in.
const SESSION_DAYS = 90;
const b64u = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64u(crypto.getRandomValues(new Uint8Array(n)));
async function sha256(text) { return b64u(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))); }
async function hashPassword(password, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 100000 }, key, 256);
  return b64u(bits);
}
function sameText(a, b) { // compare without leaking timing
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false;
  let d = 0; for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}
// an account as the app sees it, with the ways it can sign in
const providersQuery = (env, id) => env.DB.prepare('SELECT provider FROM identities WHERE account = ?').bind(id);
const providerList = (r) => ((r && r.results) || []).map((x) => x.provider).sort();
async function providersOf(env, id) { return providerList(await providersQuery(env, id).all()); }
async function publicAccount(env, a, providers) {
  if (!providers) providers = await providersOf(env, a.id);
  return { email: a.email || '', name: a.name || '', password: !!a.pass, providers, google: providers.includes('google'), apple: providers.includes('apple'), data: a.data ? JSON.parse(a.data) : null };
}
const freePlan = { plan: 'free', until: 0 };
async function signedInReply(env, acc, isNew) {
  // the new session, the ways to sign in and the plan: one trip to the database
  const token = randomToken(), now = Date.now();
  const [, ways, plan] = await env.DB.batch([sessionInsert(env, await sha256(token), acc.id, now), providersQuery(env, acc.id), planQuery(env, acc.id)]);
  return { token, account: await publicAccount(env, acc, providerList(ways)), isNew, plan: paidPlan((plan.results || [])[0]) };
}

const sessionInsert = (env, hash, accountId, now) => env.DB.prepare('INSERT INTO sessions (token, account, created, seen) VALUES (?, ?, ?, ?)').bind(hash, accountId, now, now);
async function newSession(env, accountId) {
  const token = randomToken();
  await sessionInsert(env, await sha256(token), accountId, Date.now()).run();
  return token;
}
// full: the whole account (its saved data, up to 250 KB); otherwise only who it is
async function accountFromRequest(request, env, full = false) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare(`SELECT ${full ? 'a.*' : 'a.id, a.name, a.email'}, s.created AS s_created FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.token = ?`).bind(hash).first();
  if (!row || Date.now() - row.s_created > SESSION_DAYS * 864e5) return null;
  return { ...row, sessionHash: hash };
}
// Slow down password guessing: at most 15 password tries per account per hour (from anywhere),
// and 100 sign-in attempts per address per hour (a whole class can share one school address).
async function authAllowed(request, env, key, max = 100) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  return (await countUse(env.DB, key || 'auth:' + ip, hour)) <= max;
}
// Throwaway inboxes, used to make account after account for more free questions.
const DISPOSABLE_RE = /@(mailinator|guerrillamail|guerrillamailblock|sharklasers|grr|10minutemail|10minemail|tempmail|temp-mail|tempmailo|tempail|yopmail|trashmail|getnada|nada|dispostable|maildrop|throwawaymail|mintemail|mohmal|emailondeck|fakeinbox|spamgourmet|moakt|tmpmail|tmail|burnermail|inboxkitten|mailnesia|mytemp|emailfake|fakemail|discard|mailcatch|spambox|33mail)\./i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
/* Sign in with Google and Apple. Their ID tokens are checked here against their own public keys
   (signature, who it's for, who made it, when it ends); the client IDs come from the server's
   variables GOOGLE_CLIENT_ID and APPLE_SERVICES_ID, and a provider without one is simply off. */
const IDP = {
  google: { keys: 'https://www.googleapis.com/oauth2/v3/certs', iss: ['https://accounts.google.com', 'accounts.google.com'], aud: (env) => env.GOOGLE_CLIENT_ID },
  apple: { keys: 'https://appleid.apple.com/auth/keys', iss: ['https://appleid.apple.com'], aud: (env) => env.APPLE_SERVICES_ID },
};
const idpKeys = {}; // provider → { at, keys }, kept for an hour (fetched again when a new key id shows up)
const b64urlBytes = (t) => { const s2 = String(t).replace(/-/g, '+').replace(/_/g, '/'); return Uint8Array.from(atob(s2 + '='.repeat((4 - (s2.length % 4)) % 4)), (c) => c.charCodeAt(0)); };
const b64urlJson = (t) => JSON.parse(new TextDecoder().decode(b64urlBytes(t)));
async function providerKeys(name, fresh) {
  const c = idpKeys[name];
  if (!fresh && c && Date.now() - c.at < 3600e3) return c.keys;
  const r = await fetch(IDP[name].keys, { signal: AbortSignal.timeout(8000) });
  if (!r.ok) throw new Error('no keys');
  const keys = ((await r.json()).keys || []).filter((k) => k.kty === 'RSA');
  idpKeys[name] = { at: Date.now(), keys };
  return keys;
}
async function verifyIdToken(name, token, env, nonce) {
  const aud = IDP[name].aud(env);
  if (!aud) throw new Error('off');
  const parts = String(token || '').split('.');
  if (parts.length !== 3 || token.length > 8000) throw new Error('shape');
  let head, claims;
  try { head = b64urlJson(parts[0]); claims = b64urlJson(parts[1]); } catch (e) { throw new Error('shape'); }
  if (head.alg !== 'RS256' || !head.kid) throw new Error('alg');
  let jwk = (await providerKeys(name)).find((k) => k.kid === head.kid);
  if (!jwk) jwk = (await providerKeys(name, true)).find((k) => k.kid === head.kid); // keys rotate
  if (!jwk) throw new Error('key');
  const key = await crypto.subtle.importKey('jwk', { kty: 'RSA', n: jwk.n, e: jwk.e, alg: 'RS256', ext: true }, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['verify']);
  if (!(await crypto.subtle.verify('RSASSA-PKCS1-v1_5', key, b64urlBytes(parts[2]), new TextEncoder().encode(parts[0] + '.' + parts[1])))) throw new Error('signature');
  const now = Date.now() / 1000, auds = Array.isArray(claims.aud) ? claims.aud : [claims.aud];
  if (!auds.includes(aud) || !IDP[name].iss.includes(claims.iss) || !(+claims.exp > now - 60) || (claims.iat && +claims.iat > now + 300) || !claims.sub) throw new Error('claims');
  if (nonce !== undefined && claims.nonce !== nonce) throw new Error('nonce');
  return { sub: String(claims.sub).slice(0, 255), email: String(claims.email || '').toLowerCase().slice(0, 254), verified: claims.email_verified === true || claims.email_verified === 'true', name: String(claims.given_name || claims.name || '').slice(0, 40) };
}
// Who this Google or Apple person is in Cassie: their linked account, or the account with the same
// email (only when the provider says the email is verified), or a new account. Linking to an account
// that has a password asks for that password once, so someone who signed up with another person's
// email can't keep a way in; a person who doesn't know it can let it go ({ forget: true }).
async function signInWith(env, provider, id, { password = '', forget = false, name = '' } = {}) {
  const now = Date.now();
  const linked = await env.DB.prepare('SELECT a.* FROM identities i JOIN accounts a ON a.id = i.account WHERE i.provider = ? AND i.sub = ?').bind(provider, id.sub).first();
  let acc = linked, isNew = false;
  if (!acc && id.verified && id.email) {
    const same = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(id.email).first();
    if (same && same.pass && forget) {
      await env.DB.batch([
        env.DB.prepare('UPDATE accounts SET pass = NULL, salt = NULL, updated = ? WHERE id = ?').bind(now, same.id),
        env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(same.id),
      ]);
      same.pass = null;
    } else if (same && same.pass) {
      if (!password) return { needsPassword: true, email: same.email };
      const tried = await hashPassword(String(password).slice(0, 200), same.salt);
      if (!sameText(tried, same.pass)) return { wrongPassword: true };
    }
    acc = same;
  }
  if (!acc) {
    acc = { id: randomToken(12), email: id.verified && id.email ? id.email : null, name: String(name || id.name || '').slice(0, 40), data: null };
    await env.DB.prepare('INSERT INTO accounts (id, email, name, created, updated) VALUES (?, ?, ?, ?, ?)').bind(acc.id, acc.email, acc.name, now, now).run();
    isNew = true;
  }
  if (!linked) await env.DB.prepare('INSERT OR IGNORE INTO identities (provider, sub, account) VALUES (?, ?, ?)').bind(provider, id.sub, acc.id).run();
  return signedInReply(env, acc, isNew || !acc.data);
}
// Apple sends its answer here (a form post from appleid.apple.com), and this page hands it to the
// app: to the window that opened it, or back to the app's page when there's no such window. Only an
// app address this server already allows can receive it, and the app checks its own one-time nonce.
async function appleReturn(request, env) {
  await ensureSchema(env.DB);
  const form = await request.formData().catch(() => null);
  const get = (k) => String((form && form.get(k)) || '');
  let st = {};
  try { st = b64urlJson(get('state')); } catch (e) { /* no state */ }
  const origin = String(st.o || ''), back = /^\/[\w/.-]{0,80}$/.test(String(st.p || '')) ? st.p : '/app.html', nonce = String(st.n || '');
  const okOrigin = !!cors(origin, env)['access-control-allow-origin'] && !origin.startsWith('chrome-extension:') && /^[\w-]{16,64}$/.test(nonce);
  let out = { code: 'apple_failed' };
  if (okOrigin) {
    if (get('error')) out = { code: get('error') === 'user_cancelled_authorize' ? 'apple_cancelled' : 'apple_failed' };
    else if (!(await authAllowed(request, env))) out = { code: 'too_many_tries' };
    else {
      try {
        const id = await verifyIdToken('apple', get('id_token'), env, nonce);
        let name = '';
        try { const u = JSON.parse(get('user') || '{}'); name = String((u.name && u.name.firstName) || '').slice(0, 40); } catch (e) { /* no name */ }
        const r = await signInWith(env, 'apple', id, { name });
        out = r.needsPassword ? { needsPassword: true, email: r.email, credential: get('id_token'), name } : r;
      } catch (e) { out = { code: 'apple_failed' }; }
    }
  }
  const msg = JSON.stringify({ type: 'cassie-auth', provider: 'apple', nonce, ...out }).replace(/</g, '\\u003c');
  const to = okOrigin ? JSON.stringify(origin).replace(/</g, '\\u003c') : 'null', home = okOrigin ? JSON.stringify(origin + back).replace(/</g, '\\u003c') : 'null';
  const sn = randomToken(16);
  const page = `<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Cassie</title>
<body style="font:17px -apple-system,system-ui,sans-serif;margin:0;padding:32px;background:#f2f0ec;color:#1b1b1d"><p>Going back to Cassie…</p>
<script nonce="${sn}">(function () { var to = ${to}, home = ${home}, msg = ${msg};
if (!to) { document.body.innerHTML = '<p>Apple sign-in didn’t finish, so you aren’t signed in yet. Close this window and try again.</p>'; return; }
if (window.opener) { window.opener.postMessage(msg, to); setTimeout(function () { window.close(); }, 60); }
else location.replace(home + '#cassie-auth=' + encodeURIComponent(JSON.stringify(msg))); })();</script></body></html>`;
  return new Response(page, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'referrer-policy': 'no-referrer', 'x-frame-options': 'DENY',
    'content-security-policy': `default-src 'none'; script-src 'nonce-${sn}'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'` } });
}

async function auth(request, env, path) {
  if (path === '/auth/apple/callback' && request.method === 'POST') return appleReturn(request, env);
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  await ensureSchema(env.DB);
  const fail = (message, status = 400, code = '') => json(code ? { error: message, code } : { error: message }, status, h);
  const ok = (data) => json(data, 200, h);
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 300000) return fail('That is too big to save. Make it shorter, then try again.', 413, 'too_big');
    try { body = JSON.parse(text || '{}'); } catch (e) { return fail('Cassie didn’t understand that request. Close this and try again.', 400, 'bad_request'); }
  }

  // which sign-in buttons the app shows: only providers with a client ID set on this server
  if (path === '/auth/providers') {
    return ok({
      google: env.GOOGLE_CLIENT_ID ? { clientId: env.GOOGLE_CLIENT_ID } : null,
      apple: env.APPLE_SERVICES_ID ? { clientId: env.APPLE_SERVICES_ID, redirectURI: new URL('/auth/apple/callback', request.url).href } : null,
    });
  }
  if (path === '/auth/google' || path === '/auth/apple') {
    if (!(await authAllowed(request, env))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const provider = path.slice(6), code = provider + '_failed';
    const words = provider === 'google' ? 'Google sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.' : 'Apple sign-in didn’t finish, so you aren’t signed in yet. Try again, or use your email and password.';
    let id;
    // the one-time code the app made for this sign-in must be inside the token (Apple always; Google from the app's own page)
    const nonce = body.nonce ? String(body.nonce) : provider === 'apple' ? '' : undefined;
    try { id = await verifyIdToken(provider, String(body.credential || ''), env, nonce); } catch (e) { return fail(words, 401, code); }
    if (body.password && id.email && !(await authAllowed(request, env, 'authm:' + (await sha256(id.email)), 15))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const r = await signInWith(env, provider, id, { password: String(body.password || ''), forget: body.forget === true, name: String(body.name || '') });
    if (r.wrongPassword) return fail('That password doesn’t match this email’s Cassie account. Check it for typos, or tap “I don’t know this password”.', 401, 'link_wrong_password');
    return ok(r);
  }
  if (path === '/auth/signup' || path === '/auth/login') {
    if (!(await authAllowed(request, env))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    const now = Date.now();
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return fail('That doesn’t look like an email yet. It needs an @ and a dot, like name@gmail.com.', 400, 'email_bad');
    if (path === '/auth/signup') {
      if (!(+body.age >= 2 && +body.age <= 100)) return fail('Ages go from 2 to 100. Check the number you typed.', 400, 'age_range'); // every age is welcome
      if (DISPOSABLE_RE.test(email)) return fail('That looks like a throwaway email, and those can’t make accounts. Use the email you check every day.', 400, 'email_disposable');
      if (password.length < 8) return fail('Your password needs at least 8 letters or numbers so it’s hard to guess.', 400, 'password_short');
      if (password.length > 200) return fail('That password is too long. Use one with fewer than 200 letters and numbers.', 400, 'password_long');
      const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
      if (exists) return fail('That email is already signed up. Try signing in instead.', 409, 'email_taken');
      const salt = randomToken(16);
      const acc = { id: randomToken(12), email, name: String(body.name || '').trim().slice(0, 40), data: null };
      await env.DB.prepare('INSERT INTO accounts (id, email, pass, salt, name, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(acc.id, email, await hashPassword(password, salt), salt, acc.name, now, now).run();
      return ok({ token: await newSession(env, acc.id), account: await publicAccount(env, acc), isNew: true, plan: freePlan });
    }
    if (!(await authAllowed(request, env, 'authm:' + (await sha256(email)), 15))) return fail('There were too many tries, so signing in is paused to keep accounts safe. Wait an hour, then try again.', 429, 'too_many_tries');
    if (password.length > 200) return fail('That email and password don’t match. Check both for typos, then try again.', 401, 'wrong_password');
    const acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
    const tried = await hashPassword(password, (acc && acc.salt) || 'no-account-salt'); // always hash, so a wrong email takes as long as a wrong password
    const good = !!(acc && acc.pass && sameText(tried, acc.pass));
    if (!good) {
      if (acc && !acc.pass) { // made with Google or Apple: point to the right button
        const ways = await providersOf(env, acc.id);
        if (ways.includes('google')) return fail('This account was made with Google, so it has no password. Tap “Continue with Google” instead.', 401, 'google_account');
        if (ways.includes('apple')) return fail('This account was made with Apple, so it has no password. Tap “Sign in with Apple” instead.', 401, 'apple_account');
      }
      return fail('That email and password don’t match. Check both for typos, then try again.', 401, 'wrong_password');
    }
    return ok(await signedInReply(env, acc, !acc.data));
  }

  const acc = await accountFromRequest(request, env, path === '/auth/me'); // (only /auth/me sends the saved data back)
  if (!acc) return fail('You’ve been signed out, so Cassie can’t save to your account. Sign in again to carry on.', 401, 'signed_out');
  if (path === '/auth/me') {
    const [, ways, plan] = await env.DB.batch([env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(Date.now(), acc.sessionHash), providersQuery(env, acc.id), planQuery(env, acc.id)]);
    return ok({ account: await publicAccount(env, acc, providerList(ways)), plan: paidPlan((plan.results || [])[0]) });
  }
  if (path === '/auth/save') {
    const data = body.data && typeof body.data === 'object' ? JSON.stringify(body.data) : null;
    if (!data || data.length > 250000) return fail('There was nothing to save yet. Change something first, then save.', 400, 'nothing_to_save');
    const name = String((body.data.profile && body.data.profile.name) || acc.name || '').slice(0, 40);
    await env.DB.prepare('UPDATE accounts SET data = ?, name = ?, updated = ? WHERE id = ?').bind(data, name, Date.now(), acc.id).run();
    return ok({ saved: true });
  }
  if (path === '/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(acc.sessionHash).run();
    return ok({ signedOut: true });
  }
  if (path === '/auth/delete') { // "Delete my account" — removes everything about it (its plan too)
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM identities WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM plans WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM early WHERE account = ? OR email = ?').bind(acc.id, acc.email || ''), env.DB.prepare('UPDATE payments SET account = NULL WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(acc.id)]);
    return ok({ deleted: true });
  }
  return fail('Cassie couldn’t find that. It may have been removed. Go back and try again.', 404, 'not_found');
}

/* ------------------------------------------------------------------ brain check
   Real questions with known answers, through every AI the server can use. Run it from the
   dashboard ("Run brain check") or daily with a Cron Trigger; the latest result is kept. */
const CHECK_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAWgAAAB4CAAAAAD6LzcmAAAHDklEQVR42u2deXAURRSHv9nsJiQEAuEQBYKUlFgIRkoQkKNQPFBABYkoUIIH5VEKChouUaxStAKIHBaXEOQQVBDEQiTciCCHgFUiIGchEG6yCUkIOdo/BpLsZsnMUDs7SXy/v7Kv53XPfNPb/fp1p1ZTiEIhlyAQ0AJaJKAFtIAWCWgBLRLQAlpAiwS0gBYJaAEtoEUCWkCLBLSAFtAiAS2gRQJaQAtokYAW0CIBLaAFtEhAC2iRgBbQ/1+5y+yd5a7auuNomtdTLbZZy073hKTJrLXbdhy76I2MbdS2S8tgV65K0dQbejVWNuvi0NrF27t/gbJd6/tGF2uxzabg1l5GQS+t49/io8ftbXFDB/9BdWRZAN3O3qeerpVssv4RW5sMK9niu8Gs/yYnw762jpVLX1MAsYlrTuekH5zfRQP4t1OG7YN0XGJK6lXv7qQ4AMYtDtUYHUCZVQAi0+zsXBl1AUjwXjds0g2Dbe7Rdy/Kv/6UfQBokBOioSOA5uod2tZv8TgAuhcUWfZVA3CfsxN07Jz8ok/5jwGw0jnQDwKwzlbQrQGizxY3fQHALBsbTTjt8/EvAN5yDPQxDaBhgZ2cMzWAfr62CPu/SL5qCNDFsclwjgJ4UTO8cND0GxSM+cjI9bQC8I22ou4DOBXC9VJdgPNOrQz1IdrV3/DCoZM014BABZ+NJGJY6b76093qa7wtyM9tqPMANZzKdWw8AvBwfaPrRiehXp0doGDscBg+oXTnqBuWVA4d59SDAA2dAj0HgJcN73ICoF6ZU6Lg80SATy6W6l1fA0j1qxIgLnSgp+QDdHcojs6oDBB7xfDC36IBXF/7mfXYofouA+/4G02GU0I2Fe7xANxR4FDUMdt0zLOpMoBrno9xMgAxO4ycxwNE+wTNkwAqnQ0V5+P1APhJOQS6PQC7TaXCogDCiifdvgSg6jZD3/R6AD2LdacDsUHPPZSm03cBMFA5BPqQBtDc3MVrKgGELSo0TNMAqmwx4bvWA/B8euFIVB8gPrtUp0vGw2SYuVs/0wSArnlOgX4fgMkmr14VARD27bWPMzSA6M2mfJdEAtQctu7M1cuHv+mmAcQbDBxBA32uKQCPZCuHQBfEAURcNHv9inAA92KllFKzNICojSZ997bzYxQx2Oi5gwX6UnOdc5ZyCvRqAJ4z77DcA+BeopRKdgFEWciRbBwQXkTo9o9PGgMKDujcTrZwtgK6NwApFir/wQ3gWabmugAi15h3PfiGzx5Li0lZIQKtj48dg83ZAmhvJEBcvpXav9dJD3IBRKwy7Zf1ZokNjzrLQhJwHHYDxKcr50DrWaIPrFW/sAhYxM+mvc7qm961hq89ecV7aEEvffk6KhSghwBEH1UOgm4DoFm9hXnX1/jh5qP/DJ3zO5mFef94AJJCALopQKJyEPR+AB6y3ECynlL1WPjmvw7AhOIr8DYA7l22c85zB3ljxXo+Ws8QvWQ5l1JVHzzCok17/DMNIOHt4gm9JTFAXqLtuaRzeQCN7Kja5AvJrwsQY3kyXuq51k6k6dBuEIBrv69xFAD7bJ8L9VShgz065SRA70iLr3H5s7nX/sruutGkzy8ALRsHOt+QYnePLrDtnJxZ0Mk3NXKsSMgFPANdQFaXX035pB8AaO9nvfMWgO2l+KVphnLyoKFJ0Jd+BGjWwlrlK5+5Cni+m5jsAjKf2GzG6Yye/fc31ysqK5cyCXphzk106JTuOYB70dO8MEsDLj++xcyRTn0O9TfHAGRWeNDJAOHWDoKteSoHcC/sAfSfqQGXO281dquuDyD+Zm9RmY1qpJRSqqZjoPfuBOhm6QbWPXkFCFvQU99nnK4BGZ23GfrVAuCEv/kEQM3y26PNhXdD9KnNSjizQd9iWVhomKoBxGw39KwD0Crgemm0KrcyBTq3DkBdKzsO+qZhgK2sajuNXPsAuA74GkcAsLmCg14OwAgL1W6ODrA5O0kfg/8w8NXPUSb42E5UBYjJtRvHUgDWOwW6BwAHzde6pUrA4wb6yZlYg93dK/VK5DoutwpR/s5Z0OfDATqYr/RUVQBtdomC8QDUuFC6+0x99hhcmL37u5n+htIqOOiJ1843mteHgPZVgIIkgPFGm5N6oELtEetSczIOL0jQQyP3SlXBQd8LUCXTSrXvoc0IWPApjDH0zu4YKBCdpcozaBPL/z/3APSKshI0JuU0CXiYlGH5ecMNvSutHv1Zvp+twfx2lGuZTFuyRYVUu/tFFL/LhmO9IWnWvh6tldlff7uw9vedqWleT/XqjVo/0Lbc/yu1Jj+zV6aSSiIBLaBFAlpAC2iRgBbQIgEtoAW0SEALaJGAFtACWiSgBbRIQAtoAS0S0AJaJKAFtIAWCWgBLRLQAlpAiwS0gBYJaAEtoEUCWkCLBLSAroD6D5J5FbIksIGiAAAAAElFTkSuQmCC';
async function groqAsk(env, model, messages, maxTokens = 1500) {
  const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ } throw new Error(`${r.status} ${m}`.slice(0, 200)); }
  return ((await r.json()).choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}
async function runHealth(env) {
  geminiBlocked = { until: 0, where: '' }; // a check asks Google again, now
  const textQ = [{ role: 'user', content: 'What is 17 × 23? Reply with only the number.' }];
  const picQ = [{ role: 'user', content: [{ type: 'text', text: 'Read the sum in this picture and work it out. Reply with only the number.' }, { type: 'image_url', image_url: { url: CHECK_PNG } }] }];
  const graphQ = [{ role: 'system', content: 'When asked to graph, reply with exactly one fenced code block tagged cassie-board holding minified JSON like {"type":"graph","title":"…","fn":"…","xrange":[a,b]}. fn uses * and ^.' }, { role: 'user', content: 'graph y = x^2 - 4' }];
  const graphOk = (t) => { const m = /```cassie-board\s*([\s\S]*?)```/.exec(t || ''); try { const o = JSON.parse(m[1]); return o.type === 'graph' && /x/.test(o.fn); } catch (e) { return false; } };
  const checks = [], jobs = [];
  // every check runs at the same time, and none may take longer than 45 s, so the whole check is quick
  const run = (name, fn, ok) => { const i = checks.push(null) - 1; jobs.push((async () => {
    const t0 = Date.now();
    let timer;
    const late = new Promise((_, no) => { timer = setTimeout(() => no(new Error('no answer in 45 s (too slow)')), 45000); });
    try { const out = await Promise.race([fn(), late]); checks[i] = { name, ok: !!ok(out), ms: Date.now() - t0, detail: String(out || '').replace(/\s+/g, ' ').slice(0, 160) }; }
    catch (e) { checks[i] = { name, ok: false, warn: !!e.warn, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 600) }; }
    finally { clearTimeout(timer); }
  })()); };
  if (env.GROQ_KEY) {
    run('Groq: text maths', () => groqAsk(env, CHAT_MODELS[0], textQ), (t) => /\b391\b/.test(t));
    run('Groq: graph on the board', () => groqAsk(env, CHAT_MODELS[0], graphQ), graphOk);
    run('Groq: read a picture', async () => {
      const models = await visionModels(env, true);
      if (!models.length) throw new Error(`no picture-reading model on this Groq key. Groq has: ${(vision.all || []).join(', ') || 'nothing (key problem?)'}`);
      let last;
      for (const m of models.slice(0, 3)) { try { return `${m}: ${await groqAsk(env, m, picQ, 300)}`; } catch (e) { last = e; } }
      throw last;
    }, (t) => /\b56\b/.test(t));
  } else checks.push({ name: 'Groq', ok: false, ms: 0, detail: 'GROQ_KEY is not set' });
  if (env.GEMINI_KEY) {
    // a place Google blocks is shown as a warning with the fix, not as a broken brain
    const gem = (q) => async () => { const g = await askGemini(env, q, 300); if (g.blocked) { const e = new Error(g.detail); e.warn = true; throw e; } if (!g.reply) throw new Error(g.detail); return g.reply; };
    run('Gemini: text maths', gem(textQ), (t) => /\b391\b/.test(t));
    run('Gemini: read a picture', gem(picQ), (t) => /\b56\b/.test(t));
  }
  if (env.ANTHROPIC_KEY) {
    run('Claude: text maths', () => askClaude(env, { messages: textQ }, 'haiku'), (t) => /\b391\b/.test(t));
    run('Claude: read a picture', () => askClaude(env, { messages: picQ }, 'haiku'), (t) => /\b56\b/.test(t));
  }
  if (env.AI) run('Workers AI (backup): read a picture', async () => { const v = await aiVision(env, picQ, 300); if (!v.reply) throw new Error(v.detail); return v.reply; }, (t) => /\b56\b/.test(t));
  if (env.AI) run('Workers AI (backup): text maths', async () => { const o = await env.AI.run(BACKUP_MODEL, { messages: textQ, max_tokens: 200 }); return (o && (o.response ?? o.result?.response)) || ''; }, (t) => /\b391\b/.test(t));
  await Promise.all(jobs);
  const canPictures = checks.some((c) => c.ok && /picture/.test(c.name));
  const canText = checks.some((c) => c.ok && /text maths/.test(c.name));
  const result = { ts: Date.now(), ok: canText && canPictures, canText, canPictures, checks };
  try {
    await ensureSchema(env.DB);
    await env.DB.prepare('INSERT INTO health (k, ts, data) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET ts = ?2, data = ?3').bind('last', result.ts, JSON.stringify(result)).run();
    if (!result.ok) await logProblem(env, 'brain check', checks.filter((c) => !c.ok && !c.warn).map((c) => `${c.name}: ${c.detail}`).join(' | '));
  } catch (e) { /* still return it */ }
  return result;
}
// The dashboard's password (ADMIN_TOKEN). It must be at least 16 characters; wrong guesses are
// limited to 10 an hour per network, so it can't be guessed by trying many.
// view: the dashboard's numbers may also be read with VIEW_TOKEN (a second password that can't change anything)
async function adminOk(request, env, { view = false } = {}) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 16) return { error: 'Set an ADMIN_TOKEN of at least 16 characters in the Worker settings first.', status: 503 };
  if (view && given && env.VIEW_TOKEN && String(env.VIEW_TOKEN).length >= 16 && sameText(given, String(env.VIEW_TOKEN))) { await ensureSchema(env.DB); return null; }
  await ensureSchema(env.DB);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown', hour = new Date().toISOString().slice(0, 13);
  const tries = await env.DB.prepare('SELECT n FROM quota WHERE k = ? AND day = ?').bind('adm:' + ip, hour).first();
  if (tries && tries.n >= 10) return { error: 'Too many wrong tries. Wait an hour.', status: 429 };
  if (given && sameText(given, String(env.ADMIN_TOKEN))) return null;
  await countUse(env.DB, 'adm:' + ip, hour);
  return { error: 'wrong token', status: 401 };
}
async function health(request, env) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  return json(await runHealth(env));
}

async function stats(request, env) {
  const url = new URL(request.url);
  const no = await adminOk(request, env, { view: true }); // (the view-only password reads the numbers too)
  if (no) return json({ error: no.error }, no.status);
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
    all(`SELECT COALESCE(NULLIF(grade,''),'-') AS k, COUNT(*) AS n FROM users WHERE role = 'student' GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(age,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(platform,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT substr(uid,1,8) AS id, opens, uses, first_day, last_day, role, grade, age FROM users ORDER BY opens + uses DESC LIMIT 25`),
  ]);
  const [ratings, reports, chats, accountsRow, earlyRows] = await Promise.all([
    all(`SELECT COALESCE(NULLIF(feature,''),'chat') AS name, SUM(kind = 'up') AS up, SUM(kind = 'down') AS down FROM feedback WHERE day >= ? AND kind IN ('up','down') GROUP BY name ORDER BY up + down DESC LIMIT 20`, since),
    all(`SELECT ts, kind, feature, text, ctx FROM feedback WHERE day >= ? AND text != '' ORDER BY ts DESC LIMIT 60`, since),
    all(`SELECT src, SUM(n) AS n FROM chats WHERE day >= ? GROUP BY src ORDER BY n DESC`, since),
    one(`SELECT (SELECT COUNT(*) FROM accounts) AS n, (SELECT COUNT(DISTINCT account) FROM identities WHERE provider = 'google') AS google, (SELECT COUNT(DISTINCT account) FROM identities WHERE provider = 'apple') AS apple`),
    all(`SELECT src, COUNT(*) AS n FROM early GROUP BY src ORDER BY n DESC`),
  ]);
  const [healthRow, problems] = await Promise.all([
    one(`SELECT data FROM health WHERE k = 'last'`),
    all(`SELECT feature AS k, COUNT(*) AS n, MAX(ts) AS last FROM feedback WHERE day >= ? AND kind = 'error' GROUP BY feature ORDER BY n DESC LIMIT 12`, since),
  ]);
  let healthData = null; try { healthData = healthRow ? JSON.parse(healthRow.data) : null; } catch (e) { healthData = null; }
  // money: live payments only (test payments are counted apart), this month from the 1st, Philippine time
  const monthStart = Date.parse(`${today.slice(0, 7)}-01T00:00:00+08:00`);
  const [paySum, payList, active] = await Promise.all([
    one(`SELECT COALESCE(SUM(CASE WHEN live = 1 THEN php END), 0) AS php, COALESCE(SUM(live = 1), 0) AS n, COUNT(DISTINCT CASE WHEN live = 1 THEN account END) AS people,
      COALESCE(SUM(CASE WHEN live = 1 AND paid >= ? THEN php END), 0) AS month_php, COALESCE(SUM(live = 1 AND paid >= ?), 0) AS month_n, COALESCE(SUM(live = 0), 0) AS tests FROM payments WHERE status = 'paid'`, monthStart, monthStart),
    all(`SELECT p.paid, p.plan, p.bill, p.php, p.shown, p.method, p.live, a.email FROM payments p LEFT JOIN accounts a ON a.id = p.account WHERE p.status = 'paid' ORDER BY p.paid DESC LIMIT 50`),
    one(`SELECT COALESCE(SUM(plan = 'plus'), 0) AS plus, COALESCE(SUM(plan = 'pro'), 0) AS pro FROM plans WHERE until > ?`, now),
  ]);
  return json({ days, today, since, totals, today_: todayRow, week: weekRow, range: rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top, ratings, reports, chats, accounts: accountsRow, early: earlyRows, health: healthData, problems, payments: { ...paySum, active, list: payList } });
}

export default {
  // Cron Trigger (Worker → Settings → Triggers), every hour (0 * * * *): reminders whose hour it is, the tidy-up,
  // and at 22:00 UTC (6 a.m. in the Philippines) the daily brain check (a daily-only trigger still works: it runs then)
  async scheduled(event, env, ctx) {
    const at = (event && event.scheduledTime) || Date.now();
    if (new Date(at).getUTCHours() === 22) ctx.waitUntil(runHealth(env));
    ctx.waitUntil(tidy(env).catch(() => {}));
    ctx.waitUntil(sendReminders(env, at).catch((e) => logProblem(env, 'reminders', String(e && e.message || e).slice(0, 200)).catch(() => {})));
  },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (env.DB && Date.now() - tidiedAt > 10 * 60e3) { tidiedAt = Date.now(); ctx.waitUntil(tidy(env).catch(() => {})); }
    if (request.cf && request.cf.colo) lastColo = request.cf.colo;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (tooFast(request, url.pathname)) return json({ error: 'Cassie is very busy right now because lots of people are asking at once. Wait a minute, then try again.', code: 'busy' }, 429, { ...cors(request.headers.get('origin') || '', env), 'retry-after': '60' });
      if (request.method === 'GET' && url.pathname === '/config') return await config(request, env);
      if (url.pathname === '/admin/plan' && (request.method === 'GET' || request.method === 'POST')) return await adminPlan(request, env, url);
      if (request.method === 'GET' && url.pathname === '/ask') return await ask(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/chat') return await chat(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/image') return await image(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/transcribe') return await transcribe(request, env, ctx);
      if (url.pathname === '/speak') return await speak(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
      if (request.method === 'POST' && url.pathname === '/f') return await feedback(request, env);
      if (request.method === 'POST' && url.pathname === '/care') { const h = allowedOrigin(request, env); if (!h) return new Response('forbidden', { status: 403 }); if (env.DB) { await ensureSchema(env.DB); countCare(env, ctx); } return new Response(null, { status: 204, headers: h }); }
      if (url.pathname.startsWith('/auth/')) return await auth(request, env, url.pathname);
      if (request.method === 'POST' && url.pathname === '/early') return await early(request, env);
      if (url.pathname.startsWith('/pay/')) return await pay(request, env, url, ctx);
      if (request.method === 'GET' && url.pathname === '/admin/early') return await adminEarly(request, env);
      if (url.pathname.startsWith('/room')) return await room(request, env, url);
      if (url.pathname.startsWith('/push/')) return await push(request, env, url);
      if (url.pathname.startsWith('/scores/')) return await scores(request, env, url);
      if (request.method === 'GET' && url.pathname === '/stats') return await stats(request, env);
      if (request.method === 'GET' && url.pathname === '/health') return await health(request, env);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return dashboard();
      return new Response('not found', { status: 404 });
    } catch (e) {
      // where it broke, not what it said: an error's message can quote the request (a bad JSON body, say)
      const where = String(e && e.stack || '').split('\n').filter((l) => /^\s*at /.test(l)).slice(0, 6).join('\n');
      ctx.waitUntil(logProblem(env, 'server: ' + url.pathname.slice(0, 30), `${(e && e.name) || 'Error'}\n${where}`.slice(0, 600)).catch(() => {}));
      return json({ error: 'Something went wrong on Cassie’s server. Please try again.' }, 500, cors(request.headers.get('origin') || '', env));
    }
  },
};

/* ------------------------------------------------------------------ dashboard */
const DASHBOARD = `__DASHBOARD_HTML__`;
