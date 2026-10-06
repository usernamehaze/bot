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
 *   ADMIN_TOKEN  secret — a password you choose for the dashboard
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
  const ok = allowed.some((a) => origin === a || (a === 'http://localhost' && /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin)))
    || (env.ALLOW_EXTENSION !== 'off' && /^chrome-extension:\/\/[a-p]{32}$/.test(origin)); // the Cassie extension (Chrome and Edge)
  return ok ? { 'access-control-allow-origin': origin, 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-headers': 'content-type, authorization', 'access-control-expose-headers': 'retry-after, x-cassie-source, x-cassie-left', vary: 'origin' } : {};
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
const GEMINI_FALLBACK = ['gemini-flash-latest', 'gemini-flash-lite-latest', 'gemini-2.5-flash', 'gemini-2.5-flash-lite'];
let gemini = { ids: [], at: 0, all: [] };
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
      if (ids.length) gemini = { ids: ids.slice(0, 4), at: Date.now(), all: models.map((m) => String(m.name || '').replace(/^models\//, '')) };
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
  let detail = '';
  const list = await geminiModels(env);
  for (const model of [...new Set(env.GEMINI_MODEL ? [env.GEMINI_MODEL, ...list] : list)].slice(0, 4)) {
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
        if (r.status === 404) gemini.at = 0; // a retired name: look the list up again next time
        detail += `${model}: ${r.status} ${m.slice(0, 90)} · `;
      }
    } catch (e) { detail += `${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : e.message} · `; }
  }
  return { reply: null, detail: detail ? 'Gemini ' + detail.replace(/ · $/, '') : '' };
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

  // Claude first for the main chat, within its own daily allowance per person
  if (env.ANTHROPIC_KEY && body.brain === 'claude') {
    const perDayClaude = +env.CLAUDE_DAILY_LIMIT || 40;
    let usedC = 0;
    try { usedC = (await bump('c:' + uid).first())?.n || 0; } catch (e) { usedC = 0; }
    if (uid !== 'anon' && usedC <= perDayClaude) {
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
    for (const model of models) {
      const payload = { model, messages: cleaned.messages, max_tokens: maxTokens, temperature };
      if (/gpt-oss/.test(model) && ['low', 'medium', 'high'].includes(body.reasoning_effort)) payload.reasoning_effort = body.reasoning_effort;
      let r;
      try {
        r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify(payload), signal: AbortSignal.timeout(30000) });
      } catch (e) { lastStatus = 503; problems.push(`Groq ${model}: ${e.name === 'TimeoutError' ? 'no answer in 30 s' : e.message}`); continue; }
      if (r.ok) {
        ctx.waitUntil(countChat(env, today, 'groq'));
        return new Response(r.body, { status: 200, headers: { 'content-type': 'application/json', ...h, ...left, 'x-cassie-source': 'groq' } });
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
  const [u, i] = await env.DB.batch([bump('img:u:' + uid), bump('img:i:' + ip)]);
  if ((uid !== 'anon' && (u.results?.[0]?.n || 0) > perDay) || (i.results?.[0]?.n || 0) > perDay * 25) {
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
    .bind(now, dayOf(now), uid, b.kind, clean(b.feature, 40), String(b.text || '').replace(/[\u0000-\u0008\u000b-\u001f]/g, '').slice(0, 1500), ctxText).run();
  return new Response(null, { status: 204, headers: h });
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
// Slow down password guessing: at most 30 sign-in attempts per address per hour.
async function authAllowed(request, env) {
  const ip = request.headers.get('cf-connecting-ip') || 'unknown';
  const hour = new Date().toISOString().slice(0, 13);
  const r = await env.DB.prepare(`INSERT INTO quota (k, day, n) VALUES (?1, ?2, 1)
      ON CONFLICT(k) DO UPDATE SET n = CASE WHEN day = ?2 THEN n + 1 ELSE 1 END, day = ?2 RETURNING n`).bind('auth:' + ip, hour).first();
  return !r || r.n <= 30;
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
        if (acc) { await env.DB.prepare('UPDATE accounts SET google = ?, updated = ? WHERE id = ?').bind(g.sub, now, acc.id).run(); acc.google = g.sub; }
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
    const acc = await env.DB.prepare('SELECT * FROM accounts WHERE email = ?').bind(email).first();
    const good = acc && acc.pass && sameText(await hashPassword(password, acc.salt), acc.pass);
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
const CHECK_PNG = 'data:image/png;base64,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';
async function groqAsk(env, model, messages, maxTokens = 1500) {
  const r = await fetch(`${GROQ}/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json', authorization: `Bearer ${env.GROQ_KEY}` }, body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature: 0.2 }), signal: AbortSignal.timeout(30000) });
  if (!r.ok) { let m = ''; try { m = (await r.json()).error?.message || ''; } catch (e) { /* not JSON */ } throw new Error(`${r.status} ${m}`.slice(0, 200)); }
  return ((await r.json()).choices?.[0]?.message?.content || '').replace(/<think>[\s\S]*?<\/think>\s*/g, '');
}
async function runHealth(env) {
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
    catch (e) { checks[i] = { name, ok: false, ms: Date.now() - t0, detail: String(e.message || e).slice(0, 600) }; }
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
    run('Gemini: text maths', async () => { const g = await askGemini(env, textQ, 300); if (!g.reply) throw new Error(g.detail); return g.reply; }, (t) => /\b391\b/.test(t));
    run('Gemini: read a picture', async () => { const g = await askGemini(env, picQ, 300); if (!g.reply) throw new Error(g.detail); return g.reply; }, (t) => /\b56\b/.test(t));
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
    if (!result.ok) await logProblem(env, 'brain check', checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`).join(' | '));
  } catch (e) { /* still return it */ }
  return result;
}
async function health(request, env) {
  const auth = (request.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!env.ADMIN_TOKEN || auth !== env.ADMIN_TOKEN) return json({ error: 'wrong token' }, 401);
  return json(await runHealth(env));
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
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors(request.headers.get('origin') || '', env) });
    try {
      if (request.method === 'GET' && url.pathname === '/config') return await config(request, env);
      if (request.method === 'GET' && url.pathname === '/ask') return await ask(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/chat') return await chat(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/image') return await image(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/transcribe') return await transcribe(request, env, ctx);
      if (request.method === 'POST' && url.pathname === '/e') return await ingest(request, env);
      if (request.method === 'POST' && url.pathname === '/f') return await feedback(request, env);
      if (url.pathname.startsWith('/auth/')) return await auth(request, env, url.pathname);
      if (request.method === 'GET' && url.pathname === '/stats') return await stats(request, env);
      if (request.method === 'GET' && url.pathname === '/health') return await health(request, env);
      if (request.method === 'GET' && (url.pathname === '/' || url.pathname === '/dashboard')) return new Response(DASHBOARD, { headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' } });
      return new Response('not found', { status: 404 });
    } catch (e) {
      return json({ error: String(e && e.message || e) }, 500);
    }
  },
};

/* ------------------------------------------------------------------ dashboard */
const DASHBOARD = `__DASHBOARD_HTML__`;
