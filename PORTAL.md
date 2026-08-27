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

## `portal.notifications` is write-only

154 rows as of 27 Aug, **none ever marked read**, and the string "notifications"
appears nowhere in this app. Two triggers feed it; nothing consumes it.

The actual staff red dot is `portal.messages.read_by_kui`. Do not build on
`notifications` without first deciding whether to revive or retire it.
