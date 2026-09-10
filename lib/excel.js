// ExcelJS, loaded from the CDN at runtime rather than bundled.
//
// THE PACKAGE IS IN package.json (exceljs ^4.4.0) and this still does not import it.
// That is deliberate: exceljs is ~900KB and every static or dynamic `import('exceljs')`
// pulls it into a chunk this app ships to people who will never export anything. The
// CDN script tag keeps it out of the bundle entirely and costs one network round trip
// on the first export of a session.
//
// WHY THIS FILE EXISTS. The same loader was written twice already -- page.jsx:5404 and
// programs.jsx:107 -- and testing.jsx would have been a third copy. lib/bankFields.js
// and lib/tierCost.js are the precedent: CATALOGUE records that a hand-mirrored copy is
// exactly what put duty in one margin calculation and not the other. Those two older
// copies are untouched here (programs.jsx does not even use its own -- it calls
// import('exceljs')); consolidating them is a separate change with its own diff.
//
// window.ExcelJS is the cache. A second export in the same session resolves without
// touching the network.
export function loadExcelJS() {
  return new Promise(function (resolve, reject) {
    if (typeof window !== 'undefined' && window.ExcelJS) { resolve(window.ExcelJS); return; }
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/exceljs@4.4.0/dist/exceljs.min.js';
    s.onload = function () { resolve(window.ExcelJS); };
    s.onerror = function () { reject(new Error('Could not load the Excel engine — check the internet connection and try again.')); };
    document.head.appendChild(s);
  });
}

// 'YYYY-MM-DD' -> a Date at NOON, or null.
//
// Noon, not midnight, and this is the whole reason the helper exists. new Date('2026-08-01')
// parses as UTC midnight; a reader west of Greenwich then sees 31 Jul in the cell, so an
// exported testing date can land a day before the one on screen. Noon puts every timezone
// on the same calendar day.
//
// Returns null rather than a string for a missing date, so the cell stays genuinely empty
// and the column keeps its date type instead of turning into text on the first gap.
export function excelDate(s) {
  if (!s) return null;
  var d = new Date(/^\d{4}-\d{2}-\d{2}$/.test(s) ? s + 'T12:00:00' : s);
  return isNaN(d) ? null : d;
}
