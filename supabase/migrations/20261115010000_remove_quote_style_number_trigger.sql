-- Style numbers are assigned when a product is created, not when a quote is.
drop trigger if exists trg_assign_quote_style_number on vessl.quotes;
drop function if exists vessl.assign_quote_style_number();
alter table vessl.quotes drop column if exists style_number;
