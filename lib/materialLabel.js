// One label format for a material, wherever one is named.
//
// Lives in lib/ beside textFilter.js for the same reason that one does: a pure
// function shared by a page module (app/testing.jsx) and components, where a copy
// in each would drift and the drift would be invisible because both copies look
// right. It arrived inside MaterialField.jsx and outlived it -- the picker was
// retired when Edit Product's Material block went read-only, and the helper was
// the part worth keeping.
//
// Used by the Materials row subtitle, Edit Product's read-only Material block,
// ReportModal's material dropdown, and LinkModal's rows. The point of putting the
// code on screen at all is that the same material reads the same everywhere it is
// offered; four copies would be four chances to drift.
//
// filter/join rather than a template, so a material with no code degrades to its
// name alone instead of carrying a dangling separator.
//
// No 'use client': a pure function with no hooks and no browser APIs, so it
// bundles into whichever client component imports it.
export const materialLabel = (m) => (m ? [m.material_code, m.name].filter(Boolean).join(' · ') : '');
