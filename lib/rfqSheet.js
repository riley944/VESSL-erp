// ── RFQ sheet geometry, and the workbook that fills it ───────────────────────
// The fillable freight RFQ: rates per container size, itemized destination
// charges, and if-needed fees. It goes out to a forwarder, comes back filled,
// and is parsed straight back into a forwarder_bids row.
//
// ┌───────────────────────────────────────────────────────────────────────────┐
// │ THE ROW NUMBERS ARE A WIRE FORMAT, SHARED BY A WRITER AND A READER.       │
// │                                                                           │
// │ buildRfqWorkbook writes cells at these addresses; ImportBidsModal reads    │
// │ them back from the returned file. They are the only thing connecting the   │
// │ two, and NOTHING VALIDATES THE PAIRING AT RUNTIME -- a sheet whose rows    │
// │ moved still parses, it just yields wrong numbers into a bid, silently.     │
// │                                                                           │
// │ So EVERY row number lives here as a named constant, including the ones     │
// │ only the writer uses. That is not tidiness: when the title row was added   │
// │ the importer was still reading the RFQ id from a hardcoded val(1,2), and   │
// │ a hardcoded number is invisible to any change made here. Every returned    │
// │ workbook would have failed to match its quote, and the error would have    │
// │ read "this file does not match any freight quote" -- which points at the   │
// │ forwarder's file, not at us.                                              │
// │                                                                           │
// │ If you shift a row: change it here, and grep for bare integers inside      │
// │ val(...) / num(...) in ImportBidsModal before believing you are done.      │
// └───────────────────────────────────────────────────────────────────────────┘

// Row 1 is the title band. Everything below it sits one row lower than it did
// before that band existed.
export const RFQ_TITLE_ROW = 1;
// B2 carries the quote id, labelled "do not edit" on the sheet: it is how a
// returned workbook finds its way back to the right freight quote. The importer
// reads THIS constant, never a literal.
export const RFQ_ID_ROW = 2;
// The summary block runs from the id row down; its last line is a spacer.
export const RFQ_INFO_FIRST = 2;
export const RFQ_NAME_ROW = 13, RFQ_EMAIL_ROW = 14;

export const RFQ_S1_HEADER = 16, RFQ_S1_COLS = 17;
export const RFQ_SIZES = [
  { key:'20GP', label:"20' Standard",  row:18 },
  { key:'40GP', label:"40' Standard",  row:19 },
  { key:'40HQ', label:"40' High-Cube", row:20 },
  { key:'45HQ', label:"45' High-Cube", row:21 },
];

export const RFQ_S2_HEADER = 23, RFQ_S2_COLS = 24;
export const RFQ_DEST_ROWS = { first:25, last:32 };   // destination charges (included in total)
export const RFQ_DEST_PREFILL = ['ISF Filing','Customs Clearance','Chassis Fee','Drayage / Delivery','Port / Terminal Fees','Documentation',' ',' '];

export const RFQ_S3_HEADER = 34, RFQ_S3_COLS = 35;
export const RFQ_ACC_ROWS = { first:36, last:41 };    // accessorials (excluded from total)
export const RFQ_ACC_PREFILL = ['Yard Storage','Chassis Split','Pre-Pull','Empty Return Stop-off','Terminal Wait Time','Live Unload Wait Time'];

export const RFQ_VALID_ROW = 43, RFQ_NOTES_ROW = 44;

// The file name a forwarder sees, and the one the download offers. One
// definition so the attachment and the download cannot disagree.
export const rfqFileName = quote => 'KUI-RFQ-'+((quote && quote.quote_number)||'quote')+'.xlsx';

const FONT = 'Arial';
const DARK = 'FF1D1D1F';
const RULE = 'FFD0D0D0';

// Builds the workbook and returns the buffer. NO DOM, deliberately -- the body
// touches nothing but ExcelJS, so the same function runs in the browser (for the
// Download button) and in the API route (for the attachment), and the file a
// forwarder receives is byte-identical to the one Kristy can download.
//
// ExcelJS is passed IN rather than imported here. The browser loads it from a
// CDN at runtime and the route imports the npm package; taking it as an argument
// lets one function serve both without this module reaching for either.
export async function buildRfqWorkbook(ExcelJS, quote, clientName) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Freight RFQ');
  // Widths are set by the longest COLUMN HEADER, not by the data, because the
  // data cells are empty when this file goes out -- a forwarder sees headers and
  // nothing else, so a clipped header is the only thing that can mislead them.
  //   A  34  "Rate valid until (YYYY-MM-DD)" is the longest label, at 29
  //   B  36  THE UUID, not a header, is what sets this one, and it is MEASURED
  //          rather than estimated. Per-character Arial advance widths at the
  //          9pt the id renders in: the widest possible uuid -- all digits, since
  //          hex 'f' is one of Arial's NARROWEST glyphs at 569/2048 against a
  //          digit's 1139 -- comes to 32.8 width units. 36 leaves three units of
  //          margin for cell padding.
  //
  //          A ratio-of-point-sizes guess put this at 32 and it clipped: a real
  //          uuid needs 31.2, so 32 was under one unit of margin. The lesson is
  //          the arithmetic, not the number -- measure the actual string.
  //
  //          It matters because overflow into C only renders while C is EMPTY.
  //          The id looked fine until a forwarder typed an origin cost, and a
  //          truncated uuid is the one value on this sheet nobody can retype
  //          from memory or infer from context.
  //   C  34  "Origin costs / ctr (USD)" at 24 fits outright; the basis header at
  //          44 wraps to two lines rather than forcing a 44-wide column. Trimmed
  //          from 40 to pay for B without widening the sheet overall.
  //   D  16  "Carrier"        E  14  "Transit (days)", 14
  ws.getColumn(1).width = 34; ws.getColumn(2).width = 36; ws.getColumn(3).width = 34; ws.getColumn(4).width = 16; ws.getColumn(5).width = 14;
  // 134 characters is wider than a page, so printing is fitted rather than left
  // to break mid-table. fitToHeight 0 means "as many pages tall as it needs" --
  // only the WIDTH is constrained, which is what keeps a row intact.
  ws.pageSetup = { orientation:'landscape', fitToPage:true, fitToWidth:1, fitToHeight:0, margins:{ left:0.4, right:0.4, top:0.5, bottom:0.5, header:0.2, footer:0.2 } };

  const yellow = { type:'pattern', pattern:'solid', fgColor:{argb:'FFFFF3C4'} };
  const dark = { type:'pattern', pattern:'solid', fgColor:{argb:DARK} };
  const labFont = { bold:true, size:10, color:{argb:'FF6A6A6E'} };
  // The id line is a reference, not content: small and grey on both cells so it
  // reads as a footnote at the top rather than the first thing to fill in.
  //
  // Mid-grey rather than the light grey it started as -- that was legible on
  // screen and close to invisible in print, and this line is the one a forwarder
  // may be asked to read back when a returned file will not match. It stays
  // secondary by being a point smaller and unbolded, not by being faint.
  const refFont = { size:9, color:{argb:'FF6F7885'} };

  // Arial is merged into every font here rather than set per call, so a cell
  // cannot be given a size or a colour and quietly keep the default typeface.
  const setCell = (r,c,v,opts) => {
    const cell = ws.getRow(r).getCell(c);
    cell.value = v;
    if (opts && opts.fill) cell.fill = opts.fill;
    cell.font = Object.assign({ name:FONT }, (opts && opts.font) || {});
    if (opts && opts.align) cell.alignment = opts.align;
    return cell;
  };
  const centre = { horizontal:'center', vertical:'middle' };
  // Column headers wrap rather than forcing a column as wide as its longest
  // label. "Basis / notes (per B/L, per day, free time...)" is 44 characters; a
  // 44-wide column C would push the sheet past a printable width for the sake
  // of one heading, so it takes two lines in a 40-wide column instead.
  const wrapCentre = { horizontal:'center', vertical:'middle', wrapText:true };
  const wrapLeft   = { horizontal:'left',   vertical:'middle', wrapText:true };
  const thin = { style:'thin', color:{argb:RULE} };
  // A COMPLETE GRID: every cell in the range gets all four edges, so the
  // verticals between columns and the outer right edge are drawn rather than
  // implied. This replaced a perimeter-only box that left the interior blank --
  // which is why the input rows showed horizontal rules and nothing else.
  //
  // Applied cell by cell because ExcelJS has no range primitive, and applied
  // AFTER the fills: border and fill are independent properties, so a yellow
  // input cell keeps its fill and gains its edges. Order matters only against
  // underline() below, which deliberately overwrites the bottom it shares.
  const grid = (r1,c1,r2,c2) => {
    for (let r=r1; r<=r2; r++) for (let c=c1; c<=c2; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.border = { top:thin, bottom:thin, left:thin, right:thin };
    }
  };
  // The rule under a column-header row, separating labels from what is typed.
  const underline = (r,c1,c2) => {
    for (let c=c1; c<=c2; c++) {
      const cell = ws.getRow(r).getCell(c);
      cell.border = Object.assign({}, cell.border, { bottom:{ style:'medium', color:{argb:DARK} } });
    }
  };
  const darkHeader = (r, text, span) => {
    setCell(r,1,text,{ fill:dark, font:{ bold:true, color:{argb:'FFFFFFFF'} }, align:centre });
    ws.mergeCells(r,1,r,span||5);
    // The merge takes its style from the anchor, but the covered cells still
    // paint their own fill -- so they are filled too, or the band ends at A.
    for (let c=2; c<=(span||5); c++) ws.getRow(r).getCell(c).fill = dark;
  };

  // ── Title band ─────────────────────────────────────────────────────────────
  setCell(RFQ_TITLE_ROW,1,'KING UNIVERSAL — FREIGHT RFQ',{ fill:dark, font:{ bold:true, size:14, color:{argb:'FFFFFFFF'} }, align:centre });
  ws.mergeCells(RFQ_TITLE_ROW,1,RFQ_TITLE_ROW,5);
  for (let c=2; c<=5; c++) ws.getRow(RFQ_TITLE_ROW).getCell(c).fill = dark;
  ws.getRow(RFQ_TITLE_ROW).height = 24;

  // ── Summary block ──────────────────────────────────────────────────────────
  const info = [
    ['RFQ ID (do not edit)', quote.id],
    ['Quote #', quote.quote_number||''],
    ['Client', clientName||'King Universal Inc'],
    ['Origin', quote.origin||''],
    ['Destination / delivery', quote.destination||''],
    ['Incoterm', quote.incoterm||''],
    ['Cargo ready', quote.ready_date? String(quote.ready_date).slice(0,10):''],
    ['Requested equipment', String(quote.containers_needed||'')+' × '+(quote.container_type||"40'HQ")],
    ['Total cartons', String(quote.total_cartons||'')],
    ['Total CBM / weight', String(quote.total_cbm||'')+' CBM · '+String(quote.total_weight_kg||'')+' kg'],
    ['', ''],
  ];
  info.forEach(function(pair,i){
    const r = RFQ_INFO_FIRST + i;
    const isRef = r === RFQ_ID_ROW;
    setCell(r,1,pair[0],{ font: isRef ? refFont : labFont, align:centre });
    // The id cell is centred like every other value in B. It was the one
    // exception, inheriting Excel's default left alignment for text, which read
    // as a stray ragged line in an otherwise centred column. Its font stays
    // smaller and grey -- that is what marks it as a reference rather than
    // something to fill in, not its alignment.
    setCell(r,2,pair[1],{ font: isRef ? refFont : undefined, align: centre });
  });
  setCell(RFQ_NAME_ROW,1,'Your company name',{font:{bold:true,size:10},align:centre});
  setCell(RFQ_NAME_ROW,2,'',{fill:yellow,align:centre});
  setCell(RFQ_EMAIL_ROW,1,'Contact email',{font:{bold:true,size:10},align:centre});
  setCell(RFQ_EMAIL_ROW,2,'',{fill:yellow,align:centre});
  // The summary block gets the same grid. Two ranges, not one: the trailing
  // entry of the info array is a spacer, and running the grid through it draws a
  // boxed empty row where the gap is doing the work of separating reference
  // lines from the two a forwarder actually fills in. Derived from the array
  // length rather than a literal, so adding a summary line cannot leave the
  // border behind.
  grid(RFQ_INFO_FIRST, 1, RFQ_INFO_FIRST + info.length - 2, 2);
  grid(RFQ_NAME_ROW, 1, RFQ_EMAIL_ROW, 2);

  // ── Section 1 — ocean freight per equipment ────────────────────────────────
  darkHeader(RFQ_S1_HEADER,'SECTION 1 — OCEAN FREIGHT · fill the sizes you are quoting (yellow cells)');
  ['Container','Ocean rate / ctr (USD)','Origin costs / ctr (USD)','Carrier','Transit (days)']
    .forEach(function(h,i){ setCell(RFQ_S1_COLS,i+1,h,{ font:{bold:true,size:10}, align: wrapCentre }); });
  ws.getRow(RFQ_S1_COLS).height = 30;
  RFQ_SIZES.forEach(function(sz){
    const req = sz.key===(quote.container_type||'40HQ');
    setCell(sz.row,1,sz.label+(req?'  ← requested':''),{font:{bold:req,size:10},align:centre});
    // Centred: these are short numbers and a carrier code, and a ragged left
    // edge under a centred header reads as a different column.
    for (var c=2;c<=5;c++) setCell(sz.row,c,'',{fill:yellow,align:centre});
  });
  // Grid first, then the header rule on top of the bottom edge it shares.
  grid(RFQ_S1_COLS,1,RFQ_SIZES[RFQ_SIZES.length-1].row,5);
  underline(RFQ_S1_COLS,1,5);

  // ── Section 2 — destination charges (included) ─────────────────────────────
  darkHeader(RFQ_S2_HEADER,'SECTION 2 — DESTINATION CHARGES per container · INCLUDED in total', 3);
  ['Fee description','Amount (USD)','Basis / notes (per B/L, per day, free time…)']
    .forEach(function(h,i){ setCell(RFQ_S2_COLS,i+1,h,{ font:{bold:true,size:10}, align: i===2 ? wrapLeft : wrapCentre }); });
  ws.getRow(RFQ_S2_COLS).height = 30;
  for (var r=RFQ_DEST_ROWS.first; r<=RFQ_DEST_ROWS.last; r++) {
    const pre = RFQ_DEST_PREFILL[r-RFQ_DEST_ROWS.first]||' ';
    // ┌─────────────────────────────────────────────────────────────────────┐
    // │ THE YELLOW MARKS A PROMPT, NOT PERMISSION TO TYPE.                  │
    // │                                                                     │
    // │ A NAMED row asks a specific question -- "what is ISF Filing?" -- so  │
    // │ its amount and basis are yellow. The two SPARE rows at the end ask   │
    // │ nothing; they are there in case a forwarder has a fee we did not     │
    // │ name. Highlighting them said "fill these in", and a forwarder with   │
    // │ no extra fee reads that as a question they have failed to answer.    │
    // │                                                                     │
    // │ Plain does NOT mean locked. The sheet carries no protection, the     │
    // │ cells accept text exactly as before, and the importer reads every    │
    // │ row from first to last regardless of fill -- so a fee typed into a   │
    // │ spare row still lands in the bid.                                    │
    // └─────────────────────────────────────────────────────────────────────┘
    const spare = !pre.trim();
    setCell(r,1,spare?'':pre,{align:centre});
    // Amount centred, basis left: one is a figure, the other is a sentence.
    setCell(r,2,'',{ fill: spare?undefined:yellow, align:centre });
    setCell(r,3,'',{ fill: spare?undefined:yellow });
  }
  grid(RFQ_S2_COLS,1,RFQ_DEST_ROWS.last,3);
  underline(RFQ_S2_COLS,1,3);

  // ── Section 3 — accessorials (excluded) ────────────────────────────────────
  darkHeader(RFQ_S3_HEADER,'SECTION 3 — IF-NEEDED / ACCESSORIAL FEES · EXCLUDED from total', 3);
  ['Fee description','Amount (USD)','Basis / notes']
    .forEach(function(h,i){ setCell(RFQ_S3_COLS,i+1,h,{ font:{bold:true,size:10}, align: i===2 ? wrapLeft : wrapCentre }); });
  ws.getRow(RFQ_S3_COLS).height = 30;
  for (var r2=RFQ_ACC_ROWS.first; r2<=RFQ_ACC_ROWS.last; r2++) {
    setCell(r2,1,RFQ_ACC_PREFILL[r2-RFQ_ACC_ROWS.first]||'',{align:centre});
    setCell(r2,2,'',{fill:yellow,align:centre});
    setCell(r2,3,'',{fill:yellow});
  }
  grid(RFQ_S3_COLS,1,RFQ_ACC_ROWS.last,3);
  underline(RFQ_S3_COLS,1,3);

  setCell(RFQ_VALID_ROW,1,'Rate valid until (YYYY-MM-DD)',{font:{bold:true,size:10},align:centre});
  setCell(RFQ_VALID_ROW,2,'',{fill:yellow,align:centre});
  // These two are inputs like any other, so they are bordered like any other --
  // they sat outside the tables and were the only unboxed cells on the sheet.
  grid(RFQ_VALID_ROW,1,RFQ_VALID_ROW,2);

  // Notes is the one free-text box, so it gets room to be one: three lines tall
  // with wrapping on, rather than a single line that scrolls out of sight as it
  // is typed and prints as one truncated sentence. Top-aligned so text grows
  // downward from where the cursor starts.
  // Centred vertically against a 45pt row: every other label on the sheet sits
  // beside a single-line cell, so the default bottom alignment was invisible
  // until this row grew three lines tall and left the label on the floor. The
  // INPUT keeps top-left, because typed text has to start where the cursor does
  // and grow downward.
  setCell(RFQ_NOTES_ROW,1,'Additional notes',{font:{bold:true,size:10},align:{ vertical:'middle', horizontal:'center' }});
  setCell(RFQ_NOTES_ROW,2,'',{fill:yellow,align:{ wrapText:true, vertical:'top', horizontal:'left' }});
  ws.mergeCells(RFQ_NOTES_ROW,2,RFQ_NOTES_ROW,5);
  ws.getRow(RFQ_NOTES_ROW).height = 45;
  // Every cell under the merge, or the box stops at the B/C boundary: a merged
  // range takes its VALUE from the anchor but each covered cell still draws its
  // own border, the same reason the dark header bands fill C through E by hand.
  grid(RFQ_NOTES_ROW,1,RFQ_NOTES_ROW,5);

  return wb.xlsx.writeBuffer();
}

// The covering note. Shared for the same reason the geometry is: the route sends
// it and nothing else should be free to reword it into a different ask.
export const rfqSubject = quote =>
  'Freight quote request — '+(quote.quote_number||'')+' ('+(quote.origin||'?')+' → '+(quote.destination||'?')+')';

// replyTo is passed in, never imported: this module is bundled into the BROWSER
// for the download path, and DEFAULT_REPLY_TO lives in the route. Importing the
// route here would drag server-only code -- and the Resend key it reads -- into
// the client bundle. A parameter keeps one definition of the address without
// crossing that line.
export const rfqBody = (quote, replyTo) =>
  'Hello,\n\nPlease quote the following ocean shipment using the attached RFQ sheet (fill the yellow cells and reply with the file):\n\n'
  + 'Route: '+(quote.origin||'?')+' → '+(quote.destination||'?')+'\n'
  + 'Equipment: '+String(quote.containers_needed||'?')+' × '+(quote.container_type||"40'HQ")+' (alternate sizes welcome — the sheet has a row per size)\n'
  + 'Cargo: '+String(quote.total_cartons||'?')+' cartons · '+String(quote.total_cbm||'?')+' CBM · '+String(quote.total_weight_kg||'?')+' kg\n'
  + 'Incoterm: '+(quote.incoterm||'FOB')+'\n'
  + 'Cargo ready: '+(quote.ready_date? String(quote.ready_date).slice(0,10) : 'TBA')+'\n\n'
  + 'Please itemize destination charges, list any if-needed accessorial fees separately, and include carrier, transit time, and rate validity.\n\n'
  // The ask that closes the loop. Without it the sheet says how to fill it in but
  // never says where to send it back, and a reply is the only route home -- the
  // importer needs the returned workbook, and vessl.io does not receive mail, so
  // the reply-to address is what a Reply actually reaches.
  //
  // The address is named in the text as well as set as the Reply-To header,
  // because a forwarder who forwards the mail onward, or whose client hides the
  // header, otherwise has nothing to go on. Naming it costs one parenthetical.
  //
  // Total function: a missing or malformed replyTo drops the parenthetical
  // rather than printing "(undefined)" to a forwarder. The sentence still reads
  // correctly without it -- the header alone carries the reply in that case.
  + 'When completed, please reply to this email'
  + ((typeof replyTo === 'string' && replyTo.includes('@')) ? ' ('+replyTo.trim()+')' : '')
  + ' with the filled sheet.\n\nThank you,\nKing Universal Inc.';
