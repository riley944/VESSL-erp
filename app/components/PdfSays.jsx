'use client';

// ── PDF IMPORT HIGHLIGHTS ────────────────────────────────────────────────────
// Shared by the two "Import from PDF" forms -- the quote form (factory quote
// PDF, script 129) and the new sales order form (client PO PDF, script 134) --
// so a box reads the same way on both.
//
// Green: the box holds what the PDF says, stated plainly. Amber: it holds what
// the PDF says, but the reading was interpreted or weak -- check it. Red: the
// PDF said something the form could not apply (no such company, no such code).
// A box holding something different gets no colour, only "PDF says X".

export const XC = { high: '#3f9d64', medium: '#d39a2c', low: '#d39a2c', red: '#d0574a' };

// A box's style with the highlight's border and halo, or the style unchanged.
export const xStyle = (base, h) => (h && h.color ? { ...base, borderColor: h.color, boxShadow: '0 0 0 2px ' + h.color + '33' } : base);

// The tooltip: where in the PDF a value came from, and how sure the reading was.
export const xTitle = (e) => 'From the PDF' + (e.page ? ', page ' + e.page : '') + ' (' + (e.conf || 'medium') + ' confidence)'
  + (e.evidence ? ': “' + e.evidence + '”' : '') + (e.note ? ' -- ' + e.note : '');

// "PDF says X", with a Use button when the value can be applied.
export function PdfSays({ h, small }) {
  if (!h || !h.says) return null;
  return (
    <span style={{ fontSize: small ? 11 : 11.5, color: h.color === XC.red ? XC.red : '#a66f12', lineHeight: 1.4 }} title={h.title}>
      PDF says {h.says}
      {h.onUse && (
        <button type="button" onClick={(e) => { e.preventDefault(); h.onUse(); }}
          style={{ background: 'none', border: 'none', padding: '0 0 0 6px', color: '#3461e0', fontSize: 'inherit', fontWeight: 600, cursor: 'pointer' }}>
          Use
        </button>
      )}
    </span>
  );
}
