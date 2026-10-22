import { effectiveQty } from '@/lib/tierCost';
import { sizeQuotedPrice } from '@/lib/quoteTiers';
import { sizesForSelection } from '@/app/components/SizeGrid';
import { csvField, csvGuard } from '@/lib/exportFormats';

// ── THE CLIENT PRICE SHEET ───────────────────────────────────────────────────
// What Send to Client produces: one company's products at their order
// quantities, at the delivered (DDP) price. DDP ONLY: clients never see freight,
// duty, EXW, margin or any cost (Riley, 21 Oct). There was a Breakdown view that
// split each price into product, freight and duty; it is gone, and nothing in
// this file reads a tier's freight or duty any more. The internal quote-card
// and Quote List exports are separate code and keep their own columns.
//
// One model, three formats. buildModel() turns the picked quotes into tables;
// toWorkbookSheet() describes it for lib/workbook.js (Excel), toHtml() writes
// the PDF page, toCsv() the CSV. Pure: no DOM, no network.
//
// TABLES BY QUANTITY SET. Products whose tiers are quoted at the same quantities
// share a table under one quantity header; a product with a different set starts
// its own. Any price that is missing reads "—".
//
// SIZES. A sized product whose sizes all share the tier price is one row. Where
// they do not, it is one row per run of adjacent sizes priced alike, named
// "Item — S–XL".

export const NOTE_DDP = 'Prices are per unit, delivered (DDP), in USD.';
export const NOTE_APPROVAL = 'Pricing is subject to final artwork and sample approval.';
export const CAPTION = 'PRICE PER UNIT BY ORDER QUANTITY';
const DASH = '—';

const r2 = n => Math.round(n * 100) / 100;
const usd = n => '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyLabel = n => Number(n).toLocaleString('en-US');
export const longDate = d => d.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
const esc = s => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// A quote's tiers that have a quantity, one per quantity (the first wins), in
// quantity order.
function tiersByQty(q) {
  const seen = new Map();
  (q.tiers || []).forEach(t => { const n = effectiveQty(t); if (n > 0 && !seen.has(n)) seen.set(n, t); });
  return [...seen.entries()].sort((a, b) => a[0] - b[0]);
}

// One quantity's cell: the delivered (client) price, and nothing else.
function cellFor(price) {
  return { delivered: Number(price) > 0 ? r2(Number(price)) : null };
}

// The rows one quote gives: one, or one per price band of its sizes.
function rowsFor(q, edit, qtys, tiers) {
  const base = {
    quoteId: q.id,
    style: q.sku || '',
    item: (edit && edit.item != null ? edit.item : q.product) || '',
    details: (edit && edit.details != null ? edit.details : q.clientDetails) || '',
    color: (edit && edit.color != null ? edit.color : q.clientColor) || '',
    casePack: Number(q.unitsPerCarton) > 0 ? Number(q.unitsPerCarton) + ' pcs' : '',
  };
  const byQty = new Map(tiers);
  const plain = () => [{ ...base, sizeRow: false,
    cells: qtys.map(n => (byQty.has(n) ? cellFor(byQty.get(n).client) : { delivered: null })) }];
  // Sizes that carry a quantity on any tier.
  const sizes = sizesForSelection(q.sizeScales || []).filter(e => tiers.some(([, t]) => Number((t.sizeQty || {})[e.key]) > 0));
  if (!sizes.length) return plain();
  const vec = e => qtys.map(n => {
    const t = byQty.get(n);
    if (!t) return null;
    const p = sizeQuotedPrice(t, e.key, (q.sizeDeltas || {})[e.key]);
    return p == null ? null : r2(p);
  });
  const baseVec = qtys.map(n => { const t = byQty.get(n); return t && Number(t.client) > 0 ? r2(Number(t.client)) : null; });
  const same = (a, b) => a.length === b.length && a.every((v, i) => v === b[i]);
  const vecs = sizes.map(vec);
  if (vecs.every(v => same(v, baseVec))) return plain();
  // Adjacent sizes priced alike, as bands.
  const bands = [];
  sizes.forEach((e, i) => {
    const last = bands[bands.length - 1];
    if (last && same(last.vec, vecs[i])) last.to = e.label;
    else bands.push({ from: e.label, to: e.label, vec: vecs[i] });
  });
  return bands.map(b => ({ ...base, sizeRow: true,
    item: base.item + ' — ' + (b.from === b.to ? b.from : b.from + '–' + b.to),
    cells: b.vec.map(p => ({ delivered: p })) }));
}

// quotes: the picked quotes, as rowToForm gives them. edits: { [quoteId]:
// { item, details, color } } from the settings step. header: the editable
// fields.
export function buildModel({ quotes, edits = {}, header, payment = null }) {
  const sorted = [...quotes].sort((a, b) => (a.sku || '').localeCompare(b.sku || '', undefined, { numeric: true })
    || (a.product || '').localeCompare(b.product || ''));
  const tables = [];
  const byKey = new Map();
  sorted.forEach(q => {
    const tiers = tiersByQty(q);
    const qtys = tiers.map(([n]) => n);
    const key = qtys.join('/');
    if (!byKey.has(key)) { const t = { qtys, rows: [] }; byKey.set(key, t); tables.push(t); }
    byKey.get(key).rows.push(...rowsFor(q, edits[q.id], qtys, tiers));
  });
  return { header, tables, payment };
}

const signoffLine = s => [s.name, s.title, s.company].map(v => (v || '').trim()).filter(Boolean).join('  |  ');
const notesOf = m => (m.header.notes || []).map(n => (n || '').trim()).filter(Boolean);
const paymentLines = m => (m.payment ? [
  ...(m.payment.vendor ? ['Vendor #' + m.payment.vendor] : []),
  ...(m.payment.bank || []).map(([k, v]) => k + ': ' + String(v).replace(/\n/g, ', ')),
] : []);

// ── Excel ────────────────────────────────────────────────────────────────────
// logo: { base64, width, height } for the KUI logo under the sign-off, or null.
export function toWorkbookSheet(m, logo = null) {
  const lead = [{ h: 'STYLE #', w: 12, kind: 'style' }, { h: 'ITEM', w: 26, kind: 'item' }, { h: 'DETAILS', w: 32, kind: 'muted' }, { h: 'COLOR', w: 18, kind: 'text' }];
  const blocks = m.tables.map(t => {
    const lc = r => [r.style, r.item, r.details, r.color];
    const cols = [...lead, ...t.qtys.map(n => ({ h: qtyLabel(n), w: 11, kind: 'price' })), { h: 'CASE PACK', w: 11, kind: 'center' }];
    return { caption: t.qtys.length ? CAPTION : '', cols, rows: t.rows.map(r => [...lc(r), ...r.cells.map(c => c.delivered), r.casePack]) };
  });
  const pay = m.payment ? [
    ...(m.payment.vendor ? [['Vendor #', String(m.payment.vendor)]] : []),
    ...(m.payment.bank || []).map(([k, v]) => [k, String(v).replace(/\n/g, ', ')]),
  ] : [];
  return { name: 'Pricing', title: 'PRICE SHEET', programme: m.header.programme, company: m.header.company,
    details: [['Prepared for', m.header.company], ['Date', m.header.date], ['Program', m.header.programme],
              ['Your contact', ((m.header.signoff || {}).name || '').trim()]],
    blocks, notes: notesOf(m), payment: pay, signoff: signoffLine(m.header.signoff || {}), logo };
}

// ── CSV ──────────────────────────────────────────────────────────────────────
// One row per product per quantity. A missing price is blank, and Note says so.
export function toCsv(m) {
  const head = ['Style #', 'Item', 'Details', 'Color', 'Case Pack', 'Quantity', 'Delivered (DDP)', 'Note'];
  const lines = [head];
  const n2 = v => (typeof v === 'number' ? v.toFixed(2) : '');
  m.tables.forEach(t => t.rows.forEach(r => t.qtys.forEach((q, i) => {
    const c = r.cells[i] || {};
    lines.push([r.style, r.item, r.details, r.color, r.casePack, String(q), n2(c.delivered), c.delivered == null ? 'not priced' : '']);
  })));
  return lines.map(row => row.map((v, i) => csvField(csvGuard(String(v), i < 6 || i === row.length - 1))).join(',')).join('\r\n');
}

// ── PDF (a page to print) ────────────────────────────────────────────────────
// Black and white: a solid black band with the company (left), the date
// (centered) and the program (right) in white; header rows solid black with
// white text; outlined tables, white / light grey rows; the KUI logo under the
// sign-off.
// logo: a data URL (the image the SO confirmation uses), or '' for none.
export function toHtml(m, logo = '') {
  const money = v => (typeof v === 'number' ? usd(v) : v == null ? DASH : esc(v));
  const lead = r => `<td class="style">${esc(r.style)}</td><td class="item">${esc(r.item)}</td><td class="muted">${esc(r.details)}</td><td>${esc(r.color)}</td>`;
  const LEAD_H = '<th class="l">Style #</th><th class="l">Item</th><th class="l">Details</th><th class="l">Color</th>';
  const blocks = m.tables.map(t => {
    if (!t.qtys.length) {
      return `<table><thead><tr>${LEAD_H}<th>Case Pack</th></tr></thead><tbody>${t.rows.map(r => `<tr>${lead(r)}<td class="c muted">${esc(r.casePack)}</td></tr>`).join('')}</tbody></table>`;
    }
    return `<div class="cap">${CAPTION}</div><table><thead><tr>${LEAD_H}${t.qtys.map(q => `<th>${qtyLabel(q)}</th>`).join('')}<th>Case Pack</th></tr></thead><tbody>
      ${t.rows.map(r => `<tr>${lead(r)}${r.cells.map(c => `<td class="p">${money(c.delivered)}</td>`).join('')}<td class="c muted">${esc(r.casePack)}</td></tr>`).join('')}
      </tbody></table>`;
  }).join('<div class="gap"></div>');
  const h = m.header;
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(h.company)} — ${esc(h.programme)}</title>
  <style>
    @page { size: letter landscape; margin: 0.4in; }
    * { box-sizing: border-box; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    body { font-family: -apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #000; margin: 0; background: #fff; }
    .sheet { padding: 18px 8px; }
    .band { background: #000; color: #fff; display: flex; align-items: center; gap: 24px; padding: 14px 18px; margin-bottom: 18px; }
    .band .co { font-size: 30px; font-weight: 700; letter-spacing: .01em; line-height: 1.1; }
    .band .dt { flex: 1; text-align: center; font-size: 13px; }
    .band .prog { font-size: 13px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
    .cap { font-size: 9px; font-weight: 700; letter-spacing: .08em; text-align: right; margin: 0 2px 4px; color: #000; }
    table { width: 100%; border-collapse: collapse; font-size: 11.5px; border: 1px solid #000; }
    thead th { background: #000; color: #fff; font-size: 9.5px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; padding: 8px 8px; text-align: center; }
    thead th.l { text-align: left; }
    tbody td { padding: 10px 8px; border-bottom: 1px solid #d9d9d9; vertical-align: middle; }
    tbody tr:nth-child(even) td { background: #f6f6f6; }
    tbody tr:last-child td { border-bottom: 1px solid #000; }
    td.style { color: #000; font-weight: 700; white-space: nowrap; }
    td.item { font-weight: 700; }
    td.muted, .muted { color: #555; }
    td.p { text-align: center; font-weight: 700; font-size: 12.5px; font-variant-numeric: tabular-nums; white-space: nowrap; }
    td.c { text-align: center; white-space: nowrap; }
    td.l { text-align: left; }
    .gap { height: 18px; }
    .notes { margin-top: 16px; font-size: 10.5px; color: #555; line-height: 1.6; }
    .sign { margin-top: 18px; font-size: 10.5px; font-weight: 700; }
    .logo { margin-top: 10px; }
    .logo img { width: 120px; height: auto; display: block; }
  </style></head><body><div class="sheet">
    <div class="band"><div class="co">${esc(h.company)}</div><div class="dt">${esc(h.date)}</div><div class="prog">${esc(h.programme)}</div></div>
    ${blocks || '<div class="muted">No quotes picked.</div>'}
    <div class="notes">${notesOf(m).map(esc).join('<br>')}${paymentLines(m).length ? '<br><br>' + paymentLines(m).map(esc).join('<br>') : ''}</div>
    ${signoffLine(h.signoff || {}) ? `<div class="sign">${esc(signoffLine(h.signoff || {}))}</div>` : ''}
    ${logo ? `<div class="logo"><img src="${logo}" alt="King Universal"></div>` : ''}
  </div><script>window.onload = function(){ setTimeout(function(){ window.print(); }, 300); }</script></body></html>`;
}
