'use client';
import { useState, useMemo } from "react";
import { Plus, X } from "lucide-react";
import { matches, normalizeTerm } from "@/lib/textFilter";

// ── MaterialField ────────────────────────────────────────────────────────────
// A closed combobox over vessl.materials: typing filters, but only choosing a row
// commits, so a material that does not exist cannot be entered by typing.
// "+ Add material" fires onAdd so the HOST can open AddMaterialModal -- the same
// arrangement HtsField uses for CodeModal, and for the same reason (see below).
//
// Modelled on HtsField.jsx. It is a sibling rather than a generalisation of it:
// HtsField stores a CODE STRING that may legitimately not be in the library, this
// stores a material_id (uuid) that is a foreign key. Merging them would mean one
// component whose central rule reads differently depending on which host called
// it, which is the opposite of why HtsField was extracted.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ STRUCTURAL RULE — do not break this.                                        │
// │                                                                             │
// │ The control renders `valueLabel` DIRECTLY. Nothing derives its displayed    │
// │ value from `materials`.                                                     │
// │                                                                             │
// │ A <select value={id}> with no matching <option> renders BLANK, and saving   │
// │ from there writes the blank over a real link. So would                      │
// │ materials.find(m => m.id === value)?.name. The list is for choosing, never  │
// │ for display.                                                                │
// │                                                                             │
// │ The host resolves valueLabel from the product_materials ROW, whose join     │
// │ carries the material's own name and code. That is what makes the rule hold: │
// │ the label travels with the stored link, so a materials fetch that fails,    │
// │ half-loads, or races the modal open costs you the PICKER and never the      │
// │ value. product_materials.material_id is ON DELETE CASCADE, so a deleted     │
// │ material takes its link with it rather than leaving a dangling id -- but a  │
// │ list that is merely late is enough to blank a <select>, and that is the     │
// │ case this exists for.                                                       │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// Style-agnostic by prop, like HtsField, because its host styles forms with CSS
// classes from globals.css while the picker's own chrome is owned here. The panel,
// option and add-button styles below are deliberate copies of HtsField's rather
// than a shared import: five style objects do not earn a third module, and the two
// panels are free to diverge if one host ever needs it.
//
// The <label> wrapper is load-bearing for the same reason it is in HtsField:
// globals.css:241 styles bare `label` app-wide, so the wrapper element decides
// what everything inside it inherits.

const panelStyle = { position: "absolute", top: "100%", left: 0, right: 0, zIndex: 30, marginTop: 4, background: "#ffffff", border: "1px solid #e7eaf0", borderRadius: 12, boxShadow: "0 10px 30px rgba(15,23,41,0.16)", padding: 8 };
const optionStyle = { display: "block", width: "100%", textAlign: "left", background: "transparent", border: "none", padding: "8px 9px", borderRadius: 8, fontSize: 13.5, color: "#0f1729", cursor: "pointer" };
const addBtnStyle = { display: "inline-flex", alignItems: "center", gap: 6, width: "100%", justifyContent: "center", marginTop: 6, background: "#eef1f6", color: "#3461e0", border: "none", borderRadius: 9, padding: "9px 12px", fontSize: 13, fontWeight: 600, cursor: "pointer" };
const clearBtnStyle = { background: "transparent", border: "none", color: "#6a7488", display: "inline-flex", padding: 2 };
const filterStyle = { border: "1px solid #e7eaf0", background: "#ffffff", borderRadius: 10, padding: "10px 12px", fontSize: 14, color: "#0f1729", width: "100%", marginBottom: 6 };

// One label format, used by this picker, by the host's closed trigger, and by
// ReportModal's material dropdown. Exported rather than written three times: the
// whole point of putting the code on screen is that the same material reads the
// same wherever it is offered, and three copies is three chances to drift.
//
// filter/join rather than a template, so a material with no code degrades to its
// name alone instead of carrying a dangling separator -- the same shape the
// Materials row subtitle uses.
export const materialLabel = (m) => (m ? [m.material_code, m.name].filter(Boolean).join(" · ") : "");

// onAdd(seed) is fired instead of rendering AddMaterialModal here, because that is
// a fixed-position overlay and .modal-body in globals.css is overflow-y:auto --
// nesting a fixed overlay inside a scroll container is the arrangement that is easy
// to get wrong. The host renders it as a sibling of its modal box, which is what
// CreateProductModal already does for CodeModal. The seed is whatever was typed.
export function MaterialField({
  value,
  valueLabel,
  onChange,
  materials = [],
  onAdd,
  label = "Material",
  placeholder = "Select a material",
  disabled = false,
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
  // No cap, for the reason HtsField gives: a cap would apply to the unfiltered list
  // too, so opening the panel would show only the first N and the rest would look
  // absent. 14 rows today.
  const hits = useMemo(
    () => (!q ? materials : materials.filter((m) => matches(q, m.material_code, m.name, m.composition))),
    [materials, q]
  );
  // Presence check only. Never feeds the displayed label -- see the rule above.
  const unlisted = !!value && !materials.some((m) => m.id === value);
  const commit = (m) => { onChange(m ? m.id : "", materialLabel(m)); setTyped(""); setOpen(false); };

  return (
    <label className={fieldClassName} style={{ ...fieldStyle, position: "relative" }}>
      <span style={labelStyle}>{label}</span>

      {/* The committed value, rendered straight from `valueLabel` whether or not the
          list knows it. Clicking opens the picker; it never rewrites itself. */}
      <div onClick={() => { if (!disabled) setOpen((v) => !v); }} className={inputClassName}
        style={{ ...inputStyle, display: "flex", alignItems: "center", gap: 8, cursor: disabled ? "default" : "pointer", minHeight: 40, opacity: disabled ? 0.6 : 1 }}>
        <span style={{ flex: 1, minWidth: 0, color: value ? "#0f1729" : "#9aa3b5", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {value ? (valueLabel || value) : placeholder}
        </span>
        {value && !disabled && <button type="button" title="Clear" onClick={(e) => { e.stopPropagation(); commit(null); }} style={clearBtnStyle}><X size={13} /></button>}
        {!disabled && <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#9aa3b5" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><polyline points="6 9 12 15 18 9" /></svg>}
      </div>

      {/* Not an error: the link is real and stays exactly as stored. It means the
          picker's list does not currently contain it -- a fetch that failed or has
          not arrived -- so choosing from the list would be choosing blind. */}
      {unlisted && <span style={{ fontSize: 11.5, color: "#c2683a", marginTop: 4 }}>Not in the material list — still saved as is.</span>}

      {open && !disabled && (
        <div style={panelStyle}>
          <input autoFocus value={typed} onChange={(e) => setTyped(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Escape") { setOpen(false); setTyped(""); } if (e.key === "Enter") { e.preventDefault(); if (hits.length === 1) commit(hits[0]); } }}
            placeholder="Filter by code, name or composition…" style={filterStyle} />
          <div style={{ maxHeight: panelMaxHeight, overflowY: "auto" }}>
            {hits.length === 0 && <div style={{ padding: "10px 8px", fontSize: 13, color: "#6a7488" }}>No materials match “{typed.trim()}”.</div>}
            {hits.map((m) => (
              <button key={m.id} type="button" onClick={() => commit(m)} style={optionStyle}>
                <span style={{ fontWeight: 600, fontVariantNumeric: "tabular-nums" }}>{m.material_code || "—"}</span>
                <span style={{ color: "#6a7488", marginLeft: 8 }}>{m.name}</span>
              </button>
            ))}
          </div>
          <button type="button" onClick={() => { setOpen(false); onAdd(typed.trim()); }} style={addBtnStyle}>
            <Plus size={13} /> Add material{q ? " “" + typed.trim() + "”" : ""}
          </button>
        </div>
      )}
    </label>
  );
}
