-- 116r -- Reverse 116. quotes.client_details, quotes.client_color and staff_profiles.job_title are dropped.
--
-- RUN AS postgres IN THE SQL EDITOR, only to undo 116. One transaction.
--
-- WHAT IT DOES. Drops the three columns. Every Details, Color and job title
-- recorded since 116 is LOST -- a0 shows how many quotes and staff rows hold one,
-- so read it on the rehearsal before swapping to commit. Every other column, row,
-- trigger and grant stays, the 109 and 110 staff guards included.
--
-- THE CODE FIRST. The quote form, the client price sheet and the sign-off read
-- and write these columns. Take that code out first so a save is not refused.
--
-- GUARD. All three columns exist.
--
-- WHAT A PASS LOOKS LIKE. Two rows, a0 and z0. Any b row is a failed check. Zero
-- rows means the query did not run. a0 always shows, with how many rows lose a value.

begin;

create temp table _pre116r on commit drop as
  select
    (select count(*) from information_schema.columns
      where table_schema = 'vessl'
        and ((table_name = 'quotes' and column_name in ('client_details', 'client_color'))
          or (table_name = 'staff_profiles' and column_name = 'job_title')))                   as has_cols,
    (select count(*) from vessl.quotes)                                                          as n_quotes,
    (select count(*) from vessl.staff_profiles)                                                  as n_staff;

do $guard$
begin
  if (select has_cols from _pre116r) <> 3 then
    raise exception 'not all three columns exist, so 116 is not as it left things, nothing changed';
  end if;
end
$guard$;

-- How many rows hold a value, read before the columns go.
create temp table _lost116r on commit drop as
  select (select count(*) from vessl.quotes where client_details is not null or client_color is not null) as n_quotes_set,
         (select count(*) from vessl.staff_profiles where job_title is not null)                          as n_staff_set;

-- Every row, every column but the new ones, so b2 and b3 can prove nothing else moved.
create temp table _rest116r on commit drop as
  select (select md5(coalesce(string_agg((to_jsonb(q) - 'client_details' - 'client_color')::text, '/' order by q.id), ''))
            from vessl.quotes q)                                                                  as h_quotes,
         (select md5(coalesce(string_agg((to_jsonb(s) - 'job_title')::text, '/' order by s.id), ''))
            from vessl.staff_profiles s)                                                          as h_staff;

alter table vessl.quotes drop column client_details;
alter table vessl.quotes drop column client_color;
alter table vessl.staff_profiles drop column job_title;

-- VERIFICATION. a0 (always shown, with the counts) and z0 are a pass. Any b row is
-- a failed check. Zero rows means the query did not run at all.
select * from (
  select 'a0 before, three columns present; quotes losing Details or Color = '
           || (select n_quotes_set::text from _lost116r)
           || ', staff losing a job title = ' || (select n_staff_set::text from _lost116r) as chk,
         (select has_cols::text from _pre116r) as got,
         '3' as want
  union all
  select 'b1 the three columns are gone',
         (select count(*)::text from information_schema.columns
           where table_schema = 'vessl'
             and ((table_name = 'quotes' and column_name in ('client_details', 'client_color'))
               or (table_name = 'staff_profiles' and column_name = 'job_title'))),
         '0'
  union all
  select 'b2 every other column on every quote unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(q)::text, '/' order by q.id), ''))
                           = (select h_quotes from _rest116r) then 'same' else 'changed' end
            from vessl.quotes q),
         'same'
  union all
  select 'b3 every other column on every staff row unchanged',
         (select case when md5(coalesce(string_agg(to_jsonb(s)::text, '/' order by s.id), ''))
                           = (select h_staff from _rest116r) then 'same' else 'changed' end
            from vessl.staff_profiles s),
         'same'
  union all
  select 'b4 same number of quotes and staff rows',
         ((select count(*) from vessl.quotes)::text || '/' || (select count(*) from vessl.staff_profiles)::text),
         (select n_quotes::text || '/' || n_staff::text from _pre116r)
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk like 'a0%'
   or chk = 'z0 verification ran'
order by chk;

-- Two rows, a0 and z0, and the counts are what you expect? Then swap these two lines.
-- commit;
rollback;
