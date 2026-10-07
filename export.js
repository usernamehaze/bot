/* Cassie — save any answer as a real file: Word (.docx), PDF, image (.png) or
   plain text. Everything is built in the browser; nothing is uploaded.

   Cassie writes light markdown (bold labels, bullets, numbered steps, small
   tables, code fences). We parse that into simple blocks once, then lay the
   blocks out for each format. */
(function () {
  'use strict';

  // served from Cassie's own site (vendor/), pinned to patched versions
  const JSZIP_URL = 'vendor/jszip.min.js';
  const JSPDF_URL = 'vendor/jspdf.umd.min.js';

  const scripts = {};
  function loadScript(src) {
    if (scripts[src]) return scripts[src];
    scripts[src] = new Promise((resolve, reject) => {
      const s = document.createElement('script');
      s.src = src; s.async = true;
      s.onload = resolve;
      s.onerror = () => { delete scripts[src]; reject(new Error('Could not load ' + src)); };
      document.head.appendChild(s);
    });
    return scripts[src];
  }

  /* ---------- markdown → blocks ---------- */
  // Inline: **bold** becomes a bold run; *italics* and `code` markers are dropped.
  function runs(text) {
    const out = [];
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      const bold = /^\*\*[^*]+\*\*$/.test(part);
      const t = (bold ? part.slice(2, -2) : part)
        .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1$2')
        .replace(/`([^`]+)`/g, '$1');
      if (t) out.push({ text: t, bold });
    });
    return out.length ? out : [{ text: '', bold: false }];
  }
  const plain = (rs) => rs.map((r) => r.text).join('');

  function parse(md) {
    const lines = String(md || '').replace(/\r/g, '').split('\n');
    const blocks = [];
    let para = null;
    const flush = () => { if (para) { blocks.push({ type: 'p', runs: runs(para.join(' ')) }); para = null; } };
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const fence = line.match(/^\s*```\s*([\w-]*)/);
      if (fence) {
        flush();
        const body = [];
        i++;
        while (i < lines.length && !/^\s*```/.test(lines[i])) body.push(lines[i++]);
        if (fence[1] !== 'cassie-board') blocks.push({ type: 'code', text: body.join('\n') });
        continue;
      }
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flush();
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
          const cells = lines[i].trim().slice(1, -1).split('|').map((c) => c.trim());
          if (!cells.every((c) => /^:?-{2,}:?$/.test(c))) rows.push(cells.map(runs));
          i++;
        }
        i--;
        if (rows.length) blocks.push({ type: 'table', rows });
        continue;
      }
      if (!line.trim()) { flush(); continue; }
      let m;
      if ((m = line.match(/^\s*#{1,6}\s+(.*)$/)) || (m = line.match(/^\s*\*\*([^*]+)\*\*:?\s*$/))) {
        flush(); blocks.push({ type: 'h', runs: runs(m[1].replace(/:$/, '')) }); continue;
      }
      if ((m = line.match(/^(\s*)[-*•]\s+(.*)$/))) {
        flush(); blocks.push({ type: 'li', level: m[1].length >= 2 ? 1 : 0, mark: '•', runs: runs(m[2]) }); continue;
      }
      if ((m = line.match(/^(\s*)(\d+[.)])\s+(.*)$/))) {
        flush(); blocks.push({ type: 'li', level: m[1].length >= 2 ? 1 : 0, mark: m[2], runs: runs(m[3]) }); continue;
      }
      if (/^\s*(-{3,}|\*{3,}|_{3,})\s*$/.test(line)) { flush(); continue; }
      (para = para || []).push(line.trim());
    }
    flush();
    return blocks;
  }

  // A sensible document title: the first heading, else the first words.
  function titleOf(md, fallback) {
    if (fallback) return fallback;
    const blocks = parse(md);
    const h = blocks.find((b) => b.type === 'h');
    const t = h ? plain(h.runs) : (blocks[0] && blocks[0].runs ? plain(blocks[0].runs) : 'Cassie notes');
    return t.replace(/\s+/g, ' ').trim().slice(0, 60) || 'Cassie notes';
  }
  function fileBase(title) {
    // ASCII only: some browsers silently drop a download name with symbols like "–".
    return (String(title).normalize('NFKD').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7e]/g, '')
      .replace(/[\\/:*?"<>|#%{}~&]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60) || 'Cassie notes');
  }

  // If the answer opens with its own heading, use it as the document title
  // (instead of printing two titles one above the other).
  function prep(md, title) {
    const blocks = parse(md);
    if (blocks.length > 1 && blocks[0].type === 'h') return { blocks: blocks.slice(1), title: plain(blocks[0].runs) };
    return { blocks, title };
  }

  /* ---------- Word (.docx) ---------- */
  const xmlEsc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  function wRuns(rs, extra = '') {
    return rs.map((r) => `<w:r><w:rPr>${r.bold ? '<w:b/>' : ''}${extra}</w:rPr><w:t xml:space="preserve">${xmlEsc(r.text)}</w:t></w:r>`).join('');
  }
  function wPara(inner, pPr = '') { return `<w:p>${pPr ? `<w:pPr>${pPr}</w:pPr>` : ''}${inner}</w:p>`; }

  async function toDocx(md, title) {
    await loadScript(JSZIP_URL);
    const { blocks, title: docTitle } = prep(md, title);
    title = docTitle;
    let body = wPara(wRuns([{ text: title, bold: true }], '<w:sz w:val="36"/>'), '<w:spacing w:after="200"/>');
    for (const b of blocks) {
      if (b.type === 'h') body += wPara(wRuns(b.runs.map((r) => ({ ...r, bold: true })), '<w:sz w:val="26"/>'), '<w:keepNext/><w:spacing w:before="240" w:after="80"/>');
      else if (b.type === 'p') body += wPara(wRuns(b.runs));
      else if (b.type === 'li') {
        const left = 360 + b.level * 360;
        body += wPara(`<w:r><w:t xml:space="preserve">${xmlEsc(b.mark)}</w:t></w:r><w:r><w:tab/></w:r>${wRuns(b.runs)}`,
          `<w:spacing w:after="60"/><w:ind w:left="${left}" w:hanging="360"/>`);
      } else if (b.type === 'code') {
        b.text.split('\n').forEach((l) => {
          body += wPara(`<w:r><w:rPr><w:rFonts w:ascii="Consolas" w:hAnsi="Consolas"/><w:sz w:val="19"/></w:rPr><w:t xml:space="preserve">${xmlEsc(l)}</w:t></w:r>`,
            '<w:spacing w:after="0"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
        });
        body += wPara('');
      } else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const border = '<w:top w:val="single" w:sz="4" w:color="BFBFBF"/><w:left w:val="single" w:sz="4" w:color="BFBFBF"/><w:bottom w:val="single" w:sz="4" w:color="BFBFBF"/><w:right w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideH w:val="single" w:sz="4" w:color="BFBFBF"/><w:insideV w:val="single" w:sz="4" w:color="BFBFBF"/>';
        body += `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${border}</w:tblBorders></w:tblPr><w:tblGrid>${'<w:gridCol/>'.repeat(cols)}</w:tblGrid>`;
        b.rows.forEach((row, ri) => {
          body += '<w:tr>';
          for (let c = 0; c < cols; c++) {
            const cell = row[c] || runs('');
            const rs = ri === 0 ? cell.map((r) => ({ ...r, bold: true })) : cell;
            body += `<w:tc><w:tcPr>${ri === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="EDEDED"/>' : ''}</w:tcPr>${wPara(wRuns(rs), '<w:spacing w:after="0"/>')}</w:tc>`;
          }
          body += '</w:tr>';
        });
        body += '</w:tbl>' + wPara('');
      }
    }
    const doc = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1200" w:right="1200" w:bottom="1200" w:left="1200" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="120" w:line="276" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/></w:style></w:styles>`;
    const zip = new window.JSZip();
    zip.file('[Content_Types].xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/></Types>');
    zip.file('_rels/.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>');
    zip.file('word/_rels/document.xml.rels', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>');
    zip.file('word/document.xml', doc);
    zip.file('word/styles.xml', styles);
    return zip.generateAsync({ type: 'blob', mimeType: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
  }

  /* ---------- shared word-wrap layout (PDF + image) ---------- */
  // Lays bold/regular runs into lines no wider than maxW. measure(text, bold) → width.
  function layout(rs, maxW, measure) {
    const lines = [];
    let line = [], x = 0;
    const space = (bold) => measure(' ', bold);
    rs.forEach((r) => {
      r.text.split(/(\s+)/).forEach((tok) => {
        if (!tok) return;
        if (/^\s+$/.test(tok)) { if (line.length) x += space(r.bold); return; }
        let w = measure(tok, r.bold);
        if (x + w > maxW && line.length) { lines.push(line); line = []; x = 0; }
        // break a single over-long word (e.g. a URL)
        while (w > maxW && tok.length > 1) {
          let n = tok.length - 1;
          while (n > 1 && measure(tok.slice(0, n), r.bold) > maxW) n--;
          lines.push([{ text: tok.slice(0, n), bold: r.bold, x: 0 }]);
          tok = tok.slice(n); w = measure(tok, r.bold);
        }
        line.push({ text: tok, bold: r.bold, x });
        x += w;
      });
    });
    if (line.length || !lines.length) lines.push(line);
    return lines;
  }

  /* ---------- PDF ---------- */
  // jsPDF's built-in fonts only cover Western characters, so swap common math /
  // science symbols for readable ASCII and drop anything else (e.g. emoji).
  const PDF_SUBS = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '≤': '<=', '≥': '>=', '≠': '!=', '≈': '~', '×': 'x', '÷': '/', '√': 'sqrt', 'π': 'pi', '∞': 'infinity', '∑': 'sum', 'Δ': 'Delta', 'δ': 'delta', 'α': 'alpha', 'β': 'beta', 'γ': 'gamma', 'θ': 'theta', 'λ': 'lambda', 'μ': 'mu', 'σ': 'sigma', 'Ω': 'Ohm', 'ω': 'omega', '−': '-', '✓': 'v', '✔': 'v', '✗': 'x', '★': '*', '⁰': '^0', '⁴': '^4', '⁵': '^5', '⁶': '^6', '⁷': '^7', '⁸': '^8', '⁹': '^9', '₀': '0', '₁': '1', '₂': '2', '₃': '3', '₄': '4' };
  const pdfSafe = (s) => String(s).replace(/./gu, (ch) => {
    if (PDF_SUBS[ch]) return PDF_SUBS[ch];
    const c = ch.codePointAt(0);
    if (c < 256 || '•–—‘’“”…€™'.includes(ch)) return ch;
    return '';
  });
  const pdfRuns = (rs) => rs.map((r) => ({ ...r, text: pdfSafe(r.text) }));

  async function toPdf(md, title) {
    await loadScript(JSPDF_URL);
    const { jsPDF } = window.jspdf;
    const { blocks, title: docTitle } = prep(md, title);
    title = docTitle;
    const pdf = new jsPDF({ unit: 'pt', format: 'letter' });
    const W = pdf.internal.pageSize.getWidth(), H = pdf.internal.pageSize.getHeight();
    const M = 56, maxW = W - M * 2;
    let y = M;
    const setFont = (bold, size, mono) => { pdf.setFont(mono ? 'courier' : 'helvetica', bold ? 'bold' : 'normal'); pdf.setFontSize(size); };
    const ensure = (h) => { if (y + h > H - M) { pdf.addPage(); y = M; } };
    const drawRuns = (rs, x0, width, size, lh) => {
      const lines = layout(pdfRuns(rs), width, (t, b) => { setFont(b, size); return pdf.getTextWidth(t); });
      lines.forEach((ln) => {
        ensure(lh);
        ln.forEach((seg) => { setFont(seg.bold, size); pdf.text(seg.text, x0 + seg.x, y + size); });
        y += lh;
      });
    };
    pdf.setTextColor(20);
    drawRuns([{ text: title, bold: true }], M, maxW, 18, 24);
    y += 8;
    pdf.setDrawColor(200); pdf.line(M, y, W - M, y); y += 14;
    for (const b of blocks) {
      if (b.type === 'h') { y += 8; ensure(36); drawRuns(b.runs.map((r) => ({ ...r, bold: true })), M, maxW, 13, 18); y += 2; }
      else if (b.type === 'p') { drawRuns(b.runs, M, maxW, 11, 15.5); y += 6; }
      else if (b.type === 'li') {
        const ind = M + 14 + b.level * 18;
        ensure(15.5);
        setFont(false, 11); pdf.text(pdfSafe(b.mark), ind - 12, y + 11);
        drawRuns(b.runs, ind + (b.mark.length > 2 ? 8 : 2), maxW - (ind - M) - 8, 11, 15.5); y += 2;
      } else if (b.type === 'code') {
        b.text.split('\n').forEach((l) => {
          const parts = pdf.splitTextToSize(pdfSafe(l) || ' ', maxW - 12);
          parts.forEach((p) => { ensure(13); setFont(false, 9.5, true); pdf.text(p, M + 6, y + 9.5); y += 13; });
        });
        y += 8;
      } else if (b.type === 'table') {
        const cols = Math.max(...b.rows.map((r) => r.length));
        const cw = maxW / cols;
        b.rows.forEach((row, ri) => {
          const cellLines = [];
          for (let c = 0; c < cols; c++) {
            const rs = (row[c] || runs('')).map((r) => ({ ...r, bold: ri === 0 || r.bold }));
            cellLines.push(layout(pdfRuns(rs), cw - 10, (t, bd) => { setFont(bd, 10); return pdf.getTextWidth(t); }));
          }
          const rh = Math.max(...cellLines.map((l) => l.length)) * 13 + 8;
          ensure(rh);
          if (ri === 0) { pdf.setFillColor(237, 237, 237); pdf.rect(M, y, maxW, rh, 'F'); }
          cellLines.forEach((lines, c) => {
            pdf.rect(M + c * cw, y, cw, rh);
            lines.forEach((ln, li) => ln.forEach((seg) => { setFont(seg.bold, 10); pdf.text(seg.text, M + c * cw + 5 + seg.x, y + 4 + 10 + li * 13); }));
          });
          y += rh;
        });
        y += 10;
      }
    }
    const pages = pdf.internal.getNumberOfPages();
    for (let p = 1; p <= pages; p++) {
      pdf.setPage(p); setFont(false, 8); pdf.setTextColor(140);
      pdf.text(`Made with Cassie  ·  ${p} / ${pages}`, W / 2, H - 28, { align: 'center' });
    }
    return pdf.output('blob');
  }

  /* ---------- Image (.png) — a tall, shareable study card ---------- */
  async function toPng(md, title) {
    const W = 1080, PAD = 72, maxW = W - PAD * 2, MAX_H = 16000;
    const font = (bold, size, mono) => `${bold ? '700' : '400'} ${size}px ${mono ? 'ui-monospace, Menlo, Consolas, monospace' : 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'}`;
    const probe = document.createElement('canvas').getContext('2d');
    const measureAt = (size) => (t, b) => { probe.font = font(b, size); return probe.measureText(t).width; };
    // First pass: lay everything out to know the height; second pass: draw.
    const { blocks, title: docTitle } = prep(md, title);
    title = docTitle;
    const ops = [];
    let y = PAD;
    const addRuns = (rs, x0, width, size, lh, color) => {
      layout(rs, width, measureAt(size)).forEach((ln) => { ops.push({ ln, x0, y, size, color }); y += lh; });
    };
    addRuns([{ text: title, bold: true }], PAD, maxW, 44, 56, '#111');
    y += 10; ops.push({ rule: true, y }); y += 30;
    for (const b of blocks) {
      if (y > MAX_H - 200) break;
      if (b.type === 'h') { y += 14; addRuns(b.runs.map((r) => ({ ...r, bold: true })), PAD, maxW, 32, 42, '#111'); y += 4; }
      else if (b.type === 'p') { addRuns(b.runs, PAD, maxW, 27, 39, '#222'); y += 14; }
      else if (b.type === 'li') {
        const ind = PAD + 34 + b.level * 40;
        ops.push({ ln: [{ text: b.mark, bold: false, x: 0 }], x0: ind - 30, y, size: 27, color: '#555' });
        addRuns(b.runs, ind + (b.mark.length > 2 ? 12 : 0), maxW - (ind - PAD), 27, 39, '#222'); y += 6;
      } else if (b.type === 'code') {
        b.text.split('\n').forEach((l) => { ops.push({ ln: [{ text: l, bold: false, x: 0 }], x0: PAD + 16, y, size: 22, color: '#333', mono: true }); y += 32; });
        y += 14;
      } else if (b.type === 'table') {
        b.rows.forEach((row, ri) => {
          addRuns([{ text: row.map((c) => plain(c)).join('   |   '), bold: ri === 0 }], PAD, maxW, 24, 34, '#222');
        });
        y += 14;
      }
    }
    const H = Math.min(MAX_H, y + PAD + 30);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.fillStyle = '#fafaf8'; ctx.fillRect(0, 0, W, H);
    ctx.textBaseline = 'alphabetic';
    ops.forEach((op) => {
      if (op.y > H - PAD) return;
      if (op.rule) { ctx.fillStyle = '#d6d6d2'; ctx.fillRect(PAD, op.y, maxW, 2); return; }
      ctx.fillStyle = op.color;
      op.ln.forEach((seg) => { ctx.font = font(seg.bold, op.size, op.mono); ctx.fillText(seg.text, op.x0 + seg.x, op.y + op.size); });
    });
    ctx.font = font(false, 20); ctx.fillStyle = '#9a9a96'; ctx.textAlign = 'center';
    ctx.fillText(y > MAX_H - 200 ? 'Continued in the PDF / Word version  ·  Made with Cassie' : 'Made with Cassie', W / 2, H - 34);
    return new Promise((resolve) => cv.toBlob(resolve, 'image/png'));
  }

  function toTxt(md, title) {
    const { blocks, title: docTitle } = prep(md, title);
    title = docTitle;
    const lines = blocks.map((b) => {
      if (b.type === 'h') return '\n' + plain(b.runs).toUpperCase();
      if (b.type === 'li') return `${b.level ? '    ' : ''}${b.mark} ${plain(b.runs)}`;
      if (b.type === 'code') return b.text;
      if (b.type === 'table') return b.rows.map((r) => r.map(plain).join(' | ')).join('\n');
      return plain(b.runs);
    });
    return new Blob([`${title}\n${'='.repeat(Math.min(60, title.length))}\n${lines.join('\n')}\n`], { type: 'text/plain' });
  }

  // Which file did the user ask for? ("make it a pdf", "save as word", "as a photo")
  function wantedFormat(request) {
    const t = String(request || '').toLowerCase();
    // Only when they ask for a file as the OUTPUT — "summarize this pdf" isn't asking for a PDF back.
    const asOut = (fmt) => new RegExp(`\\b(as|into|in|to)\\s+(an?\\s+)?(${fmt})\\b|\\b(${fmt})\\s+(file|version|format|copy|document|doc)\\b|\\b(make|create|give|export|save|download|send|generate|turn)\\b[^.?!]{0,40}?(?<!\\b(this|the|my|that|from|of|attached|uploaded)\\s)\\b(${fmt})\\b`).test(t);
    if (asOut('pdf')) return 'pdf';
    if (asOut('docx?|word|ms word')) return 'docx';
    if (asOut('png|jpe?g|photo|picture|image')) return 'png';
    if (asOut('txt|text file|notepad')) return 'txt';
    return '';
  }

  window.CassieExport = { parse, titleOf, fileBase, toDocx, toPdf, toPng, toTxt, wantedFormat };
})();
