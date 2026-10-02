import { SIZE_SCALES } from '@/app/components/SizeGrid';

// ── PURCHASE ORDER LINES IN READING ORDER ───────────────────────────────────
// purchase_order_items has no position column and both readers fetch with no
// ORDER BY, so lines arrive in the table's physical order. That follows entry
// order only until the PO is edited: the edit save UPDATEs every row, Postgres
// writes each new row version wherever there is room, and the lines come back
// shuffled. A two-style, eight-size PO then reads as sixteen interleaved lines.
//
// This puts them back into an order a factory can read, for the PO document and
// the PO detail table alike:
//   - lines of one STYLE (same description, SKU and product) sit together, the
//     styles in the order they first appear;
//   - within a style, sizes run in their scale's own order, smaller wearers first
//     (Toddler, Youth, Adult), a size on no scale last;
//   - a line with no size stays a single line where it is, unless it shares a
//     style with sized lines, when it goes at the end of that style.
// A PO with no sizes therefore comes back exactly as it was fetched.

// Smallest wearer first. Bag and Collar have no age, so they keep SIZE_SCALES order.
const SCALE_ORDER = ['toddler', 'youth', 'adult'];
const SCALES = SCALE_ORDER.map(k => SIZE_SCALES.find(s => s.key === k)).filter(Boolean)
  .concat(SIZE_SCALES.filter(s => !SCALE_ORDER.includes(s.key)));

const norm = v => String(v == null ? '' : v).trim().replace(/\s+/g, ' ');
const low = v => norm(v).toLowerCase();

// A stored size is a display label: "Adult L", "Youth XS", or a bare "L" / "2XL"
// when the line's scales did not collide on it (see sizesForSelection). The
// prefix is either a scale's short name or its full label.
function splitSize(label) {
  const t = low(label);
  for (const sc of SCALES) {
    for (const p of [sc.label, sc.short]) {
      const pre = p.toLowerCase() + ' ';
      if (t.startsWith(pre)) return { scale: sc.key, size: t.slice(pre.length).trim() };
    }
  }
  return { scale: null, size: t };
}

// [scale position, size position], or null for a size on no scale. A bare label
// goes to a scale the style already names explicitly when one has it -- a bare
// XS beside "Youth S" is the youth XS -- and otherwise to the first scale that
// has it. Adult, Youth and Bag order S, M, L, XL alike, so the pick cannot
// reorder a single-scale style.
function sizeRank(label, styleScales) {
  const { scale, size } = splitSize(label);
  const at = sc => sc.sizes.findIndex(s => s.toLowerCase() === size);
  if (scale) {
    const si = SCALES.findIndex(s => s.key === scale);
    const zi = at(SCALES[si]);
    return zi < 0 ? null : [si, zi];
  }
  const cands = SCALES.map((sc, si) => [si, at(sc)]).filter(([, zi]) => zi >= 0);
  if (!cands.length) return null;
  return cands.find(([si]) => styleScales.has(SCALES[si].key)) || cands[0];
}

// lines: any objects. get: { description, sku, product, size } -- each a function
// of a line. Returns blocks in reading order:
//   { kind:'line',  line }              a line with no size, as it stands
//   { kind:'style', lines }             a sized style, its lines in size order
export function poLineBlocks(lines, get) {
  const keyOf = l => low(get.description(l)) + '\u0000' + low(get.sku(l)) + '\u0000' + norm(get.product(l));
  const sized = l => norm(get.size(l)) !== '';
  const sizedKeys = new Set(lines.filter(sized).map(keyOf));
  const blocks = [];
  const styles = new Map();
  lines.forEach(l => {
    const k = keyOf(l);
    if (!sizedKeys.has(k)) { blocks.push({ kind: 'line', line: l }); return; }
    let b = styles.get(k);
    if (!b) { b = { kind: 'style', lines: [] }; styles.set(k, b); blocks.push(b); }
    b.lines.push(l);
  });
  styles.forEach(b => {
    const styleScales = new Set(b.lines.map(l => splitSize(get.size(l)).scale).filter(Boolean));
    const ranked = b.lines.map((l, i) => ({ l, i, r: sized(l) ? sizeRank(get.size(l), styleScales) : null, s: sized(l) }));
    // Ranked sizes first, then sizes on no scale, then lines with no size; each
    // of the last two keeps its fetched order.
    const tier = x => (x.r ? 0 : x.s ? 1 : 2);
    ranked.sort((a, b2) => tier(a) - tier(b2)
      || (a.r && b2.r ? (a.r[0] - b2.r[0]) || (a.r[1] - b2.r[1]) : 0)
      || a.i - b2.i);
    b.lines = ranked.map(x => x.l);
  });
  return blocks;
}
