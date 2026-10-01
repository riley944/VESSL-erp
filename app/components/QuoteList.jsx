'use client';
import { useState, useEffect, useMemo } from 'react';
import { SB } from '@/lib/supabase';
import { FilterSelect } from '@/app/components/FilterSelect';
import { ExportButton } from '@/app/components/ExportButton';
import { loadExcelJS, excelDate } from '@/lib/excel';
import { usePageState } from '@/lib/pageState';
import { buildListDoc, showListDoc, logoDataUrl } from '@/lib/listDoc';

// ── QUOTE LIST ──────────────────────────────────────────────────────────────
// Every quote in one flat, read-only list on the Quotes page, behind the same
// pill switcher the Codes page uses. One row per quote -- a quote holds one
// product (vessl.quotes has a single sku and product; tiers are price breaks and
// size_scale the sizes of that product).
//
// WHERE EACH COLUMN COMES FROM
//   SKU, Product Name   quotes.sku, quotes.product
//   Created             quotes.created_at, shown as the app shows dates
//   Company             the linked client company (client_company_id ->
//                       companies.name), else the typed quotes.client
//
// Its own read, because the Quotes view's rows are form-shaped and carry
// neither created_at nor the company link. It re-reads whenever the page's quote
// list changes (reloadKey), so a quote saved in the other view shows here too.
// Same RLS as the Quotes view -- no new permissions.
//
// FILTERS persist in the page store under 'quotelist', like every list page:
// they survive moving around the app and reset on a refresh. They combine with
// AND, and any change goes back to page 1.

const PAGE_SIZE = 50;
const DASH = '—';

// The local calendar day of a timestamp, YYYY-MM-DD -- what the date inputs
// hold, so From and To compare like with like and are inclusive.
const ymd = iso => {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d)) return '';
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
};
// "Sep 18, 2026" -- fmtStamp in quotes.jsx, the Quotes view's date.
const fmtDay = iso => {
  if (!iso) return DASH;
  try { return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }); }
  catch { return DASH; }
};
const fmtYmd = s => fmtDay(s ? s + 'T12:00:00' : '');
const todayYmd = () => ymd(new Date().toISOString());

// A cell Excel would read as a formula starts with = + - @, a tab or a return.
// A leading apostrophe makes it text; the value is otherwise untouched.
const csvSafe = v => {
  const s = String(v == null ? '' : v);
  return /^[=+\-@\t\r]/.test(s) ? "'" + s : s;
};
// Letters, digits and hyphens only, so a company name is safe in a file name.
const fileBit = s => String(s || '').replace(/[^A-Za-z0-9-]+/g, '').slice(0, 30);

const card = { maxWidth: 1280, margin: '0 auto', background: '#ffffff', border: '1px solid #e7eaf0',
               borderRadius: 16, overflow: 'hidden', boxShadow: '0 2px 10px rgba(26,34,56,0.05)' };
const GRID = '160px minmax(0,2fr) 130px minmax(0,1.4fr)';

export function QuoteList({ reloadKey, onOpen }) {
  const [ui, setUi] = usePageState('quotelist', { company: [], product: [], sku: [], from: '', to: '', page: 1 });
  const [rows, setRows] = useState(null);
  const [err, setErr] = useState('');
  const [exporting, setExporting] = useState(false);

  useEffect(() => {
    let live = true;
    (async () => {
      const { data, error } = await SB.from('quotes')
        .select('id,sku,product,client,client_company_id,created_at,company:companies!client_company_id(name)')
        .order('created_at', { ascending: false });
      if (!live) return;
      if (error) { setErr(error.message); setRows([]); return; }
      setErr('');
      setRows((data || []).map(q => ({
        id: q.id,
        sku: (q.sku || '').trim(),
        product: (q.product || '').trim(),
        company: ((q.company && q.company.name) || q.client || '').trim(),
        created: q.created_at || null,
        day: ymd(q.created_at),
      })));
    })();
    return () => { live = false; };
  }, [reloadKey]);

  const all = rows || [];
  // Options from the quotes themselves, with a count each, alphabetical. A quote
  // with no value is listed under a dash so it can still be picked.
  const optionsFor = (key, allLabel) => {
    const m = new Map();
    all.forEach(r => { const v = r[key] || DASH; m.set(v, (m.get(v) || 0) + 1); });
    return [{ value: '', label: allLabel },
            ...[...m.entries()].sort((a, b) => a[0].localeCompare(b[0])).map(([v, n]) => ({ value: v, label: v, count: n }))];
  };
  const companyOptions = useMemo(() => optionsFor('company', 'All Companies'), [rows]);
  const productOptions = useMemo(() => optionsFor('product', 'All Product Names'), [rows]);
  const skuOptions     = useMemo(() => optionsFor('sku', 'All SKUs'), [rows]);

  const inSet = (set, v) => !set.length || set.includes(v || DASH);
  const shown = useMemo(() => all.filter(r =>
    inSet(ui.company, r.company) && inSet(ui.product, r.product) && inSet(ui.sku, r.sku)
    && (!ui.from || (r.day && r.day >= ui.from)) && (!ui.to || (r.day && r.day <= ui.to))
  ), [rows, ui.company, ui.product, ui.sku, ui.from, ui.to]);
  // Newest first, by the timestamp; created_at order from the read already, and
  // stated here so the list never depends on how it was fetched.
  const sorted = useMemo(() => [...shown].sort((a, b) => String(b.created || '').localeCompare(String(a.created || ''))), [shown]);

  const pages = Math.max(1, Math.ceil(sorted.length / PAGE_SIZE));
  const page = Math.min(Math.max(1, ui.page || 1), pages);
  const pageRows = sorted.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  // Every filter change goes back to page 1.
  const setFilter = (k, v) => { setUi(k, v); setUi('page', 1); };
  const anyFilter = ui.company.length || ui.product.length || ui.sku.length || ui.from || ui.to;
  const clear = () => { setUi('company', []); setUi('product', []); setUi('sku', []); setUi('from', ''); setUi('to', ''); setUi('page', 1); };

  // ── WHAT THE FILES SAY ABOUT THE FILTERS ──────────────────────────────────
  const listOf = (set, noun) => !set.length ? null : set.length <= 3 ? set.join(', ') : set.length + ' ' + noun;
  const filterLines = () => {
    const out = [];
    const c = listOf(ui.company, 'companies'), p = listOf(ui.product, 'product names'), s = listOf(ui.sku, 'SKUs');
    if (c) out.push('Company: ' + c);
    if (p) out.push('Product Name: ' + p);
    if (s) out.push('SKU: ' + s);
    if (ui.from || ui.to) out.push('Created: ' + (ui.from ? fmtYmd(ui.from) : 'any date') + ' to ' + (ui.to ? fmtYmd(ui.to) : 'any date'));
    if (!out.length) out.push('No filters -- every quote');
    return out;
  };
  // Quotes-<filters>-<range or today>. One short bit per filter in use: the name
  // when one is chosen, a count when several are.
  const fileBase = () => {
    const bits = ['Quotes'];
    const one = (set, noun) => !set.length ? null : set.length === 1 ? fileBit(set[0]) : set.length + noun;
    [one(ui.company, 'companies'), one(ui.product, 'products'), one(ui.sku, 'SKUs')].forEach(b => { if (b) bits.push(b); });
    if (ui.from || ui.to) bits.push((ui.from || 'start') + '-to-' + (ui.to || todayYmd()));
    else bits.push(todayYmd());
    return bits.filter(Boolean).join('-');
  };
  const COLS = ['SKU', 'Product Name', 'Created', 'Company'];
  const download = (blob, name) => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };

  // ALL matching rows, every page, in the order on screen.
  const exportXlsx = async () => {
    if (!sorted.length) return;
    setExporting(true);
    try {
      const ExcelJS = await loadExcelJS();
      const wb = new ExcelJS.Workbook();
      wb.creator = 'VESSL'; wb.created = new Date();
      const ws = wb.addWorksheet('Quotes');
      ws.addRow(COLS);
      // Created is a real date cell -- the local day at noon, so no timezone moves it.
      sorted.forEach(r => ws.addRow([r.sku || DASH, r.product || DASH, excelDate(r.day), r.company || DASH]));
      ws.getRow(1).font = { bold: true };
      ws.views = [{ state: 'frozen', ySplit: 1 }];
      ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: COLS.length } };
      ws.getColumn(3).numFmt = 'yyyy-mm-dd';
      [18, 44, 13, 34].forEach((w, i) => { ws.getColumn(i + 1).width = w; });

      const fs = wb.addWorksheet('Filters');
      fs.addRow(['Export', 'King Universal - Quote List']);
      fs.addRow(['Generated', new Date()]);
      fs.addRow(['Rows in this file', sorted.length]);
      fs.addRow(['Quotes in total', all.length]);
      fs.addRow([]);
      fs.addRow(['Filters']);
      filterLines().forEach(l => fs.addRow([l]));
      fs.getRow(1).font = { bold: true }; fs.getRow(6).font = { bold: true };
      fs.getCell('B2').numFmt = 'yyyy-mm-dd hh:mm';
      fs.getColumn(1).width = 44; fs.getColumn(2).width = 40;

      const buf = await wb.xlsx.writeBuffer();
      download(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fileBase() + '.xlsx');
    } catch (e) {
      alert('Could not build the export: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  const exportCsv = () => {
    if (!sorted.length) return;
    const cell = v => '"' + csvSafe(v).replace(/"/g, '""') + '"';
    const lines = [cell('# Quote List · ' + filterLines().join(' · ') + ' · ' + sorted.length + ' of ' + all.length)];
    lines.push(COLS.map(cell).join(','));
    sorted.forEach(r => lines.push([r.sku || DASH, r.product || DASH, r.day, r.company || DASH].map(cell).join(',')));
    download(new Blob(['﻿' + lines.join('\r\n') + '\r\n'], { type: 'text/csv;charset=utf-8;' }), fileBase() + '.csv');
  };

  const exportPdf = async () => {
    if (!sorted.length) return;
    // Opened before any await, so the browser still counts the click.
    const win = window.open('', '_blank');
    if (win) win.document.write('<!doctype html><body style="font:16px system-ui;padding:48px;color:#475569">Generating quote list…</body>');
    setExporting(true);
    try {
      const logo = await logoDataUrl();
      const html = buildListDoc({
        title: 'Quote List',
        kicker: 'Quotes',
        lines: [...filterLines(), sorted.length + ' quote' + (sorted.length === 1 ? '' : 's') + ' · newest first'],
        columns: [{ label: 'SKU', width: '18%' }, { label: 'Product Name', width: '42%' },
                  { label: 'Created', width: '14%' }, { label: 'Company' }],
        rows: sorted.map(r => [r.sku || DASH, r.product || DASH, fmtDay(r.created), r.company || DASH]),
        logo,
        footLeft: 'King Universal · Quote List · ' + fmtDay(new Date().toISOString()),
      });
      showListDoc(win, html, fileBase());
    } catch (e) {
      if (win) { try { win.close(); } catch (x) {} }
      alert('Could not build the PDF: ' + ((e && e.message) || e));
    }
    setExporting(false);
  };

  const dateInp = { border: '1px solid #e7eaf0', borderRadius: 10, padding: '8px 10px', fontSize: 13,
                    fontFamily: 'inherit', color: '#0f1729', background: '#fff', outline: 'none' };
  const lbl = { fontSize: 11, fontWeight: 600, letterSpacing: '.06em', textTransform: 'uppercase', color: '#9aa3b5' };
  const pagerBtn = on => ({ border: '1px solid #e7eaf0', background: '#fff', borderRadius: 9, padding: '6px 12px',
                            fontSize: 13, fontFamily: 'inherit', color: on ? '#0f1729' : '#c3c8d2', cursor: on ? 'pointer' : 'default' });

  return (
    <div>
      {/* ── FILTERS ──
          Bottom-aligned, because the date pair carries a heading above it and the
          dropdowns do not. Everything else on the row sits in a 40px band -- the
          height of a FilterSelect button -- so the dropdowns, the date inputs and
          the controls after them share one line, and each piece wraps whole. */}
      <div style={{ maxWidth: 1280, margin: '0 auto 16px', display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
        <div className="fs-row">
          <FilterSelect multiple label="All Companies" value={ui.company} onChange={v => setFilter('company', v)} options={companyOptions} />
          <FilterSelect multiple label="All Product Names" value={ui.product} onChange={v => setFilter('product', v)} options={productOptions} />
          <FilterSelect multiple label="All SKUs" value={ui.sku} onChange={v => setFilter('sku', v)} options={skuOptions} />
        </div>
        {/* The heading names the pair, in the FROM / TO label style, so the two
            inputs read as one range filter. */}
        <div role="group" aria-label="Quote Creation Date Range" style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={lbl}>Quote Creation Date Range</span>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 10, minHeight: 40 }}>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={lbl}>From</span>
              <input type="date" value={ui.from} max={ui.to || undefined} onChange={e => setFilter('from', e.target.value)} style={dateInp} aria-label="Created from" />
            </label>
            <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <span style={lbl}>To</span>
              <input type="date" value={ui.to} min={ui.from || undefined} onChange={e => setFilter('to', e.target.value)} style={dateInp} aria-label="Created to" />
            </label>
          </div>
        </div>
        {anyFilter ? (
          <div style={{ display: 'flex', alignItems: 'center', height: 40 }}>
            <button onClick={clear} style={{ background: 'none', border: 'none', padding: 0, fontSize: 13, color: '#3461e0',
                                              cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}>
              Clear filters
            </button>
          </div>
        ) : null}
        <span style={{ display: 'flex', alignItems: 'center', height: 40, fontSize: 12, color: '#6a7488', fontVariantNumeric: 'tabular-nums' }}>
          {rows === null ? '' : sorted.length + ' shown' + (anyFilter ? ' of ' + all.length : '')}
        </span>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', height: 40 }}>
          <ExportButton count={sorted.length} busy={exporting} align="right"
            note={sorted.length + ' quote' + (sorted.length === 1 ? '' : 's') + ', every page, as filtered'}
            onXlsx={exportXlsx} onCsv={exportCsv} onPdf={exportPdf} />
        </div>
      </div>

      {/* ── THE TABLE ── */}
      <div style={card}>
        <div style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '14px 18px', borderBottom: '1px solid #e7eaf0',
                      fontSize: 11, letterSpacing: '0.07em', textTransform: 'uppercase', color: '#9aa3b5', fontWeight: 600 }}>
          {COLS.map(h => <div key={h}>{h}</div>)}
        </div>
        {rows === null ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: '#6a7488' }}>Loading…</div>
        ) : err ? (
          <div style={{ padding: '50px 20px', textAlign: 'center', color: '#a14a4a' }}>Couldn't load quotes: {err}</div>
        ) : !sorted.length ? (
          <div style={{ padding: '56px 20px', textAlign: 'center' }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: '#0f1729' }}>{all.length ? 'No quotes match these filters' : 'No quotes yet'}</div>
            {all.length > 0 && <div style={{ fontSize: 13, color: '#6a7488', marginTop: 6 }}>Change a filter, or clear them all.</div>}
          </div>
        ) : pageRows.map((r, i) => (
          <div key={r.id} onClick={() => onOpen && onOpen(r.id)} role="button" tabIndex={0}
            onKeyDown={e => { if (e.key === 'Enter') onOpen && onOpen(r.id); }}
            title="Open this quote"
            style={{ display: 'grid', gridTemplateColumns: GRID, gap: 14, padding: '12px 18px', alignItems: 'center',
                     borderTop: i > 0 ? '1px solid #f1f3f7' : 'none', cursor: 'pointer' }}
            onMouseEnter={e => { e.currentTarget.style.background = '#f8f9fc'; }}
            onMouseLeave={e => { e.currentTarget.style.background = 'transparent'; }}>
            <div style={{ fontSize: 13.5, fontWeight: 600, color: '#0f1729', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.sku || DASH}</div>
            <div style={{ fontSize: 13.5, color: '#2c3446', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.product || DASH}</div>
            <div style={{ fontSize: 13, color: '#6a7488', fontVariantNumeric: 'tabular-nums' }}>{fmtDay(r.created)}</div>
            <div style={{ fontSize: 13.5, color: '#2c3446', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{r.company || DASH}</div>
          </div>
        ))}
      </div>

      {/* ── PAGING ── 50 a page. Only when there is more than one. */}
      {sorted.length > PAGE_SIZE && (
        <div style={{ maxWidth: 1280, margin: '14px auto 0', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 10 }}>
          <span style={{ fontSize: 12.5, color: '#6a7488', fontVariantNumeric: 'tabular-nums' }}>
            {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, sorted.length)} of {sorted.length}
          </span>
          <button onClick={() => page > 1 && setUi('page', page - 1)} disabled={page <= 1} style={pagerBtn(page > 1)}>‹ Prev</button>
          <span style={{ fontSize: 13, color: '#0f1729', fontVariantNumeric: 'tabular-nums' }}>Page {page} of {pages}</span>
          <button onClick={() => page < pages && setUi('page', page + 1)} disabled={page >= pages} style={pagerBtn(page < pages)}>Next ›</button>
        </div>
      )}
    </div>
  );
}
