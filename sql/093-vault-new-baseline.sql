-- 93 -- Set delivery_request_recipients to riley, kristy and mattdillon. CLOSES THE WINDOW with a new baseline.
--
-- RUN AS postgres. This replaces 88c as the script that closes the 88b window.
-- 88c is left as it is and must NOT be run after this one -- its guard would
-- stop it anyway, because the value will no longer be mattdillon alone.
--
-- WHAT IT DOES. vault.update_secret on the same id, second argument only, so
-- name and description are untouched. The value keeps the 88a format exactly --
-- riley then kristy, one comma, no spaces -- with mattdillon appended after one
-- more comma. Lower case, three addresses, no trailing comma, length 77.
--
-- GUARD. Stops unless the current value is mattdillon alone, length 28, which
-- proves 88b was committed and nothing else touched the secret since. If it
-- stops, run 88a, send the r0 row over, and do not improvise.
--
-- READ-BACK. b1 compares the stored value to the literal and its length. b3
-- splits the stored value the way portal.notify_delivery_request does -- on
-- commas, trimmed -- and counts three addresses, three distinct.
--
-- Nothing here sends an email. The notify trigger is on portal.delivery_requests,
-- and this script touches only the vault.

begin;

create temp table _pre93 on commit drop as
  select name as name_before, description as desc_before,
         length(decrypted_secret) as len_before,
         (decrypted_secret = 'mattdillon@kinguniversal.com') as is_test
    from vault.decrypted_secrets
   where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid;

do $guard$
begin
  if (select count(*) from _pre93) <> 1
     or (select is_test from _pre93) is not true
     or (select len_before from _pre93) <> 28 then
    raise exception 'the secret is not the mattdillon test value -- run 88a and send the result, nothing changed';
  end if;
end
$guard$;

select vault.update_secret('c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid,
                           'riley@kinguniversal.com,kristy@kinguniversal.com,mattdillon@kinguniversal.com');

select * from (
  select 'r0 window closes at' as chk,
         (select updated_at::text from vault.secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid) as got,
         'shown every run' as want
  union all
  select 'r1 stored value and length',
         (select decrypted_secret || ' / length ' || length(decrypted_secret)::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid),
         'shown every run'
  union all
  select 'a0 the value before was the test value, length 28',
         (select len_before::text || '/' || is_test::text from _pre93), '28/true'
  union all
  select 'b1 read-back -- riley, kristy, mattdillon verbatim, length 77',
         (select length(decrypted_secret)::text || '/'
                 || (decrypted_secret = 'riley@kinguniversal.com,kristy@kinguniversal.com,mattdillon@kinguniversal.com')::text
            from vault.decrypted_secrets
           where id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '77/true'
  union all
  select 'b2 name and description unchanged',
         (select (s.name = p.name_before)::text || '/' || (s.description is not distinct from p.desc_before)::text
            from vault.secrets s, _pre93 p
           where s.id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), 'true/true'
  union all
  select 'b3 split as the notify function does -- three addresses, three distinct',
         (select count(*)::text || '/' || count(distinct lower(btrim(x)))::text
            from vault.decrypted_secrets d,
                 unnest(string_to_array(d.decrypted_secret, ',')) as x
           where d.id = 'c6d60a45-b574-41cd-9c1c-4d2777d14278'::uuid), '3/3'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

-- One row reading z0, plus r0 and r1? Then swap these two lines.
-- commit;
rollback;
