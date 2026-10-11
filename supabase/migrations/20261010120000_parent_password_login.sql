-- Parent login with mobile number + password, where the starting password
-- is a linked child's first name and birth year (e.g. "ishita2016").
--
-- The check runs here, inside the database, only for the server function
-- (service role); nobody can call it from the app. Wrong attempts are
-- counted per number: after 5 in 15 minutes the number is locked for a
-- while, so the password can't be guessed by trying names and years.
-- Parents can set their own password in the app; after that the starting
-- password no longer works for them.

create table public.parent_login_attempts (
  phone text not null,
  at timestamptz not null default now(),
  ok boolean not null
);

create index parent_login_attempts_phone on public.parent_login_attempts (phone, at desc);
alter table public.parent_login_attempts enable row level security; -- no policies: server only

-- Returns 'ok' | 'wrong' | 'locked', and the number in +91 form.
create function public.parent_password_check(p_phone text, p_password text)
returns table (result text, phone text)
language plpgsql security definer set search_path = '' as $$
declare
  ph text := public.normalise_phone(p_phone);
  typed text := lower(regexp_replace(coalesce(p_password, ''), '\s', '', 'g'));
  matched boolean;
begin
  if ph is null then
    return query select 'wrong'::text, null::text;
    return;
  end if;
  if (select count(*) from public.parent_login_attempts a
      where a.phone = ph and not a.ok and a.at > now() - interval '15 minutes') >= 5 then
    return query select 'locked'::text, ph;
    return;
  end if;

  select exists (
    select 1
    from public.guardians g
    join public.guardian_students gs on gs.guardian_id = g.id and not gs.removed
    join public.students s on s.id = gs.student_id
    where g.phone = ph
      and s.dob is not null
      and length(typed) >= 5
      and lower(regexp_replace(split_part(trim(s.name), ' ', 1), '[^A-Za-z]', '', 'g'))
          || extract(year from s.dob)::int::text = typed
  ) into matched;

  insert into public.parent_login_attempts (phone, ok) values (ph, matched);
  delete from public.parent_login_attempts where at < now() - interval '1 day';
  return query select case when matched then 'ok' else 'wrong' end, ph;
end
$$;

-- The login account for a number, if one exists, and whether the parent
-- has set their own password.
create function public.parent_auth_user(p_phone text)
returns table (id uuid, custom_password boolean)
language sql stable security definer set search_path = '' as $$
  select u.id, coalesce((u.raw_user_meta_data ->> 'custom_password')::boolean, false)
  from auth.users u
  where u.phone = ltrim(p_phone, '+')
  limit 1
$$;

revoke execute on function public.parent_password_check(text, text) from public, anon, authenticated;
revoke execute on function public.parent_auth_user(text) from public, anon, authenticated;
grant execute on function public.parent_password_check(text, text) to service_role;
grant execute on function public.parent_auth_user(text) to service_role;
