'use client';
import { useState, useEffect } from "react";
import { SB } from "@/lib/supabase";

// ── ProductCpscRules ─────────────────────────────────────────────────────────
// The CPSC rules linked to the PRODUCT a quote's SKU names. DISPLAY ONLY -- it
// reads products, product_regulations and regulations, and writes nothing. There
// is no quote_regulations table and this does not add one; the answer belongs to
// the product, and a quote borrows it by naming the same SKU.
//
// Sits directly above HtsRuleHints in the quote form's Product section, and
// SUPPRESSES it when a product answered. An authored answer goes above a
// heuristic, and replaces it rather than sitting beside it:
//
//   The 152 links in product_regulations use three rules -- 16 CFR 1610,
//   16 CFR 1303 and 15 USC 1278a. Two of those three are members of the four-rule
//   children's set that HtsRuleHints renders as a CONDITIONAL sentence ("if this
//   is a children's product..."), and 1610 is the one it flags as depending on an
//   age grade the quote does not record. So a linked product has already settled
//   exactly what the hint hedges about. Rendering both puts a hedge next to an
//   answer, and a reader has no way to tell which one to act on.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ THE SKU JOIN IS A STRING MATCH, NOT A KEY. It can return several rows.      │
// │                                                                             │
// │ quotes has no product_id and no foreign keys at all -- product and sku are  │
// │ free text typed into the form. products.sku is not unique either: 271 rows  │
// │ hold 240 distinct SKUs.                                                     │
// │                                                                             │
// │ Of the 291 quotes: 211 match exactly one product, 60 match SEVERAL, and 20  │
// │ match none. That 60 is why "several" is a state of its own that names what  │
// │ it found and picks nothing. Choosing one -- first row, newest, any rule --  │
// │ would answer a compliance question from a coin toss, and it would look      │
// │ exactly like the 211 confident cases. Surfacing the ambiguity IS the point. │
// │                                                                             │
// │ Naming the matched product in the confident case is part of the same rule:  │
// │ a string join can match the wrong thing, and the product's name is what     │
// │ lets a reader catch it.                                                     │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Lives here rather than inline in quotes.jsx for the reason HtsRuleHints and
// HtsField did: the same block is wanted on other hosts once something else
// carries a SKU, and a rule that governs one of two copies is a rule the next
// person reads in the file they were not editing.

// PERFORMANCE. f.sku changes on every keystroke, so nothing here may touch the
// network per character. All three tables load ONCE per host and every match is
// an in-memory scan of 271 + 152 + 12 rows -- the same arrangement useHtsRuleMap
// uses, for the same reason.
//
// regulations is filtered to active HERE so `.eq('active', true)` is written in
// one place, as useHtsCodes does. sort_order then code matches the rule library's
// own order; the second key is not decoration, since Postgres may return a tie in
// a different order between queries and the list would reshuffle between loads.
export function useProductCpscRules() {
  const [map, setMap] = useState({ products: [], links: [], regs: [] });
  useEffect(() => {
    let alive = true;
    Promise.all([
      SB.from('products').select('id,sku,name'),
      SB.from('product_regulations').select('product_id,regulation_id'),
      SB.from('regulations').select('id,code,name').eq('active', true).order('sort_order').order('code'),
    ]).then(([p, l, r]) => {
      if (!alive) return;
      // On error the piece that failed stays empty, every SKU reads as unmatched,
      // and HtsRuleHints keeps rendering. A failed fetch costs the answer and
      // falls back to the heuristic -- never to a wrong answer, and never to the
      // quote.
      setMap({
        products: (!p.error && p.data) || [],
        links: (!l.error && l.data) || [],
        regs: (!r.error && r.data) || [],
      });
    });
    return () => { alive = false; };
  }, []);
  return map;
}

// lower(btrim(sku)) exactly, spaces only, because that is the normalisation the
// 211 / 60 / 20 counts above were measured with and those numbers should stay
// reproducible from this line. String.prototype.trim() would also strip tabs and
// newlines, which is a different function -- wider, and quietly so.
const normSku = v => String(v == null ? '' : v).replace(/^ +| +$/g, '').toLowerCase();

// Pure, so the host can compute the match once and use it for BOTH the block
// below and the decision to suppress HtsRuleHints. Two callers each deriving the
// state for themselves is two chances to disagree about whether a product
// answered, and the disagreement would render as a hedge beside an answer --
// precisely the thing this component exists to prevent.
export function matchSkuToProduct(sku, map) {
  const key = normSku(sku);
  if (!key) return { kind: 'none', answered: false };

  const hits = (map.products || []).filter(p => normSku(p.sku) === key);
  if (hits.length === 0) return { kind: 'none', answered: false };
  // Every SKU in products today resolves to at most three rows, so the list is
  // rendered whole rather than truncated.
  if (hits.length > 1) return { kind: 'several', answered: false, products: hits };

  const product = hits[0];
  const links = (map.links || []).filter(l => l.product_id === product.id);
  if (links.length === 0) return { kind: 'unlinked', answered: false, product };

  // Resolved by iterating regs rather than links, so the order is the rule
  // library's own instead of whatever order the link rows arrived in -- the same
  // resolution the Edit Product modal's read-only block does.
  //
  // regs holds active rules only, so a link to a RETIRED rule resolves to nothing
  // and is COUNTED rather than allowed to vanish. Identical treatment to Edit
  // Product, deliberately: the link is real, and a block that quietly lists fewer
  // rules than are linked is the same failure as a picker that blanks an unlisted
  // code. No links point at a retired rule today; the count is what keeps that
  // true the day one is retired.
  const linkedIds = new Set(links.map(l => l.regulation_id));
  const rules = (map.regs || []).filter(r => linkedIds.has(r.id));
  const retiredCount = links.length - rules.length;
  // Keyed on the LINK existing, not on the rule resolving, so a product whose
  // links are all retired still reads as answered. Same test as Edit Product's
  // `links.length === 0`. The alternative would tell a reader "no CPSC rules
  // linked to this product" about a product that has some.
  return { kind: 'linked', answered: true, product, rules, retiredCount };
}

const wrap = { border: '1px solid #e7eaf0', borderRadius: 12, padding: '11px 13px', background: '#fbfcfe' };
const head = { fontSize: 11.5, fontWeight: 600, color: '#3461e0', letterSpacing: '0.02em' };
const sub = { fontSize: 11.5, color: '#6a7488', marginTop: 3, lineHeight: 1.5 };
const row = { fontSize: 12.5, color: '#0f1729', marginTop: 7, lineHeight: 1.45 };
const mono = { fontFamily: 'var(--mono)', fontSize: 11.5, fontWeight: 600 };

export function ProductCpscRules({ match, style }) {
  // Nothing at all when no product was found, and HtsRuleHints carries on exactly
  // as it does today. A block reading "this SKU matches no product" would sit on
  // 20 of 291 quotes plus every quote mid-typing, and text that is usually noise
  // stops being read by the time it matters.
  if (!match || match.kind === 'none') return null;

  if (match.kind === 'several') {
    const n = match.products.length;
    return (
      // Amber, because this is the duplicate-SKU problem showing itself rather
      // than a result. The point of the state is that it looks nothing like the
      // confident one.
      <div style={{ ...style, ...wrap, borderColor: '#f2dfae', background: '#fffdf7' }}>
        <div style={{ ...head, color: '#b45309' }}>{'SKU matches ' + n + ' products'}</div>
        <div style={sub}>
          No rules are shown, because which product this quote means is not settled. Quotes carry a SKU as
          text, and this one resolves to more than one row.
        </div>
        {match.products.map(p => (
          <div key={p.id} style={row}>
            <span style={mono}>{p.sku}</span>
            <span style={{ color: '#6a7488' }}>{'  —  '}</span>
            {p.name || <span style={{ color: '#9aa3b5' }}>unnamed</span>}
          </div>
        ))}
      </div>
    );
  }

  if (match.kind === 'unlinked') {
    return (
      <div style={{ ...style, ...wrap }}>
        <div style={head}>{'Product ' + (match.product.sku || '')}</div>
        <div style={sub}>
          No CPSC rules linked to this product. Rules are linked on the product itself, from the Testing page.
        </div>
      </div>
    );
  }

  // kind === 'linked'
  return (
    <div style={{ ...style, ...wrap }}>
      <div style={head}>{'Product ' + (match.product.sku || '') + '  ·  CPSC rules linked'}</div>
      {/* Named, and stated as a fact about the product rather than about the
          quote. Unlike the HTS block this is not a suggestion from a
          classification -- someone linked these rules to this product -- and the
          wording has to carry that difference, since the two blocks otherwise
          occupy the same slot in the form. */}
      <div style={sub}>
        {(match.product.name || 'This product') + ' — linked on the product, not derived from the tariff code.'}
      </div>
      {match.rules.map(r => (
        <div key={r.id} style={row}>
          <b style={mono}>{r.code}</b>{r.name ? ' — ' + r.name : ''}
        </div>
      ))}
      {match.retiredCount > 0 && (
        <div style={{ ...sub, marginTop: 7 }}>
          {match.retiredCount === 1 ? '1 linked rule is retired' : match.retiredCount + ' linked rules are retired'} and not shown here.
        </div>
      )}
    </div>
  );
}
