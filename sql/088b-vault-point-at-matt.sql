-- 88b -- Point delivery_request_recipients at mattdillon for the ZZ test. OPENS THE WINDOW.
--
-- RUN AS postgres, only after 88 is committed and 88a showed a0 and a1 clean.
-- From the commit of this script until 88c commits, EVERY client delivery
-- request -- BucketGolf included -- emails mattdillon alone. Keep that to
-- minutes. File the ZZ request, check Resend, then run 88c straight away.
--
-- WHAT IT DOES. One vault.update_secret on the secret addressed by id, second
-- argument only, so name and description are untouched -- the same call
-- that restored it on 31 Aug.
--
-- GUARD. Stops unless the current value is exactly the 31 Aug value, length
-- 48. So this script can never move the secret away from a value 88c cannot
-- put back verbatim.
--
-- r0 always shows the new updated_at. That is when the window opened.

begin;

create temp table _pre88b on commit drop as
  select name as name_before, description as desc_before,
         length(decrypted_secret) as len_before,
         (decrypted_secret = 'riley@kinguniversal.com,kristy@kinguniversal.com') as is_baseline
    from vault.decrypted_secrets
   where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid;

do $guard$
begin
  if (select count(*) from _pre88b) <> 1
     or (select is_baseline from _pre88b) is not true
     or (select len_before from _pre88b) <> 48 then
    raise exception 'the secret is not the 31 Aug riley and kristy value, nothing changed';
  end if;
end
$guard$;

select vault.update_secret('c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid,
                           'mattdillon@kinguniversal.com');

select * from (
  select 'r0 window opens at' as chk,
         (select updated_at::text from vault.secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid) as got,
         'shown every run' as want
  union all
  select 'a0 the value before was the baseline, length 48',
         (select len_before::text || '/' || is_baseline::text from _pre88b), '48/true'
  union all
  select 'b1 the value is now mattdillon alone, length 28',
         (select length(decrypted_secret)::text || '/'
                 || (decrypted_secret = 'mattdillon@kinguniversal.com')::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '28/true'
  union all
  select 'b2 name and description unchanged',
         (select (s.name = p.name_before)::text || '/' || (s.description is not distinct from p.desc_before)::text
            from vault.secrets s, _pre88b p
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
