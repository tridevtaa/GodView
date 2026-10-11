-- Lets someone who asked to join see where their request stands. They aren't
-- a member yet, so they can't read `schools`; this returns only their own
-- requests with the school's name and logo.
create function public.my_access_requests()
returns table (
  id uuid,
  status text,
  created_at timestamptz,
  decided_at timestamptz,
  school_name text,
  logo_path text,
  name text,
  designation text,
  requested_classes jsonb
)
language sql stable security definer set search_path = '' as $$
  select r.id, r.status, r.created_at, r.decided_at, s.name, s.logo_path, r.name, r.designation, r.requested_classes
  from public.access_requests r
  join public.schools s on s.id = r.school_id
  where r.email = public.current_email()
  order by r.created_at desc
  limit 10
$$;

revoke execute on function public.my_access_requests() from public, anon;
grant execute on function public.my_access_requests() to authenticated;
