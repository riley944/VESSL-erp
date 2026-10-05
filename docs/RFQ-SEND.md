# RFQ send — operating notes

The Shipments tab emails a fillable freight RFQ to one forwarder contact through
Resend, and reads the returned workbook back as a bid. These are the things about
it that are not obvious from the code.

## Environment

- `RESEND_API_KEY` must be present in Vercel's env vars. The route returns a 500
  and sends nothing if it is missing, rather than failing in a way that looks
  like a rejected message.
- `vessl.io` is verified for **sending only**. Receiving is off, so `reply_to`
  must point somewhere that accepts mail. It is `kristy@kinguniversal.com`
  (`DEFAULT_REPLY_TO` in the route), per Riley: Kristy runs the RFQ round and
  imports the replies, so the filled sheets reach her without a forwarding hop.

  The covering email **names that address in its text** as well as setting the
  header, because a forwarder who forwards the mail onward, or whose client hides
  the header, otherwise has nothing to go on. It is not written twice: `rfqBody`
  takes the address as a parameter and the route passes it. It is passed rather
  than imported because `lib/rfqSheet.js` is bundled into the browser for the
  download path, and importing the route there would pull server-only code — and
  the file that reads the Resend key — into the client bundle.

  The route passes the **resolved** `replyTo`, not the constant. With no override
  in the request they are identical; with one, the sentence follows the header
  rather than contradicting it. An email naming an address a Reply does not reach
  is worse than one naming none.

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

## Importing requires a staff_profiles row — READ THIS BEFORE DEBUGGING AN IMPORT

`vessl.forwarder_bids` carries exactly one policy: `staff_only`, PERMISSIVE /
ALL / `authenticated`, gated on `vessl.is_staff()`. That function asks whether a
row exists in `vessl.staff_profiles` matching `auth.uid()` or the JWT email. **A
staff member who is not on that roster cannot insert a bid — or read one.**

The same gate is the only permissive policy on nine tables: `forwarder_bids`,
`freight_allocations`, `freight_invoice_lines`, `freight_invoices`,
`order_notes`, `program_notes`, `program_tasks`, `programs`, `staff_profiles`.

**It fails silently in the UI.** `staff_profiles` is itself `is_staff()`-gated,
so an unrostered user's role lookup (`page.jsx`) returns nothing, `role` lands
`null`, and `allowedPagesFor(null)` means *unrestricted*. Full UI, every page
visible, and every write to those nine tables refused. Nothing surfaces until
something actually tries to write — which is why this went unnoticed until the
first real bid import, with `forwarder_bids` sitting at zero rows.

If an import fails with *"new row violates row-level security policy for table
forwarder_bids"*, the fix is a roster row, **not** a new policy. Do not copy
`shipment_quotes`' escape hatch: that table carries a second permissive policy
(`shipment_quotes_auth_all`, `using true`) which bypasses `is_staff()` entirely,
and it is safe there only because a RESTRICTIVE `kui_staff_only` email-domain
policy is AND'd on top. Adding a bare `true` policy to `forwarder_bids`, which
has no restrictive backstop, would open freight bids to every authenticated
user including portal clients.

Note also that `forwarder_bids.shipment_quote_id` has **no foreign key**.
Deleting a quote neither cascades nor errors — it orphans the bid. Delete bids
first, explicitly.

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

## Status — round trip verified 25 Aug 2026

The full loop was exercised end to end against production: a throwaway freight
quote sent from `orders.vessl.io` via the typed-address path, the workbook built
by the serverless bundle, filled as a forwarder would across **all three tables**
(rates, one destination charge, one accessorial), imported back, and saved as a
`forwarder_bids` row. Test artifacts — the bid, the quote, and the ZZTEST
forwarder rig — were removed afterwards, so nothing test-shaped reaches Kristy's
picker.

**The overwrite guard was witnessed** the same day, on the dev server against
this same database: a cross-forwarder re-send raised the confirm naming the prior
forwarder (ZZTEST Forwarder A), Cancel left the quote untouched and sent nothing,
and the accept path sent. Worth recording separately because the production round
trip above used the typed-address path, which carries no `companyId` and so
deliberately skips the confirm — that run could not have exercised it.

Two things were fixed in the course of it:

- **The `forwarder_bids` RLS lockout**, above. Found on the first real Save bid.
  `forwarder_bids` had never accepted an insert. Three of six `@kinguniversal.com`
  accounts were missing from `vessl.staff_profiles`, so `is_staff()` was false for
  them. Fixed by rostering **Matt and Kristy** (`role` `staff`, matching Carmela
  and Steven — deliberately not `limited_qc`, which *restricts* the UI). **Loren
  was deliberately excluded** and remains locked out of all nine tables, silently,
  in the manner described above. That is a decision, not an oversight — but the
  next silent write failure from that account will have this cause.
- **Reply-to moved to Kristy** and is now named in the email body.

No policy was added, dropped or altered. `forwarder_bids` still carries exactly
its one original policy; the lockout was a data gap, not a posture change.

### The reminder digest was NEVER BUILT — correcting the 31 Aug handoff

A handoff doc dated 31 Aug recorded a daily reminder digest as shipped, under a
commit `d09fc3c`, with `CRON_SECRET` and `SUPABASE_SERVICE_ROLE_KEY` in Vercel
Production. **None of that exists.** The claim propagated for three days and was
about to reach Kristy in an email telling her to expect automatic chasers.

Measured 2026-09-03, in this repo and in the KUI-portal clone:

- `d09fc3c` is not a revision on any ref in either repository.
- No commit on any ref matches `cron`, `reminder` or `digest`.
- `vercel.json` has never existed here — `git log --all -- vercel.json` is empty.
  Vercel crons are declared in that file and nowhere else, so no schedule can
  have been registered and no invocation can have occurred.
- `app/api/cron/**` has never been added. The production build lists exactly
  three routes: `/`, `/_not-found`, `/api/rfq/send`.
- `.env.local` holds four keys — the two Supabase public ones, `RESEND_API_KEY`
  and `VERCEL_OIDC_TOKEN`. Neither `CRON_SECRET` nor `SUPABASE_SERVICE_ROLE_KEY`
  is present, and neither name appears anywhere in `app/` or `lib/`.

What **did** ship from that two-part plan is part 1 only: `8e08aea`, 31 Aug,
*RFQ send: BCC Kristy on every outgoing RFQ*. She receives a copy of every RFQ
that leaves the building. She receives **no** reminder when one goes unanswered,
and no sent RFQ has ever been chased automatically — FQ-3132D included.

Part 2 remains unbuilt and still needs all three of: script 21 (`grant usage on
schema vessl` plus `select` on the three tables to `service_role`, since the
route reads as the cron and not as a user), a `CRON_SECRET` generated by hand,
and `SUPABASE_SERVICE_ROLE_KEY` from Riley.

The lesson is not about this feature. **A handoff doc is a claim, not a
measurement.** Anything it says shipped is checkable in about a minute —
`git rev-parse` the SHA, list the build's routes, name the env keys — and until
that is done it is hearsay, however confidently written. This one survived
because it was specific: a plausible SHA and a plausible env list read as
evidence when they are only detail.

### The designed upgrade: inbound email and a red dot

Today the loop has a manual seam. A forwarder replies to Kristy, and she saves
the attachment and imports it by hand. Everything downstream of that import is
automatic; everything upstream of it is a mailbox.

The intended next build closes that seam: enable **receiving** on a `vessl.io`
address, ingest the returned workbook straight into `forwarder_bids` through the
existing geometry module, and surface a **red dot on the quote card** when a bid
lands — so a reply announces itself in the app instead of waiting to be noticed
in an inbox.

Two things already point that way and should not be undone. `resend_message_id`
is stored on the quote, which is the handle an inbound reply would thread back
to. And the parse is already a pure function of the workbook — `ImportBidsModal`
does the reading, but the row numbers live in `lib/rfqSheet.js`, so a webhook can
reuse the same constants without touching the modal. The wire-format rule at the
top of that module matters more, not less, once a machine is doing the reading:
a shifted row would then produce wrong numbers with nobody looking at the sheet.
