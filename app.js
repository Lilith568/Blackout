// Blackout – offline document redaction. Apache-2.0.
// Everything in this file runs in the browser. There is no server component,
// and the CSP in index.html (connect-src 'none') makes network access impossible.

import * as pdfjsLib from './vendor/pdfjs/pdf.min.mjs';
import { I18N } from './i18n.js';

pdfjsLib.GlobalWorkerOptions.workerSrc = './vendor/pdfjs/pdf.worker.min.mjs';

// ---------- state ----------
const S = {
  kind: null,            // 'pdf' | 'image'
  name: '',
  pdf: null,             // pdfjs document
  images: [],            // for image input: [ImageBitmap]
  pageCount: 0,
  page: 1,
  zoom: 1,
  boxes: {},             // pageIndex(1-based) -> [{x,y,w,h}] normalized 0..1
  history: [],
  textLines: {},         // pageIndex -> [{str, items:[{x,y,w,h,start,end}]}] normalized
  suggestions: {},       // patternKey -> [{page, x,y,w,h}]
  tool: 'box',
  meta: [],
};

const $ = (id) => document.getElementById(id);
const el = {
  start: $('start'), editor: $('editor'), file: $('file'), drop: $('dropzone'),
  page: $('page'), overlay: $('overlay'), wrap: $('pagewrap'),
  pagenum: $('pagenum'), pagecount: $('pagecount'), zoom: $('zoom'),
  patterns: $('patterns'), fileinfo: $('fileinfo'), metalist: $('metalist'), metabox: $('metabox'),
  boxcount: $('boxcount'), lang: $('lang'),
};
const ctx = el.page.getContext('2d');
const octx = el.overlay.getContext('2d');

// ---------- i18n ----------
function applyLang(code) {
  const dict = I18N[code] || I18N.en;
  document.documentElement.lang = code;
  document.documentElement.dir = (code === 'fa' || code === 'ar') ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach(n => {
    const k = n.dataset.i18n;
    if (dict[k] || I18N.en[k]) n.textContent = dict[k] || I18N.en[k];
  });
  renderPatternList();
}
function t(k) { const d = I18N[el.lang.value] || I18N.en; return d[k] || I18N.en[k] || k; }
el.lang.addEventListener('change', () => applyLang(el.lang.value));

// ---------- detection patterns ----------
// Deliberately conservative: false positives cost the user one click; false negatives
// cost them their safety. Users are told in the UI that detection is never complete.
const PATTERNS = [
  { key: 'iban',  label: 'pat_iban',  re: /\b[A-Z]{2}\d{2}(?:[ \-]?[A-Z0-9]{4}){2,7}(?:[ \-]?[A-Z0-9]{1,4})?\b/g, on: true },
  { key: 'email', label: 'pat_email', re: /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, on: true },
  { key: 'phone', label: 'pat_phone', re: /(?:\+|00)\d{1,3}[ \-/]?(?:\(?\d{1,5}\)?[ \-/]?){2,5}\d{2,}|\b0\d{2,5}[ \-/]\d{3,}(?:[ \-]\d+)?\b/g, on: true },
  { key: 'card',  label: 'pat_card',  re: /\b(?:\d[ \-]?){13,19}\b/g, on: true },
  { key: 'url',   label: 'pat_url',   re: /\b(?:https?:\/\/|www\.)[^\s<>"']+/gi, on: true },
  { key: 'ip',    label: 'pat_ip',    re: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, on: true },
  { key: 'date',  label: 'pat_date',  re: /\b\d{1,2}[./-]\d{1,2}[./-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g, on: false },
  { key: 'idnum', label: 'pat_idnum', re: /\b[A-Z0-9]{2,4}[ \-]?\d{6,}\b|\b\d{8,}\b/g, on: false },
  { key: 'caps',  label: 'pat_caps',  re: /\b\p{Lu}\p{Ll}{2,}(?:[ \-]\p{Lu}\p{Ll}{2,})+\b/gu, on: false },
];

// ---------- file loading ----------
el.file.addEventListener('change', e => e.target.files[0] && openFile(e.target.files[0]));
['dragenter', 'dragover'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.add('over'); }));
['dragleave', 'drop'].forEach(ev => el.drop.addEventListener(ev, e => { e.preventDefault(); el.drop.classList.remove('over'); }));
el.drop.addEventListener('drop', e => e.dataTransfer.files[0] && openFile(e.dataTransfer.files[0]));
el.drop.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') el.file.click(); });
el.drop.addEventListener('click', e => { if (e.target === el.drop || e.target.tagName === 'P') el.file.click(); });

async function openFile(file) {
  resetState();
  S.name = file.name;
  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);
  try {
    if (isPdf(bytes)) await loadPdf(bytes);
    else await loadImage(file, bytes);
  } catch (err) {
    alert(t('err_open') + '\n' + (err && err.message ? err.message : err));
    return;
  }
  el.fileinfo.textContent = `${file.name} · ${(file.size / 1024).toFixed(0)} KB · ${S.pageCount} ${t('pages')}`;
  renderMeta();
  el.start.classList.add('hidden');
  el.editor.classList.remove('hidden');
  S.page = 1;
  await renderPage();
  await scanText();
}

function isPdf(b) { return b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46; }

async function loadPdf(bytes) {
  S.kind = 'pdf';
  S.pdf = await pdfjsLib.getDocument({ data: bytes, isEvalSupported: false, disableFontFace: false }).promise;
  S.pageCount = S.pdf.numPages;
  const m = await S.pdf.getMetadata().catch(() => null);
  if (m) {
    const info = m.info || {};
    for (const k of Object.keys(info)) {
      if (info[k] && typeof info[k] !== 'object') S.meta.push([k, String(info[k])]);
    }
    if (m.metadata) {
      S.meta.push(['XMP', t('meta_xmp')]);
      try { const all = m.metadata.getAll(); for (const k of Object.keys(all)) S.meta.push([k, String(all[k]).slice(0, 120)]); } catch {}
    }
  }
  // Count hidden-but-recoverable things so users understand why flattening matters.
  let annots = 0;
  for (let i = 1; i <= Math.min(S.pageCount, 50); i++) {
    const p = await S.pdf.getPage(i);
    const a = await p.getAnnotations().catch(() => []);
    annots += a.length;
  }
  if (annots) S.meta.push([t('meta_annots'), String(annots)]);
}

async function loadImage(file, bytes) {
  S.kind = 'image';
  const bmp = await createImageBitmap(file);
  S.images = [bmp];
  S.pageCount = 1;
  // Metadata inspection (presence only; we never parse untrusted structures deeply).
  if (bytes[0] === 0xFF && bytes[1] === 0xD8) scanJpegSegments(bytes);
  else if (bytes[0] === 0x89 && bytes[1] === 0x50) scanPngChunks(bytes);
  S.meta.push([t('meta_dims'), `${bmp.width} × ${bmp.height}`]);
}

function scanJpegSegments(b) {
  let i = 2;
  while (i + 4 < b.length && b[i] === 0xFF) {
    const marker = b[i + 1], len = (b[i + 2] << 8) | b[i + 3];
    if (marker === 0xDA) break;
    const sig = String.fromCharCode(...b.slice(i + 4, i + 4 + Math.min(10, len - 2)));
    if (marker === 0xE1 && sig.startsWith('Exif')) {
      S.meta.push(['EXIF', `${len} B`]);
      // GPS IFD pointer tag 0x8825 appears as bytes 88 25 or 25 88 depending on endianness
      const seg = b.subarray(i + 4, i + 2 + len);
      for (let k = 0; k + 1 < seg.length; k++) {
        if ((seg[k] === 0x88 && seg[k + 1] === 0x25) || (seg[k] === 0x25 && seg[k + 1] === 0x88)) { S.meta.push(['GPS', t('meta_gps')]); break; }
      }
    } else if (marker === 0xE1 && sig.startsWith('http://ns.adobe')) S.meta.push(['XMP', `${len} B`]);
    else if (marker === 0xE2 && sig.startsWith('ICC')) S.meta.push(['ICC', `${len} B`]);
    else if (marker === 0xED) S.meta.push(['IPTC/Photoshop', `${len} B`]);
    else if (marker === 0xFE) S.meta.push([t('meta_comment'), `${len} B`]);
    i += 2 + len;
  }
}
function scanPngChunks(b) {
  let i = 8;
  while (i + 8 <= b.length) {
    const len = (b[i] << 24 | b[i + 1] << 16 | b[i + 2] << 8 | b[i + 3]) >>> 0;
    const type = String.fromCharCode(b[i + 4], b[i + 5], b[i + 6], b[i + 7]);
    if (['tEXt', 'iTXt', 'zTXt', 'eXIf', 'tIME', 'iCCP'].includes(type)) {
      let key = '';
      if (type !== 'eXIf' && type !== 'tIME' && type !== 'iCCP') { for (let k = i + 8; k < i + 8 + Math.min(len, 79) && b[k] !== 0; k++) key += String.fromCharCode(b[k]); }
      S.meta.push([type + (key ? ' ' + key : ''), `${len} B`]);
    }
    if (type === 'IEND') break;
    i += 12 + len;
  }
}

function renderMeta() {
  el.metalist.innerHTML = '';
  if (!S.meta.length) { el.metabox.querySelector('summary').textContent = t('meta_none'); return; }
  el.metabox.querySelector('summary').textContent = `${t('meta_h')} (${S.meta.length})`;
  for (const [k, v] of S.meta) {
    const dt = document.createElement('dt'); dt.textContent = k;
    const dd = document.createElement('dd'); dd.textContent = v;
    el.metalist.append(dt, dd);
  }
}

function resetState() {
  if (S.pdf) { try { S.pdf.destroy(); } catch {} }
  Object.assign(S, { kind: null, name: '', pdf: null, images: [], pageCount: 0, page: 1, boxes: {}, history: [], textLines: {}, suggestions: {}, meta: [] });
}

// ---------- rendering ----------
async function pageSize(i) {
  if (S.kind === 'pdf') { const p = await S.pdf.getPage(i); const v = p.getViewport({ scale: 1 }); return { w: v.width, h: v.height, page: p }; }
  const im = S.images[i - 1]; return { w: im.width, h: im.height };
}

async function drawPageTo(canvas, i, scale, gray) {
  const ps = await pageSize(i);
  canvas.width = Math.round(ps.w * scale); canvas.height = Math.round(ps.h * scale);
  const c = canvas.getContext('2d');
  c.fillStyle = '#fff'; c.fillRect(0, 0, canvas.width, canvas.height);
  if (S.kind === 'pdf') {
    await ps.page.render({ canvasContext: c, viewport: ps.page.getViewport({ scale }), annotationMode: pdfjsLib.AnnotationMode.DISABLE }).promise;
  } else {
    c.drawImage(S.images[i - 1], 0, 0, canvas.width, canvas.height);
  }
  if (gray) {
    const d = c.getImageData(0, 0, canvas.width, canvas.height), p = d.data;
    for (let k = 0; k < p.length; k += 4) { const y = (p[k] * 299 + p[k + 1] * 587 + p[k + 2] * 114) / 1000; p[k] = p[k + 1] = p[k + 2] = y; }
    c.putImageData(d, 0, 0);
  }
  return canvas;
}

async function renderPage() {
  const base = 1.35 * S.zoom;
  await drawPageTo(el.page, S.page, base, false);
  el.overlay.width = el.page.width; el.overlay.height = el.page.height;
  el.wrap.style.width = el.page.width + 'px';
  el.pagenum.textContent = S.page; el.pagecount.textContent = S.pageCount;
  drawOverlay();
}

function drawOverlay(temp) {
  const W = el.overlay.width, H = el.overlay.height;
  octx.clearRect(0, 0, W, H);
  const boxes = S.boxes[S.page] || [];
  const fill = $('fillmode').value;
  for (const b of boxes) {
    octx.fillStyle = fill === 'white' ? 'rgba(255,255,255,.95)' : 'rgba(20,20,20,.8)';
    octx.fillRect(b.x * W, b.y * H, b.w * W, b.h * H);
    octx.strokeStyle = fill === 'white' ? '#999' : 'rgba(0,0,0,.9)'; octx.lineWidth = 1;
    octx.strokeRect(b.x * W + .5, b.y * H + .5, b.w * W, b.h * H);
  }
  if (temp) { octx.strokeStyle = '#c9a300'; octx.lineWidth = 2; octx.setLineDash([6, 4]); octx.strokeRect(temp.x, temp.y, temp.w, temp.h); octx.setLineDash([]); }
  const n = Object.values(S.boxes).reduce((a, l) => a + l.length, 0);
  el.boxcount.textContent = n;
}

// ---------- drawing boxes ----------
let drag = null;
function pos(e) { const r = el.overlay.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; }
el.overlay.addEventListener('pointerdown', e => {
  e.preventDefault(); el.overlay.setPointerCapture(e.pointerId);
  const p = pos(e);
  if (S.tool === 'erase') { eraseAt(p); return; }
  drag = { x0: p.x, y0: p.y };
});
el.overlay.addEventListener('pointermove', e => {
  if (!drag) return;
  const p = pos(e);
  drawOverlay({ x: Math.min(drag.x0, p.x), y: Math.min(drag.y0, p.y), w: Math.abs(p.x - drag.x0), h: Math.abs(p.y - drag.y0) });
});
el.overlay.addEventListener('pointerup', e => {
  if (!drag) return;
  const p = pos(e), W = el.overlay.width, H = el.overlay.height;
  const x = Math.min(drag.x0, p.x), y = Math.min(drag.y0, p.y), w = Math.abs(p.x - drag.x0), h = Math.abs(p.y - drag.y0);
  drag = null;
  if (w < 4 || h < 4) { drawOverlay(); return; }
  pushHistory();
  addBox(S.page, { x: x / W, y: y / H, w: w / W, h: h / H });
  drawOverlay();
});
function addBox(page, b) { (S.boxes[page] ||= []).push(clamp(b)); }
function clamp(b) { return { x: Math.max(0, b.x), y: Math.max(0, b.y), w: Math.min(1 - Math.max(0, b.x), b.w), h: Math.min(1 - Math.max(0, b.y), b.h) }; }
function eraseAt(p) {
  const W = el.overlay.width, H = el.overlay.height, list = S.boxes[S.page] || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const b = list[i];
    if (p.x >= b.x * W && p.x <= (b.x + b.w) * W && p.y >= b.y * H && p.y <= (b.y + b.h) * H) { pushHistory(); list.splice(i, 1); break; }
  }
  drawOverlay();
}
function pushHistory() { S.history.push(JSON.stringify(S.boxes)); if (S.history.length > 100) S.history.shift(); }

$('toolBox').onclick = () => setTool('box');
$('toolErase').onclick = () => setTool('erase');
function setTool(tl) { S.tool = tl; $('toolBox').classList.toggle('active', tl === 'box'); $('toolErase').classList.toggle('active', tl === 'erase'); el.overlay.classList.toggle('erase', tl === 'erase'); }
$('undo').onclick = () => { const h = S.history.pop(); if (h) { S.boxes = JSON.parse(h); drawOverlay(); } };
$('clearAll').onclick = () => { if (confirm(t('confirm_clear'))) { pushHistory(); S.boxes = {}; drawOverlay(); } };
$('fillmode').onchange = () => drawOverlay();
$('prev').onclick = () => { if (S.page > 1) { S.page--; renderPage(); } };
$('next').onclick = () => { if (S.page < S.pageCount) { S.page++; renderPage(); } };
el.zoom.oninput = () => { S.zoom = parseFloat(el.zoom.value); renderPage(); };
$('close').onclick = () => { resetState(); el.editor.classList.add('hidden'); el.start.classList.remove('hidden'); el.file.value = ''; };
document.addEventListener('keydown', e => {
  if (el.editor.classList.contains('hidden')) return;
  if ((e.ctrlKey || e.metaKey) && e.key === 'z') { e.preventDefault(); $('undo').click(); }
  if (e.key === 'ArrowRight' && e.target.tagName !== 'INPUT') $('next').click();
  if (e.key === 'ArrowLeft' && e.target.tagName !== 'INPUT') $('prev').click();
});

// ---------- text scanning for suggestions ----------
async function scanText() {
  S.suggestions = {};
  for (const p of PATTERNS) S.suggestions[p.key] = [];
  if (S.kind !== 'pdf') { renderPatternList(); return; }
  for (let i = 1; i <= S.pageCount; i++) {
    const page = await S.pdf.getPage(i);
    const vp = page.getViewport({ scale: 1 });
    const tc = await page.getTextContent({ includeMarkedContent: false }).catch(() => ({ items: [] }));
    // group items into lines by baseline
    const items = tc.items.filter(it => it.str && it.str.trim()).map(it => {
      const [a, b, c, d, e, f] = it.transform;
      const h = Math.hypot(c, d) || it.height || 10;
      const fam = (tc.styles && tc.styles[it.fontName] && tc.styles[it.fontName].fontFamily) || 'sans-serif';
      return { str: it.str, x: e / vp.width, y: 1 - (f + h * 0.95) / vp.height, w: (it.width || Math.hypot(a, b) * it.str.length * .5) / vp.width, h: (h * 1.15) / vp.height, base: f, font: `${h}px ${fam}` };
    });
    items.sort((p, q) => (Math.abs(p.base - q.base) > 3 ? q.base - p.base : p.x - q.x));
    const lines = [];
    for (const it of items) {
      const last = lines[lines.length - 1];
      if (last && Math.abs(last.base - it.base) <= 3) { last.items.push(it); } else lines.push({ base: it.base, items: [it] });
    }
    for (const ln of lines) {
      let text = '', spans = [];
      for (const it of ln.items) {
        if (text && !text.endsWith(' ')) text += ' ';
        spans.push({ it, start: text.length, end: text.length + it.str.length });
        text += it.str;
      }
      for (const p of PATTERNS) {
        p.re.lastIndex = 0; let m;
        while ((m = p.re.exec(text))) {
          if (p.key === 'card' && !luhnish(m[0])) continue;
          if (p.key === 'iban' && !ibanish(m[0])) continue;
          const ms = m.index, me = m.index + m[0].length;
          for (const sp of spans) {
            const s = Math.max(ms, sp.start), e = Math.min(me, sp.end);
            if (e <= s) continue;
            const { fx, fw } = fraction(sp.it, s - sp.start, e - sp.start);
            S.suggestions[p.key].push({ page: i, x: sp.it.x + fx * sp.it.w, y: sp.it.y, w: fw * sp.it.w, h: sp.it.h, text: m[0] });
          }
          if (m[0].length === 0) p.re.lastIndex++;
        }
      }
    }
  }
  renderPatternList();
}
// Horizontal position of a substring inside a text run, measured with the run's font
// so that proportional glyph widths are respected (an "i" is narrower than an "m").
const measureCtx = document.createElement('canvas').getContext('2d');
function fraction(it, a, b) {
  measureCtx.font = it.font;
  const full = measureCtx.measureText(it.str).width || 1;
  const pre = measureCtx.measureText(it.str.slice(0, a)).width;
  const mid = measureCtx.measureText(it.str.slice(a, b)).width;
  return { fx: pre / full, fw: mid / full };
}
function luhnish(s) { const d = s.replace(/\D/g, ''); if (d.length < 13) return false; let sum = 0, alt = false; for (let i = d.length - 1; i >= 0; i--) { let n = +d[i]; if (alt) { n *= 2; if (n > 9) n -= 9; } sum += n; alt = !alt; } return sum % 10 === 0; }
function ibanish(s) { const c = s.replace(/[\s-]/g, ''); return c.length >= 15 && c.length <= 34 && /^[A-Z]{2}\d{2}/.test(c); }

function renderPatternList() {
  el.patterns.innerHTML = '';
  for (const p of PATTERNS) {
    const n = (S.suggestions[p.key] || []).length;
    const lab = document.createElement('label');
    const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = p.on; cb.dataset.key = p.key; cb.disabled = n === 0;
    const span = document.createElement('span'); span.textContent = t(p.label);
    const cnt = document.createElement('span'); cnt.className = 'n'; cnt.textContent = n;
    lab.append(cb, span, cnt); el.patterns.append(lab);
  }
}
$('applyAuto').onclick = () => {
  pushHistory();
  const m = parseInt($('margin').value, 10) || 0;
  const W = el.overlay.width || 800, H = el.overlay.height || 1100;
  let added = 0;
  el.patterns.querySelectorAll('input:checked').forEach(cb => {
    for (const s of S.suggestions[cb.dataset.key] || []) {
      addBox(s.page, { x: s.x - m / W, y: s.y - m / H, w: s.w + 2 * m / W, h: s.h + 2 * m / H }); added++;
    }
  });
  drawOverlay();
  if (!added) alert(t('no_suggestions'));
};

// ---------- export ----------
function burn(c, page, scale) {
  // Paint the redaction boxes into the real pixels. After this there is no way back.
  const x = c.getContext('2d'), W = c.width, H = c.height, mode = $('fillmode').value;
  for (const b of S.boxes[page] || []) {
    const bx = Math.floor(b.x * W), by = Math.floor(b.y * H), bw = Math.ceil(b.w * W) + 1, bh = Math.ceil(b.h * H) + 1;
    if (mode === 'noise') {
      const d = x.createImageData(bw, bh); crypto.getRandomValues(d.data);
      for (let k = 3; k < d.data.length; k += 4) d.data[k] = 255;
      x.putImageData(d, bx, by);
    } else { x.fillStyle = mode === 'white' ? '#fff' : '#000'; x.fillRect(bx, by, bw, bh); }
  }
  return c;
}

async function renderAllForExport() {
  const dpi = parseInt($('dpi').value, 10), gray = $('gray').checked, out = [];
  for (let i = 1; i <= S.pageCount; i++) {
    const ps = await pageSize(i);
    // PDF units are 1/72 inch; images are treated as 150 dpi scans by default.
    const scale = S.kind === 'pdf' ? dpi / 72 : Math.max(1, dpi / 150);
    const c = document.createElement('canvas');
    await drawPageTo(c, i, scale, gray);
    burn(c, i, scale);
    out.push({ canvas: c, wPt: S.kind === 'pdf' ? ps.w : c.width * 72 / dpi, hPt: S.kind === 'pdf' ? ps.h : c.height * 72 / dpi });
  }
  return out;
}

function download(blob, name) {
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}
function outName(ext) { return S.name.replace(/\.[^.]+$/, '') + '-redacted.' + ext; }

$('exportPng').onclick = async () => {
  busy(true);
  try {
    const pages = await renderAllForExport();
    for (let i = 0; i < pages.length; i++) {
      const blob = await new Promise(r => pages[i].canvas.toBlob(r, 'image/png'));
      download(blob, pages.length > 1 ? outName(`p${i + 1}.png`) : outName('png'));
      await new Promise(r => setTimeout(r, 300));
    }
  } finally { busy(false); }
};

$('exportPdf').onclick = async () => {
  busy(true);
  try {
    const pages = await renderAllForExport();
    const jpegs = [];
    for (const p of pages) {
      const blob = await new Promise(r => p.canvas.toBlob(r, 'image/jpeg', 0.88));
      jpegs.push({ bytes: new Uint8Array(await blob.arrayBuffer()), w: p.canvas.width, h: p.canvas.height, wPt: p.wPt, hPt: p.hPt });
    }
    download(new Blob([buildImagePdf(jpegs)], { type: 'application/pdf' }), outName('pdf'));
  } finally { busy(false); }
};

// Minimal PDF writer: one JPEG per page, nothing else. No /Info, no /ID, no /Metadata,
// no text, no fonts. Intentionally boring so that it can be audited by reading it.
function buildImagePdf(jpegs) {
  const enc = new TextEncoder(), parts = [], offsets = [];
  let pos = 0;
  const push = (x) => { const b = typeof x === 'string' ? enc.encode(x) : x; parts.push(b); pos += b.length; };
  push('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n');
  const objs = [];           // index -> function that pushes the object body
  const n = jpegs.length;
  // 1 catalog, 2 pages, then per page: page(3+3i), image(4+3i), content(5+3i)
  objs.push(() => push('<< /Type /Catalog /Pages 2 0 R >>'));
  objs.push(() => push(`<< /Type /Pages /Count ${n} /Kids [${jpegs.map((_, i) => `${3 + 3 * i} 0 R`).join(' ')}] >>`));
  jpegs.forEach((j, i) => {
    const pg = 3 + 3 * i, im = 4 + 3 * i, ct = 5 + 3 * i;
    objs.push(() => push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${j.wPt.toFixed(2)} ${j.hPt.toFixed(2)}] /Resources << /XObject << /Im0 ${im} 0 R >> >> /Contents ${ct} 0 R >>`));
    objs.push(() => { push(`<< /Type /XObject /Subtype /Image /Width ${j.w} /Height ${j.h} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${j.bytes.length} >>\nstream\n`); push(j.bytes); push('\nendstream'); });
    const content = `q ${j.wPt.toFixed(2)} 0 0 ${j.hPt.toFixed(2)} 0 0 cm /Im0 Do Q`;
    objs.push(() => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`));
  });
  objs.forEach((fn, i) => { offsets.push(pos); push(`${i + 1} 0 obj\n`); fn(); push('\nendobj\n'); });
  const xref = pos;
  push(`xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`);
  for (const o of offsets) push(String(o).padStart(10, '0') + ' 00000 n \n');
  push(`trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const total = parts.reduce((a, b) => a + b.length, 0), out = new Uint8Array(total);
  let o = 0; for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

function busy(on) { document.body.style.cursor = on ? 'progress' : ''; ['exportPdf', 'exportPng'].forEach(id => $(id).disabled = on); }

// ---------- self-check: prove we are offline ----------
// If any fetch slipped through the CSP, this would fire; it exists so that auditors
// can see the intended behaviour in the console.
document.addEventListener('securitypolicyviolation', e => {
  console.warn('[Blackout] Blocked by CSP as intended:', e.violatedDirective, e.blockedURI);
});

// ---------- init ----------
(function initLang() {
  const nav = (navigator.language || 'en').slice(0, 2).toLowerCase();
  if (I18N[nav]) el.lang.value = nav;
  applyLang(el.lang.value);
})();
