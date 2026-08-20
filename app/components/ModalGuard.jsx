'use client';
import { createContext, useCallback, useContext, useEffect, useRef } from 'react';

// ── ModalGuard ───────────────────────────────────────────────────────────────
// Stops a backdrop click from discarding typed input, and collapses the five
// copy-pasted Overlay components into one.
//
// Escape is deliberately NOT handled. Nothing in this app has ever listened for
// it -- the only two Escape handlers are FilterSelect's and HtsField's, and both
// close their own dropdown panel, not a modal. Adding it here would be new
// behaviour dressed up as a bug fix.
//
// ┌─────────────────────────────────────────────────────────────────────────────┐
// │ WHY THERE ARE THREE DETECTORS AND NOT ONE.                                  │
// │                                                                             │
// │ 1. input / change events. Catches every keystroke, select, and checkbox.    │
// │    Cannot false-positive: React setting state from a fetch on mount does    │
// │    not fire these.                                                          │
// │                                                                             │
// │ 2. A value snapshot compared at close time. This is the one that matters.   │
// │    A CLICK that sets form state -- the "Saved factories" chips, picking an  │
// │    HTS code, Add tier, applying a quote to a PO -- fires no input event at  │
// │    all, so detector 1 is blind to every one of them. There are ~70 such     │
// │    call sites across 8 files; marking each one by hand is 70 chances to     │
// │    miss one silently, and a missed one discards work exactly as before.     │
// │    React writes state into the DOM, so comparing what the controls hold     │
// │    against what they held catches all of them at once, with no call site.   │
// │                                                                             │
// │ 3. markDirty(), for anything the first two cannot see -- state that never   │
// │    reaches a form control, like a staged file or a reordered list.          │
// └─────────────────────────────────────────────────────────────────────────────┘
//
// THE BASELINE MOVES UNTIL THE USER TOUCHES SOMETHING. Half these modals fetch
// their row and populate the form after mount; a baseline taken at mount would
// read that fetch as an edit and confirm on every open-then-close. So the
// snapshot is retaken on every render until the first pointerdown or keydown
// inside the modal, and frozen from then on. The first interaction always
// precedes the first user change -- including when that interaction IS the
// click that fills the fields, because pointerdown lands before the state set.
//
// A load that arrives AFTER the user has started typing will read as dirty. That
// is over-eager, and it is the safe direction: it asks, it never discards.
//
// Opt a control out with data-noguard -- for a search box inside a form modal,
// where typing is navigation rather than input.

const MESSAGE = 'You have unsaved changes in this form.\n\nDiscard them and close?';

// Lets a child call markDirty without every modal threading a prop down. Default
// is a no-op so a component using it outside a guarded modal still renders.
const MarkDirtyContext = createContext(() => {});
export const useMarkDirty = () => useContext(MarkDirtyContext);

// NESTED MODALS. A modal opened from inside another one is often a DOM
// DESCENDANT of the outer card even though it paints on top of it: quotes.jsx
// renders FreightBuilder inside QuoteForm's card at zIndex 1300. Without the
// ownership test below, opening it would add its six controls to QuoteForm's
// snapshot and read as an edit to the quote. Every guarded card marks itself
// with this attribute, and a control counts only for the NEAREST marked card.
const CARD_ATTR = 'data-modal-card';

// Every control the card owns, in DOM order, plus how many there are -- so
// adding or removing a row counts as a change even when no value moved.
function snapshot(node) {
  if (!node) return null;
  const els = node.querySelectorAll('input,textarea,select');
  let out = '';
  let n = 0;
  for (const el of els) {
    if (el.hasAttribute('data-noguard')) continue;
    if (el.closest('[' + CARD_ATTR + ']') !== node) continue;
    n += 1;
    out += '|' + (el.type === 'checkbox' || el.type === 'radio' ? (el.checked ? '1' : '0') : el.value);
  }
  return n + out;
}

// ref goes on the modal CARD, not the backdrop: it has to contain the controls
// being watched, and a pointerdown on the backdrop must NOT count as touching
// the form -- that click is the one asking to leave.
export function useDirtyGuard(onClose) {
  const ref = useRef(null);
  const dirty = useRef(false);
  const touched = useRef(false);
  const baseline = useRef(null);

  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    node.setAttribute(CARD_ATTR, '');
    const onEdit = () => { dirty.current = true; };
    // Only an interaction this card OWNS freezes its baseline. A pointerdown
    // inside a nested modal belongs to that modal, and must not freeze the
    // outer card's baseline while the outer form is still being populated.
    const onTouch = (e) => {
      if (e.target instanceof Element && e.target.closest('[' + CARD_ATTR + ']') !== node) return;
      touched.current = true;
    };
    // Capture phase, so a handler inside that stops propagation cannot hide the
    // edit from us.
    node.addEventListener('input', onEdit, true);
    node.addEventListener('change', onEdit, true);
    node.addEventListener('pointerdown', onTouch, true);
    node.addEventListener('keydown', onTouch, true);
    return () => {
      node.removeEventListener('input', onEdit, true);
      node.removeEventListener('change', onEdit, true);
      node.removeEventListener('pointerdown', onTouch, true);
      node.removeEventListener('keydown', onTouch, true);
    };
  }, []);

  // No dep array on purpose -- this has to run after every render so an async
  // populate is absorbed into the baseline rather than read as an edit.
  useEffect(() => {
    if (!touched.current) baseline.current = snapshot(ref.current);
  });

  const markDirty = useCallback(() => { dirty.current = true; }, []);

  const guardedClose = useCallback(() => {
    const changed = dirty.current
      || (baseline.current !== null && snapshot(ref.current) !== baseline.current);
    // A modal holding no controls at all -- a viewer, a picker, a confirm --
    // snapshots to "0" on both sides, so it can never be dirty and closes
    // silently. No special-casing at any call site.
    if (!changed) { onClose(); return; }
    if (window.confirm(MESSAGE)) onClose();
  }, [onClose]);

  return { ref, guardedClose, markDirty };
}

// The one Overlay. Replaces five near-identical local copies that differed only
// in z-index, backdrop tint and max width -- now all three are props, defaulted
// to the values four of the five already used.
//
// testing.jsx's copy sat at zIndex 200 while the other four used 300. Both are
// above everything else on their page and nothing stacks them, so the default is
// 300 and testing.jsx passes nothing; the ordering it had was never load-bearing.
//
// Guarding lives HERE rather than in each modal, so every Overlay-based modal is
// covered by importing it and changing nothing else.
export function Overlay({
  children,
  onClose,
  zIndex = 300,
  backdrop = 'rgba(0,0,0,.42)',
  maxWidth = 560,
  cardStyle,
}) {
  const { ref, guardedClose, markDirty } = useDirtyGuard(onClose);
  return (
    <div
      onClick={guardedClose}
      style={{
        position: 'fixed', inset: 0, background: backdrop, backdropFilter: 'blur(2px)',
        zIndex, display: 'flex', alignItems: 'flex-start', justifyContent: 'center',
        padding: '40px 16px', overflowY: 'auto',
      }}
    >
      <div
        ref={ref}
        onClick={e => e.stopPropagation()}
        style={{
          background: '#fff', borderRadius: '18px', boxShadow: '0 12px 48px rgba(0,0,0,.2)',
          width: '100%', maxWidth: typeof maxWidth === 'number' ? maxWidth + 'px' : maxWidth,
          padding: '24px',
          ...cardStyle,
        }}
      >
        <MarkDirtyContext.Provider value={markDirty}>{children}</MarkDirtyContext.Provider>
      </div>
    </div>
  );
}
