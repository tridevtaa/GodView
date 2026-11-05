-- A notice can go out as a letter on the school's letterhead: the school's name
-- and logo at the top, a greeting, and a sign-off. Owners and admins only, as it
-- speaks for the school; any staff can still post ordinary notices.

alter table public.notices
  add column letterhead boolean not null default false,
  add column signed_by text check (length(signed_by) <= 80);

-- Notices can be posted by any staff, so the policy alone can't stop this.
create function public.notice_letterhead_admins() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.letterhead and (tg_op = 'INSERT' or not old.letterhead) and not public.is_school_admin(new.school_id) then
    raise exception 'not allowed';
  end if;
  return new;
end
$$;
revoke execute on function public.notice_letterhead_admins() from public, anon, authenticated;
create trigger notice_letterhead_admins before insert or update of letterhead on public.notices
  for each row execute function public.notice_letterhead_admins();
