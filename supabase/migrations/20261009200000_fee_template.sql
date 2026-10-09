-- Ready-made grade list: every school starts with all grades from Nursery
-- to 12, which the owner renames or removes. Fees are added by the owner.

create function public.seed_school_template(school uuid) returns void
language sql security definer set search_path = '' as $$
  insert into public.school_grades (school_id, code, label, sort)
  select school, g.code, g.label, public.grade_sort(g.code)
  from (values
    ('Nursery', 'Nursery'), ('KG 1', 'KG 1'), ('KG 2', 'KG 2'),
    ('1', 'Grade 1'), ('2', 'Grade 2'), ('3', 'Grade 3'), ('4', 'Grade 4'), ('5', 'Grade 5'), ('6', 'Grade 6'),
    ('7', 'Grade 7'), ('8', 'Grade 8'), ('9', 'Grade 9'), ('10', 'Grade 10'), ('11', 'Grade 11'), ('12', 'Grade 12')
  ) as g(code, label)
  on conflict (school_id, code) do nothing;
$$;

select public.seed_school_template(id) from public.schools;

create function public.schools_seed_template() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  perform public.seed_school_template(new.id);
  return new;
end
$$;

create trigger schools_seed_template after insert on public.schools
  for each row execute function public.schools_seed_template();

revoke execute on function public.seed_school_template(uuid) from public, anon, authenticated;
revoke execute on function public.schools_seed_template() from public, anon, authenticated;
