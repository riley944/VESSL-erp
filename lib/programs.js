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

// ── THE CHECKLIST TEMPLATES, AND SEEDING THEM ───────────────────────────────
// Here rather than in programs.jsx because two things move cards now: a person
// on the board, and a purchase order being saved. Both must leave a card with
// the same checklist, so the list and the rule live in one place.
//
// Riley's 11 Aug templates on the six-stage ladder. Quoting has none, as it had
// none then.
//
// PRE-PRODUCTION FOLDED INTO PRODUCTION. Its three tasks were PO issued, the
// pre-production sample approved and the deposit paid. A saved PO is what puts
// a card in Production now, so "PO issued" is true on arrival and is dropped;
// the other two are real work that still happens after the PO, and lead the
// Production list.
//
// NO OWNER PER STAGE. The 11 Aug STAGE_OWNER table assigned every seeded task to
// a named person by stage; that went on decision, so seeded tasks belong to
// whoever owns the card when it moves, and nobody when nobody does.
export const STAGE_TASKS = {
  sampling:   ['Request sample from factory', 'Sample received from factory', 'Sample sent to client', 'Client feedback received'],
  revision:   ['Log requested changes', 'Changes sent to factory', 'Revised sample received', 'Client sign-off'],
  testing:    ['Submit to lab', 'Results received', 'Compliance filed'],
  production: ['Pre-production sample approved', 'Production deposit paid', 'Production started', 'Production complete', 'QC / inspection booked'],
  shipped:    ['Freight quote issued', 'Booking confirmed', 'Docs sent to client'],
};

// ONCE PER STAGE, EVER. Seeds only if the card has no task at all for the stage,
// done or not, read from the database -- so a card coming back to a stage finds
// its old list rather than a second copy. Called after a move lands, never
// before, so a refused move leaves nothing behind.
//
// Returns { seeded, error } and never throws: every caller has already moved the
// card, and a missing checklist must not undo that.
export async function seedStageTasks(programId, stage, { ownerId = null, byEmail = null } = {}) {
  const list = STAGE_TASKS[stage];
  if (!programId || !list) return { seeded: 0, error: null };
  const { count, error: ce } = await SB.from('program_tasks')
    .select('id', { count: 'exact', head: true })
    .eq('program_id', programId).eq('stage', stage);
  if (ce) return { seeded: 0, error: ce };
  if ((count || 0) > 0) return { seeded: 0, error: null };
  const { error } = await SB.from('program_tasks').insert(list.map((task, i) => ({
    program_id: programId, stage, task, owner_id: ownerId || null,
    assigned_by: byEmail || null, blocker: 'none', sort_order: i,
  })));
  return { seeded: error ? 0 : list.length, error: error || null };
}

// ── A PURCHASE ORDER PUTS A CARD IN PRODUCTION ──────────────────────────────
// THE ONE AUTOMATIC MOVE ON THE BOARD, on decision. Everything else a card does,
// a person did. When a PO is saved for a product and client whose card sits at
// an earlier stage, the card moves to Production and says so in a note.
//
// EARLIER MEANS quoted, sampling, revision or testing -- and NO STAGE AT ALL,
// on decision: a card nobody staged is before the ladder, not beside it. A card
// already in Production or Shipped is left alone; a PO arriving for a shipped
// product is a reorder, not a reason to drag the card backwards.
//
// WHAT IT NEVER DOES:
//   - create a card. No card for the pair means nothing happens -- Create PLM
//     Card on a quote stays the only door in.
//   - touch a removed card. archived is a person's decision about the board, and
//     a PO does not overrule it.
//   - move one card twice. Several lines for one product on one PO are one pair,
//     so one move and one note.
//
// It does what a hand move does after it: seeds the Production checklist and
// moves the product's own stage forward (syncProductStage).
//
// THE GUARD IS IN THE UPDATE, not only in the read before it. The update carries
// the same stage and archived conditions and returns the rows it actually
// changed, so a card somebody moved or removed in the second between the read
// and the write is left as they left it, and gets no note claiming otherwise.
//
// NEVER THROWS. The PO is saved by the time this runs, and a failed move is a
// card somebody can move by hand; interrupting a completed save over it would be
// the wrong trade. Returns { moved, error } for the caller to report.
// ── THE PRODUCT'S STAGE FOLLOWS ITS CARDS, FORWARD ONLY ─────────────────────
// products.product_stage says what a PRODUCT is -- sample or production -- and a
// card moving is the best evidence of that the system has. So a stage move on a
// card writes it, on decision, with one rule that keeps it honest:
//
//   production, shipped            -> 'production'
//   sampling, revision, testing    -> 'sample', but ONLY if it is not set yet
//   quoted                         -> nothing
//
// FORWARD ONLY because the stage belongs to the product, not to one client. A
// product already in production for one client that gets a new card for a
// second, entering Sampling for that client's round, is still a production
// product -- and a card moved back by mistake must not demote it either. So
// 'sample' never overwrites 'production', and several cards on one product give
// the same answer whatever order they move in. Putting a product back to sample
// is done by hand on the Testing page, where it always was.
//
// THE RULE IS IN THE UPDATE'S FILTER, not in a read before it, so it holds
// against a concurrent edit on the Testing page. Returns { changed, error } and
// never throws -- the card has already moved, and a product stage that did not
// follow is fixable by hand.
export async function syncProductStage(productId, cardStage) {
  if (!productId) return { changed: false, error: null };
  try {
    let q = null;
    if (cardStage === 'production' || cardStage === 'shipped') {
      q = SB.from('products').update({ product_stage: 'production' }).eq('id', productId)
        .or('product_stage.is.null,product_stage.neq.production');
    } else if (cardStage === 'sampling' || cardStage === 'revision' || cardStage === 'testing') {
      q = SB.from('products').update({ product_stage: 'sample' }).eq('id', productId)
        .is('product_stage', null);
    } else {
      return { changed: false, error: null };
    }
    const { data, error } = await q.select('id');
    return { changed: !!(data && data.length), error: error || null };
  } catch (e) {
    return { changed: false, error: e };
  }
}

const BEFORE_PRODUCTION = ['quoted', 'sampling', 'revision', 'testing'];
const STAGE_WORD = { quoted:'Quoting', sampling:'Sampling', revision:'Revision', testing:'Testing' };

export async function advanceToProductionForPO({ clientCompanyId, productIds, poNumber = null, byEmail = null }) {
  const ids = Array.from(new Set((productIds || []).filter(Boolean)));
  if (!clientCompanyId || !ids.length) return { moved: [], error: null };
  try {
    // Whoever saved the PO, read from the session when the caller does not
    // know it -- neither PO modal is handed the signed-in address.
    let by = byEmail;
    if (!by) {
      try { const { data } = await SB.auth.getUser(); by = (data && data.user && data.user.email) || null; } catch (e) {}
    }
    const { data: cards, error: re } = await SB.from('programs')
      .select('id,declared_stage,owner_id,product_id')
      .eq('client_company_id', clientCompanyId).in('product_id', ids)
      .eq('archived', false)
      .or('declared_stage.is.null,declared_stage.in.(' + BEFORE_PRODUCTION.join(',') + ')');
    if (re) return { moved: [], error: re };
    const moved = [];
    let firstErr = null;
    for (const c of cards || []) {
      const now = new Date().toISOString();
      const { data: hit, error: ue } = await SB.from('programs')
        .update({ declared_stage: 'production', updated_at: now, updated_by: by || null })
        .eq('id', c.id).eq('archived', false)
        .or('declared_stage.is.null,declared_stage.in.(' + BEFORE_PRODUCTION.join(',') + ')')
        .select('id');
      if (ue) { firstErr = firstErr || ue; continue; }
      if (!hit || !hit.length) continue;          // moved or removed meanwhile
      moved.push(c.id);
      // The note is the record that nobody pressed anything. Written after the
      // move lands; a failed note leaves a correct stage and a missing line.
      const from = c.declared_stage ? STAGE_WORD[c.declared_stage] || c.declared_stage : 'no stage';
      try {
        await SB.from('program_notes').insert({
          program_id: c.id, author: by || null, source: 'po-auto',
          note: 'Moved from ' + from + ' to Production automatically — purchase order '
              + (poNumber ? poNumber + ' ' : '') + 'saved' + (by ? ' by ' + by : '') + '.',
        });
      } catch (e) {}
      const seed = await seedStageTasks(c.id, 'production', { ownerId: c.owner_id, byEmail: by });
      if (seed.error) firstErr = firstErr || seed.error;
      // The product follows the card, as it does for a move made by hand.
      const ps = await syncProductStage(c.product_id, 'production');
      if (ps.error) firstErr = firstErr || ps.error;
    }
    return { moved, error: firstErr };
  } catch (e) {
    return { moved: [], error: e };
  }
}
