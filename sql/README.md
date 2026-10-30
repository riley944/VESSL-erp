# SQL scripts — the index

Every hand-run script against the VESSL database (ERP schema `vessl`, portal schema
`portal`). One numbering sequence for both. Built 2026-10-05.

## Rules

- **Every new script is created here**, numbered `NNN-short-name.sql` with three
  digits. **Next free number: 141.** (95 is reserved, see below.)
- A reverse is `NNNr-short-name-reverse.sql`; a check run after commit is
  `NNN-after-commit-checks.sql`. Both sit beside their forward script.
- Run `python sql/preflight.py sql/NNN-name.sql` before a script is printed or run.
- Scripts end in `rollback;`. Rehearse as written, then swap that line for `commit;`
  for the real run. The file on disk therefore never shows whether it was committed —
  this index does.
- Every script that writes `purchase_orders`, `sales_orders` or `shipments` sets
  `set local vessl.change_note = 'script NNN Matt';` straight after `begin;` (since 107).
- **Untracked while the GitHub repo is public.** `.gitignore` carries `sql/*`; only
  the 16 scripts committed before 2026-10-05 (061–069, 071–077) and `preflight.py` are
  tracked. Do not `git add -f` anything here until the repo is private. This file is
  untracked too.
- Add a row here when a script is written, and update its status when it is run.

## Key

**Area** — ERP (`vessl` schema, ERP features), Portal (KUI portal features: delivery
requests, portal logins, the delivery-request vault secret), Both (reads or writes
both schemas).

**Status** — *Run* (committed to the live database), *Never run*, *Read-only* (no
commit line by design), *Lost* (recorded as run, file gone), *Reserved*, *Unused*.

**Source** — *Doc*: docs/CATALOGUE.md, docs/PLM.md or docs/PORTAL.md record the run. *DB*: no
written record; on 2026-10-05 the live database was checked read-only and holds what
the script creates. *Inferred*: neither directly; the reasoning is in the row.

## Index

| No. | File | Date run | Area | What it did | Status | Source |
|---|---|---|---|---|---|---|
| 001–013 | — | — | — | No file and no record anywhere. Predate the catalogue. | Unknown | — |
| 014 | `014-batch1-poi-product-id.sql` | 10 Sep | ERP | Four costing-basis PO lines linked to products (after 41 cleared the constraint) | Run | Doc |
| 015 | — | 28 Aug | ERP | BUC-157 rename across products, quote and SO line | Lost | Doc |
| 016 | — | 31 Aug | ERP | `purchase_order_items.product_sku` and its stamping trigger | Lost | Doc |
| 017 | — | — | ERP | Trigger behaviour test, transaction only | Lost (rehearsal only, never committed) | Doc |
| 018 | — | 31 Aug | ERP | `quotes.product_id` and `vessl.rename_product_sku()` | Lost | Doc |
| 019 | — | 31 Aug | ERP | `products.origin`, 48 products created from quotes, and links | Lost | Doc |
| 020 | — | 31 Aug | ERP | BUC-157 draft PO line linked | Lost | Doc |
| 021 | `021-rfq-digest-grants.sql` | 8 Sep | ERP | `vessl.rfq_digest_rows()` and the only two grants `service_role` holds | Run | Doc |
| 021 | `021-after-commit-checks.sql` | 8 Sep | ERP | Checks after 021 | Read-only | Doc |
| 022 | — | 2 Sep | ERP | Client name recase, five clients, 49 rows | Lost | Doc |
| 023 | — | 2 Sep | ERP | HTS description title case, 24 rows | Lost | Doc |
| 024 | — | 2 Sep | ERP | HTS description bracket case, 2 rows | Lost | Doc |
| 025 | — | 2 Sep | ERP | `htscodes.duty_note` and both column comments | Lost | Doc |
| 026 | — | 2 Sep | ERP | The two compound-rate hat codes, 44.50 and the note | Lost | Doc |
| 027 | — | 3 Sep | ERP | 18 size-less parent products, origin `size-merge-27` | Lost | Doc |
| 028 | — | 3 Sep | ERP | 110 size-variant rows retired (run after 029) | Lost | Doc |
| 029 | — | 3 Sep | ERP | Two surviving name-variant rows renamed | Lost | Doc |
| 030 | — | 3 Sep | ERP | Regulation and material links copied to the survivors | Lost | Doc |
| 031 | — | 3 Sep | ERP | `staff_profiles.notifications_enabled` | Lost | Doc |
| 032 | — | 4 Sep | ERP | `quotes.size_plate_fees` and `quotes.size_cartons` | Lost | Doc |
| 033 | — | 4 Sep | ERP | Five BUC bag PO lines linked, v4 after three failed rehearsals | Lost | Doc |
| 034 | `034-kui-settings-table-and-rls.sql` | 8 Sep | ERP | `vessl.kui_settings`, `can_write_settings()` and RLS (v2) | Run | Doc |
| 034 | `034-after-commit-checks.sql` | 8 Sep | ERP | Checks after 034; step 2 fails by design | Read-only | Doc |
| 035 | `035-kui-settings-bank-fields.sql` | 8 Sep | ERP | Six `bank_` columns on `kui_settings`, `ach_info` dropped | Run | Doc |
| 035 | `035-after-commit-checks.sql` | 8 Sep | ERP | Checks after 035 | Read-only | Doc |
| 036 | `036-payment-accounts.sql` | — | ERP | `vessl.payment_accounts` and `quotes.payment_account_id` | **Never run** | Doc and DB (neither exists) |
| 036 | `036-after-commit-checks.sql` | — | ERP | Checks after 036 | Never run | Doc |
| 037 | `037-duplicate-product-cleanup.sql` | 8 Sep | ERP | Four imported-twice product pairs resolved | Run | Doc |
| 037 | `037-after-commit-checks.sql` | 8 Sep | ERP | Checks after 037 | Read-only | Doc |
| 038 | `038-bg09rl-orphan-retire.sql` | 8 Sep | ERP | The unreachable BG09RL-EXW orphan retired | Run | Doc |
| 039 | `039-sales-order-items-product-link.sql` | 9 Sep | ERP | 231 sales order lines linked to products (run after 041) | Run | Doc |
| 040 | `040-jon106-report-relink.sql` | 9 Sep | ERP | JON-106 test report moved to the product it describes | Run | Doc |
| 041 | `041-drop-order-item-product-uniques.sql` | 9 Sep | ERP | Both order-item `UNIQUE (order_id, product_id)` dropped | Run | Doc |
| 042 | `042-buc157-merge.sql` | 10 Sep | ERP | BUC-157 KU2607001, one product entered twice, merged | Run | Doc |
| 043 | `043-rfq-outcomes.sql` | 10 Sep | ERP | `shipment_quotes.rfq_group_id`, status CHECK, the Dallas trio grouped | Run | Doc and DB |
| 044 | `044-rfq-status-backfill.sql` | not recorded (written 10 Sep) | ERP | Existing awards copied from `forwarder_bids.selected` onto status | Run, probably | Inferred: awarded and not_selected statuses exist, but the app also writes them |
| 045 | `045-po-lines-product-link.sql` | 10 Sep | ERP | PO lines linked to products, 71 of 156 | Run | Doc |
| 046 | `046-strip-sku-prefix-from-names.sql` | 10 Sep | ERP | Eleven product names stripped of their own SKU | Run | Doc |
| 047 | `047-bubble-bath-line-link.sql` | 10 Sep | ERP | The one PO line 046 made resolvable | Run | Doc |
| 048 | `048-programs-product-client.sql` | 10 Sep | ERP | Programs rebuilt as product x client (PLM phase 2A) | Run | Doc |
| 048 | `048-after-commit-checks.sql` | not recorded | ERP | Checks after 048 | Read-only | — |
| 049 | `049-declared-stage-at.sql` | not recorded (written 11 Sep) | ERP | `programs.declared_stage_at` and its trigger | Run | DB |
| 049 | `049-after-commit-checks.sql` | not recorded | ERP | Checks after 049 | Read-only | — |
| 050 | `050-koozie-sku.sql` | 11 Sep | ERP | The Koozie gets SKU STC-016 | Run | Doc |
| 051 | `051-rename-product-sku-repair.sql` | 11 Sep | ERP | `rename_product_sku` repaired after 048 broke it | Run | Doc |
| 051 | `051-after-commit-checks.sql` | 11 Sep | ERP | Checks after 051 | Read-only | Doc |
| 052 | `052-product-active-from-orders.sql` | not recorded (written 14 Sep) | ERP | `products.active` reconciled against PO lines | Run | Inferred: 058, recorded as run, undoes part of it |
| 053 | `053-production-pct.sql` | 15 Sep | ERP | `purchase_orders.production_pct` | Run | Doc |
| 054 | `054-housekeeping-legacy-inquiry-order-date.sql` | 15 Sep | ERP | Legacy PLM tables dropped, inquiry stage removed, `order_date` NOT NULL | Run | Doc |
| 055 | `055-drop-p-program-ids.sql` | 15 Sep | ERP | `rename_product_sku` without `p_program_ids` | Run | Doc |
| 056 | `056-merge-same-sku-twins.sql` | 15 Sep | ERP | Same-SKU twins merged, LL1-380 excluded | Run | Doc |
| 057 | `057-product-active-from-sales-orders.sql` | 15 Sep | ERP | Ordered means a PO or an SO, in the active flag too | Run | Doc |
| 058 | `058-list-b-retired.sql` | 16 Sep | ERP | Fourteen products retired | Run | Doc |
| 059 | `059-parent-products-client-and-active.sql` | 16 Sep | ERP | Nine parent products from a sheet | Run | Doc |
| 060 | `060-plm-manual-reset.sql` | 17 Sep | ERP | PLM board becomes manual and starts empty | Run | Doc |
| 061 | `061-delete-duplicate-quote-TRE-011.sql` | 18 Sep | ERP | The duplicate TRE-011 quote removed | Run | Doc |
| 062 | `062-programs-updated-by.sql` | 18 Sep | ERP | `programs.updated_by` | Run | Doc |
| 063 | `063-program-notes-editable.sql` | 18 Sep | ERP | A note can be corrected by whoever wrote it | Run | Doc |
| 064 | `064-program-notes-real-delete.sql` | 18 Sep | ERP | Delete means delete, reversing 063 soft delete | Run | Doc |
| 065 | `065-programs-sampling-stage.sql` | 18 Sep | ERP | Three sample rungs become one Sampling stage | Run | Doc |
| 066 | `066-product-sampling-notes.sql` | 18 Sep | ERP | Sampling notes belong to the product (`product_notes`) | Run | Doc |
| 067 | `067-product-sample-events.sql` | 18 Sep | ERP | A sample is an event, not a column | Run | Doc |
| 068 | `068-merge-upm-companies.sql` | 22 Sep | ERP | Two company rows for one factory become one | Run | Doc |
| 069 | `069-contacts-one-primary.sql` | 22 Sep | ERP | One primary contact per company | Run | Doc |
| 070 | — | — | — | Never used. No file, no mention anywhere. | Unused | — |
| 071 | `071-quote-factory-aliases.sql` | 22 Sep | ERP | Three factory spellings become the company names | Run | Doc |
| 072 | `072-quote-client-company-backfill.sql` | 22 Sep | ERP | Quotes linked to the client company the catalogue can name | Run | Doc |
| 073 | `073-programs-delete-grant.sql` | 22–23 Sep | ERP | DELETE on `vessl.programs` for authenticated | Run | Doc |
| 074 | `074-product-client-from-quotes.sql` | 23 Sep | ERP | Products that only ever belonged to one client, linked to it | Run | Doc |
| 075 | `075-plm-stage-ladder.sql` | 23 Sep | ERP | The six-stage ladder on `programs.declared_stage` | Run | Doc |
| 076 | `076-program-tasks.sql` | 23 Sep | ERP | `vessl.program_tasks`, the per-stage checklist | Run | Doc |
| 077 | `077-program-sample-fields.sql` | 23 Sep | ERP | Sample strip columns on `programs` | Run | Doc |
| 078 | `078-programs-created-by.sql` | not recorded (written 24 Sep) | ERP | `programs.created_by` | Run | DB |
| 079 | `079-program-notes-stage.sql` | not recorded (written 24 Sep) | ERP | `program_notes.stage` | Run | DB |
| 080 | `080-program-sample-rounds.sql` | not recorded (written 24 Sep) | ERP | `vessl.program_sample_rounds` | Run | DB |
| 081 | `081-drop-programs-sample-columns.sql` | not recorded (written 25 Sep) | ERP | The four 077 sample columns dropped | Run | DB |
| 082 | `082-sample-rounds-tracking-and-delete.sql` | not recorded (written 25 Sep) | ERP | Round tracking number, and DELETE on rounds | Run | DB |
| 083 | `083-round-carrier-and-testing-lab.sql` | not recorded (written 25 Sep) | ERP | `program_sample_rounds.carrier`, `programs.testing_lab` | Run | DB |
| 084 | `084-parcel-carriers.sql` | not recorded (written 25 Sep) | ERP | `vessl.parcel_carriers` (dropped again by 085) | Run | Inferred: 085 migrated its rows |
| 085 | `085-carriers-as-companies.sql` | not recorded (written 25 Sep) | ERP | Carriers become companies of type carrier, `companies.tracking_url` | Run | DB |
| 086 | `086-delivery-request-recipients.sql` | not recorded (written 29 Sep) | Both | `companies.delivery_request_recipients` and the notify function | Run | DB |
| 087 | `087-bucketgolf-delivery-recipients.sql` | not recorded (written 30 Sep) | Portal | BucketGolf extra delivery-request recipients set | Run | DB |
| 088 | `088-zz-delivery-test-setup.sql` | not recorded (29 Sep) | Both | ZZDELIV test rows for 086 | Run | Inferred: 089 removed its rows |
| 088a | `088a-vault-record.sql` | 29 Sep | Portal | Read and record the vault recipients secret | Read-only | — |
| 088b | `088b-vault-point-at-matt.sql` | not recorded (29 Sep) | Portal | Vault secret pointed at one staff address for the test (opens the window) | Run | Inferred: 093 closes the 088b window |
| 088c | `088c-vault-restore.sql` | — | Portal | Restore the vault secret | Never run, probably | Inferred: 093 replaces it and says not to run it after |
| 088d | `088d-window-check.sql` | — | Both | Did a real client file a request during the window | Read-only | — |
| 088e | `088e-zz-diagnose.sql` | — | Both | Why no ZZDELIV request was inserted | Read-only | — |
| 089 | `089-zzdeliv-cleanup.sql` | not recorded (written 30 Sep) | Both | ZZDELIV test rig removed | Run | DB |
| 090 | `090-delivery-requests-client-update.sql` | not recorded (written 30 Sep) | Portal | Portal clients may change date and note on their own request | Run | DB |
| 091 | `091-zz-client-login-approve.sql` | not recorded (30 Sep) | Portal | Non-staff ZZ test login approved and bound to ZZDELIV | Run | Inferred: 089 removes its rig |
| 092 | `092-delivery-request-email-cancel-and-editor.sql` | not recorded (written 30 Sep) | Portal | No Gmail threading, a cancel email, `requested_by` follows the editor | Run | DB |
| 093 | `093-vault-new-baseline.sql` | 30 Sep, probably | Portal | Vault secret set to the three-staff baseline | Run, probably | Inferred: vault last changed 30 Sep 18:41 UTC; value not readable |
| 094 | `094-delivery-recipients-check.sql` | — | Portal | Who a delivery request would email | Read-only | — |
| 095 | — | — | Portal | Reserved for the portal Request access staff notification | Reserved, not written | Doc |
| 096 | `096-plm-archived-stage.sql` | 1 Oct | ERP | `archived` allowed in the three stage CHECKs | Run | Doc |
| 096r | `096r-plm-archived-stage-reverse.sql` | — | ERP | Reverse of 096 | Never run | Inferred: 096 is live |
| 097 | `097-plm-rounds-one-stage-and-sample-type.sql` | 1 Oct | ERP | Every round is a Sampling round; `sample_type` | Run | Doc |
| 097r | `097r-plm-rounds-one-stage-and-sample-type-reverse.sql` | — | ERP | Reverse of 097 | Never run | Inferred |
| 098 | `098-plm-round-notes.sql` | 1 Oct | ERP | Notes on a sample round (`round_id`, `round_no`) | Run | Doc |
| 098r | `098r-plm-round-notes-reverse.sql` | — | ERP | Reverse of 098 | Never run | Inferred |
| 099 | `099-plm-merge-revision-checklist.sql` | 1 Oct | ERP | Revision checklist merged into Sampling | Run | Doc |
| 099r | `099r-plm-merge-revision-checklist-reverse.sql` | — | ERP | Reverse of 099 | Never run | Inferred |
| 100 | `100-plm-round-renumber-notes-follow.sql` | 1 Oct | ERP | Round notes follow a renumbered round | Run | Doc |
| 100r | `100r-plm-round-renumber-notes-follow-reverse.sql` | — | ERP | Reverse of 100 | Never run | Inferred |
| 101 | `101-plm-seed-preview.sql` | 1 Oct | ERP | What a new Sampling card is seeded with | Read-only | Doc |
| 102 | `102-plm-sample-types-list.sql` | 1 Oct | ERP | `vessl.sample_types`, a list staff can add to | Run | Doc |
| 102r | `102r-plm-sample-types-list-reverse.sql` | — | ERP | Reverse of 102 | Never run | Inferred |
| 103 | `103-quote-code.sql` | not recorded (written 1 Oct) | ERP | Quote ID, `quotes.quote_code` (Q-0001 on) | Run | DB |
| 103r | `103r-quote-code-reverse.sql` | — | ERP | Reverse of 103 | Never run | Inferred |
| 104 | `104-programs-source-quote.sql` | not recorded (written 1 Oct) | ERP | `programs.source_quote_id` | Run | DB |
| 104r | `104r-programs-source-quote-reverse.sql` | — | ERP | Reverse of 104 | Never run | Inferred |
| 105 | `105-programs-backfill-source-quote.sql` | not recorded (written 1 Oct) | ERP | Three existing cards given their source quote | Run | DB (3 cards) |
| 105r | `105r-programs-backfill-source-quote-reverse.sql` | — | ERP | Reverse of 105 | Never run | Inferred |
| 106 | `106-undo-sea-to-follow-shipment.sql` | 2 Oct | ERP | The accidental shipment on PO SEA-To FOllow undone | Run | Doc |
| 106r | `106r-undo-sea-to-follow-shipment-reverse.sql` | — | ERP | Reverse of 106 | Never run | Inferred |
| 107 | `107-order-history.sql` | 2 Oct | ERP | `vessl.order_history` and its triggers. First verified live recording 5 Oct (throwaway PO ZZ-HISTORY-TEST2, rows 12–14: insert, status change, delete, via direct); the 2 Oct hand test left no rows and is not evidence | Run | Doc and DB |
| 107r | `107r-order-history-reverse.sql` | — | ERP | Reverse of 107 | Never run | Inferred |
| 108 | `108-testing-digest-rows.sql` | 5 Oct | ERP | `vessl.testing_digest_rows()` for the weekly testing email to Jenn; EXECUTE for service_role only. Rehearsal and commit both z0 only; first dry run 48 / 0 / 3 / 130 | Run | Doc (user report) and DB (function live, service_role only) |
| 108r | `108r-testing-digest-rows-reverse.sql` | — | ERP | Reverse of 108. Remove the testing cron entry from vercel.json first | Never run | Inferred: 108 is live |
| 109 | `109-staff-can-see-analytics.sql` | 7 Oct | ERP | `staff_profiles.can_see_analytics` (default false), true for Riley, Steven and Matt; trigger refuses changes to it from the app | Run | Doc (user report) and DB (3 true, trigger present) |
| 109r | `109r-staff-can-see-analytics-reverse.sql` | — | ERP | Reverse of 109; take the code that reads the column out first | Never run | Inferred: 109 is live |
| 110 | `110-staff-role-guard.sql` | — | ERP | Trigger `trg_guard_staff_identity`: from the app, no staff row can be inserted or deleted, only your own row can be updated, and `role`, `email`, `auth_user_id` and `hide_financials` cannot change. Own `full_name` and `notifications_enabled` still save; postgres scripts and the sign-in link trigger unaffected. No role changed. 16 probes | Run | DB (trigger present and enabled on insert, update, delete; 7 rows, Riley the only admin, roles unchanged; checked 8 Oct) |
| 110r | `110r-staff-role-guard-reverse.sql` | — | ERP | Reverse of 110; drops the trigger and its function, so app writes are as open as before. 109 guard stays | Never run | Inferred: 110 is live |
| 111 | `111-jenn-full-access.sql` | 10 Oct | ERP | Jenn Moore `limited_qc` → `staff` (role column, her row only, by id); `can_see_analytics` stays false, so every page but Analytics. Runs as postgres past the 109/110 guards. Rehearsal and commit both z0 only | Run | Doc (user report) and DB (Jenn staff, analytics false, Riley sole admin, other roles unchanged; checked 10 Oct) |
| 111r | `111r-jenn-full-access-reverse.sql` | — | ERP | Reverse of 111; Jenn back to `limited_qc` | Never run | Inferred |
| 112 | `112-sample-round-sent-by.sql` | — | ERP | `program_sample_rounds.sent_by`, nullable text, CHECK us / them / null; existing rounds stay blank, no backfill, no grant change (table-level grants cover it). 5 probes | Run | DB (column and CHECK present, checked read-only 12 Oct) |
| 112r | `112r-sample-round-sent-by-reverse.sql` | — | ERP | Reverse of 112; drops the column and its CHECK, losing every Sent by recorded (a0 shows the count). Take the code out first | Never run | Inferred: 112 is live |
| 113 | `113-sample-round-second-package.sql` | 12 Oct | ERP | Second package on a sample round: `sent_by_2` (CHECK us / them / null), `carrier_2`, `tracking_number_2`, all nullable text; existing rounds stay blank, no backfill, no grant change (table-level grants cover it). Needs 112. 4 probes | Run | Doc (user report, 12 Oct) and DB (three columns and CHECK present and validated, 2 rounds, none with a second package; checked 12 Oct) |
| 113r | `113r-sample-round-second-package-reverse.sql` | — | ERP | Reverse of 113; drops the three columns and the CHECK, losing every second package recorded (a0 shows the count). 112 stays. Take the code out first | Never run | Inferred: 113 is live |
| 114 | `114-sample-round-client-leg.sql` | 14 Oct | ERP | Riley (client-leg columns on program_sample_rounds: received_date, client_sent_date, client_carrier, client_tracking_number, client_received_date, client_feedback, client_feedback_at), all nullable, no default. File reconstructed 15 Oct from the live schema; original pending from Riley. The reconstruction is a no-op where all seven exist. 2 probes | Run (by Riley, 14 Oct) | DB (columns present, 15 Oct) |
| 114r | `114r-sample-round-client-leg-reverse.sql` | — | ERP | Reverse of 114; drops the seven client-leg columns, losing every arrival, client shipment, tracking and feedback recorded (a0 shows how many rounds hold any). Written with the reconstruction, not by Riley; check with Riley first. Take the code out first | Never run | Inferred: 114 is live |
| 115 | `115-tasks-seen-at.sql` | 15 Oct | ERP | `tasks.seen_at`, nullable timestamptz, no default; NULL is unread. Existing tasks stay NULL, no backfill, no grant change (table-level grants cover it). 3 probes | Run (15 Oct) | Doc (user report, 15 Oct: rehearsal z0, then commit) |
| 115r | `115r-tasks-seen-at-reverse.sql` | — | ERP | Reverse of 115; drops `seen_at`, losing every read mark (a0 shows the count). Take the code out first | Never run | — |
| 116 | `116-quote-client-sheet.sql` | 15 Oct | ERP | Client price sheet wording: `quotes.client_details` and `quotes.client_color`, and `staff_profiles.job_title` for the sign-off; all nullable text, no default, no backfill, no grant change. 110 staff guard untouched (own title saves, another person refused). 4 probes | Run (15 Oct) | Doc (user report) and DB (all three columns present, checked read-only 20 Oct) |
| 116r | `116r-quote-client-sheet-reverse.sql` | — | ERP | Reverse of 116; drops the three columns, losing every Details, Color and job title (a0 shows the counts). Take the code out first | Never run | — |
| 117 | `117-riley-job-title.sql` | 15 Oct | ERP | Riley `staff_profiles.job_title` = 'VP of Sales' for the client sheet sign-off, only where it is NULL (never overwrites a typed title). Row by id `11da4231…` + email length 23; guard exactly one match. a0 row before, z0 after. Needs 116 | Superseded (19 Oct) | Never run; Riley sets job_title himself in Settings |
| 117r | `117r-riley-job-title-reverse.sql` | — | ERP | Reverse of 117; clears Riley job_title to NULL only if it still reads 'VP of Sales' | Never run | — |
| 118 | `118-name-case-audit.sql` | 16 Oct | ERP | AUDIT, read only, no reverse. Capitalisation report: products.name and quotes.product (first letter not A-Z / 0-9; any word starting lowercase, small words and text after an apostrophe excepted), products.sku with lowercase, SKUs equal ignoring case, (sku, name) pairs equal ignoring case, and counts only for purchase_order_items / sales_order_items descriptions. Runs in a READ ONLY transaction ending in rollback | Run (16 Oct) | Doc (user report: its counts set 119, 16 Oct) |
| 119 | `119-name-first-letter.sql` | 16 Oct | ERP | `products.name` and `quotes.product` only: where the trimmed value starts a-z, trim the ends, collapse runs of 2+ spaces, uppercase the first character. Rows with sku ilike 'zztest%' untouched. Writes `vessl.z119_backup` (row_id, tbl, old_value, new_value; RLS on, no app grant) before updating. Guards: backup absent, no (sku, name) collision. Expected 38 products / 40 quotes (b1/b2 flag a difference); z0 = still lowercase 0 / 0 plus counts updated | Run (16 Oct) | Doc (user report, 16 Oct: committed, 38 products, 39 quotes) |
| 119r | `119r-name-first-letter-reverse.sql` | — | ERP | Reverse of 119 from `z119_backup`; restores only values still equal to what 119 wrote (edited since = skipped, counted). Keeps the backup table; drop it by hand once settled | Never run | — |
| 120 | `120-name-title-case.sql` | 16 Oct | ERP | `products.name` and `quotes.product` in Title Case, word by word: spacing cleaned as cleanName does; first word first letter up; later small words (a an and as at but by for in of on or the to with vs w/ w/o) left as typed; words with a digit or no lowercase letters left as is; otherwise first letter and any letter after / uppercased (not after -), rest as typed. One-off: AUto tag (license plate) with sku Auto tags becomes Auto Tag (License Plate), in both tables, backed up like the rest (a1 counts it). Only changed values touched; zztest SKUs skipped. Writes `vessl.z120_backup` (row_id, tbl, sku, old_value, new_value) first. Guards: backup absent, no (sku, name) collision. Output a0, one r row per change, z0 still to change 0 / 0. Same rule as lib/products.js cleanName | Run (16 Oct) | Doc (user report, 16 Oct: committed, 197 products, 218 quotes) |
| 120r | `120r-name-title-case-reverse.sql` | — | ERP | Reverse of 120 from `z120_backup`; restores only values still equal to what 120 wrote (edited since = skipped, counted). Keeps the backup table | Never run | — |
| 121 | `121-order-notes-notify-to.sql` | 19 Oct | ERP | `order_notes.notify_to`, nullable text[], no default; NULL is All. CHECK `order_notes_notify_to_check`: NULL or at least one entry and no NULL entry. Back-fills notify_to = array[assigned_to] where assigned_to is set; assigned_to kept. No grant change. 4 probes (staff two-person list allowed; NULL accepted; empty list and NULL entry refused). Run BEFORE deploying the code that reads it | Run (19 Oct) | Doc (user report, 19 Oct: committed) |
| 121r | `121r-order-notes-notify-to-reverse.sql` | — | ERP | Reverse of 121; copies a one-person notify_to into a blank assigned_to, then drops the CHECK and the column, losing every list of two or more (a0 counts them). Take the code out first | Never run | — |
| 122 | `122-order-notes-sales-order.sql` | 19 Oct | ERP | `order_notes.sales_order_id` uuid, FK to sales_orders ON DELETE CASCADE, index `order_notes_so_idx`; CHECK `order_notes_one_order_check` num_nonnulls(purchase_order_id, sales_order_id) = 1; notify_to re-commented (NULL = no one, a quiet note; All saved as the full list). No grant change. 4 probes (staff SO note allowed; both and neither refused; SO delete cascades). Run BEFORE deploying the code that writes it | Run (19 Oct) | DB (sales_order_id present, checked read-only 19 Oct) and user report |
| 122r | `122r-order-notes-sales-order-reverse.sql` | — | ERP | Reverse of 122; deletes every note on a sales order (a0 counts them), drops the CHECK, the index and the column, restores the 121 notify_to comment. Take the code out first | Never run | — |
| 123 | `123-order-notes-shipments-rfqs.sql` | 19 Oct | ERP | `order_notes.shipment_id` (FK shipments, cascade, `order_notes_shipment_idx`) and `order_notes.shipment_quote_id` (FK shipment_quotes, cascade, `order_notes_shipment_quote_idx`); `order_notes_one_order_check` re-added under the same name as num_nonnulls of all four record columns = 1; comments on both. No grant change. 7 probes with throwaway ZZ-123-PROBE shipment and freight quote (staff notes allowed, deletes cascade, two records and none refused). Delivery requests deferred. Run BEFORE deploying the code that writes them | Run (19 Oct) | DB (shipment_id and shipment_quote_id present, checked read-only 19 Oct) |
| 123r | `123r-order-notes-shipments-rfqs-reverse.sql` | — | ERP | Reverse of 123; deletes every note on a shipment or freight quote (a0 counts them), restores the two-column CHECK, drops both indexes and columns. Take the code out first | Never run | — |
| 124 | `124-staff-monica-limited-ops.sql` | 19 Oct | ERP | One `staff_profiles` row for Monica Harris (inserted as Monica Smith -- the surname was wrong; 125 corrects it): monica@kinguniversal.com (length 24), role `limited_ops`, can_see_analytics false, other columns default; id `3ac9f7fb…`. Page list only, not a data lock (RLS treats her as staff) | Run (19 Oct) | DB (row present, linked to her sign-in, checked read-only 19 Oct) |
| 124r | `124r-staff-monica-limited-ops-reverse.sql` | — | ERP | Reverse of 124; deletes that one row (email + length 24 + role limited_ops, guard exactly one). auth.users untouched | Never run | — |
| 125 | `125-staff-monica-surname.sql` | 19 Oct | ERP | Monica `full_name` Monica Smith (length 12) → Monica Harris, on row `3ac9f7fb…` (email length 24); guard exactly one match on id, email and the old name. No other column or row | Run (19 Oct) | Doc (user report, 19 Oct) |
| 125r | `125r-staff-monica-surname-reverse.sql` | — | ERP | Reverse of 125; back to Monica Smith, only while the row still reads Monica Harris (length 13) | Never run | — |
| 126 | `126-so-deposit-percent.sql` | 19 Oct | ERP | `sales_orders.deposit_percent` numeric(5,2), nullable, no default (same type as the PO column); CHECK `sales_orders_deposit_percent_check` null or 0-100 (the PO column has none); comment. No backfill, no grant change. 3 probes on throwaway ZZ-126-PROBE (staff sets 30; 100.5 and -5 refused). Run BEFORE deploying the code that writes it | Run (19 Oct) | Doc (user report) and DB (column and CHECK present, checked read-only 19 Oct) |
| 126r | `126r-so-deposit-percent-reverse.sql` | — | ERP | Reverse of 126; drops the CHECK and the column, losing every SO deposit (a0 counts them). Take the code out first | Never run | — |
| 127 | `127-po-status-so-words.sql` | 19 Oct | ERP | `vessl.order_status` gains received (before confirmed), testing (after confirmed), invoiced (after delivered); no PO changes. `po_to_so_status` maps the three 1:1 (they used to fall to received). `so_to_po_status` and `sync_so_status_down` untouched (SO testing now flows down to POs; SO invoiced still sends POs to delivered). Checks read pg_enum and call the function -- new enum values cannot be used in the transaction that adds them. Run BEFORE deploying the code that offers them | Run (19 Oct) | Doc (user report) and DB (enum has the three values, po_to_so_status maps them 1:1; checked read-only 19 Oct) |
| 127r | `127r-po-status-so-words-reverse.sql` | — | ERP | Restores `po_to_so_status` exactly as before 127. CANNOT remove the three enum values; a0 counts POs already in them. Take the code out first | Never run | — |
| 128 | `128-so-po-status-match.sql` | 20 Oct | ERP | SO and PO statuses match (Kristy). New `status_rank(text)` (draft = received; cancelled unranked); `so_to_po_status` testing and invoiced 1:1; `sync_so_status_down` sends invoiced as invoiced; new `trg_sync_status_on_link` (AFTER INSERT on sales_order_pos) lifts the SO to its PO, never moves the PO, skips closed/cancelled. Reconcile of 27 rows by id + number length with change_note: 21 POs delivered to invoiced, 6 SOs up to their PO (1535890, 29000/5440, VIP To FOllow to in_production; 23-FBAF-2026, KUI-SO-2026-011, KUI-SO-2026-012 to delivered), with the portal notice and shipment sync triggers disabled around the SO update and re-enabled before verify. Left alone: two draft/received pairs and PO 11990 9. 3 link probes | Run (20 Oct) | Doc (user report) and DB (link trigger present, 27 history rows with the change note, 3 linked pairs still differing as planned; checked read-only 20 Oct) |
| 128r | `128r-so-po-status-match-reverse.sql` | — | ERP | Drops the link trigger, its function and status_rank; restores `so_to_po_status` and `sync_so_status_down` exactly as before 128. Does NOT undo the 27-row reconcile (order_history has each change, a0 counts them) | Never run | — |
| 129 | `129-quote-pdfs-bucket.sql` | 20 Oct | ERP | Private storage bucket `quote-pdfs` (application/pdf only, 25 MB, enforced by the Storage API); policies `quote-pdfs staff read` (SELECT) and `quote-pdfs staff upload` (INSERT, path `draft` or quote uuid / digits-name.pdf), both `vessl.is_staff()`, no UPDATE or DELETE; `quotes.pdf_path` text nullable with comment. No grant change. 6 probes (staff upload, bad path and non-staff refused, staff sees and non-staff does not, staff sets pdf_path). Run BEFORE deploying the PDF import | Not run | — |
| 129r | `129r-quote-pdfs-bucket-reverse.sql` | — | ERP | Reverse of 129; refuses while the bucket holds files (remove them in the dashboard first), drops both policies, the bucket and `pdf_path` (a0 counts paths lost). Take the code out first | Never run | — |
| 130 | `130-monica-full-access.sql` | 23 Oct | ERP | Monica Harris `limited_ops` → `staff` (role column, her row only, by id `3ac9f7fb…`, email length 24; guard exactly one row for the email and the row as measured); `can_see_analytics` stays false, so every page but Analytics, plus PO/SO pages, Company Banking, order money in exports and `can_write_settings`. Runs as postgres past the 109/110 guards. 3 probes as Monica (role change refused 42501, settings write true, own name save allowed). Rehearsal and commit both z0 only | Run | DB (Monica role staff, analytics false; checked read-only 23 Oct) |
| 130r | `130r-monica-full-access-reverse.sql` | — | ERP | Reverse of 130; Monica back to `limited_ops`, only while her row reads staff/24/no analytics. Needs the `limited_ops` page list still in ROLE_PAGES | Never run | — |
| 131 | `131-forwarder-bids-all-in.sql` | 23 Oct | ERP | `forwarder_bids.all_in` boolean not null default false, with comment (Kristy -- a forwarder quoted one all-in price, no additional fees). Existing 37 bids read false via the default, no backfill. No grant change, no trigger. 3 probes (staff saves an all-in bid; default false; null refused 23502). Run BEFORE deploying the all-in bid code | Run | DB (all_in column present; checked read-only 23 Oct) |
| 131r | `131r-forwarder-bids-all-in-reverse.sql` | — | ERP | Reverse of 131; drops `all_in` (a0 counts bids marked all-in and lost; their totals stay). Take the code out first | Never run | — |
| 132 | `132-monica-analytics.sql` | 23 Oct | ERP | Monica Harris `can_see_analytics` false → true (her row only, by id `3ac9f7fb…`, email length 24; guard exactly one row for the email and the row as measured -- staff, analytics off). Role and every other column unchanged; every other profile byte-identical; 3 → 4 with analytics. Runs as postgres past the 109 guard. 2 probes as Monica (changing analytics from the app refused 42501, own name save allowed). Rehearsal and commit both z0 only | Run | DB (Monica can_see_analytics true; checked read-only 23 Oct) |
| 132r | `132r-monica-analytics-reverse.sql` | — | ERP | Reverse of 132; Monica analytics back to false, only while her row reads email length 24 and analytics true | Never run | — |
| 133 | `133-landed-cost-rates.sql` | 23 Oct | ERP | Landed-cost rates on `kui_settings`, seven numeric not-null columns with defaults: mpf_rate 0.3464, mpf_min 34.58, mpf_max 670.86, hmf_rate 0.125, dis_rate 2.5, insurance_rate 0.4, insurance_uplift 110; CHECK `kui_settings_landed_rates_check` (rates 0-100, uplift 100-200, 0 <= min <= max); comments. The one row takes the defaults. No grant or policy change (update is can_write_settings). 3 probes (staff sets mpf_min; hmf 101 and min above max refused). Run BEFORE deploying the landed-cost panel | Run | DB (seven rate columns present; checked read-only 23 Oct) |
| 133r | `133r-landed-cost-rates-reverse.sql` | — | ERP | Reverse of 133; drops the CHECK and the seven columns (a0 shows the rates lost). Take the code out first | Never run | — |
| 134 | `134-order-pdfs-bucket.sql` | 23 Oct | ERP | Private storage bucket `order-pdfs` (application/pdf only, 25 MB, enforced by the Storage API); policies `order-pdfs staff read` (SELECT) and `order-pdfs staff upload` (INSERT, path `draft` or sales order uuid / digits-name.pdf), both `vessl.is_staff()`, no UPDATE or DELETE; `sales_orders.pdf_path` text nullable with comment. Modelled on 129. No grant change; po-attachments untouched. 6 probes (staff upload, bad path and non-staff refused, staff sees and non-staff does not, staff sets pdf_path on throwaway ZZ-134-PROBE with change_note). Run BEFORE deploying Import from PO PDF | Not run | — |
| 134r | `134r-order-pdfs-bucket-reverse.sql` | — | ERP | Reverse of 134; refuses while the bucket holds files (remove them in the dashboard first), drops both policies, the bucket and `pdf_path` (a0 counts paths lost). Take the code out first | Never run | — |
| 135 | `135-po-attachments-private.sql` | 26 Oct | ERP | `po-attachments` public → private, 25 MB, PDF/JPEG/PNG/GIF/WebP. Drops `auth read/upload/delete po-attachments` (any signed-in user, bucket_id only); adds `po-attachments staff read` (SELECT), `staff upload` (INSERT, path `<existing PO uuid>/digits-name`) and `staff delete` (DELETE), all `vessl.is_staff()`. No file moved (9 files, 7 folders, 9061136 bytes on 26 Oct; all 9 fit the new upload shape). Guard: bucket public with no limits, 3 old policies, no new ones. 9 probes (staff sees 9 and one by id, upload ok, bad shape and unknown PO refused, non-staff sees 0 and upload refused, staff delete 1, non-staff delete 0). Run AFTER the signed-link code (78cf852, live in f7edc57) | Run | DB (private, 25 MB, five types, 3 staff policies, 9 files, no probe rows; checked read-only 26 Oct) |
| 135r | `135r-po-attachments-private-reverse.sql` | — | ERP | Reverse of 135; bucket public again with no limits, drops the 3 staff policies, recreates the 3 old ones as measured (permissive, authenticated, bucket_id only). Guard: 135 committed. Code can stay | Never run | — |
| 136 | `136-kui-ior-flag.sql` | — | ERP | Importer of record flag. `companies.kui_ior` boolean null (true = KUI is the IOR for this client, false = the client is, null = unknown) and `products.kui_ior` boolean null (true/false overrides the client company, null = use `companies.kui_ior` via `client_company_id`), both with comments. No default, no backfill; `products.importer_of_record` (text, 0 values on 28 Oct) left in place. No grant or policy change; neither table has a trigger. Guard: columns absent, importer_of_record still text, probe rows ZZTESTER (client, name length 8) and ZZTEST2 (sku length 7) as measured, no column-level grants. 3 probes (Jenn sets the company, Jenn sets the product, non-staff reaches 0 rows). Run BEFORE deploying the code that names kui_ior | Never run | — |
| 136r | `136r-kui-ior-flag-reverse.sql` | — | ERP | Reverse of 136; drops both `kui_ior` columns (a0 counts flags lost); importer_of_record untouched. Guard: 136 committed. Take the code out first | Never run | — |
| 137 | `137-shipment-tracking.sql` | — | ERP | Ocean tracking (ShipsGo). Nine nullable `shipments` columns (tracking_provider CHECK shipsgo, tracking_ref, tracking_status, tracking_vessel, tracking_voyage, tracking_eta, tracking_ata, tracking_checked_at, tracking_error) with comments, partial unique index `shipments_tracking_ref_key` on (provider, ref). Table `shipment_tracking_events`, unique (shipment_id, provider, container_number, event_code, location_code), RLS and grants as `shipments`. `vessl.apply_tracking_update(uuid, jsonb)` security definer, service_role only: sets `vessl.suppress_client_notify` and change_note for its transaction, status forward only within in_transit..out_for_delivery (never delivered, never from delivered/cancelled/delayed/exception), never writes actual_arrival, upserts events, finds a shipment by id or provider+ref. `notify_portal_on_so_status` gains the flag check (body otherwise as measured, md5 3bae3322…). SO/PO statuses still cascade, silently. Guard: none exists, notify body and shipments policies as measured, ZZTESTER/ZZTESTFACTORY as measured. 8 probes on throwaway ZZ-137-PROBE orders (staff sees events, non-staff not, staff refused the function, silent move, direct move notifies, forward only, idempotent, by ref). Run BEFORE deploying the tracking code | Run | DB (9 columns, unique index, events table, apply_tracking_update body md5 dfeb1c99… as in this file, notify flag check; checked read-only 30 Oct) |
| 137r | `137r-shipment-tracking-reverse.sql` | — | ERP | Reverse of 137; notify function back to the measured body (md5 checked), drops the function, the events table, the index, the CHECK and the nine columns (a0 counts tracked shipments and events lost). Statuses already moved stay. Take the code and the ShipsGo webhook out first | Never run | — |
| 138 | `138-tracking-refs-due.sql` | — | ERP | `vessl.tracking_refs_due()` security definer, stable, service_role only: shipments with a tracking_ref not delivered or cancelled (id, provider, ref, status, checked_at), oldest check first -- the list GET /api/tracking/refresh (daily cron) reads; service_role has no table grant in vessl. Guard: 137 committed, function absent. 2 probes (staff refused 42501; throwaway ZZ-138-PROBE listed in transit, not once delivered). Run BEFORE deploying the refresh cron | Run | DB (tracking_refs_due body md5 9418f8d4… as in this file, service_role only; checked read-only 30 Oct) |
| 138r | `138r-tracking-refs-due-reverse.sql` | — | ERP | Reverse of 138; drops the function. Take the cron out first | Never run | — |
| 139 | `139-quote-pdf-item.sql` | — | ERP | Which item of its PDF a quote was imported from. `quotes.pdf_item` jsonb null ({page, anchor, item_name}; anchor = the words the item was read from, in practice its table row), CHECK `quotes_pdf_item_object` (null or an object), comment. No default, no backfill. No grant or policy change; the one trigger (trg_quote_code) only keeps quote_code. Guard: column absent, pdf_path present, probe quote ZZTESTER (5e39d303, client length 8), no column-level grants, only trg_quote_code. 3 probes (Jenn sets it, an array refused 23514, non-staff reaches 0 rows). Run BEFORE deploying the code that names pdf_item (Save of an imported quote, the Quote List select) | Run | DB (pdf_item jsonb, CHECK, comment; checked read-only 30 Oct) |
| 139r | `139r-quote-pdf-item-reverse.sql` | — | ERP | Reverse of 139; drops the CHECK and `pdf_item` (a0 counts items lost); pdf_path untouched. Guard: 139 committed. Take the code out first | Never run | — |
| 140 | `140-tracking-per-container.sql` | 30 Oct | ERP | Tracking per container: every shipment on one B/L (or booking) follows one ShipsGo shipment, each row its own container. Drops the unique index `shipments_tracking_ref_key` for the plain partial `shipments_tracking_ref_idx`; adds `shipments.tracking_container` (the container a row follows) and a new comment on tracking_ref. Replaces `apply_tracking_update(uuid, jsonb)` with `vessl.apply_tracking_group(p_ref, p_number, p_data)`, security definer, service_role only: with a number it attaches every live sibling (same B/L else booking, uppercased, spaces out; not delivered or cancelled; not tracked) and reports one tracked under another ref as skipped; each row then takes its own container from `p_data.containers` (status word, vessel, voyage, ETA, ATA, target, events), a row with no container (or while ShipsGo lists none) the whole shipment, a container ShipsGo does not list no move, no events and `tracking_error` naming both. Forward only as 137; P0002 when no row. Replaces `tracking_refs_due()` with one row per (provider, ref) with a live row: provider, ref, n_rows, oldest check. Guard: 137/138 bodies as measured (md5), new objects absent, no tracking_ref and no event yet, no column grants, ZZTESTER/ZZTESTFACTORY. 8 probes on throwaway ZZ-140-PROBE shipments (per container with silent SO cascade, whole shipment, unlisted container, attach, by ref, staff refused, refresh list, twice). Run BEFORE deploying the tracking code | Run | DB (tracking_container, shipments_tracking_ref_idx not unique, old key gone, apply_tracking_group service_role only, apply_tracking_update gone, tracking_refs_due new columns; no ref or event yet; checked read-only 30 Oct) |
| 140r | `140r-tracking-per-container-reverse.sql` | — | ERP | Reverse of 140; drops apply_tracking_group and recreates apply_tracking_update and tracking_refs_due exactly as 137/138 made them (md5 checked), the unique index back, the 137 comment, drops tracking_container (a0 counts rows that lose it). Guard: 140 committed, no ref shared by two or more shipments. Take the code out first | Never run | — |

Also here: `preflight.py`, the lexer that checks a script before it is printed.
