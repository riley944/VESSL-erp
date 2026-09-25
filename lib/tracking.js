// ── A TRACKING NUMBER AS A LINK ──────────────────────────────────────────────
// trackingUrl(carrier, number) returns the carrier's own tracking page for the
// number, or null when it cannot tell whose number it is -- and null means the
// number is shown as plain text, never as a guess.
//
// THE CARRIER WINS WHEN ONE IS TYPED. It is matched loosely -- case, spaces and
// punctuation ignored, so "Fed Ex", "FEDEX" and "fedex ground" are all FedEx.
// A carrier that is typed but is none of the four stays plain text even when the
// number looks like one of theirs: somebody said who carried it, and it was not
// FedEx, UPS, DHL or USPS.
//
// ONLY A BLANK CARRIER IS INFERRED FROM THE NUMBER, by its shape --
//   1Z and 16 more letters or digits          UPS
//   12 or 15 digits                            FedEx
//   20 to 22 digits starting with 9            USPS
//   10 digits                                  DHL
// Spaces and dashes in the number are ignored for the test and dropped from the
// link, since none of the four sites wants them.
//
// THE FOUR URLS, checked on 2026-09-25 by fetching each with a dummy number.
// FedEx, UPS and DHL each answered 200 with their tracking page and the number
// still in the address. USPS answered a bot check to a script, as it does, after
// redirecting to its tracking page with the number kept; a browser passes that
// check.
const URLS = {
  fedex: n => 'https://www.fedex.com/wtrk/track/?trknbr=' + encodeURIComponent(n),
  ups:   n => 'https://www.ups.com/track?loc=en_US&tracknum=' + encodeURIComponent(n),
  usps:  n => 'https://tools.usps.com/go/TrackConfirmAction?tLabels=' + encodeURIComponent(n),
  dhl:   n => 'https://www.dhl.com/us-en/home/tracking.html?tracking-id=' + encodeURIComponent(n) + '&submit=1',
};

const carrierKey = carrier => {
  const c = String(carrier || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!c) return '';
  if (c.includes('fedex') || c.includes('federalexpress')) return 'fedex';
  if (c.includes('usps') || c.includes('postal')) return 'usps';
  if (c === 'ups' || c.startsWith('ups') || c.includes('unitedparcel')) return 'ups';
  if (c.includes('dhl')) return 'dhl';
  return 'other';
};

const inferFromNumber = n => {
  if (/^1Z[0-9A-Z]{16}$/i.test(n)) return 'ups';
  if (/^\d{12}$/.test(n) || /^\d{15}$/.test(n)) return 'fedex';
  if (/^9\d{19,21}$/.test(n)) return 'usps';
  if (/^\d{10}$/.test(n)) return 'dhl';
  return '';
};

export function trackingUrl(carrier, number) {
  const n = String(number || '').replace(/[\s-]+/g, '');
  if (!n) return null;
  let key = carrierKey(carrier);
  if (key === 'other') return null;
  if (!key) key = inferFromNumber(n);
  return key ? URLS[key](n) : null;
}
