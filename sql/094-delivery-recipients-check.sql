-- 94 -- After 87 and 93. Who would a delivery request email? Writes nothing, sends nothing.
--
-- RUN AS postgres IN THE SQL EDITOR. The read-only connection cannot decrypt
-- vault secrets, so only a hand run can build the merged list. Ends in
-- rollback, and there is no commit line to swap -- nothing here is kept.
--
-- NO EMAIL. The list is built by copying the merge from
-- portal.notify_delivery_request, not by calling it. Nothing is inserted into
-- or updated on portal.delivery_requests, which is where the notify triggers
-- live, and net.http_post is never called.
--
-- THE MERGE, as the function does it. Base is the vault secret
-- delivery_request_recipients, read by name, split on commas, trimmed, blanks
-- dropped -- or riley and kristy if that comes out empty. Then the client
-- company extras are appended, everything is lower-cased, duplicates removed,
-- sorted.
--
-- THE THREE COMPANIES, by id.
--   BucketGolf   771dc750-929c-4b8f-a279-53404e94da60  name length 10
--   Stitch Golf  613d94c3-fdbe-4302-85d0-b7c8c58126d4  name length 11, a real client with no extras
--   ZZDELIV      eeb055ce-c12e-4a44-b00d-75b56c56abf0  name length 7
--
-- WHAT A PASS LOOKS LIKE. r1 to r4 always show, so the lists can be read by
-- eye, plus z0. Any a or b row means that check failed.
--   b1 BucketGolf stored extras, in stored order -- killian 34, justin 33, <client contact 3> 20
--   b2 BucketGolf merged, sorted -- justin 33, killian 34, kristy 24, mattdillon 28, <client contact 3> 20, riley 23
--   b3 Stitch Golf merged, sorted -- kristy 24, mattdillon 28, riley 23
--   b4 ZZDELIV extras, in stored order -- the zzextra address 36, mattdillon 28 -- as before 87

begin;

create temp table _base94 on commit drop as
  select coalesce(
           nullif(array(select btrim(x)
                          from unnest(string_to_array(coalesce(
                                 (select decrypted_secret from vault.decrypted_secrets
                                   where name = 'delivery_request_recipients'), ''), ',')) as x
                         where btrim(x) <> ''), '{}'),
           array['riley@kinguniversal.com','kristy@kinguniversal.com']) as base;

create temp table _m94 on commit drop as
  select c.id, c.name, length(c.name) as name_len, c.type::text as ctype,
         c.delivery_request_recipients as extras,
         array(select distinct lower(x)
                 from unnest((select base from _base94) || coalesce(c.delivery_request_recipients, '{}'::text[])) as x
                order by 1) as to_list
    from vessl.companies c
   where c.id in ('771dc750-929c-4b8f-a279-53404e94da60'::uuid,
                  '613d94c3-fdbe-4302-85d0-b7c8c58126d4'::uuid,
                  'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid);

select * from (
  select 'r1 BucketGolf stored extras' as chk,
         (select coalesce(array_to_string(extras, ', '), 'null')::text from _m94
           where id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid) as got,
         'shown every run' as want
  union all
  select 'r2 BucketGolf merged list',
         (select cardinality(to_list)::text || ' -- ' || array_to_string(to_list, ', ') from _m94
           where id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid), 'shown every run'
  union all
  select 'r3 Stitch Golf merged list',
         (select cardinality(to_list)::text || ' -- ' || array_to_string(to_list, ', ') from _m94
           where id = '613d94c3-fdbe-4302-85d0-b7c8c58126d4'::uuid), 'shown every run'
  union all
  select 'r4 ZZDELIV stored extras',
         (select coalesce(array_to_string(extras, ', '), 'null')::text from _m94
           where id = 'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid), 'shown every run'
  union all
  select 'a0 the three ids are client BucketGolf 10, client Stitch Golf 11 with no extras, client ZZDELIV 7',
         (select string_agg(ctype || ' ' || name_len::text || ' ' || (extras is null)::text, '/' order by name_len) from _m94),
         'client 7 false/client 10 false/client 11 true'
  union all
  select 'b1 BucketGolf stored extras, lengths in stored order',
         (select string_agg(length(x)::text, ',' order by o) from _m94 m, unnest(m.extras) with ordinality u(x, o)
           where m.id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid), '34,33,20'
  union all
  select 'b2 BucketGolf merged -- six addresses, lengths in sorted order',
         (select cardinality(to_list)::text || '/' || array_to_string(array(select length(x)::text from unnest(to_list) with ordinality u(x, o) order by o), ',')
            from _m94 where id = '771dc750-929c-4b8f-a279-53404e94da60'::uuid), '6/33,34,24,28,20,23'
  union all
  select 'b3 Stitch Golf merged -- the three base addresses only',
         (select cardinality(to_list)::text || '/' || array_to_string(array(select length(x)::text from unnest(to_list) with ordinality u(x, o) order by o), ',')
            from _m94 where id = '613d94c3-fdbe-4302-85d0-b7c8c58126d4'::uuid), '3/24,28,23'
  union all
  select 'b4 ZZDELIV extras unchanged -- two, lengths in stored order',
         (select cardinality(extras)::text || '/' || array_to_string(array(select length(x)::text from unnest(extras) with ordinality u(x, o) order by o), ',')
            from _m94 where id = 'eeb055ce-c12e-4a44-b00d-75b56c56abf0'::uuid), '2/36,28'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

rollback;
