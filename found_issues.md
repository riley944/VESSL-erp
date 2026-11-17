# Found issues

## Quote, product, and client links

- [ ] Decide whether a product can be quoted for more than one client, and how changing a quote's client should affect its linked product.
- [ ] Review and update the V2 quote workflow to enforce that decision. The existing quote editor can change a quote's client while retaining its product link, even if the product has a different client. This behavior predates V2; the older workflow supports product-and-client combinations, so a mismatch is not necessarily invalid.
- [ ] Add tests for changing a linked quote's client, including shared products and unresolved client links as applicable to the decision.

Relevant code: `app/quotes.jsx` (quote save and client resolution), `lib/productQuote.js` (product-originated quote links), and `lib/programs.js` (product-and-client combinations).
