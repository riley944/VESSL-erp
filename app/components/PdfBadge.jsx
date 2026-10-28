'use client';
import { SB } from '@/lib/supabase';
import { PDF_BUCKET, pdfFileNameOf } from '@/lib/quotePdf';

// ── THE "PDF" BADGE ON A QUOTE ──────────────────────────────────────────────
// A quote imported from a factory PDF (quotes.pdf_path, script 129) carries a
// small badge: click opens the stored PDF through a signed link, the same way
// the quote form's View PDF does. Quotes from the same import share the path;
// hovering reports the path through onHover so the list can outline every
// sibling, and the tooltip counts them.
//
// The click stops there -- the badge sits inside rows that open or expand a
// quote on click.
export const SIBLING_OUTLINE = '#d39a2c';   // the import highlight amber (PdfSays XC.medium)

export function PdfBadge({ path, count = 1, onHover }) {
  if (!path) return null;
  const name = pdfFileNameOf(path) || 'the PDF';
  const open = async (e) => {
    e.stopPropagation();
    // Opened before the await so the browser does not treat it as a popup.
    const w = window.open('', '_blank');
    const { data, error } = await SB.storage.from(PDF_BUCKET).createSignedUrl(path, 600);
    if (error || !data) { if (w) w.close(); window._toast?.('Could not open the PDF: ' + (error ? error.message : 'no link'), 'err'); return; }
    if (w) w.location.href = data.signedUrl;
  };
  return (
    <button type="button" onClick={open}
      onMouseEnter={() => onHover && onHover(path)} onMouseLeave={() => onHover && onHover(null)}
      title={count + ' quote' + (count === 1 ? '' : 's') + ' from ' + name}
      style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, padding: '1px 6px', border: '1px solid #d5dae4',
               borderRadius: 6, background: '#fafbfc', color: '#3461e0', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
               lineHeight: 1.5, cursor: 'pointer', verticalAlign: 'middle', fontFamily: 'inherit' }}>
      PDF
    </button>
  );
}
