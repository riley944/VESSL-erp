# Found issues

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
