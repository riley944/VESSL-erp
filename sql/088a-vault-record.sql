-- 88a -- Read and record the delivery_request_recipients vault secret. Writes nothing.
--
-- RUN AS postgres IN THE SQL EDITOR. The read-only connection cannot decrypt
-- vault secrets (42501 on _crypto_aead_det_decrypt), so only a hand run can see
-- the value.
--
-- The r0 row always shows. Copy its got value somewhere safe before 88b -- it
-- is what 88c must put back. 88c restores the value recorded on 31 Aug, so if
-- a1 shows here the live value has changed since then. Stop and send it over
-- before going further, because 88c would then restore the wrong thing.

begin;

select * from (
  select 'r0 record this value' as chk,
         (select decrypted_secret || ' / length ' || length(decrypted_secret)::text
                 || ' / name ' || name || ' / updated ' || updated_at::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid) as got,
         'shown every run' as want
  union all
  select 'a0 exactly one secret carries the name, and it is this id',
         (select count(*)::text || '/' || bool_and(id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid)::text
            from vault.secrets where name = 'delivery_request_recipients'), '1/true'
  union all
  select 'a1 the value is still the one restored on 31 Aug',
         (select length(decrypted_secret)::text || '/'
                 || (decrypted_secret = 'riley@kinguniversal.com,kristy@kinguniversal.com')::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '48/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

rollback;
