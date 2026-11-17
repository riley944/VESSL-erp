import { sameCompany } from './companyName';

// A product-originated quote must stay linked to that exact product and client.
export function productQuoteLinks(form) {
  if (form.__clientId && !sameCompany(form.client, form.__clientName)) {
    return { error: 'The quote client must match the selected product’s client.' };
  }
  return {
    row: !form.id && form.__productId ? { product_id: form.__productId, client_company_id: form.__clientId || null } : {},
    clientId: form.__clientId && sameCompany(form.client, form.__clientName) ? form.__clientId : null,
  };
}
