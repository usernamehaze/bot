/* Citations for the real papers Cassie finds (Research) — built from the paper's own data
 * (OpenAlex), not written by the AI, so nothing is made up:
 *   APA 7 and MLA 9 reference lists to copy, BibTeX (Zotero, Mendeley, LaTeX/Overleaf) and
 *   RIS (Zotero, Mendeley, EndNote) files to download.
 *
 *   paper = { title, year, authors: ['First M. Last', …], venue, doi, url, volume, issue, firstPage, lastPage, type }
 *   CassieCite.apa(papers) · .mla(papers) · .bibtex(papers) · .ris(papers) · .bar(papers, { track }) → element
 */
(function () {
  'use strict';
  const PARTICLES = /^(de|dela|del|della|der|den|da|das|do|dos|di|du|la|le|van|von|y|bin|binti|al|el|st\.?)$/i;

  // "Maria Clara dela Cruz" → { last: 'dela Cruz', given: ['Maria', 'Clara'] }
  function splitName(full) {
    const s = String(full || '').trim();
    if (s.includes(',')) { const [last, rest] = s.split(/,\s*/); return { last, given: (rest || '').split(/\s+/).filter(Boolean) }; }
    const w = s.split(/\s+/).filter(Boolean);
    if (w.length < 2) return { last: s, given: [] };
    let i = w.length - 1;
    while (i > 1 && PARTICLES.test(w[i - 1])) i--;
    return { last: w.slice(i).join(' '), given: w.slice(0, i) };
  }
  const initials = (given) => given.map((g) => g.split('-').map((p) => p[0].toUpperCase() + '.').join('-')).join(' ');
  const doiUrl = (p) => (p.doi ? 'https://doi.org/' + String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : p.url || '');
  const bareDoi = (p) => (p.doi ? String(p.doi).replace(/^https?:\/\/(dx\.)?doi\.org\//i, '') : '');
  const pages = (p) => (p.firstPage ? p.firstPage + (p.lastPage && p.lastPage !== p.firstPage ? '–' + p.lastPage : '') : '');
  const end = (t) => (/[.?!]$/.test(t) ? t : t + '.');

  function apaOne(p) {
    const names = (p.authors || []).map((a) => { const n = splitName(a); return n.given.length ? `${n.last}, ${initials(n.given)}` : n.last; });
    let who = '';
    if (!names.length) who = '';
    else if (names.length === 1) who = names[0];
    else if (names.length <= 20) who = names.slice(0, -1).join(', ') + ', & ' + names[names.length - 1];
    else who = names.slice(0, 19).join(', ') + ', … ' + names[names.length - 1];
    const year = `(${p.year || 'n.d.'}).`;
    let src = p.venue || '';
    if (src && p.volume) src += `, ${p.volume}${p.issue ? `(${p.issue})` : ''}`;
    if (src && pages(p)) src += `, ${pages(p)}`;
    const head = who ? `${end(who)} ${year}` : `${end(p.title || 'Untitled')} ${year}`;
    return [head, who ? end(p.title || 'Untitled') : '', src ? end(src) : '', doiUrl(p)].filter(Boolean).join(' ');
  }
  function mlaOne(p) {
    const a = (p.authors || []).map(splitName);
    let who = '';
    if (a.length === 1) who = `${a[0].last}, ${a[0].given.join(' ')}`.replace(/, $/, '');
    else if (a.length === 2) who = `${a[0].last}, ${a[0].given.join(' ')}, and ${a[1].given.join(' ')} ${a[1].last}`;
    else if (a.length > 2) who = `${a[0].last}, ${a[0].given.join(' ')}, et al`;
    const bits = [];
    if (p.venue) bits.push(p.venue);
    if (p.volume) bits.push(`vol. ${p.volume}`);
    if (p.issue) bits.push(`no. ${p.issue}`);
    if (p.year) bits.push(String(p.year));
    if (pages(p)) bits.push(`pp. ${pages(p)}`);
    const link = doiUrl(p).replace(/^https?:\/\//, '');
    return [who ? end(who) : '', `“${end(p.title || 'Untitled')}”`, bits.length ? end(bits.join(', ')) : '', link ? end(link) : ''].filter(Boolean).join(' ');
  }
  const sortByAuthor = (list, f) => list.map((p) => ({ p, k: (splitName((p.authors || [])[0] || p.title || '').last || '').toLowerCase() })).sort((a, b) => a.k.localeCompare(b.k)).map((x) => f(x.p));
  const apa = (list) => sortByAuthor(list, apaOne).join('\n\n');
  const mla = (list) => sortByAuthor(list, mlaOne).join('\n\n');

  const texEsc = (t) => String(t || '').replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
  function bibtex(list) {
    const used = new Set();
    return list.map((p) => {
      const last = (splitName((p.authors || [])[0] || 'anon').last || 'anon').normalize('NFD').replace(/[^A-Za-z]/g, '').toLowerCase() || 'anon';
      const word = (String(p.title || '').normalize('NFD').toLowerCase().match(/[a-z]{4,}/) || ['paper'])[0];
      let key = `${last}${p.year || ''}${word}`, k = key, i = 1;
      while (used.has(k)) k = key + String.fromCharCode(97 + i++);
      used.add(k);
      const journal = /article/.test(p.type || 'article') && p.venue;
      const f = [
        ['title', `{${texEsc(p.title || 'Untitled')}}`],
        ['author', (p.authors || []).map((a) => { const n = splitName(a); return n.given.length ? `${n.last}, ${n.given.join(' ')}` : n.last; }).map(texEsc).join(' and ')],
        ['year', p.year], [journal ? 'journal' : 'howpublished', texEsc(p.venue)], ['volume', p.volume], ['number', p.issue],
        ['pages', p.firstPage ? p.firstPage + (p.lastPage && p.lastPage !== p.firstPage ? '--' + p.lastPage : '') : ''],
        ['doi', bareDoi(p)], ['url', doiUrl(p)],
      ].filter(([, v]) => v);
      return `@${journal ? 'article' : 'misc'}{${k},\n${f.map(([n, v]) => `  ${n} = {${v}}`).join(',\n')}\n}`;
    }).join('\n\n') + '\n';
  }
  function ris(list) {
    return list.map((p) => {
      const L = [['TY', /article/.test(p.type || 'article') && p.venue ? 'JOUR' : 'GEN']];
      (p.authors || []).forEach((a) => { const n = splitName(a); L.push(['AU', n.given.length ? `${n.last}, ${n.given.join(' ')}` : n.last]); });
      L.push(['TI', p.title || 'Untitled']);
      if (p.venue) L.push(['T2', p.venue]);
      if (p.year) L.push(['PY', String(p.year)]);
      if (p.volume) L.push(['VL', p.volume]);
      if (p.issue) L.push(['IS', p.issue]);
      if (p.firstPage) L.push(['SP', p.firstPage]);
      if (p.lastPage) L.push(['EP', p.lastPage]);
      if (bareDoi(p)) L.push(['DO', bareDoi(p)]);
      if (doiUrl(p)) L.push(['UR', doiUrl(p)]);
      L.push(['ER', '']);
      return L.map(([t, v]) => `${t}  - ${String(v).replace(/[\r\n]+/g, ' ')}`).join('\r\n');
    }).join('\r\n\r\n') + '\r\n';
  }

  function download(name, text, type) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type }));
    a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  }
  function copy(text) {
    try { return navigator.clipboard.writeText(text); } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ } ta.remove();
    return Promise.resolve();
  }

  // the row of buttons under a list of papers
  function bar(papers, opts = {}) {
    const row = document.createElement('div');
    row.className = 'bubble-tools cite-tools';
    row.innerHTML = '<span class="save-label">Cite these</span>';
    const btn = (label, title, fn) => {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label; b.title = title;
      b.addEventListener('click', () => { const r = fn(); if (opts.track) opts.track('feature', 'cite:' + label.toLowerCase().replace(/\W+/g, '')); if (r && r.then) r.then(() => { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = label; }, 1500); }); });
      row.appendChild(b);
    };
    btn('Copy APA', 'Copy the reference list in APA 7th edition', () => copy(apa(papers)));
    btn('Copy MLA', 'Copy the works cited in MLA 9th edition', () => copy(mla(papers)));
    btn('BibTeX', 'For Zotero, Mendeley or LaTeX/Overleaf', () => download('cassie-references.bib', bibtex(papers), 'application/x-bibtex'));
    btn('RIS', 'For Zotero, Mendeley or EndNote', () => download('cassie-references.ris', ris(papers), 'application/x-research-info-systems'));
    return row;
  }

  window.CassieCite = { apa, mla, apaOne, mlaOne, bibtex, ris, bar, splitName };
})();
