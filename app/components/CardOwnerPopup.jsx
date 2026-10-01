'use client';
import { Overlay } from '@/app/components/ModalGuard';
import { OwnerSelect } from '@/app/components/OwnerSelect';

// ── THE "WHO OWNS THE NEW CARD" POPUP ───────────────────────────────────────
// Create PLM Card's popup, lifted out of MarkWonButton unchanged so the PLM
// page's Quote ID box asks the same question in the same words. Nothing is
// written until Start; the owner defaults to the quote's creator, chosen by the
// caller (ownerIdForEmail on quotes.updated_by), and Unowned stays a choice.
export function CardOwnerPopup({ title, staff = [], ownerId, busy = false, onOwner, onStart, onCancel }) {
  return (
    <Overlay onClose={onCancel} maxWidth={420}>
      <div style={{ fontSize:17, fontWeight:600, color:'#0f1729', letterSpacing:'-.01em' }}>
        {title}
      </div>
      <div style={{ fontSize:12.5, color:'#6a7488', marginTop:6, lineHeight:1.5 }}>
        Opens a card at Quoted. Nothing is written until you press Start.
      </div>
      <label style={{ display:'flex', flexDirection:'column', gap:5, marginTop:16,
                      fontSize:11, fontWeight:600, letterSpacing:'.08em',
                      textTransform:'uppercase', color:'#86868B', fontFamily:'inherit' }}>
        Owner
        <OwnerSelect value={ownerId} staff={staff} disabled={busy}
          onChange={onOwner}
          style={{ minWidth:0, width:'100%' }} />
      </label>
      <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:20 }}>
        <button onClick={onCancel} disabled={busy}
          style={{ background:'#F2F2F4', border:'none', borderRadius:10, padding:'9px 16px',
                   fontSize:13, fontWeight:600, color:'#5A5A5E', fontFamily:'inherit',
                   cursor: busy ? 'default' : 'pointer' }}>Cancel</button>
        <button onClick={onStart} disabled={busy}
          style={{ background:'#0f7d43', border:'none', borderRadius:10, padding:'9px 18px',
                   fontSize:13, fontWeight:600, color:'#fff', fontFamily:'inherit',
                   cursor: busy ? 'default' : 'pointer' }}>{busy ? 'Starting…' : 'Start'}</button>
      </div>
    </Overlay>
  );
}
