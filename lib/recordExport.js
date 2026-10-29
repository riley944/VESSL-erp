// ── EXPORTS: the date, the person, the letterhead, the files ────────────────
// Moved from app/page.jsx so the iPad view (app/m) builds the per-card exports
// of the Sales Orders, Purchase Orders and Shipments pages exactly as the
// desktop does. The sheets themselves are lib/ordersExport.js and
// lib/shipmentsExport.js; this lays them out as Excel, CSV files or a print
// document. Checked byte for byte against the inline version with
// scripts/record-snapshot.mjs.
//
// out: { sheets, xlsxName, csvName(sheet, table, i), pdfMeta } -- one set of
// sheet descriptions, laid out as Excel, CSV files or a print document.
import { SB } from '@/lib/supabase';
import { loadExcelJS } from '@/lib/excel';
import { buildWorkbook } from '@/lib/workbook';
import { sheetsToCsvFiles, sheetsToPdfHtml } from '@/lib/exportFormats';
import { logoDataUrl } from '@/lib/listDoc';
import { downloadBlob } from '@/lib/download';

// ── EXPORT PLUMBING, SHARED BY EVERY EXPORT ─────────────────────────────────
// Both of these were local to Products. Companies exports too and is declared
// above it, so it could not see them -- and a second copy of a two-line helper is
// how one export writes products-2026-09-22.xlsx and another writes something
// subtly different. Module scope, one definition, every caller.
export const stampToday = () => {
  const d = new Date();
  return d.getFullYear()+'-'+String(d.getMonth()+1).padStart(2,'0')+'-'+String(d.getDate()).padStart(2,'0');
};
// A PDF needs its window opened inside the click, before anything is awaited,
// or a pop-up blocker stops it.
export const openExportWindow = () => {
  const win = window.open('', '_blank');
  if (!win) { alert('The PDF opens in a new window. Allow pop-ups for this site and try again.'); return null; }
  win.document.write('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><body style="font:16px system-ui;padding:48px;color:#475569">Preparing the PDF…</body>');
  return win;
};
export const exportUser = (user, displayName) => {
  const email = user?.email || '';
  return email ? ((displayName||'').trim() ? displayName.trim()+' ('+email+')' : email) : '';
};

// The letterhead a printed document carries: kui_settings and the logo as a
// data URL. THE LOGO HAS TO TRAVEL AS BYTES -- the document is written into an
// about:blank window, so a relative src like "/logo.png" would fetch nothing.
// public/logo.png is the black crown-globe mark, the one for paper.
export async function loadLetterhead() {
  let settings = null;
  try { const { data } = await SB.from('kui_settings').select('*').eq('id',1).single(); settings = data; } catch(e){}
  const logo = await logoDataUrl();
  return { settings, logo };
}

export const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

// One format, as files: { files: [{ blob, name }] } for xlsx (one) and csv (one
// per table), { html } for the PDF page. brand is loadLetterhead()'s answer --
// read here when not given.
export async function buildExportFiles(fmt, out, { brand = null, loadExcel = loadExcelJS } = {}) {
  if (fmt === 'xlsx') {
    const ExcelJS = await loadExcel();
    const buf = await buildWorkbook(ExcelJS, out.sheets).xlsx.writeBuffer();
    return { files: [{ blob: new Blob([buf], { type: XLSX_MIME }), name: out.xlsxName }] };
  }
  if (fmt === 'csv') {
    return { files: sheetsToCsvFiles(out.sheets, out.csvName).map((f) => ({ blob: new Blob([f.text], { type: 'text/csv;charset=utf-8' }), name: f.name })) };
  }
  return { html: sheetsToPdfHtml(out.sheets, brand || await loadLetterhead(), out.pdfMeta) };
}

// The desktop's delivery: Excel and CSV handed to deliver (a download by
// default) -- CSV one file per table, one after another, a short gap so the
// browser takes each download as its own -- and the PDF written into the
// window the click opened, printed once its fonts have landed (the document
// paginates itself).
export async function deliverExport(fmt, out, win, deliver = downloadBlob) {
  if (fmt === 'pdf') {
    const { html } = await buildExportFiles('pdf', out);
    win.document.open(); win.document.write(html); win.document.close();
    setTimeout(() => { try { win.focus(); win.print(); } catch (e) {} }, 900);
    return;
  }
  if (fmt !== 'xlsx' && fmt !== 'csv') return;
  const { files } = await buildExportFiles(fmt, out);
  for (let i = 0; i < files.length; i++) {
    if (i) await new Promise(r => setTimeout(r, 400));
    await deliver(files[i].blob, files[i].name);
  }
}
