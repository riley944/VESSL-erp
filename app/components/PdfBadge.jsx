'use client';
import { useState } from 'react';
import { pdfFileNameOf, SIBLING_OUTLINE } from '@/lib/quotePdf';
import { PdfItemViewer } from '@/app/components/PdfItemViewer';

// ── THE "PDF" BADGE ON A QUOTE ──────────────────────────────────────────────
// A quote imported from a factory PDF (quotes.pdf_path, script 129) carries a
// small badge: click opens the stored PDF in the viewer, the same way the quote
// form's View PDF does. Quotes from the same import share the path;
// hovering reports the path through onHover so the list can outline every
// sibling, and the tooltip counts them.
//
// The click stops there -- the badge sits inside rows that open or expand a
// quote on click.
//
// The click opens PdfItemViewer: at the quote's own item when it knows it
// (quotes.pdf_item, script 139), else wherever the PDF names the product.
export { SIBLING_OUTLINE };

export function PdfBadge({ path, count = 1, onHover, item = null, productName = '' }) {
  const [viewing, setViewing] = useState(false);
  if (!path) return null;
  const name = pdfFileNameOf(path) || 'the PDF';
  const open = (e) => { e.stopPropagation(); setViewing(true); };
  // The viewer beside the button, not in it: a portal still bubbles its
  // events through the React tree, and the button's would reopen it.
  return (
    <>
    {viewing && <PdfItemViewer path={path} item={item} productName={productName} onClose={() => setViewing(false)} />}
    <button type="button" onClick={open}
      onMouseEnter={() => onHover && onHover(path)} onMouseLeave={() => onHover && onHover(null)}
      title={count + ' quote' + (count === 1 ? '' : 's') + ' from ' + name}
      style={{ display: 'inline-flex', alignItems: 'center', marginLeft: 6, padding: '1px 6px', border: '1px solid #d5dae4',
               borderRadius: 6, background: '#fafbfc', color: '#3461e0', fontSize: 10.5, fontWeight: 700, letterSpacing: '.04em',
               lineHeight: 1.5, cursor: 'pointer', verticalAlign: 'middle', fontFamily: 'inherit' }}>
      PDF
    </button>
    </>
  );
}
