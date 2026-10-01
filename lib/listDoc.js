// ── A LIST AS A PRINTED DOCUMENT ────────────────────────────────────────────
//
// For list pages that export a PDF -- a title, what the list was filtered to, a
// row count, and a table that runs across as many US Letter sheets as it needs,
// with its header repeated and "Page n of m" in every footer.
//
// THE PRINT MODEL IS THE ORDER CONFIRMATION'S (buildSODoc in app/page.jsx), copied
// rather than shared because that document is client-facing and was not to be
// touched for this: @page margin 0 so Chrome prints no header or footer of its
// own, each .sheet a literal 816x1056px (8.5x11in at 96dpi) with 48px padding as
// the margin, and the pagination done in JavaScript -- Chrome does not implement
// @page margin boxes with counter(page), and a fixed footer cannot know its
// number. Blocks are measured into fixed-height sheets once the fonts have
// landed, the table splits row by row with its thead re-cloned, and the footers
// are stamped only when the sheet count is known. The letterhead is the PLM
// card's: logo (or the company name in type), kicker on the right, a rule.
//
// The document prints itself after laying out, as the PLM card does.

export const docEsc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// The logo has to travel as bytes: the document is written into an about:blank
// window, where a relative src fetches nothing. A failed fetch gives '' and the
// letterhead falls back to the company name in type.
export async function logoDataUrl() {
  try {
    const res = await fetch('/logo.png');
    if (!res.ok) return '';
    const blob = await res.blob();
    return await new Promise((ok, no) => {
      const fr = new FileReader();
      fr.onload = () => ok(fr.result); fr.onerror = no; fr.readAsDataURL(blob);
    });
  } catch (e) { return ''; }
}

// columns: [{ label, width? }]   rows: arrays of display strings, already formatted.
// lines: the filter sentences printed under the title.
export function buildListDoc({ title, kicker = 'List', lines = [], columns, rows, logo = '', footLeft = '' }) {
  const th = 'text-align:left;padding:6px 10px 6px 0;font-size:9.5px;font-weight:600;letter-spacing:.06em;'
           + 'text-transform:uppercase;color:#6b7280;border-bottom:1px solid #d1d5db;';
  const td = 'padding:6px 10px 6px 0;border-bottom:1px solid #eef0f3;font-size:11.5px;color:#111827;vertical-align:top;';
  const head = '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:28px;">'
      + '<div>' + (logo
          ? '<img src="' + logo + '" alt="King Universal" style="height:42px;width:auto;display:block;">'
          : '<div style="font-size:20px;font-weight:700;letter-spacing:-.015em;color:#0c1322;">King Universal Inc.</div>')
      + '</div>'
      + '<div style="font-size:16px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0c1322;white-space:nowrap;">'
        + docEsc(kicker) + '</div>'
    + '</div>'
    + '<div style="height:2px;background:#0c1322;margin-top:16px;"></div>'
    + '<div style="margin-top:20px;">'
      + '<div style="font-size:20px;font-weight:600;letter-spacing:-.015em;color:#111827;">' + docEsc(title) + '</div>'
      + lines.map(l => '<div style="font-size:12px;color:#4b5563;margin-top:4px;">' + docEsc(l) + '</div>').join('')
    + '</div>';
  const table = '<table data-table="1" style="width:100%;border-collapse:collapse;margin-top:18px;">'
    + '<thead><tr>' + columns.map(c => '<th style="' + th + (c.width ? 'width:' + c.width + ';' : '') + '">'
        + docEsc(c.label) + '</th>').join('') + '</tr></thead>'
    + '<tbody>' + rows.map(r => '<tr>' + r.map(v => '<td style="' + td + '">' + docEsc(v) + '</td>').join('') + '</tr>').join('')
    + '</tbody></table>';
  const flow = '<div>' + head + '</div>' + (rows.length ? table
    : '<div style="margin-top:18px;font-size:12.5px;color:#6b7280;">No rows.</div>');

  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
    + '<title>' + docEsc(title) + '</title>'
    + '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap" rel="stylesheet">'
    + '<style>'
    + '*{box-sizing:border-box;margin:0;padding:0;}'
    + "html,body{font-family:'Inter',system-ui,sans-serif;color:#111827;background:#eef1f5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
    + '.sheet{width:816px;height:1056px;background:#fff;margin:0 auto;position:relative;padding:48px 48px 0;overflow:hidden;}'
    + '.sbody{height:926px;overflow:hidden;}'
    + '.sfoot{position:absolute;left:48px;right:48px;bottom:30px;display:flex;justify-content:space-between;align-items:baseline;'
      + 'border-top:1px solid #e5e7eb;padding-top:7px;font-size:8.5px;color:#6b7280;letter-spacing:.02em;}'
    + '#flow{position:absolute;left:-10000px;top:0;width:720px;}'
    + '@media screen{.sheet{box-shadow:0 1px 5px rgba(15,23,42,.16);margin-bottom:20px;}#out{padding:20px 0;}}'
    + '@media print{@page{size:letter;margin:0;}html,body{background:#fff;}#out{padding:0;}'
      + '.sheet{box-shadow:none;margin:0;break-after:page;page-break-after:always;}'
      + '.sheet:last-child{break-after:auto;page-break-after:auto;}}'
    + '</style></head><body>'
    + '<div id="flow" data-footl="' + docEsc(footLeft) + '">' + flow + '</div><div id="out"></div>'
    + '<script>(function(){'
    + 'var H=926;'
    + 'var flow=document.getElementById("flow"),out=document.getElementById("out"),fl=flow.getAttribute("data-footl");'
    + 'function sheet(){var s=document.createElement("div");s.className="sheet";'
      + 'var b=document.createElement("div");b.className="sbody";s.appendChild(b);'
      + 'var f=document.createElement("div");f.className="sfoot";'
      + 'f.innerHTML=\'<span></span><span class="pn"></span>\';f.firstChild.textContent=fl;'
      + 's.appendChild(f);out.appendChild(s);return b;}'
    + 'function run(){'
      + 'var body=sheet(),blocks=[].slice.call(flow.children);'
      + 'blocks.forEach(function(b){'
        + 'if(b.getAttribute("data-table")==="1"){'
          + 'var rows=[].slice.call(b.querySelectorAll("tbody tr"));'
          + 'var sh=b.cloneNode(true);sh.querySelector("tbody").innerHTML="";'
          + 'body.appendChild(sh);'
          + 'if(body.scrollHeight>H){sh.parentNode.removeChild(sh);body=sheet();body.appendChild(sh);}'
          + 'var tb=sh.querySelector("tbody");'
          + 'rows.forEach(function(r){'
            + 'tb.appendChild(r);'
            + 'if(body.scrollHeight>H){tb.removeChild(r);'
              + 'var ns=b.cloneNode(true);ns.querySelector("tbody").innerHTML="";'
              + 'body=sheet();body.appendChild(ns);tb=ns.querySelector("tbody");tb.appendChild(r);}'
          + '});'
        + '}else{'
          + 'body.appendChild(b);'
          + 'if(body.scrollHeight>H){body.removeChild(b);body=sheet();body.appendChild(b);}'
        + '}'
      + '});'
      + 'flow.parentNode.removeChild(flow);'
      + 'var s=out.querySelectorAll(".sheet");'
      + 'for(var i=0;i<s.length;i++){s[i].querySelector(".pn").textContent="Page "+(i+1)+" of "+s.length;}'
      + 'setTimeout(function(){try{window.focus();window.print();}catch(e){}},150);'
    + '}'
    + 'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run).catch(run);}else{run();}'
    + '})();<\/script>'
    + '</body></html>';
}

// Opens the document in a new tab, or downloads it as .html when the browser
// blocks the window -- the fallback the PLM card and order confirmation take.
// win is opened by the caller BEFORE any await, so the click still counts as a
// user gesture; pass null to skip straight to the download.
export function showListDoc(win, html, fileBase) {
  if (win) { win.document.open(); win.document.write(html); win.document.close(); return; }
  const url = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  const a = document.createElement('a');
  a.href = url; a.download = fileBase + '.html';
  a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000);
}
