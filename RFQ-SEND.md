# RFQ send — operating notes

The Shipments tab emails a fillable freight RFQ to one forwarder contact through
Resend, and reads the returned workbook back as a bid. These are the things about
it that are not obvious from the code.

## Environment

- `RESEND_API_KEY` must be present in Vercel's env vars. The route returns a 500
  and sends nothing if it is missing, rather than failing in a way that looks
  like a rejected message.
- `vessl.io` is verified for **sending only**. Receiving is off, so `reply_to`
  must point somewhere that accepts mail. It defaults to
  `mattdillon@kinguniversal.com`.

  **This is the item most worth revisiting.** The covering email now asks the
  forwarder to reply with the filled sheet, so every returned workbook lands in
  one personal inbox. A shared address would make the replies findable by whoever
  is actually chasing the bid.

## Auth

The route is the app's only server-side endpoint and the only thing in it a
stranger could reach. It validates the caller's Supabase access token with
`getUser()` AND attaches it to the client, so:

- an unauthenticated or non-staff request gets a 401 and sends nothing;
- every query runs **as the caller**, so the route can never read a quote the
  person who invoked it could not open themselves.

It deliberately uses the anon key plus a user token rather than a service-role
key. Service-role would bypass RLS entirely and leave the staff gate as the only
thing between a bug and every row in the table.

That coupling is not theoretical: the first live send failed with "quote could
not be found" because `getUser(token)` validates a token without authenticating
the client, so the read went out as `anon` and RLS — every policy on
`shipment_quotes` targets `authenticated` — made the row invisible.

## Schema it depends on

Applied by hand, both live:

- `vessl.shipment_quotes.resend_message_id` — text, nullable, no default.
- `vessl.products.manual_test_date` — date, nullable, no default. (Unrelated to
  this flow; listed because it shipped in the same window.)

## Known limits, accepted rather than missed

- **One forwarder per quote.** `forwarder_company_id` is a single uuid, which is
  why Duplicate exists. Sending to a second forwarder means duplicating the
  quote; the modal confirms before overwriting a different one.
- **A typed address records no forwarder.** Nobody can say which company an
  arbitrary address belongs to, and guessing would attach a later bid to the
  wrong one.
- **"Sent" means the provider accepted it**, not that it was delivered or read.
  The status, `sent_at`, the forwarder and `resend_message_id` are written
  together and only on a 200 carrying an id.
- **The spare fee rows are unhighlighted.** Rows 31–32 of the sheet are plain, so
  nothing signals they are available. The importer reads them regardless. If
  forwarders never use them, a hint in column A restores the cue without the
  yellow.

## The sheet is a wire format

`lib/rfqSheet.js` holds every row number as a named constant because
`ImportBidsModal` parses the workbook this module writes, and **nothing validates
the pairing at runtime** — a sheet whose rows moved still parses, it just yields
wrong numbers into a bid, silently.

When the title band was added, the importer was still reading the quote id from a
hardcoded `val(1,2)`. Every returned workbook would have failed to match, and the
error would have pointed at the forwarder's file rather than at us.

If you shift a row: change it in that module, then grep for bare integers inside
`val(...)` / `num(...)` in `ImportBidsModal` before believing you are done.
