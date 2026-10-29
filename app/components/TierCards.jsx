'use client';
import { tierTotalCost, moldPerUnit, effectiveQty, tierMoldFee } from '@/lib/tierCost';
import { sizeLines } from '@/lib/quoteTiers';
import { fmtUnit, tierMargin, tierQtyShown, sizeLineText, freightCell, dutyCell, NO_PRICE_TEXT, NO_PRICE_TIP } from '@/lib/quoteFigures';

// ── A QUOTE'S TIERS AS CARDS ────────────────────────────────────────────────
// One card per tier, label and value pairs: Quantity, EXW Cost, Method,
// Freight, Duty, Total Cost, Client Price, Margin, then the size line. Lifted
// from ExpandedDetail's phone branch in app/quotes.jsx so the iPad view
// (app/m) shows the same figures in the same order.
//
//   variant 'desktop'  exactly the phone card the Quotes page always drew --
//                      the style values below are copied from quotes.jsx's S
//                      (tierTable, detailLabel, num, methodTag, sizeDetailLine)
//   variant 'touch'    the iPad view's rules: every word shown in full and
//                      wrapping, numbers on one line, nothing clipped (no
//                      overflow:hidden, no ellipsis), type from the --m-fs and
//                      --m-fs-meta variables (15/13 on iPad, 14/12 on a
//                      phone), and as many columns as fit, down to one.

// NO CLIENT PRICE, SAID RATHER THAN DASHED -- see lib/quoteFigures.js.
export function PriceTag({ text, tip }) {
  return (
    <span title={tip} style={{ display: "inline-block", fontSize: 11, fontWeight: 500, color: "#6a7488", background: "#f1f3f7",
      borderRadius: 999, padding: "2px 8px", whiteSpace: "nowrap", lineHeight: 1.5, fontVariantNumeric: "normal" }}>{text}</span>
  );
}

const DESKTOP = {
  tierTable: { border: "1px solid #e7eaf0", borderRadius: 12, overflow: "hidden", background: "#ffffff" },
  detailLabel: { fontSize: 11, color: "#9aa3b5" },
  num: { fontSize: 14, fontVariantNumeric: "tabular-nums", color: "#0f1729" },
  methodTag: { fontSize: 11, fontWeight: 600, color: "#3461e0", background: "#eef1f6", borderRadius: 12, padding: "2px 9px" },
  sizeDetailLine: { fontSize: 11.5, color: "#6a7488", fontVariantNumeric: "tabular-nums", lineHeight: 1.45 },
};

export function TierCards({ q, dutyRate = null, variant = 'desktop' }) {
  if (variant === 'touch') return <TouchTierCards q={q} dutyRate={dutyRate} />;
  const S = DESKTOP;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {(q.tiers || []).map((t, i) => {
        const m = tierMargin(t, t.client, q.moldFee, dutyRate);
        const total = tierTotalCost(t, q.moldFee, dutyRate);
        const mpu = moldPerUnit(tierMoldFee(t, q.moldFee), effectiveQty(t));
        const sz = sizeLines(t, q.sizeScales, q.sizeDeltas);
        const pair = (label, value, strong) => (
          <div style={{ minWidth: 0 }}>
            <div style={S.detailLabel}>{label}</div>
            <div style={{ ...S.num, fontSize: 13.5, ...(strong ? { fontWeight: 600, color: "#0f1729" } : {}) }}>{value}</div>
          </div>
        );
        return (
          <div key={i} style={{ ...S.tierTable, padding: "10px 12px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px 14px" }}>
            {pair("Quantity", tierQtyShown(t) ? tierQtyShown(t).toLocaleString() : "—", true)}
            {pair("EXW Cost", t.landed ? `$${fmtUnit(t.landed)}` : "—")}
            {pair("Method", <span style={S.methodTag}>{(t.ship || "ocean") === "air" ? "Air" : "Ocean"}</span>)}
            {pair("Freight", freightCell(t))}
            {pair("Duty", dutyCell(t))}
            {pair("Total Cost", <>{total ? `$${fmtUnit(total)}` : "—"}{mpu > 0 && <div style={{ fontSize: 10.5, color: "#6a7488", fontWeight: 500 }}>incl. ${fmtUnit(mpu)} mold</div>}</>, true)}
            {pair("Client Price", t.client ? `$${fmtUnit(t.client)}` : <PriceTag text={NO_PRICE_TEXT} tip={NO_PRICE_TIP} />, true)}
            {pair("Margin", <span style={{ color: m && m < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{m ? m.toFixed(0) + "%" : "—"}</span>)}
            {sz.differs && <div style={{ gridColumn: "1 / -1", ...S.sizeDetailLine }}>{sz.lines.map((l) => sizeLineText(l, true)).join(" · ")}</div>}
          </div>
        );
      })}
      {(!q.tiers || q.tiers.length === 0) && <div style={{ ...S.tierTable, padding: "11px 14px", color: "#6a7488", textAlign: "center", fontSize: 13.5 }}>No tiers entered.</div>}
    </div>
  );
}

// The iPad view's card. Same figures, same order; the type, the wrapping and
// the column count follow the view's rules (see the top).
const T = {
  card: { border: "1px solid #e7eaf0", borderRadius: 12, background: "#ffffff", padding: "12px 14px",
          display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(132px, 1fr))", gap: "12px 18px" },
  label: { fontSize: "var(--m-fs-meta)", color: "#6a7488", lineHeight: 1.35, overflowWrap: "anywhere" },
  // Figures never break: a price split over two lines misreads.
  num: { fontSize: "var(--m-fs)", fontVariantNumeric: "tabular-nums", color: "#0f1729", whiteSpace: "nowrap", lineHeight: 1.4 },
  words: { fontSize: "var(--m-fs)", color: "#0f1729", lineHeight: 1.4, overflowWrap: "anywhere" },
  tag: { display: "inline-block", fontSize: "var(--m-fs-meta)", fontWeight: 600, borderRadius: 12, padding: "2px 10px", lineHeight: 1.4 },
  sizeLine: { gridColumn: "1 / -1", fontSize: "var(--m-fs-meta)", color: "#36405a", fontVariantNumeric: "tabular-nums", lineHeight: 1.5, overflowWrap: "anywhere" },
};

function TouchTierCards({ q, dutyRate }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      {(q.tiers || []).map((t, i) => {
        const m = tierMargin(t, t.client, q.moldFee, dutyRate);
        const total = tierTotalCost(t, q.moldFee, dutyRate);
        const mpu = moldPerUnit(tierMoldFee(t, q.moldFee), effectiveQty(t));
        const sz = sizeLines(t, q.sizeScales, q.sizeDeltas);
        const pair = (label, value, opts = {}) => (
          <div style={{ minWidth: 0 }}>
            <div style={T.label}>{label}</div>
            <div style={{ ...(opts.words ? T.words : T.num), ...(opts.strong ? { fontWeight: 600 } : {}) }}>{value}</div>
          </div>
        );
        return (
          <div key={i} style={T.card}>
            {pair("Quantity", tierQtyShown(t) ? tierQtyShown(t).toLocaleString() : "—", { strong: true })}
            {pair("EXW Cost", t.landed ? `$${fmtUnit(t.landed)}` : "—")}
            {pair("Method", <span style={{ ...T.tag, color: "#3461e0", background: "#eef1f6" }}>{(t.ship || "ocean") === "air" ? "Air" : "Ocean"}</span>, { words: true })}
            {pair("Freight", freightCell(t))}
            {pair("Duty", dutyCell(t))}
            {pair("Total Cost", <>{total ? `$${fmtUnit(total)}` : "—"}{mpu > 0 && <div style={{ fontSize: "var(--m-fs-meta)", color: "#6a7488", fontWeight: 500, whiteSpace: "normal" }}>incl. ${fmtUnit(mpu)} mold</div>}</>, { strong: true })}
            {t.client
              ? pair("Client Price", `$${fmtUnit(t.client)}`, { strong: true })
              : pair("Client Price", <span title={NO_PRICE_TIP} style={{ ...T.tag, fontWeight: 500, color: "#6a7488", background: "#f1f3f7" }}>{NO_PRICE_TEXT}</span>, { words: true })}
            {pair("Margin", <span style={{ color: m && m < 25 ? "#c2683a" : "#3f7d5a", fontWeight: 600 }}>{m ? m.toFixed(0) + "%" : "—"}</span>)}
            {sz.differs && <div style={T.sizeLine}>{sz.lines.map((l) => sizeLineText(l, true)).join(" · ")}</div>}
          </div>
        );
      })}
      {(!q.tiers || q.tiers.length === 0) && <div style={{ ...T.card, display: "block", color: "#6a7488", textAlign: "center", fontSize: "var(--m-fs)" }}>No tiers entered.</div>}
    </div>
  );
}
