import { SB } from '@/lib/supabase';

// ── A PROGRAM IS CREATED BY THE WORK, NOT BY A FORM ─────────────────────────
// Quoting a product for a client, selling it to them, or ordering it for them
// IS the program starting. Nobody should have to remember to declare one, and
// the seed in script 48 was built from exactly these three records -- so the
// live paths have to keep doing what the seed did, or the table drifts from the
// day it was created.
//
// IDEMPOTENT BY CONSTRAINT, not by checking first. programs carries
// UNIQUE (product_id, client_company_id), so this upserts with
// ignoreDuplicates and lets the database decide what is new. No read, no race,
// no chance of two saves creating two programs for the same pair.
//
// IT NEVER UPDATES, and that is deliberate. ignoreDuplicates means an existing
// row is left completely alone -- including its archived flag and its declared
// stage. A program somebody archived by hand must not be resurrected because a
// new order line arrived, and un-retiring a product must not silently reopen
// work. Archiving stays with the retire action, per the phase 2A decision.
//
// FAILURES ARE RETURNED, NOT THROWN. Every caller is a save that has already
// succeeded -- the sales order exists, the quote is marked won -- and a program
// that did not get created is a missing row somebody can fix from the Programs
// page with one button. Interrupting a completed save with an alert about
// bookkeeping would be the wrong trade.
export async function ensurePrograms(pairs) {
  const seen = new Set();
  const rows = [];
  for (const [productId, clientId] of pairs || []) {
    if (!productId || !clientId) continue;      // an unlinked line names no program
    const k = productId + '|' + clientId;
    if (seen.has(k)) continue;                  // several lines, one program
    seen.add(k);
    rows.push({ product_id: productId, client_company_id: clientId });
  }
  if (!rows.length) return { attempted: 0, error: null };
  const { error } = await SB.from('programs')
    .upsert(rows, { onConflict: 'product_id,client_company_id', ignoreDuplicates: true });
  return { attempted: rows.length, error: error || null };
}

// ── THE ONE DOOR INTO THE PROGRAMS TABLE ────────────────────────────────────
// PLM is kept by hand since script 60. A card exists because somebody pressed
// Create PLM Card on a quote card, and it opens at the stage that button means
// -- quoted -- owned by whoever the popup names.
//
// OWNER IS RESOLVED HERE, from an email to a staff_profiles id, because
// programs.owner_id is a foreign key and a key cannot hold a typo. An email with
// no staff row resolves to NULL rather than failing the whole call -- an unowned
// card is a visible state the board shows and somebody can fix, and refusing to
// create the card would punish the quote for a missing profile.
//
// INSERT ONLY, by the same ignoreDuplicates contract ensurePrograms uses. If a
// card already exists for the pair it is left exactly as it is -- its stage, its
// owner and its notes. Pressing the button on a second quote for the same product
// and client must not drag a card back to quoted or take it off its owner.
// AN ID WINS OVER AN EMAIL, and skips the lookup entirely. The popup asks who
// should own the card now and hands back the staff_profiles id the picker chose,
// so turning that id back into an email so this could look the id up again would
// be a round trip that can only lose. ownerEmail stays for any caller that
// genuinely knows only an address.
//
// NEITHER IS A FALLBACK FOR THE OTHER. A caller that passes ownerId null has said
// Unowned, and that is a state the board shows on purpose -- quietly substituting
// the email of whoever happened to be signed in would overwrite a decision.
// CREATING A CARD IS A TOUCH. createdBy is the address of whoever opened it, and
// it is stamped on the insert so a new card never reads as never touched. The one
// door passes it -- the Create PLM Card popup on the quote card. The quote form
// used to carry a tick that opened a card on save; it is gone, and this function
// now has a single caller.
//
// ONLY A NEW ROW GETS IT, and that falls out of ignoreDuplicates rather than
// needing a guard: an upsert that hits the existing product and client pair writes
// nothing at all, so a card somebody else made keeps the last touch it already
// had. Pressing the button on a second quote for the same pair cannot restamp it.
export async function createProgram(productId, clientId, { stage = 'quoted', ownerEmail = null, ownerId = null, createdBy = null } = {}) {
  if (!productId || !clientId) return { created: false, error: null, reason: 'no product or no client' };
  let owner = ownerId || null;
  if (!owner && ownerEmail) {
    const { data } = await SB.from('staff_profiles').select('id').ilike('email', ownerEmail.trim()).limit(1);
    owner = (data && data[0] && data[0].id) || null;
  }
  const { error } = await SB.from('programs')
    .upsert([{ product_id: productId, client_company_id: clientId, declared_stage: stage, owner_id: owner,
               updated_by: createdBy || null, updated_at: new Date().toISOString() }],
            { onConflict: 'product_id,client_company_id', ignoreDuplicates: true });
  return { created: !error, error: error || null, ownerId: owner };
}

// Every product-and-client pair the records prove, read fresh. The same three
// sources script 48 seeded from, in the same order, so the sweep and the seed
// cannot disagree about what a program is.
//
// NOTHING CALLS THIS TODAY. Its only caller was Sync from records, removed when
// the board became manual. It is kept because it is the honest way to write a
// deliberate catch-up if one is ever wanted again, and because rewriting it from
// memory later would be how the seed and the sweep start disagreeing.
export async function pairsFromRecords() {
  const [q, poi, soi] = await Promise.all([
    SB.from('quotes').select('product_id,client_company_id').not('product_id','is',null).not('client_company_id','is',null),
    SB.from('purchase_order_items').select('product_id,purchase_orders(client_company_id)').not('product_id','is',null),
    SB.from('sales_order_items').select('product_id,sales_orders(client_company_id)').not('product_id','is',null),
  ]);
  const err = [q, poi, soi].find(r => r.error);
  if (err) throw new Error(err.error.message);
  const out = [];
  (q.data   || []).forEach(r => out.push([r.product_id, r.client_company_id]));
  (poi.data || []).forEach(r => out.push([r.product_id, (r.purchase_orders || {}).client_company_id]));
  (soi.data || []).forEach(r => out.push([r.product_id, (r.sales_orders   || {}).client_company_id]));
  return out.filter(([p, c]) => p && c);
}
