# Client portal integration — operating notes

`kui.vessl.io` is the client-facing portal. These are the things about how it
meets this codebase that are not obvious from the code here.

## The portal is not in this repository

It is a separate Next.js app on Vercel, deployed from a different account. It is
not on any branch of `VESSL-erp` — `git ls-tree -r origin/main` matches no path
containing "portal", and `git ls-remote` shows `refs/heads/main` and nothing else.

**We cannot read, test, or change it.** Anything client-facing is therefore a
prediction until someone with that repo confirms it. Say so rather than assuming.

What we share is the database: the `portal` schema, whose views (`portal.orders`,
`order_items`, `order_logistics`, `me`) read straight from `vessl.*`, scoped by
`portal.my_company_id()`.

## `threads.last_message_at` is NOT the newest message's `created_at`

**Any logic that assumes those are equal will be wrong for client-sent messages.**

`portal.trg_touch_thread_on_message` maintains `last_message_body` and
`last_message_at` from inside the inserting transaction, using the row's own
server-side `created_at`. That is correct at the moment it runs.

But **the portal then overwrites it.** It does its own insert-then-update, and its
UPDATE lands after the trigger's, stamping the column with the portal's own clock.
The ERP used to do the same thing; that half was removed when the trigger shipped
(see `send()` in `app/page.jsx`), but the portal's writer is unreachable and still
live.

Measured on production, 27 Aug:

| thread | newest author | `last_message_at` − `created_at` |
| --- | --- | --- |
| ZZTEST — portal test | client | **+1.716s** |
| 37-FBAF4-2026 | kui_staff (pre-trigger row) | **−0.263s** |

Drift goes **both ways**. Positive on client sends, because the portal writes
later than the trigger. Negative on old ERP rows, because a browser clock running
behind the server produced a preview timestamp that *predates* the message it
describes.

Consequences worth holding onto:

- **Never sort or window on `last_message_at` as if it were the message time.**
  Join to `portal.messages` and use `created_at` when the answer has to be exact.
- **Never compute an interval between the two.** It is not a latency measurement,
  it is clock skew between two machines.
- `last_message_body` does **not** have this problem — both writers set the same
  text, so the value converges even though the timestamp does not.
- This resolves if the portal drops its manual update, the way the ERP did. Until
  then the column is approximately right and precisely wrong.

## Chat email triggers

- `trg_email_client_on_kui_msg` — **enabled**. A staff reply emails every approved
  client user of that company. This is the only signal a client away from the
  portal ever gets: `portal.notifications` is staff-only by RLS, and
  `raise_message_notification` fires only for `author_type = 'client'`, so a staff
  reply creates no notification row at all.
- `trg_email_kui_on_client_msg` — **disabled** (not dropped). It emailed five KUI
  addresses on every client message. Staff now rely on the in-app red dot.
  Re-enable with `alter table portal.messages enable trigger
  trg_email_kui_on_client_msg;`.

All three portal email functions read the Resend key from
`vault.decrypted_secrets` under the name `resend_api_key`. None of them contains a
key. If mail stops, check the vault before the code — every one of them returns
early and silently when the secret is missing, which is how delivery-request
emails were dead for months without anyone noticing.

## Staff messages display as "KUI Team" — but authorship is recorded

Riley's call: **everyone sees every thread, red dots stay shared, and staff
messages show one team voice.** No per-person labels.

`portal.messages.author_email` is still written on every staff send, and nothing
renders it. That is deliberate, not an oversight:

- **Authorship cannot be reconstructed later.** Nothing else records who typed a
  reply. If the display is switched back on in a year, real names would appear on
  new messages and "KUI Team" on everything sent in between — a permanent hole in
  the record, for the sake of not writing one nullable column nobody sees.
- **Re-enabling is a display change only.** The resolution helper (`staffLabel`:
  `author_email` → `vessl.staff_profiles.full_name` first word → email local-part
  → `'KUI Team'`) was removed rather than left as dead code. It rendered
  "Matt KUI" / "Kristy KUI". Restoring it means that expression plus loading the
  roster in `ClientRelations`' `loadAll` — see the commit that added it for the
  version that was tested against all seven staff addresses.
- **`author_name` stays `'KUI Team'`** on every staff row regardless. That column
  is shared with the portal, which we cannot see or test, so it is not a safe
  place to express a staff-side display preference.

Do not remove the `author_email` write as an unused column.

## Parked: per-user thread ownership (#2)

Designed, approved, then **parked** — shared visibility and shared badges are the
product for now. Recorded so the design is not re-derived from scratch:

- **DDL:** `alter table portal.threads add column owner_email text;` — nullable,
  no FK, no CHECK. **NULL means unassigned**, which is every row today, so
  behaviour would be unchanged until someone claims a thread. That is what makes
  ownership opt-in rather than a migration.
- **Email, not uuid** — matches `thread_reads.user_email`, the `thread_reads_own`
  policy's `auth.jwt()->>'email'`, and `is_kui_staff()`. A uuid would be a fifth
  identity scheme for the same thing.
- **No FK to `staff_profiles`** — that roster is incomplete by decision (Loren is
  off it), and an FK would make claiming impossible for anyone unrostered,
  rebuilding the `forwarder_bids` lockout in a new place.
- **Claim mechanics:** self-serve claim and release, owner shown on the thread, no
  auto-claim on reply. **Anyone can release** — a thread stranded on someone who
  is away is worse than a contested claim.
- **Scoping:** unread = threads where `owner_email = me OR owner_email is null`,
  containing a client message newer than my `thread_reads.last_read_at`.
  Membership, never exclusion: a thread owned by someone else leaves *my* count
  but stays visible and openable. The sidebar badge would have to be scoped the
  same way or it disagrees with the panel.
- **`portal.thread_reads` is the per-user read mechanism** and is still unused —
  0 rows. It exists precisely for this. Today's red dot is
  `portal.messages.read_by_kui`, a single global boolean: one staff member opening
  a thread marks it read for everyone. That is fine while visibility is shared and
  is the first thing that breaks if ownership is revived.

## `portal.notifications` is write-only

154 rows as of 27 Aug, **none ever marked read**, and the string "notifications"
appears nowhere in this app. Two triggers feed it; nothing consumes it.

The actual staff red dot is `portal.messages.read_by_kui`. Do not build on
`notifications` without first deciding whether to revive or retire it.
