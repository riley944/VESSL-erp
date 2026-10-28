'use client';
import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { SB } from '@/lib/supabase';
import { PDF_BUCKET, pdfFileNameOf, SIBLING_OUTLINE } from '@/lib/quotePdf';

// ── THE QUOTE'S OWN ROW IN ITS PDF ──────────────────────────────────────────
// A quote imported from one item of a factory PDF remembers which (quotes.
// pdf_item, script 139): { page, anchor, item_name }, anchor being the words
// the import read that item from -- in practice its table row. This viewer
// opens the PDF at that page and outlines the row in the import amber.
//
// Rendered here with pdfjs-dist (bundled, worker included -- no CDN). The row
// is found in the page's text, not drawn by the import: the text is grouped
// into lines, and the run of one to four lines holding the most of the
// anchor's words (and every word of the item name) is the row. The outline
// spans the table -- the nearby lines with three or more separate pieces of
// text -- or just the row when there are none. Not found, the page opens
// anyway with a note saying so.
//
// A quote with a PDF but no pdf_item (imported before script 139) is looked
// for by its product name instead: every page is searched, whole words, case
// ignored, and the best match wins -- every word of a name of one or two
// words, two thirds of a longer one; the earliest page on a tie. No match,
// page 1 opens with "Item not located".
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

// The box around the item's row, or null when the page does not have it.
// byName: the product name alone, with no anchor -- a partial match counts
// (see the top), and the score comes back so pages can be compared.
function findRow(lines, anchor, itemName, byName = false) {
  const want = byName ? [] : [...new Set(words(anchor))];
  const name = [...new Set(words(itemName))];
  const key = want.length ? want : name;
  if (!key.length) return null;
  const need = byName ? (name.length <= 2 ? 1 : 2 / 3) : 0.5;
  let best = null;
  for (let i = 0; i < lines.length; i++) {
    const seen = new Set();
    for (let w = 1; w <= 4 && i + w <= lines.length; w++) {
      const l = lines[i + w - 1];
      // A gap of more than two lines is the next row, not this one wrapping.
      if (w > 1 && l.y0 - lines[i + w - 2].y1 > l.h * 2) break;
      l.words.forEach((x) => seen.add(x));
      if (!byName && name.length && !name.every((x) => seen.has(x))) continue;
      const hit = key.filter((x) => seen.has(x)).length / key.length;
      if (hit < need) continue;
      const score = hit - 0.02 * (w - 1);
      if (!best || score > best.score) best = { score, from: i, to: i + w - 1 };
    }
  }
  if (!best) return null;
  const rows = lines.slice(best.from, best.to + 1);
  const box = { x0: Math.min(...rows.map((l) => l.x0)), x1: Math.max(...rows.map((l) => l.x1)),
                y0: Math.min(...rows.map((l) => l.y0)), y1: Math.max(...rows.map((l) => l.y1)) };
  // The table's width: the lines above and below that read as table rows
  // (three or more separate pieces of text -- the header, the other items),
  // walked out until one stands more than six lines from the last. Rows can
  // stand far apart (a picture column has no text), so a line of fewer pieces
  // is passed over rather than ending the walk.
  const tabular = (l) => l.runs.length >= 3;
  let x0 = box.x0, x1 = box.x1;
  const walk = (k, step) => {
    let edge = step < 0 ? box.y0 : box.y1;
    for (; k >= 0 && k < lines.length; k += step) {
      const l = lines[k];
      if (!tabular(l)) continue;
      if ((step < 0 ? edge - l.y1 : l.y0 - edge) > l.h * 6) return;
      x0 = Math.min(x0, l.x0); x1 = Math.max(x1, l.x1);
      edge = step < 0 ? l.y0 : l.y1;
    }
  };
  walk(best.from - 1, -1);
  walk(best.to + 1, 1);
  return { x0, x1, y0: box.y0, y1: box.y1, score: best.score };
}

export function PdfItemViewer({ path, item, productName = '', onClose }) {
  const wrapRef = useRef(null);
  const canvasRef = useRef(null);
  const docRef = useRef(null);
  const [url, setUrl] = useState('');
  const [pages, setPages] = useState(0);
  const [page, setPage] = useState(Math.max(1, Number(item && item.page) || 1));
  const [box, setBox] = useState(null);
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
              const hit = findRow(lines, '', productName, true);
              if (hit && (!found || hit.score > found.score)) found = { page: n, score: hit.score };
            }
          }
          if (dead) { doc.destroy(); docRef.current = null; return; }
          const at = found ? found.page : 1;
          if (!found) setNote(productName.trim() ? 'Item not located \u2014 no page of this PDF names \u201c' + productName.trim() + '\u201d.' : 'Item not located \u2014 this quote has no product name to look for.');
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

  // The page, drawn to the width there is; the row found on the item's page.
  useEffect(() => {
    const doc = docRef.current;
    if (!doc || !pages) return;
    let dead = false;
    let task = null;
    (async () => {
      setBusy(true);
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
        if (page === targetPage) {
          const text = await p.getTextContent();
          const lines = linesOf(text.items, viewport, pdfjs.Util);
          const found = byName ? findRow(lines, '', productName, true) : findRow(lines, item.anchor, item.item_name);
          if (dead) return;
          setBox(found);
          if (!found) setNote((n) => n || 'Item not located on page ' + page + ' \u2014 check the page for \u201c' + (label || 'the item') + '\u201d.');
        } else setBox(null);
      } catch (e) {
        if (e && e.name === 'RenderingCancelledException') return;
        console.error('PDF viewer', e);
        if (!dead) setErr('Could not render page ' + page + ': ' + ((e && e.message) || String(e)));
      } finally { if (!dead) setBusy(false); }
    })();
    return () => { dead = true; if (task) task.cancel(); };
  }, [pages, page, targetPage, item, byName, productName, label]);

  const name = pdfFileNameOf(path) || 'PDF';
  const pad = 4;
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
            <div style={{ fontSize: 12, color: '#6a7488', overflowWrap: 'anywhere' }}>{name}{pages ? ' · page ' + page + ' of ' + pages : ''}</div>
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
            {box && page === targetPage && (
              <div style={{ position: 'absolute', left: box.x0 - pad, top: box.y0 - pad, width: box.x1 - box.x0 + pad * 2, height: box.y1 - box.y0 + pad * 2,
                            border: '2px solid ' + SIBLING_OUTLINE, borderRadius: 4, background: 'rgba(211,154,44,0.08)', pointerEvents: 'none' }} />
            )}
          </div>
          {busy && !err && <span style={{ position: 'absolute', top: 24, fontSize: 12.5, color: '#6a7488', lineHeight: 1.4 }}>{'Loading…'}</span>}
        </div>
      </div>
    </div>
  );
  return typeof document === 'undefined' ? null : createPortal(view, document.body);
}
