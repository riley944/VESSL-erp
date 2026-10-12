// ── TESTING STATUS, ONE DEFINITION ──────────────────────────────────────────
// Moved out of app/testing.jsx unchanged (12 Oct) so the sample card's Testing
// tab reads a product the way the Testing page does -- the same date format,
// the same days-left arithmetic, the same expiry window, the same four eFiling
// readings and the same latest-test-date rule -- rather than a copy that drifts.
// Pure: no React, no Supabase, so either side can import it.
//
// Jenn's weekly email does not import this: it has no expiry, and its latest test
// date is worked out in SQL (vessl.testing_digest_rows, script 108) to the same
// rule as latestTestDateByProduct + testingDateOf below.

export const fmtDate = s => { if(!s) return '—'; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); return isNaN(d)?'—':d.toLocaleDateString('en-US',{month:'short',day:'2-digit',year:'numeric'}); };
export const daysUntil = s => { if(!s) return null; const d=new Date(/^\d{4}-\d{2}-\d{2}$/.test(s)?s+'T12:00:00':s); if(isNaN(d)) return null; return Math.round((d.getTime()-Date.now())/86400000); };
// eFiling has FOUR readings, not two, and the fourth is the one every product is in
// today. efiling_required is nullable with no default and null on all 271 rows: nobody
// has decided. That is not "not required" -- it is the absence of the decision -- and it
// is not "not filed" either, which a null efiled_date already says on its own.
//
// Tested with === on both branches, never truthiness. false and null are both falsy, so
// !p.efiling_required would read an undecided product as one Jenn had ruled exempt, and
// nothing on screen would say the reading was invented. That is the products.active
// mistake 0c41008 had to undo.
//
// A stored date outranks the judgement below it. A filing that happened is a fact;
// required is somebody's reading of the rules, and where the two disagree the fact is
// the one worth showing. Reachable today: 2 of 271 carry a date, both with required
// still unset.
export const efilingKey = p =>
    p.efiled_date              ? 'filed'
  : p.efiling_required === false ? 'notreq'
  : p.efiling_required === true  ? 'unfiled'
  :                                'undecided';
// One place the four strings are written, so the row tooltip, the search index and the
// filter cannot drift apart. CreateProductModal still repeats them, from when they
// lived in app/testing.jsx, which imports it -- importing back would have closed a
// cycle. From here it could import them; it has not been changed.
// "Not set" is the word for the undecided state, everywhere. EfilingModal's dropdown
// says "— Not set —" and that is where Jenn meets the concept, so it is the word she
// will type into the search box and look for on a pill. page.jsx's active cell already
// calls its undecided option the same thing, which makes this the app's word for the
// state rather than this feature's word for it.
export const EFILING_LABEL = { filed:'eFiled', unfiled:'Not eFiled', notreq:'Not required', undecided:'Not set' };

// Reports whose expiry lands inside this window count as "expiring" on the pulse
// strip and the reports filter. 60 days is the re-test lead time that gives a lab
// round-trip comfortable margin.
export const EXPIRY_WINDOW_DAYS = 60;

// product_id -> the LATEST test_date among that product's reports.
//
// Computed as a running max rather than read off the fetch order. That query sorts
// test_date DESC, and Postgres sorts NULLS FIRST on DESC, so the first row for a
// product could be the one report with no date -- taking [0] would show nothing on a
// product that has four dated reports and one undated.
//
// Only a report carrying product_id counts; one linked to a material alone does not.
export const latestTestDateByProduct = reports => {
    const map = {};
    reports.forEach(r=>{
      if(!r.product_id || !r.test_date) return;
      if(!map[r.product_id] || r.test_date > map[r.product_id]) map[r.product_id] = r.test_date;
    });
    return map;
};
// A product's testing date: its latest linked report, else the hand-entered
// manual_test_date. A linked report always wins -- see the note on the Testing
// page's Testing date column.
export const testingDateOf = (p, latestByProduct) => latestByProduct[p.id] || p.manual_test_date || null;
