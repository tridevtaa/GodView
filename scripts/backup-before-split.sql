-- A snapshot of every app table before splitting Berries Kids out of Mav
-- (the free plan has no backups). Run it once in the Supabase SQL editor,
-- right before the split.
--
-- The copies go in their own schema, backup_split_20261020, which the app
-- and its API never see (only "public" is exposed). If anything about the
-- split needs undoing, the original rows are here. Delete the schema once
-- both schools have been checked:  drop schema backup_split_20261020 cascade;

do $$
declare
  t text;
begin
  if exists (select 1 from pg_namespace where nspname = 'backup_split_20261020') then
    raise exception 'A backup from today already exists (backup_split_20261020): nothing done';
  end if;
  create schema backup_split_20261020;
  revoke all on schema backup_split_20261020 from public, anon, authenticated;

  for t in select tablename from pg_tables where schemaname = 'public' order by tablename loop
    execute format('create table backup_split_20261020.%I as table public.%I', t, t);
  end loop;
end
$$;

-- What was saved (the editor shows this row when it's done).
select
  (select count(*) from pg_tables where schemaname = 'backup_split_20261020') as tables_copied,
  (select count(*) from pg_tables where schemaname = 'public') as app_tables,
  (select count(*) from backup_split_20261020.students) as students_copied,
  (select count(*) from backup_split_20261020.fee_payments) as payments_copied;
