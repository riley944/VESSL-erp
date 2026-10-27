-- 101 -- PLM, what a new card arriving in Sampling is seeded with. Writes nothing, sends nothing.
--
-- RUN AS postgres IN THE SQL EDITOR. Ends in rollback, and there is no commit
-- line to swap -- nothing here is kept.
--
-- WHAT IT DOES. Inside the transaction only, it makes a throwaway card for the
-- ZZTESTPLM product and the ZZTESTFACTORY company (a pair with no card), puts
-- it in Sampling, and inserts the Sampling checklist exactly the way
-- seedStageTasks in lib/programs.js does -- one row per task in
-- STAGE_TASKS.sampling, in order, with program_id, stage sampling, the task,
-- the card owner as owner_id, the mover as assigned_by, blocker none and
-- sort_order 0 up. Then it shows the rows and rolls everything back.
--
-- THE SIX ARE COPIED FROM lib/programs.js, which is what the board runs. SQL
-- cannot run that file, so this proves the list the code holds today is
-- accepted by the table -- the stage CHECK, the blocker CHECK, the non-blank
-- task CHECK -- and shows it as it would land. b1 checks the list by the
-- length of each task, so a word changed in the code and not here shows up.
--
-- NO EMAIL. program_tasks and programs have no mailing trigger; the only
-- trigger on programs stamps declared_stage_at.
--
-- WHAT A PASS LOOKS LIKE. r1 to r6, one per task in order, plus z0. Any a or b
-- row is a failed check.

begin;

create temp table _pre101 on commit drop as
  select
    (select length(name)::text || ' ' || sku from vessl.products
      where id = 'bb06cd26-e1a1-4336-9c4e-b1f863da62a8'::uuid)                                   as product_ident,
    (select length(name)::text || ' ' || type::text from vessl.companies
      where id = '5fa19444-d240-48bb-b170-98119697919a'::uuid)                                   as company_ident,
    (select count(*) from vessl.programs
      where product_id = 'bb06cd26-e1a1-4336-9c4e-b1f863da62a8'::uuid
        and client_company_id = '5fa19444-d240-48bb-b170-98119697919a'::uuid)                   as pair_cards,
    (select owner_id from vessl.programs
      where id = '3e754941-1bbc-4fbf-ba6d-c58c1adbef97'::uuid)                                   as owner_id,
    (select count(*) from vessl.programs)                                                        as t_progs,
    (select count(*) from vessl.program_tasks)                                                   as t_tasks;

do $guard$
begin
  if (select product_ident from _pre101) is distinct from '9 zztestplm'
     or (select company_ident from _pre101) is distinct from '13 factory' then
    raise exception 'the ZZTESTPLM product or ZZTESTFACTORY company is not as measured, nothing run';
  end if;
  if (select pair_cards from _pre101) <> 0 then
    raise exception 'that pair already has a card, nothing run';
  end if;
end
$guard$;

create temp table _card101 (id uuid) on commit drop;

with c as (
  insert into vessl.programs (product_id, client_company_id, declared_stage, owner_id, created_by, updated_by)
  select 'bb06cd26-e1a1-4336-9c4e-b1f863da62a8'::uuid, '5fa19444-d240-48bb-b170-98119697919a'::uuid,
         'sampling', owner_id, 'mattdillon@kinguniversal.com', 'mattdillon@kinguniversal.com'
    from _pre101
  returning id
)
insert into _card101 select id from c;

-- STAGE_TASKS.sampling, in the order lib/programs.js lists it.
insert into vessl.program_tasks (program_id, stage, task, owner_id, assigned_by, blocker, sort_order)
select k.id, 'sampling', t.task, p.owner_id, 'mattdillon@kinguniversal.com', 'none', t.ord - 1
  from _card101 k, _pre101 p,
       unnest(array['Request sample from factory', 'Sample received from factory', 'Sample sent to client',
                    'Client feedback received', 'Changes sent to factory', 'Client sign-off'])
         with ordinality as t(task, ord);

-- VERIFICATION. r1 to r6 plus z0 is a pass. Any a or b row is a failed check.
-- Zero rows means the query did not run at all.
select * from (
  select 'r' || (t.sort_order + 1)::text || ' seeded task' as chk,
         (t.sort_order::text || ' -- ' || t.task || ' -- ' || t.blocker
          || case when t.done then ' -- done' else ' -- open' end)::text as got,
         'shown every run' as want
    from vessl.program_tasks t join _card101 k on k.id = t.program_id
  union all
  select 'a0 product and company as measured, no card for the pair yet',
         (select product_ident || '/' || company_ident || '/' || pair_cards::text from _pre101),
         '9 zztestplm/13 factory/0'
  union all
  select 'b1 six tasks, by length in order -- the list in lib/programs.js',
         (select count(*)::text || '/' || string_agg(length(t.task)::text, ',' order by t.sort_order)
            from vessl.program_tasks t join _card101 k on k.id = t.program_id),
         '6/27,28,21,24,23,15'
  union all
  select 'b2 all six are stage sampling, open, no blocker, owned by the card owner, sort 0 to 5',
         (select bool_and(t.stage = 'sampling' and not t.done and t.blocker = 'none'
                          and t.owner_id is not distinct from p.owner_id)::text
                 || '/' || min(t.sort_order)::text || '/' || max(t.sort_order)::text
            from vessl.program_tasks t join _card101 k on k.id = t.program_id, _pre101 p),
         'true/0/5'
  union all
  select 'b3 the throwaway card is in Sampling',
         (select declared_stage::text from vessl.programs where id = (select id from _card101)), 'sampling'
  union all
  select 'b4 exactly one card and six tasks more than before, until the rollback',
         (select ((select count(*) from vessl.programs) - t_progs)::text || '/'
                 || ((select count(*) from vessl.program_tasks) - t_tasks)::text from _pre101),
         '1/6'
  union all
  select 'z0 verification ran', 'ran', 'ran'
) r
where got is distinct from want
   or chk = 'z0 verification ran'
order by chk;

rollback;
