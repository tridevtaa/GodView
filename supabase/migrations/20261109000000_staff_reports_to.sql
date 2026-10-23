-- Who a staff member reports to, for the org chart in Staff > People.
-- Empty (the default): the chart places them from their designation.
-- Set by owners and admins (the existing "admins edit employees" policy).

alter table public.employees
  add column reports_to uuid references public.employees (id) on delete set null,
  add constraint employees_not_own_manager check (reports_to is distinct from id);

-- The person they report to must be at the same school, and the chain above
-- them must not lead back to them.
create function public.check_employee_reports_to() returns trigger
language plpgsql set search_path = '' as $$
declare
  boss uuid := new.reports_to;
  steps int := 0;
begin
  if boss is null then
    return new;
  end if;
  if not exists (select 1 from public.employees e where e.id = boss and e.school_id = new.school_id) then
    raise exception 'reports_to must be someone at the same school';
  end if;
  while boss is not null and steps < 100 loop
    if boss = new.id then
      raise exception 'reporting lines cannot go in a circle';
    end if;
    select e.reports_to into boss from public.employees e where e.id = boss;
    steps := steps + 1;
  end loop;
  return new;
end
$$;

create trigger employees_reports_to before insert or update of reports_to on public.employees
  for each row execute function public.check_employee_reports_to();
