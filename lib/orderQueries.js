// ── WHAT THE ORDER LISTS READ ───────────────────────────────────────────────
// The Sales Orders and Purchase Orders pages' list selects, moved verbatim from
// app/page.jsx so the iPad view (app/m) reads rows of the same shape -- the
// per-card exports (lib/ordersExport.js) are built from exactly these rows.

// Sales Orders: the order, its client, lines, linked POs with their lines (for
// the factory cost), and additional costs.
export const SO_LIST_SELECT = '*,client:companies!client_company_id(id,name),sales_order_items(id,description,client_sku,size,quantity,client_price),sales_order_pos(purchase_orders(id,order_number,client_po_number,status,currency,factory:companies!factory_company_id(name),purchase_order_items(unit_price,quantity))),order_costs(id,amount,kind,note)';

// Read-only additions for the export: the PO's terms, fees and notes, and each
// line's quantity, prices, size and SKUs. The cards still read only what they did.
export const PO_CARD_SELECT = 'id,order_number,client_po_number,status,production_pct,order_date,updated_at,cargo_ready_date,requested_ship_date,cancel_date,payment_terms,incoterm,shipping_method,currency,mold_fee,sample_fee,deposit_percent,notes,delivery_address,factory:companies!factory_company_id(name),client:companies!client_company_id(name),purchase_order_items(id,description,quantity,unit_price,size,product_sku,product_id,vpn,master_sku,pack_sku,baby_sku,carton_info,ci_value,retail_price,products(sku,name)),sales_order_pos(sales_orders(id,so_number,client_po_number,created_at))';

// The Purchase Orders page's fallback when the primary select is refused: every
// primary column but production_pct (the newest, likeliest missing from a stale
// schema cache).
export const PO_CARD_FALLBACK_SELECT = 'id,order_number,client_po_number,status,order_date,cargo_ready_date,requested_ship_date,factory:companies!factory_company_id(name),client:companies!client_company_id(name),purchase_order_items(description,products(name))';
