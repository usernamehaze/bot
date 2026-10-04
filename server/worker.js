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
  table { width: 100%; border-collapse: collapse; font-size: 13px; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 7px 8px; border-bottom: 1px solid var(--border); white-space: nowrap; }
  th { color: var(--text-secondary); font-weight: 600; }
  .scroll { overflow-x: auto; }
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
  function bars(rows, label, value, extra) {
    if (!rows.length) return '<div class="empty">No data yet</div>';
    const max = Math.max(...rows.map(value), 1);
    return \`<div class="bars">\${rows.map((r) => \`<div class="bar" data-tip="\${esc(label(r))}|\${esc(extra ? extra(r) : fmt(value(r)))}"><span class="lbl">\${esc(label(r))}</span><span class="trk"><span class="fill" style="width:\${(value(r) / max * 100).toFixed(1)}%"></span></span><span class="val">\${fmt(value(r))}</span></div>\`).join('')}</div>\`;
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
        return \`<g class="col" data-tip="\${r.day}|\${r.fresh} new user\${r.fresh === 1 ? '' : 's'}"><rect x="\${x}" y="\${T}" width="\${w}" height="\${H - T - B}" fill="transparent"/>\${r.fresh ? \`<path d="M\${x} \${Y(0)}V\${Y(r.fresh) + Math.min(4, h)}q0 -\${Math.min(4, h)} \${Math.min(4, w / 2)} -\${Math.min(4, h)}H\${x + w - Math.min(4, w / 2)}q\${Math.min(4, w / 2)} 0 \${Math.min(4, w / 2)} \${Math.min(4, h)}V\${Y(0)}Z" fill="var(--series-1)"/>\` : ''}</g>\`; }).join('')}
      \${rows.map((r, i) => (i % every === 0 || i === rows.length - 1) ? \`<text x="\${L + (i + 0.5) * bw}" y="\${H - 6}" text-anchor="middle" font-size="11" fill="var(--text-muted)">\${r.day.slice(5)}</text>\` : '').join('')}
    </svg>\`;
  }
  function showTip(e, html) { tip.innerHTML = html; tip.style.display = 'block'; const x = Math.min(window.innerWidth - tip.offsetWidth - 8, e.clientX + 14); tip.style.left = x + 'px'; tip.style.top = (e.clientY + 14) + 'px'; }
  function hideTip() { tip.style.display = 'none'; }

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
      <div class="card"><h2>Most active users</h2><p class="sub">Anonymous — a random id per device, never a name</p><div class="scroll"><table>
        <tr><th>User</th><th>Opens</th><th>Features used</th><th>First seen</th><th>Last seen</th><th>Who</th></tr>
        \${d.top.length ? d.top.map((u) => \`<tr><td>#\${esc(u.id)}</td><td>\${fmt(u.opens)}</td><td>\${fmt(u.uses)}</td><td>\${esc(u.first_day)}</td><td>\${esc(u.last_day)}</td><td>\${esc([u.role === 'pro' ? 'Professional' : u.role === 'student' ? 'Student' : '', u.grade, u.age].filter(Boolean).join(' · '))}</td></tr>\`).join('') : '<tr><td colspan="6" class="empty">No users yet</td></tr>'}
      </table></div></div>\`;
    document.getElementById('range').onchange = (e) => { days = +e.target.value; load(); };
    document.getElementById('refresh').onclick = load;
    document.getElementById('logout').onclick = () => { try { localStorage.removeItem('cassie.stats.token'); } catch (e) {} token = ''; gate(''); };
    wireLine(rows);
    app.querySelectorAll('[data-tip]').forEach((n) => {
      n.addEventListener('mousemove', (e) => { const [a, b] = n.dataset.tip.split('|'); showTip(e, \`<b>\${a}</b>\${b}\`); });
      n.addEventListener('mouseleave', hideTip);
    });
  }
  load();
})();
</script>
</body></html>
`;
