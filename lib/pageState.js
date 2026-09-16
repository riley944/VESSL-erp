'use client';
import { useState, useEffect } from 'react';

// ── FILTERS THAT SURVIVE NAVIGATION, AND NOTHING ELSE ───────────────────────
//
// Riley opened a purchase order from a filtered list, came back, and the filters
// were gone. Nothing was wrong with the filters. Every page mounts as
// {page==='orders' && <Orders/>} and a detail view is its own page value, so going
// into one UNMOUNTS the list and coming back builds it again from scratch -- every
// useState in it reborn at its default.
//
// WHAT THIS IS. One module-level Map, read when a page mounts and written when its
// state changes. A page that comes back finds what it left.
//
// WHY A MODULE-LEVEL MAP AND NOT CONTEXT. Context would put this state in the app
// shell, and every keystroke in a search box would re-render the sidebar, the top
// bar and whatever else hangs off it. A Map outside React survives an unmount for
// free and re-renders nothing.
//
// WHY IT IS GONE ON RELOAD, deliberately. A reload re-evaluates this module and the
// Map is empty again -- which is the requirement, not a limitation. It is also why
// there is no localStorage here: this is per tab, per person, and nothing about it
// outlives the session. The two filters that DO survive a reload -- the sales order
// sort and its CRD chips, on Kristy word -- keep their own localStorage keys and are
// deliberately not moved here.
//
// WHAT DOES NOT BELONG IN IT. Anything transient: an open modal, an expanded row, a
// busy flag, a fetched list. Those stay plain useState. Restoring a modal that was
// open when somebody navigated away would reopen it behind their back, and restoring
// fetched rows would show stale data the page is about to refetch anyway. The rule is
// narrow on purpose -- what the user CHOSE about the view, nothing else.
//
// The store is keyed by page, so two pages can hold a `search` each without meeting.
const store = new Map();

// defaults is read once per mount, for the keys the store has nothing for. Pass the
// same object shape every time a page mounts; a key that disappears from defaults
// simply stops being restored.
export function usePageState(pageKey, defaults) {
  const [state, setState] = useState(() => ({ ...defaults, ...(store.get(pageKey) || {}) }));
  // Written on every change rather than on unmount. An unmount-time write would need
  // a ref to dodge the stale-closure trap, and would lose everything if the component
  // ever unmounted without running cleanup.
  useEffect(() => { store.set(pageKey, state); }, [pageKey, state]);
  // set('search', v) or set('search', prev => ...), so a caller that needs the old
  // value has the same shape useState gives it.
  const set = (k, v) => setState(s => ({ ...s, [k]: typeof v === 'function' ? v(s[k]) : v }));
  return [state, set];
}

// For tests and for a deliberate reset. Nothing in the app calls this today.
export function clearPageState(pageKey) {
  if (pageKey === undefined) store.clear(); else store.delete(pageKey);
}
