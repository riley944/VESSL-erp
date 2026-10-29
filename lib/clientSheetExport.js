// ── THE CLIENT PRICE SHEET, AS FILES ────────────────────────────────────────
// What Send to Client's settings step and Export sheet do, lifted out of
// app/quotes.jsx (SendToClientModal) unchanged so the iPad view (app/m) builds
// the same sheet for one quote. The sheet itself -- tables by quantity set,
// size bands, DDP only -- is lib/clientSheet.js; the Excel layout is
// buildPriceSheet in lib/workbook.js. Checked byte for byte against the inline
// version with scripts/sheet-snapshot.mjs.
import { buildModel, toWorkbookSheet, toCsv, toHtml, longDate, NOTE_DDP, NOTE_APPROVAL } from '@/lib/clientSheet';
import { buildPriceSheet } from '@/lib/workbook';
import { safeName } from '@/lib/exportFormats';
import { BANK_FIELDS } from '@/lib/bankFields';
import { loadExcelJS } from '@/lib/excel';
import { logoDataUrl } from '@/lib/listDoc';

export const SHEET_MIME = {
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  csv: 'text/csv;charset=utf-8',
};

// The header the settings step opens with. settings is the kui_settings row,
// me the signed-in person's staff row ({ email, full_name, job_title }).
export function sheetHeader({ client, settings, me = {}, now = new Date() }) {
  const co = (settings && settings.company_name) || 'King Universal Inc.';
  return {
    company: (client || '').toUpperCase(),
    programme: 'UNIT PRICING',
    date: longDate(now),
    notes: [NOTE_DDP, NOTE_APPROVAL],
    // A job title that is the sign-in address is saved browser autofill: blank.
    signoff: { name: me.full_name || '', company: co,
               title: (me.job_title || '').trim().toLowerCase() === (me.email || '').toLowerCase() ? '' : (me.job_title || '') },
  };
}

// Item, Details and Color per quote, from the quote unless already edited.
export function sheetEdits(quotes, prev = {}) {
  const next = { ...prev };
  (quotes || []).forEach((q) => { if (!next[q.id]) next[q.id] = { item: q.product || '', details: q.clientDetails || '', color: q.clientColor || '' }; });
  return next;
}

// The payment block, or null when it is not asked for.
export function sheetPayment({ withPayment, settings, vendor }) {
  return withPayment && settings ? {
    vendor,
    bank: BANK_FIELDS.map(([k, label]) => [label, String((settings || {})[k] ?? '').trim()]).filter(([, v]) => v !== ''),
  } : null;
}

export const sheetModel = ({ quotes, edits, header, payment }) => buildModel({ quotes, edits, header, payment });

export function sheetBaseName(client, now = new Date()) {
  const day = now.toISOString().slice(0, 10);
  return 'KUI-Price-Sheet-' + safeName(client || 'client') + '-' + day;
}

// The KUI logo (/logo.png, as the SO confirmation uses it) and the size the
// Excel letterhead sets it at, 160px wide. Browser only. None when it is not
// there.
export async function sheetLogo() {
  const logoSrc = await logoDataUrl();
  const logoSize = logoSrc ? await new Promise((ok) => {
    const img = new Image();
    img.onload = () => ok(img.naturalWidth ? { width: 160, height: Math.round(160 * img.naturalHeight / img.naturalWidth) } : null);
    img.onerror = () => ok(null);
    img.src = logoSrc;
  }) : null;
  return { logoSrc, logoSize };
}

// One format: { blob, filename } for xlsx and csv, { html } for the PDF page
// (written into a window the caller opened on the click).
export async function sheetFile({ fmt, model, logoSrc, logoSize, base, loadExcel = loadExcelJS }) {
  if (fmt === 'xlsx') {
    const ExcelJS = await loadExcel();
    const buf = await buildPriceSheet(ExcelJS, toWorkbookSheet(model, logoSize ? { base64: logoSrc, ...logoSize } : null)).xlsx.writeBuffer();
    return { blob: new Blob([buf], { type: SHEET_MIME.xlsx }), filename: base + '.xlsx' };
  }
  if (fmt === 'csv') return { blob: new Blob(['﻿' + toCsv(model)], { type: SHEET_MIME.csv }), filename: base + '.csv' };
  return { html: toHtml(model, logoSize ? logoSrc : '') };
}
