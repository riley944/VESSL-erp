// ── Importer of record (script 136) ─────────────────────────────────────────
// companies.kui_ior: true = KUI is the importer of record for this client,
// false = the client is, null = unknown. products.kui_ior overrides it for one
// product; null there means use the company. One rule, read by Testing, Samples
// and the product modal, so the three can never disagree about a product.

// product.kui_ior wins; null falls through to the client company's flag.
export function resolveKuiIor(product, client) {
  if (product?.kui_ior != null) return { value: product.kui_ior, source: 'product' };
  if (client?.kui_ior != null) return { value: client.kui_ior, source: 'company' };
  return { value: null, source: null };
}

// "KUI" / "Client" / null -- the bare value, for selects and the company card.
export const iorWord = v => v === true ? 'KUI' : v === false ? 'Client' : null;

// "IOR: KUI (from company)" and the like, for a row or a card.
export function iorLabel(r) {
  const w = iorWord(r.value);
  if (!w) return 'IOR: not set';
  return 'IOR: ' + w + (r.source === 'company' ? ' (from company)' : '');
}

// A three-way select holds strings; the column holds true / false / null.
export const iorToSelect = v => v === true ? 'kui' : v === false ? 'client' : '';
export const iorFromSelect = s => s === 'kui' ? true : s === 'client' ? false : null;

// The filter key on the RESOLVED value: kui | client | notset.
export const iorKey = r => r.value === true ? 'kui' : r.value === false ? 'client' : 'notset';
