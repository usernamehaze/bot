/* The words Cassie shows people, found in the source: the text inside JavaScript strings (not
   comments, not regular expressions) and the text and attributes of HTML pages. Used by the
   smoke test that keeps em and en dashes out of everything a student reads.
     jsStrings(src)   → [{ start, end, text }]  (the inside of each '…', "…" and the text parts of `…`)
     htmlStrings(src) → [{ start, end, text }]  (text between tags, attribute values, inline scripts' strings)
   JSON files (the web app and extension manifests) are read like JavaScript: every "…" is a string. */
const fs = require('fs');
const path = require('path');

const KEYWORDS_BEFORE_REGEX = new Set(['return', 'typeof', 'instanceof', 'in', 'of', 'new', 'delete', 'void', 'throw', 'case', 'do', 'else', 'yield', 'await']);

function jsStrings(src, from = 0, to = src.length, out = []) {
  // one pass with a stack: code (counting its { }) and template literals (whose ${ } is code again),
  // so comments, regular expressions and quotes are handled the same everywhere
  const stack = [{ code: true, depth: 0 }];
  let i = from, last = '', piece = 0; // last: the previous significant character or word (regex or division?)
  const lastWord = () => { const m = /([A-Za-z_$][\w$]*)$/.exec(src.slice(Math.max(from, i - 20), i).trimEnd()); return m ? m[1] : ''; };
  while (i < to) {
    const top = stack[stack.length - 1], c = src[i], n = src[i + 1];
    if (!top.code) { // inside a template literal
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { out.push({ start: piece, end: i, text: src.slice(piece, i) }); stack.pop(); i++; last = 'x'; continue; }
      if (c === '$' && n === '{') { out.push({ start: piece, end: i, text: src.slice(piece, i) }); stack.push({ code: true, depth: 0 }); i += 2; last = '('; continue; }
      i++; continue;
    }
    if (c === '/' && n === '/') { while (i < to && src[i] !== '\n') i++; continue; }
    if (c === '/' && n === '*') { const e = src.indexOf('*/', i + 2); i = e < 0 ? to : e + 2; continue; }
    if (c === '\'' || c === '"') {
      let j = i + 1;
      while (j < to && src[j] !== c && src[j] !== '\n') j += src[j] === '\\' ? 2 : 1;
      out.push({ start: i + 1, end: j, text: src.slice(i + 1, j) });
      i = j + 1; last = 'x'; continue;
    }
    if (c === '`') { stack.push({ code: false }); piece = i + 1; i++; continue; }
    if (c === '{') { top.depth++; last = '{'; i++; continue; }
    if (c === '}') {
      if (top.depth === 0 && stack.length > 1) { stack.pop(); piece = i + 1; i++; continue; } // back into the template
      top.depth--; last = '}'; i++; continue;
    }
    if (c === '/') {
      const w = lastWord();
      const regex = !last || /[(,=:[!&|?{};+\-*%<>~^]/.test(last) || KEYWORDS_BEFORE_REGEX.has(w) && last !== '.';
      if (regex) { // skip the regular expression, with its character classes
        let j = i + 1, cls = false;
        while (j < to && src[j] !== '\n') { if (src[j] === '\\') { j += 2; continue; } if (src[j] === '[') cls = true; else if (src[j] === ']') cls = false; else if (src[j] === '/' && !cls) break; j++; }
        i = j + 1; while (/[a-z]/i.test(src[i] || '')) i++;
        last = 'x'; continue;
      }
    }
    if (/[A-Za-z_$]/.test(c)) { let j = i; while (j < to && /[\w$]/.test(src[j])) j++; const word = src.slice(i, j); last = KEYWORDS_BEFORE_REGEX.has(word) ? '(' : 'x'; i = j; continue; }
    if (!/\s/.test(c)) last = /[\w$)\]]/.test(c) ? 'x' : c;
    i++;
  }
  return out;
}

function htmlStrings(src) {
  const out = [];
  let i = 0;
  while (i < src.length) {
    if (src.startsWith('<!--', i)) { const e = src.indexOf('-->', i); i = e < 0 ? src.length : e + 3; continue; }
    if (src[i] === '<') {
      const m = /^<\s*(\/?)([a-zA-Z][\w-]*)/.exec(src.slice(i, i + 40));
      const e = src.indexOf('>', i);
      if (!m || e < 0) { i++; continue; }
      const tag = src.slice(i, e + 1);
      // attribute values people read
      const re = /\s(placeholder|title|aria-label|alt|value|content|data-tip|label)\s*=\s*("([^"]*)"|'([^']*)')/gi;
      let a;
      while ((a = re.exec(tag))) { const val = a[3] !== undefined ? a[3] : a[4]; const off = i + a.index + a[0].indexOf(val, a[0].indexOf('=')); out.push({ start: off, end: off + val.length, text: val }); }
      const name = m[2].toLowerCase();
      if (!m[1] && (name === 'script' || name === 'style')) {
        const close = src.indexOf(`</${name}`, e);
        const end = close < 0 ? src.length : close;
        if (name === 'script' && !/\btype\s*=\s*["']?(application\/(ld\+)?json|importmap)/i.test(tag) && !/\bsrc\s*=/.test(tag)) jsStrings(src, e + 1, end, out);
        if (name === 'script' && /application\/ld\+json/i.test(tag)) out.push({ start: e + 1, end, text: src.slice(e + 1, end) });
        i = end; continue;
      }
      i = e + 1; continue;
    }
    const next = src.indexOf('<', i);
    const end = next < 0 ? src.length : next;
    if (src.slice(i, end).trim()) out.push({ start: i, end, text: src.slice(i, end) });
    i = end;
  }
  return out;
}

// Every file whose words people see (the app, the labs and 3D views, the landing page, the
// extension, the server's replies). Libraries made by others (three.js and friends) are left out.
const ROOT = path.resolve(__dirname, '..');
const UI_FILES = () => {
  const list = [];
  const add = (dir, re) => { for (const f of fs.readdirSync(path.join(ROOT, dir))) if (re.test(f)) list.push(path.join(dir, f)); };
  add('.', /^(app|native|sketch|board|cards|cite|voice|memory|export|config|cassie-bot|listen|study-room|bot-page|start|gradient|sw)\.js$|\.html$/);
  add('labs', /\.js$/);
  add('explore', /^(body-facts|cells|cell3d|body3d|tissue)\.js$/);
  add('landing', /\.js$/);
  add('extension', /\.(js|html)$/);
  add('server', /^(worker\.src\.js|dashboard\.html)$/);
  list.push('manifest.json', 'extension/manifest.json'); // the app's name on the home screen and in Chrome
  return list.filter((f) => fs.existsSync(path.join(ROOT, f)));
};
function uiStrings(file) {
  const src = fs.readFileSync(path.join(ROOT, file), 'utf8');
  return (file.endsWith('.html') ? htmlStrings(src) : jsStrings(src)).map((s) => ({ ...s, file, line: src.slice(0, s.start).split('\n').length }));
}
module.exports = { jsStrings, htmlStrings, UI_FILES, uiStrings, ROOT };
