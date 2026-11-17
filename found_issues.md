# Found issues

## Audit: changes after d124cd9

Reviewed the V2 quote editor, factory directory, factory/product links, navigation, and the quote factory-ID migration through commit d0bb5d1. Existing open items below remain applicable.

### High: quote factory IDs become missing or incorrect

- [x] Keep `quotes.factory_company_id` synchronized when a factory is selected, changed, or cleared in both quote editors and carry it into purchase-order-created quotes. Historical snapshots remain unchanged. A migration fills unlinked unique-name matches; linked name mismatches are preserved for review because renames are legitimate. Regression tests cover selection, clearing, legacy edits, rename snapshots, and the backfill.
  - Code: `app/v2/quotes/FactoryField.jsx:12-23`, `app/v2/quotes/QuoteModal.jsx:49-51`, `app/v2/quotes/quoteForm.js:4-5,36-61`, `app/quotes.jsx:436-437`, `lib/factoryProducts.js:15`.

### High: factory and contact edits can be lost while saving

- [x] Lock the shared company form and its close controls during a save, and unlock with the draft intact on error. Delayed company and contact save tests cover the shared factory/client form.
  - Code: `app/components/CreateCompanyModal.jsx:100-104,119-154,205-261`.

### High: switching shipping method can retain hidden legacy freight

- [x] Keep legacy freight on its original method and remove the legacy fallback when switching methods. Regression tests cover switching in either direction and retaining an existing price for the newly selected method.
  - Code: `app/v2/quotes/quoteForm.js:23-31,43-56`, `app/v2/quotes/useQuotePricing.js:19-28`, `lib/tierCost.js:26-31`.

### Medium: choosing a factory erases quote details without filling its contact

- [ ] Preserve or explicitly confirm before clearing quote-specific contact, country, and lead-time values when the factory changes, and populate appropriate defaults from the selected factory when available. The V2 picker clears all five fields immediately and reads only company ID/name; the legacy factory directory already has contact and preset lookup logic. This can discard entered details and requires retyping information already in the directory. Test changing and clearing a factory with existing values, and factories with and without primary contacts.
  - Code: `app/v2/quotes/QuoteModal.jsx:49-51,124-127`, `app/v2/quotes/FactoryField.jsx:10-23`, `app/components/FactorySelect.jsx:28-80`.

### Medium: primary contacts can be duplicated or shown inconsistently

- [ ] Make creating or changing a primary contact atomic and enforce at most one primary per company. Two users can open a factory with no primary contact and both insert one; the local database has no unique primary-contact index or contact trigger. With multiple primaries, the factory list takes the last contact returned while the detail/editor takes the first by ID, so they can display and edit different people. Handle existing duplicates before adding a constraint, and test concurrent creation and consistent reads.
  - Code: `app/components/CreateCompanyModal.jsx:138-150`, `app/v2/factories/page.jsx:35-45`, `app/v2/factories/[id]/page.jsx:26-30`, `app/v2/factories/EditFactoryModal.jsx:10-16`.

### Medium: factory country and preset data can be lost or orphaned

- [ ] Handle errors when saving a new factory's country to `factory_presets`, and provide a way to maintain it. Supabase returns insert errors in the response, but the creation form ignores that response and closes as if the country was saved; factory editing hides the country field. Renaming a factory also changes only `companies.name`, while the legacy quote directory finds country and lead time by the preset's factory name, so those defaults stop matching after a rename. Test preset save failures and factory renames without overwriting historical quote values.
  - Code: `app/components/CreateCompanyModal.jsx:122-136,189-195,225-229`, `app/components/FactorySelect.jsx:24-35,48-60`.

### Medium: factory dropdown omits factories beyond the server row limit

- [ ] Paginate the V2 quote factory query or use server-side search. `FactoryField` makes one unrestricted select with no pagination, unlike the factory index; with the usual Supabase row limit, factories beyond the first page cannot be selected for new quotes. Test with more than one page of factories and preserve the saved legacy-name fallback.
  - Code: `app/v2/quotes/FactoryField.jsx:10-23`, `app/v2/factories/page.jsx:14-21`.

### Low: factory detail omits the primary contact's email and phone

- [ ] Show the primary contact's own email and phone separately from the factory company's email and phone. The factory editor saves those fields on `contacts`, and the detail query fetches them, but the detail page displays only the contact name and the company's email/phone. After editing the main contact, users cannot verify or use the contact details on the show page. Test differing company and contact values and missing fields.
  - Code: `app/v2/factories/[id]/page.jsx:27-28,40-45`, `app/components/CreateCompanyModal.jsx:138-150`.

## Quote, product, and client links

- [ ] Decide whether a product can be quoted for more than one client, and how changing a quote's client should affect its linked product.
- [ ] Review and update the V2 quote workflow to enforce that decision. The legacy quote editor can change a quote's client while retaining its product link, even if the product has a different client. The V2 editor currently displays the client without allowing it to change. The older workflow supports product-and-client combinations, so a mismatch is not necessarily invalid.
- [ ] Add tests for changing a linked quote's client, including shared products and unresolved client links as applicable to the decision.

Relevant code: `app/quotes.jsx` (quote save and client resolution), `lib/productQuote.js` (product-originated quote links), and `lib/programs.js` (product-and-client combinations).

## Quote tasks and saving

- [x] Decouple task creation from quote saving in the V2 editor. Tasks are saved separately after the quote exists; a failed task remains available for retry without blocking quote changes.
- [ ] Decide how task entry should behave during an in-flight save. Currently the task text remains editable while saving, and a successful save clears any newer text typed during that wait. Add a delayed-save regression test for the chosen behavior.
- [ ] Decide how to surface a failed task-assignment email after the quote modal closes. The task itself is saved, but the asynchronous notification error can be lost when its panel unmounts. Add a delayed-notification regression test for the chosen behavior.

## Inactive products and archived quotes

- [ ] Decide whether V2 should prevent or warn when creating a quote for an inactive product. The original quote editor blocks new quotes for retired SKUs; V2 currently allows them from both the product list and the quote product search. Preserve the ability to edit existing quotes and add tests for the chosen behavior.
- [ ] Implement archived quotes as a future feature. The V2 quote-list archive button is currently a stub; quote archiving is separate from product active/inactive status.

## V2 quote editor parity

- [ ] Add V2 controls for size-specific quantities and prices, carton dimensions and plate fees, plus the existing freight builder and PDF import/view workflow. Preserve the existing values and calculation behavior when implementing them. The V2 editor currently preserves those stored values but does not provide all of the original editor's controls.

## Mixed legacy freight and duty

- [ ] Decide how to represent a quote containing both older freight that includes duty and newer freight-only tiers with no duty entered. Existing quote readers infer this from one quote-wide timestamp, so they cannot distinguish those tiers individually. V2 preserves the older timestamp while legacy tiers remain and warns when other freight changes; per-tier interpretation needs a separate data and reader design.
