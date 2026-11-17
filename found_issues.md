# Found issues

## Quote, product, and client links

- [ ] Decide whether a product can be quoted for more than one client, and how changing a quote's client should affect its linked product.
- [ ] Review and update the V2 quote workflow to enforce that decision. The legacy quote editor can change a quote's client while retaining its product link, even if the product has a different client. The V2 editor currently displays the client without allowing it to change. The older workflow supports product-and-client combinations, so a mismatch is not necessarily invalid.
- [ ] Add tests for changing a linked quote's client, including shared products and unresolved client links as applicable to the decision.

Relevant code: `app/quotes.jsx` (quote save and client resolution), `lib/productQuote.js` (product-originated quote links), and `lib/programs.js` (product-and-client combinations).

## Quote tasks and saving

- [x] Decouple task creation from quote saving in the V2 editor. Tasks are saved separately after the quote exists; a failed task remains available for retry without blocking quote changes.

## V2 quote editor parity

- [ ] Add V2 controls for size-specific quantities and prices, carton dimensions and plate fees, plus the existing freight builder and PDF import/view workflow. Preserve the existing values and calculation behavior when implementing them. The V2 editor currently preserves those stored values but does not provide all of the original editor's controls.
