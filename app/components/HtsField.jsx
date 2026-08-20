'use client';
import { useState, useEffect, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { SB } from "@/lib/supabase";
import { matches, normalizeTerm } from "@/lib/textFilter";

// ── HtsField ─────────────────────────────────────────────────────────────────
// A closed combobox over vessl.htscodes: typing filters, but only choosing a row
// commits, so a code that is not in the library cannot be entered by typing.
// "+ Add code" fires onAdd so the HOST can open CodeModal -- see below.
//
// Extracted from app/quotes.jsx so the Edit Product modal can use the same
// control. The rule in the box below is the reason it was extracted rather than
// copied: a rule that governs one of two copies is a rule the next person reads
// in the file they were not editing.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STRUCTURAL RULE — do not break this.                                        │
// │                                                                             │
// │ The control renders `value` DIRECTLY. Nothing derives its displayed value   │
// │ from `codes`.                                                               │
// │                                                                             │
// │ 20 of the 30 quotes carrying an HTS hold a code that is not in the library. │
// │ A <select value={value}> with no matching <option> renders BLANK, and       │
// │ saving from there writes the blank over a real customs classification. So   │
// │ would codes.find(c => c.code === value)?.code. Either reintroduces silent   │
// │ data loss on those 20 quotes. The list is for choosing, never for display.  │
// │                                                                             │
// │ products.hts_code is empty on all 271 rows today. That does NOT retire the  │
// │ rule: useHtsCodes filters on active, so RETIRING a code -- the sanctioned   │
// │ alternative to deleting -- drops it out of `codes` while every row citing   │
// │ it keeps it. Deleting does the same, and there is no foreign key from       │
// │ either table to stop it. A clean column stays clean only until the first    │
// │ code is retired.                                                            │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Style-agnostic by prop, because the two hosts style forms differently:
// quotes.jsx is inline (its S object), CreateProductModal is CSS classes from
// globals.css. Pass either, or both -- inline wins on conflict, so a host that
// uses one mechanism can ignore the other. Only the picker's own chrome (panel,
// options, add button) is owned here; neither host has an equivalent and neither
// wants a different one.
//
// The markup is deliberately unchanged from the quotes.jsx original -- <label>
// wrapper, <span> caption, <div> trigger. globals.css:241 styles bare `label`
// app-wide (mono, uppercase, .14em tracking), so the wrapper element decides what
// everything inside it inherits. Swapping it for a <div> silently restyles the
// quote form's HTS row. Keep it a label; hosts that need the trigger to opt out
// of that inheritance say so in inputStyle.

const panelStyle = { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, marginTop: 4, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, boxShadow: "0 10px 30px rgba(15,23,41,0.16)", padding: 8 };
const optionStyle = { display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "8px 9px", borderRadius: 8, fontSize: 13.5, color: "#0f1729", cursor: "pointer" };
const addBtnStyle = { display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", marginTop: 6, background: "#eef1f6", color: "#3461e0", border: "none", borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const clearBtnStyle = { background: "transparent", border: "none", color: "#6a7488", display: "inline-flex", padding: 2 };
// The filter box inside the panel. Not the host's input style: it belongs to the
// picker, and matching the trigger it hangs beneath would make the panel look
// like a second copy of the field.
const filterStyle = { border: "1px solid #e7eaf0", background: "#ffffff", borderRadius: 10, padding: "10px 12px", fontSize: 14, color: "#0f1729", width: "100%", marginBottom: 6 };

// The code library, fetched once per host that asks for it.
//
// This exists so `.eq("active", true)` is written in exactly one place. Two hosts
// each filtering for themselves is two chances to disagree about which codes are
// offered, and the disagreement would be invisible -- both lists look plausible.
//
// addCode takes the row CodeModal hands back, so selecting a just-added code does
// not need a refetch to find it.
export function useHtsCodes() {
  const [codes, setCodes] = useState([]);
  useEffect(() => {
    let alive = true;
    // id is fetched purely so the option rows have a stable React key: once one code
    // can appear on several rows, key={c.id || c.code} would fall back to a value
    // that is no longer unique.
    // total_duty rides along for the quote form's duty calculation. CreateProductModal
    // ignores it; one fetch shared beats two that can disagree about which codes exist.
    SB.from("htscodes").select("id,code,description,total_duty").eq("active", true).order("code")
      .then(({ data, error }) => { if (alive && !error && data) setCodes(data); });
    return () => { alive = false; };
  }, []);
  // On error the list stays empty and the field still renders whatever is stored --
  // the structural rule means a failed fetch costs you the picker, never the value.
  const addCode = (row) => {
    if (!row) return;
    setCodes((prev) => [...prev, row].sort((a, b) => a.code.localeCompare(b.code)));
  };
  return { codes, addCode };
}

// onAdd(seed) is fired instead of rendering CodeModal here on purpose. CodeModal is
// a fixed-position overlay; .modal-body in globals.css is overflow-y:auto, and
// nesting a fixed overlay inside a scroll container is exactly the arrangement that
// is fiddly to reason about and easy to get wrong. Both hosts render it as a sibling
// of their modal box instead, which is the arrangement already proven in the quote
// form. The seed is whatever was typed into the filter, digits only.
export function HtsField({
  value,
  onChange,
  codes,
  onAdd,
  label = "HTS Code",
  panelMaxHeight = 220,
  fieldStyle,
  fieldClassName,
  labelStyle,
  inputStyle,
  inputClassName,
}) {
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState("");
  const q = normalizeTerm(typed);
  // No cap. A cap would apply to the unfiltered list too, so opening the panel
  // would show only the first N alphabetically and the rest would look absent.
  // ~100 rows in a scrolling div costs nothing.
  const hits = useMemo(
    () => (!q ? codes : codes.filter((c) => matches(q, c.code, c.description))),
    [codes, q]
  );
  // Display only. Never feeds the value -- see the rule above.
  //
  // A code can carry several library rows with different descriptions, and the row
  // stores only the code, so when several match there is no way to know which was
  // picked. Show nothing rather than whichever happened to sort first. `unlisted`
  // keys off zero matches specifically: an ambiguous code IS in the library and must
  // not be flagged as missing.
  const forValue = value ? codes.filter((c) => c.code === value) : [];
  const known = forValue.length === 1 ? forValue[0] : null;
  const unlisted = !!value && forValue.length === 0;
  const commit = (code) => { onChange(code); setTyped(""); setOpen(false); };

  return (
    <label className={fieldClassName} style={{ ...fieldStyle, position: "relative" }}>
      <span style={labelStyle}>{label}</span>

      {/* The committed value, rendered straight from `value` whether or not the
          library knows it. Clicking opens the picker; it never rewrites itself. */}
      <div onClick={() => setOpen((v) => !v)} className={inputClassName}
        style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: "pointer", minHeight: 40 }}>
        <span style={{ flex: 1, minWidth: 0, color: value ? "#0f1729" : "#9aa3b5", fontVariantNumeric: "tabular-nums", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? value : "Select a tariff code"}
          {known?.description && <span style={{ color: "#6a7488" }}> · {known.description}</span>}
        </span>
        {value && <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); commit(""); }} style={clearBtnStyle}><X size={13} /></button>}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>
      </div>

      {/* Not an error: the code is real and stays exactly as stored. It is a
          prompt to add it to the library, which "+ Add code" does in place. */}
      {unlisted && <span style={{ fontSize: 11.5, color: "#c2683a", marginTop: 4 }}>Not in the code library — still saved as is.</span>}

      {open && (
        <div style={panelStyle}>
          {/* data-noguard: typing here is NAVIGATION, not input. It filters the
              list and commits nothing -- only choosing a row sets the field, per
              the structural rule above. Without the tag the modal dirty guard
              counts this box as an edit, so hunting for a code and closing the
              panel would ask to discard changes that were never made. That would
              fire constantly, since this picker is how every code is chosen. */}
          <input autoFocus data-noguard value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setTyped(""); } if (e.key === "Enter") { e.preventDefault(); if (hits.length === 1) commit(hits[0].code); } }}
            placeholder="Filter by code or description…" style={filterStyle} />
          <div style={{ maxHeight: panelMaxHeight, overflowY: "auto" }}>
            {hits.length === 0 && <div style={{ padding: "10px 8px", fontSize: 13, color: "#6a7488" }}>No codes match “{typed.trim()}”.</div>}
            {hits.map((c) => (
              <button key={c.id || c.code} type="button" onClick={() => commit(c.code)} style={optionStyle}>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{c.code}</span>
                <span style={{ color: "#6a7488", marginLeft: 8 }}>{c.description}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); onAdd(typed.replace(/\D/g, "")); }} style={addBtnStyle}>
            <Plus size={13} /> Add code{q ? " “" + typed.trim() + "”" : ""}
          </button>
        </div>
      )}
    </label>
  );
}
