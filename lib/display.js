// ── Small display helpers shared by app/page.jsx and its components ─────────
// Moved out of page.jsx unchanged so app/components (the order notes panel) can
// draw the same avatars and times without importing the page.

// Per-company color — identical hash+palette to the Quotes app so a company's
// hue is the SAME in both systems.
export const CLIENT_PALETTE = ['#f87171','#fb923c','#fbbf24','#a3e635','#4ade80','#2dd4bf','#58a6ff','#818cf8','#a78bfa','#f472b6','#fb7185','#22d3ee'];
export function companyColor(name){
  const n=(name||'Unassigned').trim(); let hash=0;
  for(let i=0;i<n.length;i++) hash=(hash*31+n.charCodeAt(i))>>>0;
  return CLIENT_PALETTE[hash % CLIENT_PALETTE.length];
}
export function initials(name){ return (name||'?').replace(/[^A-Za-z0-9 ]/g,'').split(/\s+/).filter(Boolean).slice(0,2).map(w=>w[0].toUpperCase()).join('')||'?'; }

export const fmtDateTime = s => { if (!s) return ''; const d=new Date(s); return d.toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · '+d.toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}); };
