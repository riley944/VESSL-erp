// ── COMPANY NAMES, COMPARED ─────────────────────────────────────────────────
// Plain functions with no imports, so the quote form (browser) and the PDF
// routes (server) compare names the same way.

// The words every company name carries, dropped wherever they stand.
const STOP = /\b(co|company|corp|corporation|ltd|limited|inc|llc|plc|factory|manufacturing|mfg|industrial|industry|industries|trading|group|international|intl|the)\b/g;
// Lower case, punctuation gone, the STOP words gone, single spaces.
export const normName = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(STOP, ' ').replace(/\s+/g, ' ').trim();

// The legal endings a factory name trails: "Co.,LTD", "Co., Ltd.", "LLC", "Inc".
const LEGAL = new Set(['co', 'company', 'corp', 'corporation', 'ltd', 'limited', 'inc', 'llc', 'plc']);
// One key per company: case, spaces and punctuation ignored, trailing legal
// tokens dropped -- so "Fuzhou Xiang Xing Textile Co.,LTD" and "Fuzhou
// Xiangxing Textile Co., LTD" are both "fuzhouxiangxingtextile".
export const companyKey = (s) => {
  const w = String(s || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (w.length > 1 && LEGAL.has(w[w.length - 1])) w.pop();
  return w.join('');
};
export const sameCompany = (a, b) => {
  const ka = companyKey(a);
  return ka !== '' && ka === companyKey(b);
};
