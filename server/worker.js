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
 *                     text when Groq can't (aistudio.google.com/apikey)
 *   ANTHROPIC_KEY     (optional) secret — makes Claude Cassie's brain for the main chat and
 *                     photos (console.anthropic.com → API keys). Groq and Workers AI stay as backup.
 * Optional variables:
 *   DAILY_LIMIT      questions per person per day through your key (default 150)
 *   MINUTE_LIMIT     questions per person per minute (default 12)
 *   IMAGE_LIMIT      backup pictures per person per day (default 20)
 *   CLAUDE_DAILY_LIMIT  Claude answers per person per day (default 40); after that, Groq answers
 *   CLAUDE_MODEL     which Claude model to use (default: Anthropic's newest Opus, looked up
 *                    automatically from the Models API)
 *   CLAUDE_EFFORT    how hard Claude thinks: low, medium or high (default medium)
 *   ASK_LIMIT        Shortcut answers per network per day (default 40)
 *   TRANSCRIBE_DAILY_LIMIT  voice recordings written down per network per day (default 3000)
 *   ALLOW_EXTENSION  set to "off" to stop the Chrome / Edge extension using this server
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
  `CREATE TABLE IF NOT EXISTS accounts (id TEXT PRIMARY KEY, email TEXT UNIQUE, pass TEXT, salt TEXT, google TEXT UNIQUE, name TEXT, data TEXT, created INTEGER, updated INTEGER)`,
  `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, account TEXT, created INTEGER, seen INTEGER)`,
  `CREATE TABLE IF NOT EXISTS health (k TEXT PRIMARY KEY, ts INTEGER, data TEXT)`,
  // live board rooms: a code, who's in, and every drawing step in order (rooms last a day)
  `CREATE TABLE IF NOT EXISTS rooms (code TEXT PRIMARY KEY, created INTEGER, owner TEXT, title TEXT)`,
  `CREATE TABLE IF NOT EXISTS room_members (code TEXT, uid TEXT, name TEXT, seen INTEGER, PRIMARY KEY (code, uid))`,
  `CREATE TABLE IF NOT EXISTS room_ops (id INTEGER PRIMARY KEY AUTOINCREMENT, code TEXT, uid TEXT, ts INTEGER, op TEXT)`,
  // daily puzzles: each student's first finish of each puzzle, each day (lower value = better)
  `CREATE TABLE IF NOT EXISTS scores (day TEXT, game TEXT, uid TEXT, name TEXT, value REAL, shown TEXT, ts INTEGER, PRIMARY KEY (day, game, uid))`,
  `CREATE INDEX IF NOT EXISTS room_ops_code ON room_ops(code, id)`,
];
let schemaReady = false;
async function ensureSchema(db) {
  if (schemaReady) return;
  await db.batch(SCHEMA.map((q) => db.prepare(q)));
  schemaReady = true;
}

const dayOf = (ms) => new Date(ms + TZ_OFFSET_H * 3600e3).toISOString().slice(0, 10);
const clean = (v, n = 40) => String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, '').slice(0, n);
// feature and event names are short labels like "quiz" or "labs: pendulum" — anything else is dropped
const label = (v, n = 40) => { const t = clean(v, n); return /^[\w .:/+&()'’-]*$/u.test(t) ? t : ''; };

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS ? env.ALLOWED_ORIGINS.split(',').map((s) => s.trim()) : DEFAULT_ORIGINS);
  const ok = allowed.some((a) => origin === a || (a === 'http://localhost' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))
    || (env.ALLOW_EXTENSION !== 'off' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)); // the Cassie extension (Chrome and Edge)
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-expose-headers': 'retry-after, x-cassie-source, x-cassie-left', vary: 'origin' } : {};
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
const SPEED = { '/e': 400, '/f': 100, '/scores/': 200, '/room/create': 30, '/room': 3000, '/auth/': 200, '/transcribe': 300, '/image': 100 };
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
function chatError(message, status, h, extra = {}) {
  return json({ error: { message } }, status, { ...h, ...extra });
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
        detail += `${model}: ${r.status} ${m.slice(0, 90)} · `;
      }
    } catch (e) { detail += `${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : e.message} · `; }
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
    } catch (e) { detail += `${model}: ${String(e.message || e).slice(0, 90)} · `; }
  }
  return { reply: null, detail: 'Workers AI ' + detail.replace(/ · $/, '') };
}

/* Problems the server hit, for the dashboard (a few hundred a day at most, no messages). */
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
let claudePick = { id: '', at: 0 };
const anthropicHeaders = (env) => ({ 'content-type': 'application/json', 'x-api-key': env.ANTHROPIC_KEY, 'anthropic-version': '2023-06-01' });
// Anthropic's newest Opus (the Models API lists newest first), unless CLAUDE_MODEL picks one.
async function claudeModel(env) {
  if (env.CLAUDE_MODEL) return env.CLAUDE_MODEL;
  if (claudePick.id && Date.now() - claudePick.at < 6 * 3600e3) return claudePick.id;
  try {
    const r = await fetch(`${ANTHROPIC}/models?limit=100`, { headers: anthropicHeaders(env), signal: AbortSignal.timeout(10000) });
    const ids = ((await r.json()).data || []).map((m) => m.id);
    const id = ids.find((x) => /opus/i.test(x)) || ids[0] || '';
    if (id) claudePick = { id, at: Date.now() };
  } catch (e) { /* keep the old pick */ }
  return claudePick.id;
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
async function askClaude(env, cleaned) {
  const model = await claudeModel(env);
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
async function config(request, env) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  return json({ claude: !!env.ANTHROPIC_KEY }, 200, { ...h, 'cache-control': 'max-age=300' });
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
  if (file.size > 8 * 1024 * 1024) return chatError('That recording is too long — talk in shorter bits.', 413, h);
  const uid = /^[\w-]{8,64}$/.test(String(form.get('uid') || '')) ? String(form.get('uid')) : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const now = Date.now(), minute = Math.floor(now / 60e3), mk = `t|${uid}|${ip}`;
  const hit = minuteHits.get(mk);
  const n = hit && hit.m === minute ? hit.n + 1 : 1;
  minuteHits.set(mk, { m: minute, n });
  if (n > (+env.TRANSCRIBE_MINUTE_LIMIT || 20)) return chatError('Lots of talking! Give me a few seconds.', 429, h, { 'retry-after': '20' });
  if (env.DB) {
    await ensureSchema(env.DB);
    const row = await env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind('t:' + ip, dayOf(now)).first();
    if (row && row.n > (+env.TRANSCRIBE_DAILY_LIMIT || 3000)) return chatError('That’s a lot of voice for today — type for now, and voice comes back tomorrow.', 429, h);
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
        problems.push(`Groq ${model}: ${r.status} ${m}`.slice(0, 200));
      } catch (e) { problems.push(`Groq ${model}: ${e.message}`); }
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
    } catch (e) { problems.push(`Workers AI whisper: ${e.message || e}`); }
  }
  ctx.waitUntil(logProblem(env, 'voice: transcribe', problems.join(' | ') || 'no speech-to-text set up'));
  return chatError('I couldn’t hear that clearly — try again, or type it.', 503, h);
}

/* ---------------------------------------------------------------- the iPhone Shortcut
   GET /ask?text=…  → plain text. Shortcuts shows it in a pop-up over Safari / a PDF, so no new
   browser tab opens. Shortcuts sends no Origin header, so this route has its own small daily
   cap per network instead of the site check. */
const MATH_NOTE = 'The text was copied on a phone, so maths may be flattened: "x2" usually means x², "x3" means x³, a number on the line under another number is often a fraction, and symbols like √, π, ∫ or exponents may be missing or split across lines. Rebuild the intended expression first and say it in one line ("I read this as: …"), then solve it carefully and double-check the result.';
const ASK_SYSTEM = `You are Cassie, a warm, sharp study buddy. A student selected some text on their phone (from a PDF, a document or a web page) and wants help with it. Do what it needs: if it is a question or a problem, solve it, giving the answer first and then the key steps; otherwise explain it simply, with a short example. Keep it under 180 words. Plain text only: no markdown symbols (no **, #, tables) and no LaTeX; write maths with ordinary symbols (x², √, ½, ≤, π). ${MATH_NOTE}`;
const plainText = (t) => String(t).replace(/<think>[\s\S]*?<\/think>\s*/g, '').replace(/```[\s\S]*?```/g, '').replace(/\*\*|__|`/g, '').replace(/^#{1,6}\s*/gm, '').replace(/^\s*[-*]\s+/gm, '• ').replace(/\n{3,}/g, '\n\n').trim();
async function ask(request, env, ctx) {
  const url = new URL(request.url);
  const out = (t, status = 200) => new Response(t, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
  const text = (url.searchParams.get('text') || '').trim().slice(0, 4000);
  if (!text) return out('Select some words first, then Share → Ask Cassie.');
  const now = Date.now(), today = dayOf(now), ip = request.headers.get('cf-connecting-ip') || 'unknown';
  await ensureSchema(env.DB);
  const row = await env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind('a:' + ip, today).first();
  const limit = +env.ASK_LIMIT || 40;
  if ((row && row.n || 0) > limit) return out(`That's today's ${limit} quick answers from this network. Open Cassie for more: askcassie.pages.dev`, 429);
  const messages = [{ role: 'system', content: ASK_SYSTEM }, { role: 'user', content: text }];
  let reply = null, src = 'shortcut';
  if (env.ANTHROPIC_KEY) { try { reply = await askClaude(env, { messages }); } catch (e) { reply = null; } if (reply) src = 'shortcut-claude'; }
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
  if (!reply) { ctx.waitUntil(logProblem(env, 'iPhone Shortcut', 'no AI answered')); return out('Cassie is very busy right now. Try again in a minute.', 503); }
  ctx.waitUntil(countChat(env, today, src));
  return out(`${plainText(reply)}\n\n— Cassie · askcassie.pages.dev`);
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
  // the whole network too (made-up ids can't get around the minute limit; a classroom shares one address)
  const ipHit = minuteHits.get('ip|' + ip);
  const nIp = ipHit && ipHit.m === minute ? ipHit.n + 1 : 1;
  minuteHits.set('ip|' + ip, { m: minute, n: nIp });
  if (minuteHits.size > 5000) minuteHits.clear();
  if (n > perMin || nIp > perMin * 10) return chatError('Whoa, lots of questions! Give me a few seconds, then ask again.', 429, h, { 'retry-after': String(60 - Math.floor((now / 1000) % 60)) });
  await ensureSchema(env.DB);
  const bump = (k) => env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind(k, today);
  // no id → the allowance is per network ("anon" is never one shared pool)
  const [u, i] = await env.DB.batch([bump(uid === 'anon' ? 'an:' + ip : 'u:' + uid), bump('i:' + ip)]);
  const usedU = u.results?.[0]?.n || 0, usedI = i.results?.[0]?.n || 0;
  if (Math.random() < 0.01) ctx.waitUntil(env.DB.prepare('DELETE FROM quota WHERE day < ?').bind(today).run());
  if (usedU > perDay || usedI > perDay * 25) {
    const secs = Math.ceil(msUntilMidnightPH(now) / 1000);
    return chatError(`You've used today's ${perDay} free questions. They come back at midnight — or add your own free Groq key in Settings to keep going right now.`, 429, h, { 'retry-after': String(secs), 'x-cassie-daily': '1' });
  }
  const left = { 'x-cassie-left': String(Math.max(0, perDay - usedU)) };

  // Claude first for the main chat, within its own daily allowance per person
  if (env.ANTHROPIC_KEY && body.brain === 'claude') {
    const perDayClaude = +env.CLAUDE_DAILY_LIMIT || 40;
    let usedC = 0;
    let usedCi = 0;
    try { [usedC, usedCi] = (await env.DB.batch([bump('c:' + uid), bump('ci:' + ip)])).map((r) => r.results?.[0]?.n || 0); } catch (e) { usedC = usedCi = Infinity; }
    if (uid !== 'anon' && usedC <= perDayClaude && usedCi <= perDayClaude * 25) {
      let reply = null;
      try { reply = await askClaude(env, cleaned); } catch (e) { reply = null; }
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
      } catch (e) { lastStatus = 503; problems.push(`Groq ${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : e.message}`); continue; }
      if (r.ok) {
        ctx.waitUntil(countChat(env, today, 'groq'));
        return new Response(r.body, { status: 200, headers: { 'content-type': stream ? 'text/event-stream' : 'application/json', 'cache-control': 'no-store', ...h, ...left, 'x-cassie-source': 'groq' } });
      }
      lastStatus = r.status;
      try { lastDetail = (await r.json()).error?.message || ''; } catch (e) { lastDetail = ''; }
      problems.push(`Groq ${model}: ${r.status} ${lastDetail}`.slice(0, 300));
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
    } catch (e) { lastDetail = lastDetail || String(e && e.message || e); problems.push(`Workers AI: ${e.message || e}`); }
  }
  ctx.waitUntil(countChat(env, today, 'failed'));
  ctx.waitUntil(logProblem(env, cleaned.image ? 'chat: picture' : 'chat: text', problems.filter(Boolean).join(' | ') || `status ${lastStatus}`));
  // an unanswered question shouldn't use up the person's daily allowance
  ctx.waitUntil(env.DB.batch(['u:' + uid, 'i:' + ip].map((k) => env.DB.prepare('UPDATE quota SET n = MAX(0, n - 1) WHERE k = ?').bind(k))));
  if (cleaned.image && !env.GROQ_KEY && !env.GEMINI_KEY) return chatError('Reading photos needs a Groq or Gemini key — add one in Settings.', 503, h);
  if (cleaned.image) vision.at = 0; // look again for picture readers next time
  return lastStatus === 429
    ? chatError('Cassie is very busy right now — try again in a minute.', 429, h, { 'retry-after': '20' })
    : chatError(cleaned.image ? 'I couldn’t read that picture just now — try again in a minute, or type the question instead.' : 'Cassie can’t reach her brain right now — try again in a moment.', 503, h);
}

/* ------------------------------------------------------------------ pictures */
const IMAGE_MODEL = '@cf/black-forest-labs/flux-1-schnell'; // Workers AI, fast and free-tier friendly
async function image(request, env, ctx) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.AI) return chatError('Pictures aren’t set up on this server.', 503, h);
  let body; try { body = JSON.parse(await request.text()); } catch (e) { return chatError('Bad request.', 400, h); }
  const prompt = String(body.prompt || '').replace(/\s+/g, ' ').trim().slice(0, 1500);
  if (prompt.length < 2) return chatError('What should the picture show?', 400, h);
  await ensureSchema(env.DB);
  const today = dayOf(Date.now());
  const uid = /^[\w-]{8,64}$/.test(body.uid || '') ? body.uid : 'anon';
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const perDay = +env.IMAGE_LIMIT || 20;
  const bump = (k) => env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind(k, today);
  const [u, i] = await env.DB.batch([bump(uid === 'anon' ? 'img:an:' + ip : 'img:u:' + uid), bump('img:i:' + ip)]);
  if ((u.results?.[0]?.n || 0) > perDay || (i.results?.[0]?.n || 0) > perDay * 25) {
    return chatError(`You've made today's ${perDay} pictures. More tomorrow — or add a free Gemini key in Settings for your own picture allowance.`, 429, h);
  }
  try {
    const out = await env.AI.run(IMAGE_MODEL, { prompt, steps: 6 });
    const b64 = out && (out.image || out.result?.image);
    if (!b64) throw new Error('empty');
    ctx.waitUntil(countChat(env, today, 'image'));
    return json({ image: b64, mimeType: 'image/jpeg' }, 200, h);
  } catch (e) {
    ctx.waitUntil(env.DB.batch(['img:u:' + uid, 'img:i:' + ip].map((k) => env.DB.prepare('UPDATE quota SET n = MAX(0, n - 1) WHERE k = ?').bind(k))));
    return chatError('Couldn’t make that picture right now — try again in a minute, or describe it more simply.', 503, h);
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
    .bind(now, dayOf(now), uid, b.kind, label(b.feature, 40), String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500), ctxText).run();
  return new Response(null, { status: 204, headers: h });
}

/* ------------------------------------------------------------------ live board rooms */
// A study room is a shared drawing board. Someone creates it and gets a 6-letter code; up
// to ROOM_MAX classmates join with the code (or the link) and everyone's strokes appear on
// everyone's board. Clients send their strokes and ask for new ones about once a second.
// Rooms and their drawings are deleted after a day. Only drawings are shared — no chat.
const ROOM_MAX = 12, ROOM_HOURS = 24, ROOM_OPS_MAX = 6000, ROOM_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
async function room(request, env, url) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  if (!env.DB) return json({ error: 'Rooms need the server database.' }, 503, h);
  await ensureSchema(env.DB);
  const db = env.DB, now = Date.now();
  const okUid = (u) => /^[\w-]{8,64}$/.test(u);
  const okCode = (c) => /^[A-Z0-9]{6}$/.test(c);
  const live = async (code) => db.prepare('SELECT code, title, created FROM rooms WHERE code = ? AND created > ?').bind(code, now - ROOM_HOURS * 3600e3).first();
  const members = async (code) => (await db.prepare('SELECT uid, name FROM room_members WHERE code = ? AND seen > ? ORDER BY name').bind(code, now - 25000).all()).results || [];

  if (request.method === 'GET' && url.pathname === '/room/poll') {
    const code = clean(url.searchParams.get('code'), 6).toUpperCase(), uid = clean(url.searchParams.get('uid'), 64);
    const since = Math.max(0, parseInt(url.searchParams.get('since'), 10) || 0);
    if (!okCode(code) || !okUid(uid)) return json({ error: 'bad request' }, 400, h);
    if (!(await live(code))) return json({ error: 'This room has ended.', gone: true }, 404, h);
    // "I'm still here" at most every 10 s (a write only when it's due)
    await db.prepare('UPDATE room_members SET seen = ? WHERE code = ? AND uid = ? AND seen < ?').bind(now, code, uid, now - 10000).run();
    const rows = (await db.prepare('SELECT id, uid, op FROM room_ops WHERE code = ? AND id > ? ORDER BY id LIMIT 400').bind(code, since).all()).results || [];
    return json({ ops: rows.map((r) => ({ id: r.id, uid: r.uid, op: JSON.parse(r.op) })), members: await members(code), more: rows.length === 400 }, 200, h);
  }
  if (request.method !== 'POST') return new Response('not found', { status: 404, headers: h });
  const text = await request.text();
  if (text.length > 200000) return json({ error: 'Too much at once.' }, 413, h);
  let b; try { b = JSON.parse(text); } catch (e) { return json({ error: 'bad json' }, 400, h); }
  const uid = clean(b.uid, 64), name = clean(b.name, 30).trim() || 'Classmate';
  if (!okUid(uid)) return json({ error: 'bad request' }, 400, h);

  if (url.pathname === '/room/create') {
    // tidy up: rooms older than a day go, with their drawings
    const old = now - ROOM_HOURS * 3600e3;
    await db.batch([
      db.prepare('DELETE FROM room_ops WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
      db.prepare('DELETE FROM room_members WHERE code IN (SELECT code FROM rooms WHERE created < ?)').bind(old),
      db.prepare('DELETE FROM rooms WHERE created < ?').bind(old),
    ]);
    const mine = await db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE owner = ? AND created > ?').bind(uid, old).first();
    if (mine && mine.n >= 10) return json({ error: 'You’ve made 10 rooms today — use one of those, or try again tomorrow.' }, 429, h);
    let code = '';
    for (let i = 0; i < 5 && !code; i++) {
      const c = Array.from(crypto.getRandomValues(new Uint8Array(6)), (x) => ROOM_LETTERS[x % ROOM_LETTERS.length]).join('');
      if (!(await db.prepare('SELECT 1 FROM rooms WHERE code = ?').bind(c).first())) code = c;
    }
    if (!code) return json({ error: 'Try again.' }, 503, h);
    await db.batch([
      db.prepare('INSERT INTO rooms (code, created, owner, title) VALUES (?, ?, ?, ?)').bind(code, now, uid, clean(b.title, 60) || `${name}’s study room`),
      db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?)').bind(code, uid, name, now),
    ]);
    return json({ code, title: clean(b.title, 60) || `${name}’s study room` }, 200, h);
  }
  const code = clean(b.code, 6).toUpperCase();
  if (!okCode(code)) return json({ error: 'That code isn’t right — it’s 6 letters and numbers.' }, 400, h);
  const r = await live(code);
  if (!r) return json({ error: 'No room with that code (rooms last a day).', gone: true }, 404, h);

  if (url.pathname === '/room/join') {
    const here = await members(code);
    if (here.length >= ROOM_MAX && !here.some((m) => m.uid === uid)) return json({ error: `The room is full (${ROOM_MAX} people).` }, 409, h);
    await db.prepare('INSERT INTO room_members (code, uid, name, seen) VALUES (?, ?, ?, ?) ON CONFLICT(code, uid) DO UPDATE SET name = excluded.name, seen = excluded.seen').bind(code, uid, name, now).run();
    return json({ code, title: r.title, members: await members(code) }, 200, h);
  }
  if (url.pathname === '/room/ops') {
    const ops = Array.isArray(b.ops) ? b.ops.slice(0, 40) : [];
    if (!ops.length) return json({ ok: true }, 200, h);
    if (!(await db.prepare('SELECT 1 FROM room_members WHERE code = ? AND uid = ?').bind(code, uid).first())) return json({ error: 'Join the room first.' }, 403, h);
    const count = await db.prepare('SELECT COUNT(*) AS n FROM room_ops WHERE code = ?').bind(code).first();
    if (count && count.n + ops.length > ROOM_OPS_MAX) return json({ error: 'This board is full — save it and start a new room.', full: true }, 409, h);
    const rows = [];
    for (const op of ops) {
      if (!op || !['add', 'del', 'clearmine'].includes(op.t)) continue;
      const t = JSON.stringify(op);
      if (t.length > 60000) continue; // one huge stroke is dropped, not the room
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
    // old days go after two weeks
    await db.prepare('DELETE FROM scores WHERE day < ?').bind(puzzleDay(now - 14 * 86400e3)).run();
    me = uid; day = b.day;
  } else if (!(request.method === 'GET' && url.pathname === '/scores/today')) return new Response('not found', { status: 404, headers: h });
  if (!/^\d{4}-\d\d-\d\d$/.test(day)) return json({ error: 'bad day' }, 400, h);
  const rows = (await db.prepare('SELECT game, uid, name, value, shown FROM scores WHERE day = ? ORDER BY game, value, ts LIMIT 20000').bind(day).all()).results || [];
  const total = new Map(), names = new Map(), mine = {};
  let lastGame = '', rank = 0;
  for (const r of rows) {
    if (r.game !== lastGame) { lastGame = r.game; rank = 0; }
    rank++;
    const p = placePoints(rank);
    total.set(r.uid, (total.get(r.uid) || 0) + p);
    names.set(r.uid, r.name);
    if (r.uid === me) mine[r.game] = { rank, points: p, shown: r.shown };
  }
  const board = [...total.entries()].sort((a, b) => b[1] - a[1]);
  const at = board.findIndex(([u]) => u === me);
  return json({
    day, players: board.length,
    top: board.slice(0, 3).map(([u, points]) => ({ name: names.get(u), points, me: u === me })),
    me: at >= 0 ? { rank: at + 1, points: board[at][1], games: mine } : null,
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
const publicAccount = (a) => ({ email: a.email || '', name: a.name || '', google: !!a.google, data: a.data ? JSON.parse(a.data) : null });

async function newSession(env, accountId) {
  const token = randomToken();
  const now = Date.now();
  await env.DB.prepare('INSERT INTO sessions (token, account, created, seen) VALUES (?, ?, ?, ?)').bind(await sha256(token), accountId, now, now).run();
  return token;
}
async function accountFromRequest(request, env) {
  const token = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!/^[\w-]{20,100}$/.test(token)) return null;
  const hash = await sha256(token);
  const row = await env.DB.prepare('SELECT a.*, s.created AS s_created FROM sessions s JOIN accounts a ON a.id = s.account WHERE s.token = ?').bind(hash).first();
  if (!row || Date.now() - row.s_created > SESSION_DAYS * 864e5) return null;
  return { ...row, sessionHash: hash };
}
// Slow down password guessing: at most 15 password tries per account per hour (from anywhere),
// and 100 sign-in attempts per address per hour (a whole class can share one school address).
async function authAllowed(request, env, key, max = 100) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  const r = await env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind(key || 'auth:' + ip, hour).first();
  return !r || r.n <= max;
}
// Throwaway inboxes, used to make account after account for more free questions.
const DISPOSABLE_RE = /@(mailinator|guerrillamail|guerrillamailblock|sharklasers|grr|10minutemail|10minemail|tempmail|temp-mail|tempmailo|tempail|yopmail|trashmail|getnada|nada|dispostable|maildrop|throwawaymail|mintemail|mohmal|emailondeck|fakeinbox|spamgourmet|moakt|tmpmail|tmail|burnermail|inboxkitten|mailnesia|mytemp|emailfake|fakemail|discard|mailcatch|spambox|33mail)\./i;
const EMAIL_RE = /^[^\s@]{1,64}@[^\s@]{1,190}\.[^\s@]{2,24}$/;
async function verifyGoogle(credential, env) {
  if (!env.GOOGLE_CLIENT_ID) throw new Error('Google sign-in isn’t set up on this server yet.');
  const r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential));
  const t = r.ok ? await r.json() : null;
  if (!t || t.aud !== env.GOOGLE_CLIENT_ID || !/^(https:\/\/)?accounts\.google\.com$/.test(t.iss || '') || +t.exp * 1000 < Date.now() || !t.sub) throw new Error('Google sign-in didn’t work — please try again.');
  return { sub: String(t.sub), email: String(t.email || '').toLowerCase(), verified: t.email_verified === true || t.email_verified === 'true', name: String(t.given_name || t.name || '').slice(0, 40) };
}

async function auth(request, env, path) {
  const h = allowedOrigin(request, env);
  if (!h) return new Response('forbidden', { status: 403 });
  await ensureSchema(env.DB);
  const fail = (message, status = 400) => json({ error: message }, status, h);
  const ok = (data) => json(data, 200, h);
  let body = {};
  if (request.method === 'POST') {
    const text = await request.text();
    if (text.length > 300000) return fail('That’s too much to save.', 413);
    try { body = JSON.parse(text || '{}'); } catch (e) { return fail('Bad request.'); }
  }

  if (path === '/auth/signup' || path === '/auth/login' || path === '/auth/google') {
    if (!(await authAllowed(request, env))) return fail('Too many tries — please wait an hour and try again.', 429);
    const now = Date.now();
    if (path === '/auth/google') {
      let g; try { g = await verifyGoogle(String(body.credential || ''), env); } catch (e) { return fail(e.message, 401); }
      let acc = await env.DB.prepare('SELECT * FROM accounts WHERE google = ?').bind(g.sub).first();
      if (!acc && g.verified && g.email) { // same email signed up with a password before → link them
        acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(g.email).first();
        if (acc) {
          // Google has just proved this email is theirs. Whoever made the password account may not
          // have been them (anyone can type any email), so that password and its sign-ins stop working.
          await env.DB.batch([
            env.DB.prepare('UPDATE accounts SET google = ?, pass = NULL, salt = NULL, updated = ? WHERE id = ?').bind(g.sub, now, acc.id),
            env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(acc.id),
          ]);
          acc.google = g.sub; acc.pass = null;
        }
      }
      if (!acc) {
        acc = { id: randomToken(12), email: g.verified ? g.email : null, google: g.sub, name: g.name, data: null };
        await env.DB.prepare('INSERT INTO accounts (id, email, google, name, created, updated) VALUES (?, ?, ?, ?, ?, ?)').bind(acc.id, acc.email, acc.google, acc.name, now, now).run();
      }
      return ok({ token: await newSession(env, acc.id), account: publicAccount(acc), isNew: !acc.data });
    }
    const email = String(body.email || '').trim().toLowerCase();
    const password = String(body.password || '');
    if (!EMAIL_RE.test(email)) return fail('Please type a valid email address.');
    if (path === '/auth/signup') {
      if (!(+body.age >= 13)) return fail('Cassie accounts are for ages 13 and up.');
      if (DISPOSABLE_RE.test(email)) return fail('Please use your real email address — throwaway emails can’t make accounts.');
      if (password.length < 8) return fail('Use at least 8 characters for your password.');
      if (password.length > 200) return fail('That password is too long.');
      const exists = await env.DB.prepare('SELECT id FROM accounts WHERE email = ?').bind(email).first();
      if (exists) return fail('There’s already an account with that email — sign in instead.', 409);
      const salt = randomToken(16);
      const acc = { id: randomToken(12), email, name: String(body.name || '').trim().slice(0, 40), data: null };
      await env.DB.prepare('INSERT INTO accounts (id, email, pass, salt, name, created, updated) VALUES (?, ?, ?, ?, ?, ?, ?)')
        .bind(acc.id, email, await hashPassword(password, salt), salt, acc.name, now, now).run();
      return ok({ token: await newSession(env, acc.id), account: publicAccount(acc), isNew: true });
    }
    if (!(await authAllowed(request, env, 'authm:' + (await sha256(email)), 15))) return fail('Too many tries for this account — please wait an hour and try again.', 429);
    if (password.length > 200) return fail('That email and password don’t match. Check them and try again.', 401);
    const acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
    const tried = await hashPassword(password, (acc && acc.salt) || 'no-account-salt'); // always hash, so a wrong email takes as long as a wrong password
    const good = !!(acc && acc.pass && sameText(tried, acc.pass));
    if (!good) {
      if (acc && !acc.pass && acc.google) return fail('This account uses Google — tap “Continue with Google”.', 401);
      return fail('That email and password don’t match. Check them and try again.', 401);
    }
    return ok({ token: await newSession(env, acc.id), account: publicAccount(acc), isNew: !acc.data });
  }

  const acc = await accountFromRequest(request, env);
  if (!acc) return fail('Please sign in again.', 401);
  if (path === '/auth/me') {
    await env.DB.prepare('UPDATE sessions SET seen = ? WHERE token = ?').bind(Date.now(), acc.sessionHash).run();
    return ok({ account: publicAccount(acc) });
  }
  if (path === '/auth/save') {
    const data = body.data && typeof body.data === 'object' ? JSON.stringify(body.data) : null;
    if (!data || data.length > 250000) return fail('Nothing to save.');
    const name = String((body.data.profile && body.data.profile.name) || acc.name || '').slice(0, 40);
    await env.DB.prepare('UPDATE accounts SET data = ?, name = ?, updated = ? WHERE id = ?').bind(data, name, Date.now(), acc.id).run();
    return ok({ saved: true });
  }
  if (path === '/auth/logout') {
    await env.DB.prepare('DELETE FROM sessions WHERE token = ?').bind(acc.sessionHash).run();
    return ok({ signedOut: true });
  }
  if (path === '/auth/delete') { // "Delete my account" — removes everything about it
    await env.DB.batch([env.DB.prepare('DELETE FROM sessions WHERE account = ?').bind(acc.id), env.DB.prepare('DELETE FROM accounts WHERE id = ?').bind(acc.id)]);
    return ok({ deleted: true });
  }
  return fail('Not found.', 404);
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
    run('Claude: text maths', () => askClaude(env, { messages: textQ }), (t) => /\b391\b/.test(t));
    run('Claude: read a picture', () => askClaude(env, { messages: picQ }), (t) => /\b56\b/.test(t));
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
async function adminOk(request, env) {
  const given = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || String(env.ADMIN_TOKEN).length < 16) return { error: 'Set an ADMIN_TOKEN of at least 16 characters in the Worker settings first.', status: 503 };
  await ensureSchema(env.DB);
  const ip = request.headers.get('cf-connecting-ip') || 'unknown', hour = new Date().toISOString().slice(0, 13);
  const tries = await env.DB.prepare('SELECT n FROM quota WHERE k = ? AND day = ?').bind('adm:' + ip, hour).first();
  if (tries && tries.n >= 10) return { error: 'Too many wrong tries — wait an hour.', status: 429 };
  if (given && sameText(given, String(env.ADMIN_TOKEN))) return null;
  await env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2`).bind('adm:' + ip, hour).run();
  return { error: 'wrong token', status: 401 };
}
async function health(request, env) {
  const no = await adminOk(request, env);
  if (no) return json({ error: no.error }, no.status);
  return json(await runHealth(env));
}

async function stats(request, env) {
  const url = new URL(request.url);
  const no = await adminOk(request, env);
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
    all(`SELECT COALESCE(NULLIF(grade,''),'—') AS k, COUNT(*) AS n FROM users WHERE role = 'student' GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(age,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT COALESCE(NULLIF(platform,''),'unknown') AS k, COUNT(*) AS n FROM users GROUP BY k ORDER BY n DESC`),
    all(`SELECT substr(uid,1,8) AS id, opens, uses, first_day, last_day, role, grade, age FROM users ORDER BY opens + uses DESC LIMIT 25`),
  ]);
  const [ratings, reports, chats, accountsRow] = await Promise.all([
    all(`SELECT COALESCE(NULLIF(feature,''),'chat') AS name, SUM(kind = 'up') AS up, SUM(kind = 'down') AS down FROM feedback WHERE day >= ? AND kind IN ('up','down') GROUP BY name ORDER BY up + down DESC LIMIT 20`, since),
    all(`SELECT ts, kind, feature, text, ctx FROM feedback WHERE day >= ? AND text != '' ORDER BY ts DESC LIMIT 60`, since),
    all(`SELECT src, SUM(n) AS n FROM chats WHERE day >= ? GROUP BY src ORDER BY n DESC`, since),
    one(`SELECT COUNT(*) AS n, SUM(google IS NOT NULL) AS google FROM accounts`),
  ]);
  const [healthRow, problems] = await Promise.all([
    one(`SELECT data FROM health WHERE k = 'last'`),
    all(`SELECT feature AS k, COUNT(*) AS n, MAX(ts) AS last FROM feedback WHERE day >= ? AND kind = 'error' GROUP BY feature ORDER BY n DESC LIMIT 12`, since),
  ]);
  let healthData = null; try { healthData = healthRow ? JSON.parse(healthRow.data) : null; } catch (e) { healthData = null; }
  return json({ days, today, since, totals, today_: todayRow, week: weekRow, range: rangeRow, daily, newDaily, features, words, roles, grades, ages, platforms, top, ratings, reports, chats, accounts: accountsRow, health: healthData, problems });
}

export default {
  // Cron Trigger (Worker → Settings → Triggers): the daily brain check
  async scheduled(event, env, ctx) { ctx.waitUntil(runHealth(env)); },
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (request.cf && request.cf.colo) lastColo = request.cf.colo;
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (tooFast(request, url.pathname)) return json({ error: 'Too many requests — please wait a minute.' }, 429, { ...cors(request.headers.get('origin') || '', env), 'retry-after': '60' });
      if (request.method === 'GET' && url.pathname === '/config') return await config(request, env);
      if (request.method === 'GET' && url.pathname === '/ask') return await ask(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/chat') return await chat(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/image') return await image(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/transcribe') return await transcribe(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
      if (request.method === 'POST' && url.pathname === '/f') return await feedback(request, env);
      if (url.pathname.startsWith('/auth/')) return await auth(request, env, url.pathname);
      if (url.pathname.startsWith('/room')) return await room(request, env, url);
      if (url.pathname.startsWith('/scores/')) return await scores(request, env, url);
      if (request.method === 'GET' && url.pathname === '/stats') return await stats(request, env);
      if (request.method === 'GET' && url.pathname === '/health') return await health(request, env);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return dashboard();
      return new Response('not found', { status: 404 });
    } catch (e) {
      ctx.waitUntil(logProblem(env, 'server: ' + url.pathname.slice(0, 30), String(e && e.stack || e).slice(0, 600)).catch(() => {}));
      return json({ error: 'Something went wrong on Cassie’s server. Please try again.' }, 500, cors(request.headers.get('origin') || '', env));
    }
  },
};

/* ------------------------------------------------------------------ dashboard */
const DASHBOARD = `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Cassie Usage</title>
<style>
  :root {
    color-scheme: light;
    --page: #f4f3f1; --surface-1: #fcfcfb; --border: #e6e4df;
    --text-primary: #0b0b0b; --text-secondary: #52514e; --text-muted: #8a8984;
    --grid: #ecebe7; --axis: #c9c7c1;
    --series-1: #2a78d6; --series-2: #eb6834;
  }
  @media (prefers-color-scheme: dark) {
    :root:where(:not([data-theme="light"])) {
      color-scheme: dark;
      --page: #111110; --surface-1: #1a1a19; --border: #2c2c2a;
      --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
      --grid: #262624; --axis: #4a4945;
      --series-1: #3987e5; --series-2: #d95926;
    }
  }
  :root[data-theme="dark"] {
    color-scheme: dark;
    --page: #111110; --surface-1: #1a1a19; --border: #2c2c2a;
    --text-primary: #ffffff; --text-secondary: #c3c2b7; --text-muted: #8f8e86;
    --grid: #262624; --axis: #4a4945;
    --series-1: #3987e5; --series-2: #d95926;
  }
  * { box-sizing: border-box; }
  body { margin: 0; background: var(--page); color: var(--text-primary); font: 15px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; }
  .wrap { max-width: 1120px; margin: 0 auto; padding: 20px 16px 48px; }
  header { display: flex; flex-wrap: wrap; align-items: center; gap: 12px; margin-bottom: 18px; }
  header h1 { margin: 0; font-size: 22px; letter-spacing: -.02em; }
  header .sp { flex: 1; }
  select, button, input { font: inherit; color: var(--text-primary); background: var(--surface-1); border: 1px solid var(--border); border-radius: 10px; padding: 8px 12px; }
  button { cursor: pointer; font-weight: 600; }
  .muted { color: var(--text-muted); }
  .grid { display: grid; gap: 14px; }
  .kpis { grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); margin-bottom: 14px; }
  .tile, .card { background: var(--surface-1); border: 1px solid var(--border); border-radius: 16px; padding: 16px; min-width: 0; }
  .tile .k { font-size: 13px; color: var(--text-secondary); }
  .tile .v { font-size: 30px; font-weight: 750; letter-spacing: -.03em; margin-top: 2px; }
  .tile .s { font-size: 12.5px; color: var(--text-muted); }
  .two { grid-template-columns: repeat(auto-fit, minmax(320px, 1fr)); margin-bottom: 14px; }
  .card h2 { margin: 0 0 2px; font-size: 16px; }
  .card .sub { margin: 0 0 12px; font-size: 13px; color: var(--text-muted); }
  .legend { display: flex; gap: 16px; font-size: 13px; color: var(--text-secondary); margin-bottom: 6px; }
  .legend i { display: inline-block; width: 14px; height: 3px; border-radius: 2px; vertical-align: middle; margin-right: 6px; }
  svg { display: block; width: 100%; height: auto; overflow: visible; }
  .bars { display: flex; flex-direction: column; gap: 6px; }
  .bar { display: grid; grid-template-columns: minmax(90px, 38%) 1fr auto; align-items: center; gap: 10px; font-size: 13.5px; }
  .bar .lbl { color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .bar .trk { height: 14px; position: relative; }
  .bar .fill { position: absolute; left: 0; top: 0; bottom: 0; background: var(--series-1); border-radius: 0 4px 4px 0; min-width: 2px; }
  .bar .val { color: var(--text-primary); font-variant-numeric: tabular-nums; font-weight: 600; }
  .bar:hover .fill { filter: brightness(1.12); }
  .reports { display: flex; flex-direction: column; gap: 10px; max-height: 520px; overflow: auto; }
  .rep { border: 1px solid var(--grid); border-radius: 10px; padding: 10px 12px; font-size: 14px; }
  .rep .meta { color: var(--text-secondary); font-size: 12.5px; margin-bottom: 4px; }
  .rep .txt { white-space: pre-wrap; overflow-wrap: anywhere; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--text-secondary); font-weight: 600; }
  .scroll { overflow-x: auto; }
  td.detail { white-space: normal; word-break: break-word; min-width: 260px; } /* the whole message, wrapped */
  details summary { cursor: pointer; color: var(--text-secondary); font-size: 13px; margin-top: 10px; }
  #tip { position: fixed; pointer-events: none; background: var(--surface-1); color: var(--text-primary); border: 1px solid var(--border); border-radius: 10px; padding: 8px 10px; font-size: 13px; box-shadow: 0 8px 24px rgba(0,0,0,.18); display: none; z-index: 9; }
  #tip b { display: block; margin-bottom: 2px; }
  .gate { max-width: 420px; margin: 12vh auto; }
  .gate .card { display: flex; flex-direction: column; gap: 10px; }
  .err { color: #d03b3b; font-size: 13px; }
  .empty { color: var(--text-muted); font-size: 13.5px; padding: 18px 0; text-align: center; }
</style></head>
<body>
<div id="tip"></div>
<div class="wrap" id="app"></div>
<script>
(() => {
  const app = document.getElementById('app'), tip = document.getElementById('tip');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const fmt = (n) => (n == null ? '—' : Number(n).toLocaleString());
  let token = ''; try { token = localStorage.getItem('cassie.stats.token') || ''; } catch (e) {}
  let days = 30;

  const FEATURE_NAMES = {
    chat: 'Chat', hint: 'Hint', quiz: 'Quiz me', talk: 'Talk', photo: 'Read a photo', research: 'Research', web: 'Web',
    image: 'Generate an image', graph: 'Graph on the board', board: 'Open the board', timer: 'Focus timer',
    'voice-in': 'Ask by voice', 'voice-out': 'Read answers aloud', colour: 'Change colour',
    'mode:pro': 'Switch to Professional', 'mode:student': 'Switch to Student',
    'highlight:explain': 'Highlight → Explain', 'highlight:answer': 'Highlight → Answer', 'highlight:code': 'Highlight → Code',
    'save:docx': 'Save as Word', 'save:pdf': 'Save as PDF', 'save:png': 'Save as image', 'save:txt': 'Save as text',
    'island-drop': 'Drop on Cassie', popout: 'Pop Cassie out', explore: 'Explore 3D', voice: 'Talk with Cassie (voice)',
    'file:pdf': 'Read a PDF', 'file:pptx': 'Read PowerPoint', 'file:docx': 'Read a Word file', 'file:text': 'Read a text file', 'file:image': 'Read an image file',
  };
  const fname = (n) => FEATURE_NAMES[n] || n;

  function gate(msg) {
    app.innerHTML = \`<div class="gate"><div class="card"><h2>Cassie usage</h2><p class="muted" style="margin:0">Enter the ADMIN_TOKEN you set on the Worker.</p>
      <input id="tok" type="password" placeholder="Admin token" autocomplete="current-password"><button id="go">Open dashboard</button>\${msg ? \`<div class="err">\${esc(msg)}</div>\` : ''}</div></div>\`;
    const go = () => { token = document.getElementById('tok').value.trim(); try { localStorage.setItem('cassie.stats.token', token); } catch (e) {} load(); };
    document.getElementById('go').onclick = go;
    document.getElementById('tok').onkeydown = (e) => { if (e.key === 'Enter') go(); };
  }

  async function load() {
    if (!token) return gate('');
    app.innerHTML = '<p class="muted">Loading…</p>';
    let r;
    try { r = await fetch('stats?days=' + days, { headers: { authorization: 'Bearer ' + token } }); } catch (e) { return gate('Could not reach the Worker.'); }
    if (r.status === 401) return gate('That token is wrong.');
    const d = await r.json();
    if (d.error) return gate(d.error);
    render(d);
  }

  function tile(k, v, s) { return \`<div class="tile"><div class="k">\${k}</div><div class="v">\${v}</div>\${s ? \`<div class="s">\${s}</div>\` : ''}</div>\`; }
  function bars(rows, label, value, extra, o = {}) {
    if (!rows.length) return '<div class="empty">No data yet</div>';
    const max = o.max || Math.max(...rows.map(value), 1);
    return \`<div class="bars">\${rows.map((r) => \`<div class="bar" data-tip="\${esc(label(r))}|\${esc(extra ? extra(r) : fmt(value(r)))}"><span class="lbl">\${esc(label(r))}</span><span class="trk"><span class="fill" style="width:\${(value(r) / max * 100).toFixed(1)}%"></span></span><span class="val">\${fmt(value(r))}\${o.suffix || ''}</span></div>\`).join('')}</div>\`;
  }
  // every day in the range, zero-filled
  function series(d) {
    const map = Object.fromEntries(d.daily.map((x) => [x.day, x]));
    const nmap = Object.fromEntries(d.newDaily.map((x) => [x.day, x.n]));
    const out = [];
    const end = new Date(d.today + 'T00:00:00Z');
    for (let i = d.days - 1; i >= 0; i--) {
      const day = new Date(end - i * 864e5).toISOString().slice(0, 10);
      const x = map[day] || {};
      out.push({ day, active: x.active || 0, opens: x.opens || 0, uses: x.uses || 0, fresh: nmap[day] || 0 });
    }
    return out;
  }
  function lineChart(rows) {
    const W = 640, H = 240, L = 36, R = 64, T = 12, B = 26;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.active, r.opens)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step || 1;
    const X = (i) => L + (rows.length < 2 ? 0 : i / (rows.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - v / top) * (H - T - B);
    const ticks = []; for (let v = 0; v <= top; v += step) ticks.push(v);
    const path = (k) => rows.map((r, i) => \`\${i ? 'L' : 'M'}\${X(i).toFixed(1)} \${Y(r[k]).toFixed(1)}\`).join('');
    const every = Math.max(1, Math.ceil(rows.length / 7));
    const last = rows[rows.length - 1];
    return \`<svg viewBox="0 0 \${W} \${H}" role="img" aria-label="Active users and opens per day" id="lc">
      \${ticks.map((v) => \`<line x1="\${L}" x2="\${W - R}" y1="\${Y(v)}" y2="\${Y(v)}" stroke="var(--grid)"/><text x="\${L - 6}" y="\${Y(v) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">\${v}</text>\`).join('')}
      <line x1="\${L}" x2="\${W - R}" y1="\${Y(0)}" y2="\${Y(0)}" stroke="var(--axis)"/>
      \${rows.map((r, i) => (i % every === 0 || i === rows.length - 1) ? \`<text x="\${X(i)}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">\${r.day.slice(5)}</text>\` : '').join('')}
      <path d="\${path('opens')}" fill="none" stroke="var(--series-2)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <path d="\${path('active')}" fill="none" stroke="var(--series-1)" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"/>
      <text x="\${X(rows.length - 1) + 8}" y="\${Y(last.opens) + 4}" font-size="12" fill="var(--text-secondary)">Opens</text>
      <text x="\${X(rows.length - 1) + 8}" y="\${Y(last.active) + (Math.abs(Y(last.active) - Y(last.opens)) < 14 ? 16 : 4)}" font-size="12" fill="var(--text-secondary)">Active</text>
      <line id="xh" y1="\${T}" y2="\${H - B}" stroke="var(--axis)" stroke-dasharray="3 3" visibility="hidden"/>
      <circle id="d1" r="5" fill="var(--series-1)" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/>
      <circle id="d2" r="5" fill="var(--series-2)" stroke="var(--surface-1)" stroke-width="2" visibility="hidden"/>
      <rect x="\${L}" y="\${T}" width="\${W - L - R}" height="\${H - T - B}" fill="transparent" id="hit"/>
    </svg>\`;
  }
  function wireLine(rows) {
    const svg = document.getElementById('lc'); if (!svg) return;
    const W = 640, L = 36, R = 64, T = 12, B = 26, H = 240;
    const max = Math.max(1, ...rows.map((r) => Math.max(r.active, r.opens)));
    const step = Math.pow(10, Math.floor(Math.log10(max))) * (max / Math.pow(10, Math.floor(Math.log10(max))) > 5 ? 2 : 1);
    const top = Math.ceil(max / step) * step || 1;
    const X = (i) => L + (rows.length < 2 ? 0 : i / (rows.length - 1)) * (W - L - R);
    const Y = (v) => T + (1 - v / top) * (H - T - B);
    const hit = svg.querySelector('#hit'), xh = svg.querySelector('#xh'), d1 = svg.querySelector('#d1'), d2 = svg.querySelector('#d2');
    hit.addEventListener('mousemove', (e) => {
      const b = svg.getBoundingClientRect(); const px = (e.clientX - b.left) / b.width * W;
      const i = Math.max(0, Math.min(rows.length - 1, Math.round((px - L) / (W - L - R) * (rows.length - 1)))); const r = rows[i];
      [xh].forEach((n) => { n.setAttribute('x1', X(i)); n.setAttribute('x2', X(i)); n.setAttribute('visibility', 'visible'); });
      d1.setAttribute('cx', X(i)); d1.setAttribute('cy', Y(r.active)); d1.setAttribute('visibility', 'visible');
      d2.setAttribute('cx', X(i)); d2.setAttribute('cy', Y(r.opens)); d2.setAttribute('visibility', 'visible');
      showTip(e, \`<b>\${r.day}</b>Active users: \${fmt(r.active)}<br>Opens: \${fmt(r.opens)}<br>Features used: \${fmt(r.uses)}<br>New users: \${fmt(r.fresh)}\`);
    });
    hit.addEventListener('mouseleave', () => { [xh, d1, d2].forEach((n) => n.setAttribute('visibility', 'hidden')); hideTip(); });
  }
  function colChart(rows) {
    const W = 640, H = 150, L = 30, R = 8, T = 10, B = 24;
    const max = Math.max(1, ...rows.map((r) => r.fresh));
    const bw = (W - L - R) / rows.length;
    const every = Math.max(1, Math.ceil(rows.length / 7));
    const Y = (v) => T + (1 - v / max) * (H - T - B);
    return \`<svg viewBox="0 0 \${W} \${H}" role="img" aria-label="New users per day">
      <line x1="\${L}" x2="\${W - R}" y1="\${Y(0)}" y2="\${Y(0)}" stroke="var(--axis)"/>
      <text x="\${L - 6}" y="\${Y(max) + 4}" text-anchor="end" font-size="11" fill="var(--text-muted)">\${max}</text>
      \${rows.map((r, i) => { const h = Y(0) - Y(r.fresh); const x = L + i * bw + 1; const w = Math.max(1, bw - 2);
        return \`<g class="col" data-tip="\${esc(r.day)}|\${r.fresh} new user\${r.fresh === 1 ? '' : 's'}"><rect x="\${x}" y="\${T}" width="\${w}" height="\${H - T - B}" fill="transparent"/>\${r.fresh ? \`<path d="M\${x} \${Y(0)}V\${Y(r.fresh) + Math.min(4, h)}q0 -\${Math.min(4, h)} \${Math.min(4, w / 2)} -\${Math.min(4, h)}H\${x + w - Math.min(4, w / 2)}q\${Math.min(4, w / 2)} 0 \${Math.min(4, w / 2)} \${Math.min(4, h)}V\${Y(0)}Z" fill="var(--series-1)"/>\` : ''}</g>\`; }).join('')}
      \${rows.map((r, i) => (i % every === 0 || i === rows.length - 1) ? \`<text x="\${L + (i + 0.5) * bw}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">\${r.day.slice(5)}</text>\` : '').join('')}
    </svg>\`;
  }
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.style.display = 'none'; }

  // The brain check: real questions with known answers through every AI the server uses.
  function brainCard(d) {
    const h = d.health;
    const rows = h ? h.checks.map((c) => \`<tr><td>\${c.ok ? '✅' : c.warn ? '⚠️' : '❌'}</td><td>\${esc(c.name)}</td><td>\${(c.ms / 1000).toFixed(1)}s</td><td class="muted detail">\${esc(c.detail || '')}</td></tr>\`).join('') : '';
    const status = !h ? 'Not run yet.' : h.ok ? '✅ Text and pictures both work.' : \`⚠️ \${!h.canText ? 'Text answers are failing. ' : ''}\${!h.canPictures ? 'Pictures (photos, snips, board) are failing. ' : ''}See the ❌ rows.\`;
    const probs = (d.problems || []).length ? \`<p class="muted" style="margin:12px 0 4px">Problems Cassie hit (last \${d.days} days)</p>\${bars(d.problems, (r) => r.k, (r) => r.n, (r) => \`\${fmt(r.n)} · last \${esc(new Date(r.last).toLocaleString())}\`)}\` : '<p class="muted" style="margin-top:10px">No problems logged.</p>';
    return \`<div class="card" style="margin-bottom:14px"><h2>Brain check</h2><p class="sub">Asks every AI real questions with known answers (17 × 23, a picture of 7 × 8, a graph). \${h ? 'Last run ' + esc(new Date(h.ts).toLocaleString()) : ''}</p>
      <p><b>\${status}</b></p>\${rows ? \`<div class="scroll"><table>\${rows}</table></div>\` : ''}
      <button id="brain">Run brain check now</button> <span id="brain-msg" class="muted"></span>\${probs}</div>\`;
  }
  function render(d) {
    const rows = series(d);
    const t = d.totals || {};
    const avg = t.users ? (t.opens / t.users) : 0;
    app.innerHTML = \`
      <header><h1>Cassie usage</h1><span class="muted">Philippine time · \${esc(d.since)} → \${esc(d.today)}</span><span class="sp"></span>
        <select id="range">\${[7, 30, 90, 365].map((n) => \`<option value="\${n}" \${n === d.days ? 'selected' : ''}>Last \${n} days</option>\`).join('')}</select>
        <button id="refresh">Refresh</button><button id="logout" title="Forget the token on this device">Sign out</button></header>
      <div class="grid kpis">
        \${tile('Total users', fmt(t.users), \`\${fmt(t.came_back)} came back on another day\`)}
        \${tile('Active today', fmt(d.today_ && d.today_.active), \`\${fmt(d.today_ && d.today_.opens)} opens today\`)}
        \${tile('Active this week', fmt(d.week && d.week.active), 'last 7 days')}
        \${tile('Opens', fmt(d.range && d.range.opens), \`last \${d.days} days\`)}
        \${tile('Opens per user', avg.toFixed(1), 'average, all time')}
        \${tile('Features used', fmt(d.range && d.range.uses), \`last \${d.days} days\`)}
      </div>
      \${brainCard(d)}
      <div class="card" style="margin-bottom:14px"><h2>Active users and opens per day</h2><p class="sub">How many people used Cassie each day, and how many times the app was opened</p>
        <div class="legend"><span><i style="background:var(--series-1)"></i>Active users</span><span><i style="background:var(--series-2)"></i>Opens</span></div>
        \${lineChart(rows)}
        <details><summary>Show as a table</summary><div class="scroll"><table><tr><th>Day</th><th>Active users</th><th>Opens</th><th>Features used</th><th>New users</th></tr>\${rows.slice().reverse().map((r) => \`<tr><td>\${r.day}</td><td>\${r.active}</td><td>\${r.opens}</td><td>\${r.uses}</td><td>\${r.fresh}</td></tr>\`).join('')}</table></div></details>
      </div>
      <div class="grid two">
        <div class="card"><h2>New users per day</h2><p class="sub">First time someone opened Cassie</p>\${colChart(rows)}</div>
        <div class="card"><h2>Most-used features</h2><p class="sub">Times used in the last \${d.days} days (people in brackets)</p>\${bars(d.features.slice(0, 14), (r) => fname(r.name), (r) => r.n, (r) => \`\${fmt(r.n)} uses · \${fmt(r.users)} \${r.users === 1 ? 'person' : 'people'}\`)}</div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Top topic words</h2><p class="sub">Single keywords from adults who allowed it — never full messages</p>\${bars(d.words.slice(0, 20), (r) => r.word, (r) => r.n)}</div>
        <div class="card"><h2>Who uses Cassie</h2><p class="sub">From the sign-up (all users)</p>
          <p class="muted" style="margin:4px 0">Student or professional</p>\${bars(d.roles, (r) => r.k === 'pro' ? 'Professional' : r.k === 'student' ? 'Student' : r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Students by level</p>\${bars(d.grades, (r) => r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Age</p>\${bars(d.ages, (r) => r.k, (r) => r.n)}
          <p class="muted" style="margin:12px 0 4px">Device</p>\${bars(d.platforms, (r) => r.k, (r) => r.n)}
        </div>
      </div>
      <div class="grid two">
        <div class="card"><h2>Questions answered through your server</h2><p class="sub">People without their own key, last \${d.days} days</p>\${bars((d.chats || []), (r) => ({ claude: 'Claude', gemini: 'Gemini (your key)', 'shortcut-gemini': 'iPhone Shortcut (Gemini)', shortcut: 'iPhone Shortcut', 'shortcut-claude': 'iPhone Shortcut (Claude)', groq: 'Groq', backup: 'Workers AI (backup)', 'backup-picture': 'Pictures (Workers AI backup)', failed: 'Could not answer', voice: 'Voice chat: speech to text (Groq)', 'voice-backup': 'Voice chat: speech to text (Workers AI)', image: 'Pictures (Workers AI)' }[r.src] || r.src), (r) => r.n)}</div>
        <div class="card"><h2>Problem reports</h2><p class="sub">What users wrote in “Report a problem”</p>
          \${(d.reports || []).length ? \`<div class="reports">\${d.reports.map((r) => \`<div class="rep"><div class="meta">\${esc(new Date(r.ts).toLocaleString())} · \${r.kind === 'report' ? 'Report' : r.kind === 'down' ? '👎 ' + esc(fname(r.feature)) : r.kind === 'error' ? '⚠️ ' + esc(r.feature || 'Server problem') : r.kind === 'auto' ? '⚠️ App error · ' + esc(fname(r.feature)) : esc(r.kind)}\${r.ctx ? ' · ' + esc(r.ctx) : ''}</div><div class="txt">\${esc(r.text)}</div></div>\`).join('')}</div>\` : '<div class="empty">No reports yet</div>'}</div>
      </div>
      <div class="card"><h2>Most active users</h2><p class="sub">Anonymous — a random id per device, never a name</p><div class="scroll"><table>
        <tr><th>User</th><th>Opens</th><th>Features used</th><th>First seen</th><th>Last seen</th><th>Who</th></tr>
        \${d.top.length ? d.top.map((u) => \`<tr><td>#\${esc(u.id)}</td><td>\${fmt(u.opens)}</td><td>\${fmt(u.uses)}</td><td>\${esc(u.first_day)}</td><td>\${esc(u.last_day)}</td><td>\${esc([u.role === 'pro' ? 'Professional' : u.role === 'student' ? 'Student' : '', u.grade, u.age].filter(Boolean).join(' · '))}</td></tr>\`).join('') : '<tr><td colspan="6" class="empty">No users yet</td></tr>'}
      </table></div></div>\`;
    document.getElementById('range').onchange = (e) => { days = +e.target.value; load(); };
    document.getElementById('refresh').onclick = load;
    document.getElementById('brain').onclick = async () => {
      const m = document.getElementById('brain-msg'); m.textContent = 'Checking every AI… (about 10–45 seconds)';
      try { const r = await fetch('health', { headers: { authorization: 'Bearer ' + token } }); if (!r.ok) throw new Error('HTTP ' + r.status); load(); }
      catch (e) { m.textContent = 'Could not run it: ' + e.message; }
    };
    document.getElementById('logout').onclick = () => { try { localStorage.removeItem('cassie.stats.token'); } catch (e) {} token = ''; gate(''); };
    wireLine(rows);
    app.querySelectorAll('[data-tip]').forEach((n) => {
      // dataset gives the text back un-escaped, so it is escaped again before it becomes HTML
      n.addEventListener('mousemove', (e) => { const t = n.dataset.tip, i = t.lastIndexOf('|'); showTip(e, \`<b>\${esc(t.slice(0, i))}</b>\${esc(t.slice(i + 1))}\`); });
      n.addEventListener('mouseleave', hideTip);
    });
  }
  load();
})();
</script>
</body></html>
`;
