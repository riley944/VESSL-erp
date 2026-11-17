const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function recordPath(type, record) {
  const identifier = type === 'quote' ? record.quote_code : record.style_number;
  return `/v2/${type === 'quote' ? 'quotes' : 'products'}/${encodeURIComponent(identifier || record.id)}`;
}

export function recordLookupColumn(type, identifier) {
  return UUID.test(identifier) ? 'id' : type === 'quote' ? 'quote_code' : 'style_number';
}
