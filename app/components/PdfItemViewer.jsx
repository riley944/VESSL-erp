'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SB } from '@/lib/supabase';
import { PDF_BUCKET, pdfFileNameOf, SIBLING_OUTLINE } from '@/lib/quotePdf';

// ── THE QUOTE'S OWN ROWS IN ITS PDF ─────────────────────────────────────────
// A quote imported from one item of a factory PDF remembers which (quotes.
// pdf_item, script 139): { page, anchor, item_name, anchors }. anchor is the
// words the item's name was read from -- in practice its first table row --
// and anchors[] has one { page, anchor } per price the import read, so a
// product quoted at two quantities or several sizes names every row. Rows
// saved before anchors existed have the one anchor only. This viewer opens the
// PDF at the item's page and outlines EVERY row it finds in the import amber.
//
// Rendered here with pdfjs-dist (bundled, worker included -- no CDN). The rows
// are found in the page's text, not drawn by the import: the text is grouped
// into lines, and for each anchor the run of one to four lines holding the
// most of its words (and every word of the item name) is the row. A price row
// that does not repeat the name -- a size listed under it -- is taken only on
// every one of at least three words of its anchor. Rows found twice (the name
// anchor and the first price are the same row) are drawn once.
//
// Each box spans the table -- the nearby lines with three or more separate
// pieces of text -- and the full height of its cell: up to the ruled line
// between this row and the next when the page draws one, else halfway to the
// next row's text (cellOf). Not found, the page opens anyway with a note.
//
// A quote whose pdf_item predates anchors[] gets, on its page, every table
// row naming the item as well as its anchor's row.
//
// A quote with a PDF but no pdf_item (imported before script 139) is looked
// for by its product name instead: every page is searched, whole words, case
// ignored -- every word of a name of one or two words, two thirds of a longer
// one. It opens at the page with the best match (the earliest on a tie) and
// outlines every table row there that names the product -- never a notes or
// packing line. No match, page 1 opens
// with "Item not located".
//
// Portalled to the body, so it sits above the quote form; every click stops
// at its root, since React still bubbles a portal's events to the rows and
// overlays it was opened from.

let pdfjsPromise = null;
function loadPdfjs() {
  if (!pdfjsPromise) {
    // The worker as a webpack worker entry, so it is bundled and minified as
    // a module. Next 14 minifies a plain new URL() asset as a script, and the
    // build fails on its import and export.
    pdfjsPromise = import('pdfjs-dist/legacy/build/pdf.mjs').then((m) => {
      if (!m.GlobalWorkerOptions.workerPort) {
        // Bare Worker, not window.Worker -- webpack only bundles the bare form.
        // eslint-disable-next-line no-undef
        m.GlobalWorkerOptions.workerPort = new Worker(new URL('pdfjs-dist/legacy/build/pdf.worker.mjs', import.meta.url), { type: 'module' });
      }
      return m;
    }).catch((e) => { pdfjsPromise = null; throw e; });
  }
  return pdfjsPromise;
}

const words = (s) => String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// The page's text as lines, in viewport pixels, top to bottom.
function linesOf(items, viewport, Util) {
  const runs = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const tx = Util.transform(viewport.transform, it.transform);
    const h = Math.hypot(tx[2], tx[3]) || 10;
    const x0 = tx[4], x1 = tx[4] + it.width * viewport.scale, y1 = tx[5], y0 = tx[5] - h;
    runs.push({ str: it.str, x0, x1, y0, y1, h });
  }
  runs.sort((a, b) => a.y1 - b.y1 || a.x0 - b.x0);
  const lines = [];
  for (const r of runs) {
    const ln = lines.find((l) => Math.abs(l.y1 - r.y1) < Math.min(l.h, r.h) * 0.5);
    if (ln) {
      ln.runs.push(r);
      ln.x0 = Math.min(ln.x0, r.x0); ln.x1 = Math.max(ln.x1, r.x1);
      ln.y0 = Math.min(ln.y0, r.y0); ln.y1 = Math.max(ln.y1, r.y1); ln.h = Math.max(ln.h, r.h);
    } else lines.push({ runs: [r], x0: r.x0, x1: r.x1, y0: r.y0, y1: r.y1, h: r.h });
  }
  lines.sort((a, b) => a.y1 - b.y1);
  for (const l of lines) {
    l.runs.sort((a, b) => a.x0 - b.x0);
    l.words = new Set(words(l.runs.map((r) => r.str).join(' ')));
  }
  return lines;
}

// The page's painted horizontal rules, in viewport pixels: [{ y, x0, x1 }].
// Read from the drawing operators -- lines and rectangle edges that are
// stroked or filled (a clipping path is not a rule) -- with the transforms
// they are drawn under.
function rulesOf(ol, viewport, pdfjs) {
  const { OPS, Util } = pdfjs;
  let ctm = [1, 0, 0, 1, 0, 0];
  const stack = [];
  let pending = [];
  const out = [];
  const pt = (x, y) => viewport.convertToViewportPoint(...Util.applyTransform([x, y], ctm));
  const seg = (xa, ya, xb, yb) => {
    const a = pt(xa, ya), b = pt(xb, yb);
    if (Math.abs(a[1] - b[1]) < 0.75 && Math.abs(a[0] - b[0]) > 8) pending.push({ y: (a[1] + b[1]) / 2, x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]) });
  };
  const paint = new Set([OPS.stroke, OPS.closeStroke, OPS.fill, OPS.eoFill, OPS.fillStroke, OPS.eoFillStroke, OPS.closeFillStroke, OPS.closeEOFillStroke]);
  for (let i = 0; i < ol.fnArray.length; i++) {
    const fn = ol.fnArray[i], args = ol.argsArray[i];
    if (fn === OPS.save) stack.push(ctm);
    else if (fn === OPS.restore) ctm = stack.pop() || [1, 0, 0, 1, 0, 0];
    else if (fn === OPS.transform) ctm = Util.transform(ctm, args);
    else if (fn === OPS.constructPath) {
      const [ops, co] = args;
      let k = 0, cx = 0, cy = 0, sx = 0, sy = 0;
      for (const op of ops) {
        if (op === OPS.rectangle) {
          const [x, y, w, h] = co.slice(k, k + 4); k += 4;
          seg(x, y, x + w, y);
          if (Math.abs(h) > 0.5) seg(x, y + h, x + w, y + h);
        } else if (op === OPS.moveTo) { cx = sx = co[k]; cy = sy = co[k + 1]; k += 2; }
        else if (op === OPS.lineTo) { seg(cx, cy, co[k], co[k + 1]); cx = co[k]; cy = co[k + 1]; k += 2; }
        else if (op === OPS.curveTo) { cx = co[k + 4]; cy = co[k + 5]; k += 6; }
        else if (op === OPS.curveTo2 || op === OPS.curveTo3) { cx = co[k + 2]; cy = co[k + 3]; k += 4; }
        else if (op === OPS.closePath) { seg(cx, cy, sx, sy); cx = sx; cy = sy; }
      }
    } else if (paint.has(fn)) { out.push(...pending); pending = []; }
    else if (fn === OPS.endPath) pending = [];
  }
  return out;
}

// The table's width around rows from..to: the lines above and below that read
// as table rows (three or more separate pieces of text -- the header, the
// other items), walked out until one stands more than six lines from the
// last. Rows can stand far apart (a picture column has no text), so a line of
// fewer pieces is passed over rather than ending the walk.
function tableBox(lines, from0, to0) {
  // The whole row first: a cell that wraps puts the row's other cells on
  // lines that overlap it vertically (centred against it), so lines touching
  // the run join it until one stands clear.
  let from = from0, to = to0;
  const near = (a, b) => b.y0 - a.y1 < Math.min(a.h, b.h) * 0.25;
  while (from > 0 && near(lines[from - 1], lines[from])) from--;
  while (to < lines.length - 1 && near(lines[to], lines[to + 1])) to++;
  const rows = lines.slice(from, to + 1);
  const box = { x0: Math.min(...rows.map((l) => l.x0)), x1: Math.max(...rows.map((l) => l.x1)),
                y0: Math.min(...rows.map((l) => l.y0)), y1: Math.max(...rows.map((l) => l.y1)), from, to };
  const tabular = (l) => l.runs.length >= 3;
  const walk = (k, step) => {
    let edge = step < 0 ? box.y0 : box.y1;
    for (; k >= 0 && k < lines.length; k += step) {
      const l = lines[k];
      if (!tabular(l)) continue;
      if ((step < 0 ? edge - l.y1 : l.y0 - edge) > l.h * 6) return;
      box.x0 = Math.min(box.x0, l.x0); box.x1 = Math.max(box.x1, l.x1);
      edge = step < 0 ? l.y0 : l.y1;
    }
  };
  walk(from - 1, -1);
  walk(to + 1, 1);
  return box;
}

// The row's cell, top to bottom: from its text out to the ruled line between
// it and the neighbouring row's text when there is one under most of the box,
// else halfway to that text. Never more than the row's own height (or two
// lines) each way, so a row at the end of a table does not swallow the page.
function cellOf(box, lines, rules) {
  const hgt = box.y1 - box.y0;
  const lineH = lines[box.from] ? lines[box.from].h : 10;
  const reach = Math.max(hgt, lineH * 2);
  const under = (r) => Math.min(r.x1, box.x1) - Math.max(r.x0, box.x0) >= (box.x1 - box.x0) * 0.5;
  const prev = lines[box.from - 1], next = lines[box.to + 1];
  const lo = prev ? prev.y1 - 1 : box.y0 - reach;
  const hi = next ? next.y0 + 1 : box.y1 + reach;
  const above = rules.filter((r) => r.y >= lo && r.y <= box.y0 + 1 && under(r)).sort((a, b) => b.y - a.y)[0];
  const below = rules.filter((r) => r.y <= hi && r.y >= box.y1 - 1 && under(r)).sort((a, b) => a.y - b.y)[0];
  const top = above ? above.y : prev ? (prev.y1 + box.y0) / 2 : box.y0 - 3;
  const bottom = below ? below.y : next ? (box.y1 + next.y0) / 2 : box.y1 + 3;
  return { ...box, y0: Math.max(top, box.y0 - reach), y1: Math.min(bottom, box.y1 + reach), ruled: !!(above && below) };
}

// The run of one to four lines that is the anchor's row, or null. mode:
//   'item'   every word of itemName in the run, scored on the anchor's words
//   'strict' no name needed, but every word of an anchor of three or more
const GAP_LINES = 2;
function findRow(lines, anchor, itemName, mode = 'item') {
  const key = [...new Set(words(anchor))];
  const name = mode === 'item' ? [...new Set(words(itemName))] : [];
  if (!key.length || (mode === 'strict' && key.length < 3)) return null;
  const need = mode === 'strict' ? 1 : 0.5;
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const seen = new Set();
    for (let w = 1; w <= 4 && i + w <= lines.length; w++) {
      const l = lines[i + w - 1];
      // A gap of more than two lines is the next row, not this one wrapping.
      if (w > 1 && l.y0 - lines[i + w - 2].y1 > l.h * GAP_LINES) break;
      l.words.forEach((x) => seen.add(x));
      if (name.length && !name.every((x) => seen.has(x))) continue;
      const hit = key.filter((x) => seen.has(x)).length / key.length;
      if (hit < need) continue;
      const score = hit - 0.02 * (w - 1);
      if (!best || score > best.score) best = { score, from: i, to: i + w - 1 };
    }
  }
  return best ? { ...tableBox(lines, best.from, best.to), score: best.score } : null;
}

// Every TABLE row naming the product: whole words, case ignored; every word
// of a name of one or two words, two thirds of a longer one. A row starts on a
// line holding one of the name's words and is the shortest run (up to four
// lines) that reaches the mark, grown to its whole row; the search goes on
// after it. Only a row with a line of three or more separate pieces of text
// counts -- a table row, not a notes or packing line that mentions the product.
function rowsByName(lines, productName) {
  const name = [...new Set(words(productName))];
  if (!name.length) return [];
  const need = name.length <= 2 ? 1 : 2 / 3;
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    if (!name.some((x) => lines[i].words.has(x))) continue;
    const seen = new Set();
    for (let w = 1; w <= 4 && i + w <= lines.length; w++) {
      const l = lines[i + w - 1];
      if (w > 1 && l.y0 - lines[i + w - 2].y1 > l.h * GAP_LINES) break;
      l.words.forEach((x) => seen.add(x));
      const hit = name.filter((x) => seen.has(x)).length / name.length;
      if (hit >= need) {
        const b = tableBox(lines, i, i + w - 1);
        if (lines.slice(b.from, b.to + 1).some((x) => x.runs.length >= 3)) out.push({ ...b, score: hit - 0.02 * (w - 1) });
        i = b.to;
        break;
      }
    }
  }
  return out;
}

// One box per row: two boxes over the same row (more than half the shorter
// one) become their union.
function mergeBoxes(boxes) {
  const out = [];
  for (const b of [...boxes].sort((a, c) => a.y0 - c.y0)) {
    const o = out.find((x) => Math.min(x.y1, b.y1) - Math.max(x.y0, b.y0) > Math.min(x.y1 - x.y0, b.y1 - b.y0) * 0.5);
    if (o) { o.x0 = Math.min(o.x0, b.x0); o.x1 = Math.max(o.x1, b.x1); o.y0 = Math.min(o.y0, b.y0); o.y1 = Math.max(o.y1, b.y1); }
    else out.push({ ...b });
  }
  return out;
}

// The item's anchors: the name's row, then one per price; old rows have only
// the first. Same page and words once.
function anchorsOf(item) {
  if (!item) return [];
  const all = [{ page: Number(item.page) || 1, anchor: item.anchor },
               ...(Array.isArray(item.anchors) ? item.anchors : []).map((a) => ({ page: Number(a && a.page) || Number(item.page) || 1, anchor: a && a.anchor }))];
  const seen = new Set();
  return all.filter((a) => {
    const k = a.page + '|' + String(a.anchor || '').trim();
    if (!String(a.anchor || '').trim() || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export function PdfItemViewer({ path, item, productName = '', onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const docRef = useRef(null);
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, Number(item && item.page) || 1));
  const [boxes, setBoxes] = useState([]);
  const [note, setNote] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(true);
  // With an item, its page. Without, the page the name search settles on --
  // null until it has, so nothing is outlined before then.
  const [targetPage, setTargetPage] = useState(item ? Math.max(1, Number(item.page) || 1) : null);
  const byName = !item;
  const label = (item && item.item_name) || productName || '';

  // Escape closes this and nothing under it.
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') { e.stopImmediatePropagation(); e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [onClose]);

  // The document, once.
  useEffect(() => {
    let dead = false;
    (async () => {
      const { data, error } = await SB.storage.from(PDF_BUCKET).createSignedUrl(path, 600);
      if (dead) return;
      if (error || !data) { setErr('Could not open the PDF: ' + (error ? error.message : 'no link')); setBusy(false); return; }
      setUrl(data.signedUrl);
      try {
        const pdfjs = await loadPdfjs();
        const doc = await pdfjs.getDocument({ url: data.signedUrl, isEvalSupported: false }).promise;
        if (dead) { doc.destroy(); return; }
        docRef.current = doc;
        if (byName) {
          // Every page's text at scale 1, the best match kept; a later page
          // has to beat an earlier one, not tie it.
          let found = null;
          if (words(productName).length) {
            for (let n = 1; n <= doc.numPages && !dead; n++) {
              const pg = await doc.getPage(n);
              const lines = linesOf((await pg.getTextContent()).items, pg.getViewport({ scale: 1 }), pdfjs.Util);
              const best = Math.max(-1, ...rowsByName(lines, productName).map((r) => r.score));
              if (best >= 0 && (!found || best > found.score)) found = { page: n, score: best };
            }
          }
          if (dead) { doc.destroy(); docRef.current = null; return; }
          const at = found ? found.page : 1;
          if (!found) setNote(productName.trim() ? 'Item not located — no page of this PDF names “' + productName.trim() + '”.' : 'Item not located — this quote has no product name to look for.');
          setPage(at);
          setTargetPage(at);
        }
        setPages(doc.numPages);
        if (!byName && targetPage > doc.numPages) { setNote('The PDF has ' + doc.numPages + ' page' + (doc.numPages === 1 ? '' : 's') + '; the item was read from page ' + targetPage + '.'); setPage(doc.numPages); }
      } catch (e) {
        console.error('PDF viewer', e);
        if (!dead) { setErr('Could not render the PDF: ' + ((e && e.message) || String(e))); setBusy(false); }
      }
    })();
    return () => { dead = true; if (docRef.current) { docRef.current.destroy(); docRef.current = null; } };
  // Once per PDF: the target page is worked out here, not read from it.
  }, [path]);

  // The page, drawn to the width there is; on it, every row of the item (or
  // naming the product) that is found.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pages || targetPage == null) return;
    let dead = false;
    let task = null;
    (async () => {
      setBusy(true);
      setBoxes([]);
      try {
        const pdfjs = await loadPdfjs();
        const p = await doc.getPage(page);
        const width = Math.min(900, (wrapRef.current && wrapRef.current.clientWidth) || 800);
        const viewport = p.getViewport({ scale: width / p.getViewport({ scale: 1 }).width });
        const dpr = window.devicePixelRatio || 1;
        const c = canvasRef.current;
        if (!c || dead) return;
        c.width = Math.floor(viewport.width * dpr); c.height = Math.floor(viewport.height * dpr);
        c.style.width = viewport.width + 'px'; c.style.height = viewport.height + 'px';
        task = p.render({ canvasContext: c.getContext('2d'), viewport, transform: dpr === 1 ? null : [dpr, 0, 0, dpr, 0, 0] });
        await task.promise;
        if (dead) return;
        const anchors = byName ? [] : anchorsOf(item).filter((a) => a.page === page);
        // Saved before anchors[] existed: the one anchor names the first row
        // only, so on the item's page the table rows naming the item are added
        // -- a product at two quantities still shows both.
        const legacy = !byName && !(Array.isArray(item.anchors) && item.anchors.length) && page === targetPage;
        if (!byName && !anchors.length && !legacy) {
          if (page === targetPage) setNote((n) => n || 'Item not located on page ' + page + ' — check the page for “' + (label || 'the item') + '”.');
          return;
        }
        const lines = linesOf((await p.getTextContent()).items, viewport, pdfjs.Util);
        let found = byName
          ? rowsByName(lines, productName)
          : anchors.map((a) => findRow(lines, a.anchor, item.item_name) || findRow(lines, a.anchor, '', 'strict')).filter(Boolean)
              .concat(legacy ? rowsByName(lines, item.item_name || productName) : []);
        // The ruled lines only when there is a row to fit -- reading the
        // drawing is the slow part.
        if (found.length) {
          let rules = [];
          try { rules = rulesOf(await p.getOperatorList(), viewport, pdfjs); } catch (e) { rules = []; }
          found = mergeBoxes(found.map((b) => cellOf(b, lines, rules)));
        }
        if (dead) return;
        setBoxes(found);
        if (!found.length && page === targetPage) setNote((n) => n || 'Item not located on page ' + page + ' — check the page for “' + (label || 'the item') + '”.');
      } catch (e) {
        if (e && e.name === 'RenderingCancelledException') return;
        console.error('PDF viewer', e);
        if (!dead) setErr('Could not render page ' + page + ': ' + ((e && e.message) || String(e)));
      } finally { if (!dead) setBusy(false); }
    })();
    return () => { dead = true; if (task) task.cancel(); };
  }, [pages, page, targetPage, item, byName, productName, label]);

  const name = pdfFileNameOf(path) || 'PDF';
  const padX = 4;
  const btn = { background: 'transparent', color: '#2b3445', border: '1px solid #e7eaf0', borderRadius: 8, padding: '5px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' };
  const view = (
    <div onClick={(e) => { e.stopPropagation(); onClose(); }} onMouseDown={(e) => e.stopPropagation()}
      style={{ position: 'fixed', inset: 0, background: 'rgba(26,34,56,0.46)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'flex-start',
               justifyContent: 'center', padding: '36px 16px', zIndex: 70, overflowY: 'auto' }}>
      <div onClick={(e) => e.stopPropagation()}
        style={{ background: '#ffffff', borderRadius: 16, width: '100%', maxWidth: 960, boxShadow: '0 24px 60px rgba(11,21,48,0.22)', border: '1px solid #e7eaf0' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, padding: '14px 18px', borderBottom: '1px solid #e7eaf0' }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: '#0f1729', overflowWrap: 'anywhere' }}>{label || name}</div>
            <div style={{ fontSize: 12, color: '#6a7488', overflowWrap: 'anywhere' }}>{name}{pages ? ' · page ' + page + ' of ' + pages : ''}{boxes.length > 1 ? ' · ' + boxes.length + ' rows' : ''}</div>
          </div>
          {pages > 1 && (
            <span style={{ display: 'inline-flex', gap: 6 }}>
              <button type="button" style={{ ...btn, opacity: page > 1 ? 1 : 0.4 }} disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>Prev</button>
              <button type="button" style={{ ...btn, opacity: page < pages ? 1 : 0.4 }} disabled={page >= pages} onClick={() => setPage((n) => n + 1)}>Next</button>
              {targetPage && page !== targetPage && targetPage <= pages && <button type="button" style={btn} onClick={() => setPage(targetPage)}>Item page</button>}
            </span>
          )}
          {url && <a href={url} target="_blank" rel="noopener noreferrer" style={{ fontSize: 12.5, fontWeight: 600, color: '#3461e0' }}>Open in new tab</a>}
          <button type="button" style={btn} onClick={onClose}>Close</button>
        </div>
        {(note || err) && (
          <div style={{ padding: '8px 18px', fontSize: 12.5, color: err ? '#c0392b' : '#a66f12', background: err ? '#fdf1f0' : '#fdf6e9', borderBottom: '1px solid #e7eaf0' }}>{err || note}</div>
        )}
        <div ref={wrapRef} style={{ position: 'relative', padding: 16, display: 'flex', justifyContent: 'center', minHeight: 200 }}>
          <div style={{ position: 'relative', lineHeight: 0, boxShadow: '0 1px 4px rgba(11,21,48,0.12)' }}>
            <canvas ref={canvasRef} />
            {boxes.map((b, i) => (
              <div key={i} style={{ position: 'absolute', left: b.x0 - padX, top: b.y0 - 1, width: b.x1 - b.x0 + padX * 2, height: b.y1 - b.y0 + 2,
                                    border: '2px solid ' + SIBLING_OUTLINE, borderRadius: 4, background: 'rgba(211,154,44,0.08)', pointerEvents: 'none', boxSizing: 'border-box' }} />
            ))}
          </div>
          {busy && !err && <span style={{ position: 'absolute', top: 24, fontSize: 12.5, color: '#6a7488', lineHeight: 1.4 }}>{'Loading…'}</span>}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(view, document.body);
}
