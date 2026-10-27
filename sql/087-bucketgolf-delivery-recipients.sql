-- 87 -- BucketGolf delivery requests also email Elevate and the delivery coordinator.
--
-- WHAT IT DOES. One update, in one transaction. Sets
-- companies.delivery_request_recipients on the BucketGolf client company to
-- the three extras Riley named on 29 Sep --
--   <client contact 1>
--   <client contact 2>
--   <client contact 3> (Josue, the delivery coordinator)
-- Riley and Kristy are NOT stored here. They come from the vault secret, which
-- applies to every client, and portal.notify_delivery_request merges the two
-- lists and removes duplicates. Storing them here as well would keep mailing a
-- stale address after the vault list changes.
--
-- NEEDS SCRIPT 86 FIRST. The guard stops the script if the column is missing.
--
-- WHICH ROW. By id, 771dc750-929c-4b8f-a279-53404e94da60, as given on 29 Sep.
-- The guard first proves that id resolves to a client company named BucketGolf,
-- name length 10, and stops the script if it does not. Every later reference
-- is to the id alone.
--
-- ZZDELIV IS IGNORED, AND ONLY ZZDELIV. The ZZ test (88) left extras on the
-- client company ZZDELIV, id eeb055ce-c12e-4a44-b00d-75b56c56abf0, and 89 will
-- clear them later. The guard proves that id is ZZDELIV, name length 7, then
-- leaves it out of the count. It still stops the script if BucketGolf already
-- has a value, or if any company other than ZZDELIV has one. ZZDELIV itself is
-- not written, and b6 proves its value is the same after as before.
--
-- EVERY OTHER COMPANY IS UNTOUCHED, and so is every other column of
-- BucketGolf, proven by hashing whole rows minus the new column (b4, b5).
-- companies has no trigger, so updated_at does not move.

begin;

create temp table _pre87 on commit drop as
  select (select count(*) from information_schema.columns
           where table_schema = 'vessl' and table_name = 'companies'
             and column_name = 'delivery_request_recipients')                          as col_exists,
         (select count(*) from vessl.companies
           where id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid
             and name = 'BucketGolf' and type::text = 'client')                        as matches,
         '771dc750-929c-4b8f-a279-53404e94da60'::uuid                                  as target_id,
         (select length(name) from vessl.companies
           where id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid)                    as name_len,
         (select count(*) from vessl.companies
           where id = 'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid
             and name = 'ZZDELIV' and length(name) = 7 and type::text = 'client')      as zz_matches,
         'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid                                  as zz_id;

create temp table _hash87 on commit drop as
  select (select md5(coalesce(string_agg((to_jsonb(c) - 'delivery_request_recipients')::text, '/' order by c.id), ''))
            from vessl.companies c where c.id <> (select target_id from _pre87))       as others_before,
         (select md5((to_jsonb(c) - 'delivery_request_recipients')::text)
            from vessl.companies c where c.id = (select target_id from _pre87))        as target_before,
         (select count(*) from vessl.companies c
           where c.id = (select target_id from _pre87)
             and c.delivery_request_recipients is not null)                            as target_set_before,
         (select count(*) from vessl.companies c
           where c.id <> (select target_id from _pre87)
             and c.id <> (select zz_id from _pre87)
             and c.delivery_request_recipients is not null)                            as others_set_before,
         (select c.delivery_request_recipients from vessl.companies c
           where c.id = (select zz_id from _pre87))                                    as zz_before;

do $guard$
begin
  if (select col_exists from _pre87) <> 1 then
    raise exception 'companies has no delivery_request_recipients -- run script 86 first, nothing changed';
  end if;
  if (select matches from _pre87) <> 1 or (select name_len from _pre87) <> 10 then
    raise exception 'id 771dc750 is not the client company BucketGolf, nothing changed';
  end if;
  if (select zz_matches from _pre87) <> 1 then
    raise exception 'id eeb055ce is not the client company ZZDELIV, nothing changed';
  end if;
  if (select target_set_before from _hash87) <> 0 then
    raise exception 'BucketGolf already has delivery request recipients, nothing changed';
  end if;
  if (select others_set_before from _hash87) <> 0 then
    raise exception 'a company other than ZZDELIV already has delivery request recipients, nothing changed';
  end if;
end
$guard$;

update vessl.companies
   set delivery_request_recipients = array['<client contact 1>',
                                           '<client contact 2>',
                                           '<client contact 3>']
 where id = (select target_id from _pre87);

-- VERIFICATION. Exactly one row, reading z0, is a pass. More rows means those
-- checks failed. Zero rows means the query did not run at all.
select * from (
  select 'a0 column present, the id is client BucketGolf, name length 10, ZZDELIV proven, nothing set on BucketGolf or any non-ZZDELIV company' as chk,
         (select col_exists::text || '/' || matches::text || '/' || name_len::text || '/' || zz_matches::text from _pre87)
           || '/' || (select target_set_before::text || '/' || others_set_before::text from _hash87) as got,
         '1/1/10/1/0/0' as want
  union all
  select 'b1 BucketGolf holds three addresses',
         (select cardinality(delivery_request_recipients)::text from vessl.companies
           where id = (select target_id from _pre87)), '3'
  union all
  -- Identity by length, sorted by address -- justin 33, killian 34, <client contact 3> 20.
  select 'b2 each address has the expected length',
         (select string_agg(length(x)::text, ',' order by x) from vessl.companies c,
                 unnest(c.delivery_request_recipients) x
           where c.id = (select target_id from _pre87)), '33,34,20'
  union all
  select 'b3 the three addresses passed the shape check and are the only ones set outside ZZDELIV',
         (select count(*)::text from vessl.companies c, unnest(c.delivery_request_recipients) x
           where c.id <> (select zz_id from _pre87)), '3'
  union all
  select 'b4 every other company is unchanged',
         (select md5(coalesce(string_agg((to_jsonb(c) - 'delivery_request_recipients')::text, '/' order by c.id), ''))
            from vessl.companies c where c.id <> (select target_id from _pre87)),
         (select others_before from _hash87)
  union all
  select 'b5 every other column of BucketGolf is unchanged',
         (select md5((to_jsonb(c) - 'delivery_request_recipients')::text)
            from vessl.companies c where c.id = (select target_id from _pre87)),
         (select target_before from _hash87)
  union all
  select 'b6 ZZDELIV recipients are the same after as before',
         (select (c.delivery_request_recipients is not distinct from h.zz_before)::text
            from vessl.companies c, _hash87 h
           where c.id = (select zz_id from _pre87)), 'true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0? Then swap these two lines.
-- commit;
rollback;
