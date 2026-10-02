// ── ORDER DOCUMENTS: one letterhead, one print model ────────────────────────
//
// Lifted out of buildSODoc (app/page.jsx) so the factory purchase order prints
// with the same letterhead, footer and pagination as the client's order
// confirmation rather than a copy of them that drifts. buildSODoc and buildPODoc
// both call these. lib/listDoc.js keeps its own older copy of the print model.
//
// PRINT MODEL. @page margin is 0, so Chrome prints no header or footer of its own
// -- no "about:blank", no browser date stamp, no URL. Everything inside the paper
// edge is ours, which means the page margin has to be ours too: each .sheet is a
// literal 816x1056px (8.5x11in at 96dpi) with 48px of padding standing in for the
// half-inch margin.
//
// PAGE N OF M IS PAGINATED IN JAVASCRIPT, deliberately. The CSS way -- @page
// margin boxes with counter(page) -- is not implemented in Chrome, and a
// position:fixed footer repeats on every sheet but cannot know its own number. So
// the document lays itself out: blocks are measured into fixed-height sheets, the
// items table splits across sheets with its header repeated, and only once the
// sheet count is known are the footers stamped. It waits on document.fonts.ready
// first, because Inter arriving late would change every height it just measured.
//
// Two markers a block or row can carry, both unused by the order confirmation:
//   data-break="1" on a top-level block starts it on a fresh sheet (attached art);
//   data-keepnext="1" on a table row carries it over with the row after it when
//   that row moves to the next sheet, so a style heading is never left alone at
//   the foot of a page;
//   data-group="x" on rows, with data-grouphead="1" on the group's heading row:
//   when a new sheet opens partway through a group, a copy of the heading goes
//   first, with its hidden [data-cont] "(continued)" shown.

export const DOC_FONTS = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap';

// ── LETTERHEAD CONTACT LINES ────────────────────────────────────────────────
// Blank fields are SKIPPED here rather than dashed. A dash is right in a details
// grid, where a missing date is information; it is wrong in a letterhead, where
// an em dash where the phone number goes just looks broken.
// NOTE: kui_settings has no website column, so the website line the layout calls
// for cannot be filled. The slot is commented rather than faked.
// TWO LINES, NOT FOUR. The address is flattened onto one line and the ways to
// reach a person onto the next, so the block reads as a letterhead rule rather
// than as a stack of fields. A stored address with its own line breaks would
// otherwise print four ragged lines under a 40px logo and swamp it.
export function letterheadLines(st, esc) {
  const addrLine = ((st && st.address) || '').trim().split(/\n+/).map(x => x.trim()).filter(Boolean).join(', ');
  const reachLine = [st && st.phone, st && st.office_phone, st && st.email]
    .map(x => (x || '').trim()).filter(Boolean).join('  ·  ');
  // (st.website||'').trim() -- no kui_settings column; slot left commented, not faked.
  return [addrLine, reachLine].filter(Boolean).map(esc).join('<br>');
}

// LETTERHEAD. Logo, then the two-line address/contact block beneath it; the
// document title on the right, set larger than anything else on the sheet so the
// eye lands on WHAT THIS IS before it reads a single field. The rule closes the
// block. No panel, no fill -- the logo is the only mark.
//
// THE LOGO IS AN <img> ON A DATA URI, never a path: the document is written into
// an about:blank window, where a relative src fetches nothing. Text fallback when
// the logo did not load, so a failed fetch degrades to the company name rather
// than to an anonymous sheet. title and ref arrive as plain text.
export function docLetterhead({ logo, coName, headLines, title, ref, esc }) {
  return '<div>'
    + '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:28px;">'
      + '<div style="min-width:0;">'
        + (logo
          ? '<img src="' + logo + '" alt="' + esc(coName) + '" style="height:46px;width:auto;display:block;">'
          : '<div style="font-size:21px;font-weight:700;letter-spacing:-.015em;color:#0c1322;line-height:1.1;">' + esc(coName) + '</div>')
        + (headLines ? '<div style="margin-top:13px;font-size:11.5px;color:#4b5563;line-height:1.6;">' + headLines + '</div>' : '')
      + '</div>'
      + '<div style="text-align:right;white-space:nowrap;">'
        + '<div style="font-size:18px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#0c1322;line-height:1.1;">' + esc(title) + '</div>'
        + '<div class="mono" style="font-size:15px;color:#374151;margin-top:8px;">' + esc(ref) + '</div>'
      + '</div>'
    + '</div>'
    + '<div style="height:2px;background:#0c1322;margin-top:18px;"></div>'
  + '</div>';
}

// The whole document around a flow of blocks. titleHtml and footLeftHtml arrive
// escaped. The flow's top-level children are the blocks the paginator places.
export function paginatedDocument({ titleHtml, flow, footLeftHtml }) {
  return '<!DOCTYPE html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
+ '<title>' + titleHtml + '</title>'
+ '<link href="' + DOC_FONTS + '" rel="stylesheet">'
+ '<style>'
+ '*{box-sizing:border-box;margin:0;padding:0;}'
+ "html,body{font-family:'Inter',system-ui,sans-serif;color:#111827;background:#eef1f5;-webkit-print-color-adjust:exact;print-color-adjust:exact;}"
+ ".mono{font-family:'JetBrains Mono',ui-monospace,SFMono-Regular,Menlo,monospace;}"
// 816x1056 = 8.5x11in at 96dpi. The 48px padding IS the page margin, because
// @page has none -- that is what keeps Chrome's own header and footer off.
+ '.sheet{width:816px;height:1056px;background:#fff;margin:0 auto;position:relative;padding:48px 48px 0;overflow:hidden;}'
+ '.sbody{height:926px;overflow:hidden;}'
+ '.sfoot{position:absolute;left:48px;right:48px;bottom:30px;display:flex;justify-content:space-between;align-items:baseline;'
  + 'border-top:1px solid #e5e7eb;padding-top:7px;font-size:8.5px;color:#6b7280;letter-spacing:.02em;}'
// Measured off-screen at the exact width of .sbody, so heights taken here are the
// heights the content will have once it is moved in.
+ '#flow{position:absolute;left:-10000px;top:0;width:720px;}'
+ '@media screen{.sheet{box-shadow:0 1px 5px rgba(15,23,42,.16);margin-bottom:20px;}#out{padding:20px 0;}}'
+ '@media print{@page{size:letter;margin:0;}html,body{background:#fff;}#out{padding:0;}'
  + '.sheet{box-shadow:none;margin:0;break-after:page;page-break-after:always;}'
  + '.sheet:last-child{break-after:auto;page-break-after:auto;}}'
+ '</style></head><body>'
+ '<div id="flow" data-footl="' + String(footLeftHtml).replace(/"/g, '&quot;') + '">' + flow + '</div><div id="out"></div>'
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
    + 'if(b.getAttribute("data-break")==="1"&&body.children.length){body=sheet();}'
    + 'if(b.getAttribute("data-table")==="1"){'
      // The table is rebuilt on each sheet from a clone, so the header repeats.
      + 'var rows=[].slice.call(b.querySelectorAll("tbody tr"));'
      // Group headings, by group, so a group continuing on a new sheet can have
      // its heading repeated there.
      + 'var heads={};rows.forEach(function(r){if(r.getAttribute("data-grouphead")==="1")heads[r.getAttribute("data-group")]=r;});'
      + 'var sh=b.cloneNode(true);sh.querySelector("tbody").innerHTML="";'
      + 'body.appendChild(sh);'
      + 'if(body.scrollHeight>H){sh.parentNode.removeChild(sh);body=sheet();body.appendChild(sh);}'
      + 'var tb=sh.querySelector("tbody");'
      + 'rows.forEach(function(r){'
        + 'tb.appendChild(r);'
        + 'if(body.scrollHeight>H){tb.removeChild(r);'
          // Rows marked keep-with-next travel with this one, as long as one row
          // stays behind -- an empty table at the foot of a sheet is worse.
          + 'var carry=[];'
          + 'while(tb.children.length>1&&tb.lastElementChild.getAttribute("data-keepnext")==="1"){carry.unshift(tb.lastElementChild);tb.removeChild(tb.lastElementChild);}'
          + 'var ns=b.cloneNode(true);ns.querySelector("tbody").innerHTML="";'
          + 'body=sheet();body.appendChild(ns);tb=ns.querySelector("tbody");'
          + 'carry.forEach(function(c){tb.appendChild(c);});tb.appendChild(r);'
          // The sheet opens partway through a group: repeat its heading, marked
          // "(continued)". Not when the heading itself travelled over.
          + 'var g=tb.firstElementChild.getAttribute("data-group");'
          + 'if(g&&heads[g]&&tb.firstElementChild!==heads[g]){var hc=heads[g].cloneNode(true);'
            + 'hc.removeAttribute("data-grouphead");hc.removeAttribute("data-keepnext");'
            + 'var ct=hc.querySelector("[data-cont]");if(ct)ct.style.display="inline";'
            + 'tb.insertBefore(hc,tb.firstElementChild);}'
        + '}'
      + '});'
    + '}else{'
      + 'body.appendChild(b);'
      // One retry only. A block taller than a whole sheet would loop forever
      // otherwise; it gets its own sheet and is allowed to clip.
      + 'if(body.scrollHeight>H){body.removeChild(b);body=sheet();body.appendChild(b);}'
    + '}'
  + '});'
  + 'flow.parentNode.removeChild(flow);'
  + 'var s=out.querySelectorAll(".sheet");'
  + 'for(var i=0;i<s.length;i++){s[i].querySelector(".pn").textContent="Page "+(i+1)+" of "+s.length;}'
+ '}'
// Fonts first. Inter landing after measurement would reflow every height and the
// page breaks would fall in the wrong places.
+ 'if(document.fonts&&document.fonts.ready){document.fonts.ready.then(run).catch(run);}else{run();}'
+ '})();<\/script>'
+ '</body></html>';
}
