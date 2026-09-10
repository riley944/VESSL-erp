'use client';

// ── THE PAGE IS A PLACEHOLDER WHILE THE TABLE IS REBUILT ────────────────────
// Step 1 of three, and it ships BEFORE script 48 runs rather than after.
//
// 48 renames programs, program_tasks and program_notes to _legacy and puts a
// product x client table in their place. Everything this file did read or wrote
// the old shape -- stage as one of nine values, program_tasks, the free-text
// product / sku / client / factory columns -- so left in place it would start
// erroring against columns that no longer exist the moment 48 commits.
//
// THE WHOLE FILE WENT, not just the page component. Every other component here
// -- the factory sheet export, the import, the program detail, its task rows and
// the email composer -- existed only to serve that page, and page.jsx imports
// nothing from this file but the default export. It is all in git history at
// this commit's parent, and none of it is worth keeping commented out, because
// the rebuilt page reads different columns and DERIVES five of its stages
// rather than storing them.
//
// EXPORT AND IMPORT ARE VISIBLE AND DISABLED, deliberately. They are the factory
// round trip and it comes back in phase 2B with expected_ship_date as a real
// column instead of a date crushed into a note on import. A disabled control
// with a reason says "shortly"; a removed one says "gone", and only one of those
// is true.
//
// NOTHING IS LOST MEANWHILE. The old table held ONE row, eight tasks and zero
// notes, and 48 keeps every one of them under _legacy. The rebuilt programs are
// seeded from quotes, sales orders and purchase orders the app already holds.
export default function Programs({ userEmail }) {
  const Btn = ({ children }) => (
    <button disabled title="Coming back with the rebuilt Programs page"
      style={{background:'#f2f2f4',color:'#b0b0b4',border:'1px solid #e5e5ea',borderRadius:'980px',
              padding:'9px 16px',fontSize:'13.5px',fontWeight:500,cursor:'default',fontFamily:'inherit'}}>
      {children}
    </button>
  );
  return (
    <div style={{padding:'28px 30px',maxWidth:'760px'}}>
      <div style={{display:'flex',alignItems:'center',gap:'12px',flexWrap:'wrap',marginBottom:'18px'}}>
        <h1 style={{fontSize:'26px',fontWeight:700,letterSpacing:'-.02em',color:'#1D1D1F',margin:0}}>Programs</h1>
        <span style={{fontSize:'11px',fontWeight:700,letterSpacing:'.06em',textTransform:'uppercase',
                      color:'#b45309',background:'#FEF3C7',border:'1px solid #f0d9a8',
                      borderRadius:'980px',padding:'4px 11px'}}>Being rebuilt</span>
      </div>
      <div style={{background:'#fff',borderRadius:'18px',padding:'26px 28px',boxShadow:'0 1px 3px rgba(0,0,0,.05)'}}>
        <p style={{margin:'0 0 12px',fontSize:'14.5px',color:'#1D1D1F',lineHeight:1.6}}>
          Programs are being rebuilt around <strong>a product for a client</strong>.
        </p>
        <p style={{margin:'0 0 12px',fontSize:'13.5px',color:'#5A5A5E',lineHeight:1.65}}>
          Quoted, Ordered, Shipped, Delivered and Sold will read from that client&rsquo;s own
          records rather than being typed in and kept up to date by hand. Inquiry and
          Sampling stay manual, because those are the two nobody else can tell you.
        </p>
        <p style={{margin:'0 0 18px',fontSize:'13.5px',color:'#5A5A5E',lineHeight:1.65}}>
          Nothing has been lost. The existing program, its tasks and its notes are kept,
          and the rebuilt page starts from the quotes, sales orders and purchase orders
          already recorded.
        </p>
        <div style={{display:'flex',gap:'8px',flexWrap:'wrap',paddingTop:'16px',borderTop:'1px solid #F0F0F2'}}>
          <Btn>Export factory sheet</Btn>
          <Btn>Import reply</Btn>
        </div>
        <p style={{margin:'12px 0 0',fontSize:'12px',color:'#8A8A8E',lineHeight:1.55}}>
          The factory round trip is coming back with an expected ship date column, so the
          date stops being crushed into the notes field on import.
        </p>
      </div>
    </div>
  );
}
