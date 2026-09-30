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

## Delivery requests: what the first live test found

The feature was exercised end to end on 28 Aug — a ZZTEST client filed a request
from the portal, staff answered it in Shipments → Delivery Requests. That was the
**first time `portal.delivery_requests` had ever held a row**, and the first time
several code paths on both sides had ever executed.

Confirmed working: HTML escaping (a note containing `<Friday> &` renders
literally in both the notification email and the ERP, rather than as markup), the
notification email itself, the Confirm path end to end, and the Adjust button's
no-date guard.

### `shipment_ref` holds the SALES ORDER number, not the shipment number

This settles a question that was open through migrations 11 and 13. The portal
writes `ZZTEST-SO-001` — `sales_orders.so_number` — into
`delivery_requests.shipment_ref`, despite the column's name and despite
`portal.order_logistics` exposing both `shipment_id` and `shipment_number`.

The ERP resolves that column against `vessl.shipments.shipment_number`, so the
row displayed with the **"unmatched ref"** chip. That is the design working: the
request was still listed and still answerable, rather than being dropped because
a join missed. Had it been hidden, the first real request would have vanished.

**Backlog:** resolve against `sales_orders.so_number` as well, falling back to
`shipment_number`. Do NOT simply switch — the portal is unreachable code and may
write either, and a resolver that only understands one is how this happened.

**Refined 29 Sep, from the portal source:** it writes `client_po_number` when the
order has one and `so_number` only when it does not (`poLabel =
order.client_po_number || order.so_number`). ZZTEST-SO-001 had no client PO;
the ZZDELIV test order did, and its requests carry `ZZDELIV-PO-001`. A resolver
therefore needs `sales_orders.client_po_number` too, not just `so_number`.

### The portal does not reflect our response

After staff Confirm, the portal's summary card still reads **"Requested"**. The
status and `kui_response_note` are written correctly and the client's own RLS
lets them read the row, so this is a portal display gap, not a data one. At
minimum the summary card is stale; whether the detail view shows it is unknown,
because of the crash below.

### ✅ RESOLVED 2026-08-31: delivery-request recipients restored

For roughly two days the `delivery_request_recipients` vault secret held
mattdillon@kinguniversal.com alone — set that way deliberately for testing and
then left. Any real delivery request filed in that window reached one person,
silently: no error, no bounce. `portal.notify_delivery_request` mails whatever
the secret holds, and the hardcoded riley+kristy fallback inside that function
applies only when the secret is missing entirely, which it never was.

Restored by hand 2026-08-31 03:58 UTC on secret id
`c6d60a45-b574-41cd-9c1c-4d2777d14278`:

    select vault.update_secret(
      'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid,
      'riley@kinguniversal.com,kristy@kinguniversal.com');

Read-back confirmed: value `riley@kinguniversal.com,kristy@kinguniversal.com`,
length 48, `matches_target` true, `updated_at` advanced. Addressing by id rather
than by name is deliberate — it cannot land on a similarly-named secret. Omitting
the third and fourth arguments leaves `name` and `description` untouched.

~~Add the delivery coordinator to that same string when Riley names them.~~
**Superseded 29 Sep:** the vault string stays riley + kristy for every client.
Anyone who should hear about ONE client's requests goes on that company's
`delivery_request_recipients` instead — see "Delivery-request emails and client
edits" below.

**The value cannot be checked from our read-only connection.** `vault.secrets` is
readable, but `_crypto_aead_det_decrypt` is not granted, so selecting
`decrypted_secrets` fails with `42501: permission denied for function
_crypto_aead_det_decrypt` — confirmed again during this restore. A read-only
query can prove the secret EXISTS and nothing more. Verifying the value means
running the select as postgres, by hand. Do not infer from "the row is there"
that it is correct — an earlier note did exactly that and was wrong. That is why
this entry records the read-back result rather than the update alone.

### ⚠ The client-side delivery-request render path crashes

**Resolved 21 Sep, see the 2026-09-21 entry under "Deploying KUI-portal" below.**

Opening a shipment detail card **as a client** throws:

    ReferenceError: requests is not defined

inside an `Array.map` — the delivery-request render path itself. It had never
executed before this test: no client had ever had a shipment-linked order, so
the code shipped and sat unreachable. BucketGolf has 21 such orders, meaning
**Killian would hit this the moment he opens a shipment card**.

This is the lead item for the portal-repo access request, ahead of the badge bug.
It is entirely in code we cannot read or fix, and unlike the badge — which shows
a wrong number — this one takes the page down.

## Delivery-request emails and client edits (29–30 Sep, scripts 86–92)

### Who is emailed

`portal.notify_delivery_request` sends ONE email to the vault list
(`delivery_request_recipients`, riley + kristy — the baseline for every client)
**plus** that client's `vessl.companies.delivery_request_recipients` (script 86),
lower-cased, duplicates removed. Null means no extras. A CHECK keeps the array
non-empty, lower case and one `x@y` per entry. BucketGolf's three extras
(killian, justin, mendezjosue@live.com) are script 87. There is no ERP screen
for this column yet — the proposal is a client-only field in the Companies edit
modal.

The function reads `companies` from inside a trigger fired by a client, so it
relies on SECURITY DEFINER **and** an owner that bypasses RLS — otherwise
`kui_staff_only` hides the row and the extras vanish silently. 86 and 92 both
assert it.

### When an email is sent

| Trigger | Fires on | Email |
| --- | --- | --- |
| `trg_notify_delivery_request` | INSERT, or UPDATE OF `requested_date` | "Delivery date requested" / "Delivery request changed" |
| `trg_notify_delivery_request_cancelled` | UPDATE OF `status`, WHEN it moves to `cancelled` | "Delivery request cancelled", By = the cancelling login |

Before 86 the trigger was **insert only**, so every client change to a request
had emailed nobody. Staff Confirm / Adjust / Decline write `status` but never
`requested_date` or `cancelled`, so they send nothing. The only writer of
`cancelled` is `portal.cancel_delivery_request(req_id)`.

Subjects end with the requested date (`… — ZZDELIV-PO-001 · Oct 17`), and every
email carries a fresh `X-Entity-Ref-ID` header, which is Resend's documented way
to stop Gmail threading. `Message-ID` is deliberately NOT set: Resend already
makes it unique and documents no override. Every colon in the function body is
written `chr(58)` because the SQL editor eats single colons — a slip there is in
the Resend URL and stops all mail.

### What a client may change

Until script 90 there was **no client UPDATE policy** on `delivery_requests`.
The portal's "Change delivery request" path could only succeed for a login that
passes `is_kui_staff()`; for a real client it updated zero rows and still showed
success.

- `dr_client_update` (90): own company, from requested / confirmed / adjusted /
  declined, and the row must end `requested`. A cancelled request is history —
  asking again inserts a new row.
- `trg_dr_client_update_guard` (90, widened in 92): a client may change only
  `requested_date`, `note`, `status` (to `requested`) and `requested_by` — and
  `requested_by` only to their own login email. It must stay SECURITY INVOKER:
  `current_user` is how it tells a portal client from staff, postgres and
  SECURITY DEFINER functions such as the cancel RPC, all of which it lets through.
- `cancel_delivery_request(req_id)`: own company, only while `requested`; one
  vague error for every refusal. The portal offers Cancel only in that state and
  tells the client to message KUI once a request has been answered.

When a client re-asks, KUI's earlier answer (`proposed_date`,
`kui_response_note`, `responded_*`) stays on the row. The portal hides it once
the status is back to `requested`; the ERP panel may not. Clearing it would lose
who answered what, so it is a separate decision.

### `is_kui_staff()` is the email domain, nothing else

    select coalesce(auth.jwt()->>'email','') ilike '%@kinguniversal.com'

Any `@kinguniversal.com` login — plus-addressed ones included — is **staff** to
RLS: it can update any delivery request through `dr_staff_update` and read every
company's through `dr_staff_read`, whatever its portal company. A portal test run
from such a login tests the staff path and proves nothing about clients.

**Client-side tests use a non-KUI login.** ZZDELIV (client, extras
`mattdillon+zzextra@` and `mattdillon@`) has two portal logins:
`mattdillon+zzdeliv@kinguniversal.com` (staff path, script 88) and
`mattdillon1197+zzclient@gmail.com` (the real client path, script 91). Its order
ZZDELIV-SO-001 → PO → shipment ZZDELIV-SH-001 keeps the request button live.

### Testing without emailing Riley and Kristy

The vault list applies to every client, so a ZZ request emails Riley and Kristy
unless the secret is pointed away first. The procedure is 88a (record the value)
→ 88b (point it at mattdillon, guarded on the exact baseline) → test → 88c
(restore verbatim, guarded, with read-back) → 88d (list non-ZZ requests filed in
the window). While the window is open **every** client's requests reach
mattdillon alone — keep it to minutes, and run 88c even if the test failed.
`delivery_requests` has no `updated_at`, so 88d can see new requests in the
window but not changes to older ones.

## Deploying KUI-portal, and how to actually verify it

The portal is a separate repo — `riley944/KUI-portal`, Vercel project
`prj_PftVIw825ab46PzCj0ZvwvjMvDiW`, serving `kui.vessl.io`. It is NOT the
`vessl-erp` project, and the Vercel connector used from this workspace is pinned
to `vessl-erp`: `get_deployment` on a KUI-portal id returns 404, `get_project`
takes no arguments, and `list_deployments` silently IGNORES `projectId` — passing
a nonsense id returns vessl-erp's list rather than erroring. Treat any Vercel API
result as being about vessl-erp unless proven otherwise.

### THE COMMIT AUTHOR MUST BE LINKED TO A VERCEL ACCOUNT

On 28 Aug two pushes to KUI-portal were **BLOCKED** — not failed, not queued.
Vercel resolves the commit author's email to a GitHub account and refuses to build
if that account is not connected to a Vercel account. Nothing in git, GitHub or
the repo shows this; the push succeeds normally and the deployment simply never
runs.

Meanwhile the production alias stayed on the previous build for two days. Every
check against the live domain was reading old code, which made a correct commit
look like it was missing its changes.

The trap: **the same author email builds fine on VESSL-erp.** Authorship alone
never explains a difference between the two projects, because the requirement is
per-Vercel-account linkage, not per-commit. Do not conclude "the author is fine
because the other repo deploys".

### ✅ RESOLVED 2026-09-21: the 28 Aug crash fix had never deployed

Killian (Elevate/BucketGolf) reported "Application error: a client-side exception
has occurred" on opening a shipment — the `ReferenceError: requests is not defined`
crash described below. Its fix, `472567e` (plus the `ba5545f` re-trigger), was
committed on 28 Aug and **never reached `kui.vessl.io`**.

kui-portal had blocked every push from the `mdill97` GitHub account since late
Aug, because that account was not linked to a Vercel account. GitHub commit
statuses show "Deployment was blocked" on `e0299ad`, `472567e` and `ba5545f`
(all 28 Aug). An empty commit, `a60d2dd`, was blocked the same way on 21 Sep.
The domain kept serving `087be33` (26 Aug) the whole time. Before the fix the
page `Age` stood at 2,265,597s, about 26 days.

**Fix:** linked GitHub on the Vercel account (Account Settings → Authentication),
then redeployed. `a60d2dd`, whose code is identical to `ba5545f`, completed at
22 Sep 01:26 UTC.

**Confirmed live by the bundle check, not the dashboard:** the page chunk
changed from `page-a41a09325550b5d3.js` to `page-061eeec8c115e9eb.js`, and it
contains "KUI proposed" and "Request withdrawn" (0 hits before). The unrenamed
`requests.find` that caused the crash is gone.

**The dashboard's Ready / Current label is not proof. The bundle string check
below is.**

**Open:** why kui-portal enforces the author check when vessl-erp does not.
Both repos push as the same GitHub login (`mdill97`, same email, same
credential), under the same `riley944s-projects` scope. On 21 Sep vessl-erp
built those commits while kui-portal blocked them, so the difference is a
per-project Vercel setting, not git identity. Riley to compare the two
projects' Git settings. Until that is answered, assume the next kui-portal push
may be blocked, and verify on the domain.

### Verify the DOMAIN, never the deployment

Two holes made this take far longer than it should have. Both are about
mistaking a proxy for the thing itself:

1. **`readyState: READY` does not mean the domain serves it.** A deployment can be
   READY and hold no production alias — preview builds are READY too. READY plus
   an `alias` array in the API response is still not proof the alias is *assigned*
   to that deployment rather than merely configured on the project. A dashboard
   can show a build as READY while `kui.vessl.io` serves something two days older.

2. **Inspecting the deployment's build output proves nothing about what users
   get.** A local `npm run build` passing at exit 0, or reading a deployment's
   assets, says the code compiles — not that it is being served. During this
   incident a clean local build coexisted with a blocked deployment and a
   two-day-old live bundle.

**The check that worked, and the one to use:** fetch the public domain and look
for a string that exists ONLY in the new code.

    CH=$(curl -s https://kui.vessl.io | grep -oE '/_next/static/chunks/app/page-[^"]+\.js' | head -1)
    curl -s "https://kui.vessl.io$CH" | grep -c 'SOME_NEW_STRING_LITERAL'

Zero means the fix is not live, whatever any dashboard says. This is the only
check in the whole incident that never gave a wrong answer.

Two supporting signals on the same response:

- **`Age` never resetting.** A new production deployment invalidates the alias
  cache and `Age` returns to 0. An `Age` that climbs monotonically across hours —
  187,000 seconds here — means no new deployment has taken the alias, regardless
  of build status.
- **`ETag` unchanged.** Same object, same bytes. Compare it before and after a
  push; if it is identical, nothing shipped.

Neither cache-busting query params nor `Cache-Control: no-cache` will move a
statically prerendered page off its cache key — four request variants returned the
identical ETag here. A stale-looking response is not evidence of a CDN problem;
check whether a new deployment exists at all first.

### Do not push what cannot be verified

The deeper mistake was pushing to KUI-portal at all while knowing the deployment
state could not be read. Three pushes produced zero deployments and several rounds
of inference from cache headers, where one API call would have answered it.

Either get a Vercel connector scoped to the TEAM rather than a single project, or
treat KUI-portal pushes as unverified until a human confirms the deployment in the
dashboard AND the domain-content check above returns non-zero.

## `portal.notifications` is write-only

154 rows as of 27 Aug, **none ever marked read**, and the string "notifications"
appears nowhere in this app. Two triggers feed it; nothing consumes it.

The actual staff red dot is `portal.messages.read_by_kui`. Do not build on
`notifications` without first deciding whether to revive or retire it.
