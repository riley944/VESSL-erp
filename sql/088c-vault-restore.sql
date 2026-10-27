-- 88c -- Restore delivery_request_recipients to riley and kristy, verbatim. CLOSES THE WINDOW.
--
-- RUN AS postgres, straight after the ZZ request has been filed and checked.
-- Commit this one even if the test itself went wrong -- a failed test is
-- recoverable, a secret left on one address is the 31 Aug incident again.
--
-- WHAT IT DOES. vault.update_secret on the same id, second argument only,
-- with the exact value 88a recorded and 88b required -- riley then kristy,
-- one comma, no spaces, length 48.
--
-- GUARD. Stops unless the current value is mattdillon alone, which proves 88b
-- was committed and nothing else touched the secret since. If it stops, run
-- 88a, send the r0 row over, and do not improvise a restore.
--
-- READ-BACK. b1 compares the stored value to the literal and its length --
-- the read-back the 31 Aug restore recorded.

begin;

create temp table _pre88c on commit drop as
  select name as name_before, description as desc_before,
         length(decrypted_secret) as len_before,
         (decrypted_secret = 'mattdillon@kinguniversal.com') as is_test
    from vault.decrypted_secrets
   where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid;

do $guard$
begin
  if (select count(*) from _pre88c) <> 1
     or (select is_test from _pre88c) is not true
     or (select len_before from _pre88c) <> 28 then
    raise exception 'the secret is not the mattdillon test value -- run 88a and send the result, nothing changed';
  end if;
end
$guard$;

select vault.update_secret('c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid,
                           'riley@kinguniversal.com,kristy@kinguniversal.com');

select * from (
  select 'r0 window closes at' as chk,
         (select updated_at::text from vault.secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid) as got,
         'shown every run' as want
  union all
  select 'a0 the value before was the test value, length 28',
         (select len_before::text || '/' || is_test::text from _pre88c), '28/true'
  union all
  select 'b1 read-back -- riley and kristy verbatim, length 48',
         (select length(decrypted_secret)::text || '/'
                 || (decrypted_secret = 'riley@kinguniversal.com,kristy@kinguniversal.com')::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '48/true'
  union all
  select 'b2 name and description unchanged',
         (select (s.name = p.name_before)::text || '/' || (s.description is not distinct from p.desc_before)::text
            from vault.secrets s, _pre88c p
           where s.id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), 'true/true'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r0? Then swap these two lines.
-- commit;
rollback;
