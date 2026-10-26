-- Limits for the assistant (Premium): how often one person can ask, and how
-- much of the shared voice allowance one school can use in a day.
-- Only the concierge and voice edge functions touch this (service role);
-- nobody can read or write it from the app.

create table public.assistant_usage (
  id bigint generated always as identity primary key,
  user_id uuid not null,
  school_id uuid not null,
  kind text not null check (kind in ('ask', 'voice')),
  amount integer not null default 1,
  at timestamptz not null default now()
);

create index assistant_usage_user on public.assistant_usage (user_id, kind, at);
create index assistant_usage_school on public.assistant_usage (school_id, kind, at);

alter table public.assistant_usage enable row level security;
-- No policies: closed to every app user.

-- Checks the limits and, if there is room, records the use. Returns '' when
-- allowed, else which limit was hit: 'burst' (too many in 10 minutes) or
-- 'daily' (today, India time).
--   ask:   one question by p_user; p_burst per 10 minutes, p_daily per day.
--   voice: p_amount characters for p_school; p_daily characters per day.
-- A null limit is not checked.
create or replace function public.assistant_take(
  p_user uuid,
  p_school uuid,
  p_kind text,
  p_amount integer,
  p_burst integer,
  p_daily integer
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  day_start timestamptz := date_trunc('day', now() at time zone 'Asia/Kolkata') at time zone 'Asia/Kolkata';
  n bigint;
begin
  -- One check at a time per person (questions) or school (voice), so two
  -- requests at once can't both squeeze under the limit.
  perform pg_advisory_xact_lock(hashtext('assistant:' || p_kind || ':' || (case when p_kind = 'ask' then p_user else p_school end)::text));

  if p_kind = 'ask' then
    if p_burst is not null then
      select count(*) into n from public.assistant_usage
      where user_id = p_user and kind = 'ask' and at > now() - interval '10 minutes';
      if n >= p_burst then return 'burst'; end if;
    end if;
    if p_daily is not null then
      select count(*) into n from public.assistant_usage
      where user_id = p_user and kind = 'ask' and at >= day_start;
      if n >= p_daily then return 'daily'; end if;
    end if;
  elsif p_kind = 'voice' then
    if p_daily is not null then
      select coalesce(sum(amount), 0) into n from public.assistant_usage
      where school_id = p_school and kind = 'voice' and at >= day_start;
      if n + p_amount > p_daily then return 'daily'; end if;
    end if;
  else
    return 'bad_kind';
  end if;

  insert into public.assistant_usage (user_id, school_id, kind, amount)
  values (p_user, p_school, p_kind, greatest(p_amount, 0));

  -- Now and then, forget rows no limit looks at any more.
  if random() < 0.01 then
    delete from public.assistant_usage where at < now() - interval '40 days';
  end if;
  return '';
end
$$;

revoke execute on function public.assistant_take(uuid, uuid, text, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.assistant_take(uuid, uuid, text, integer, integer, integer) to service_role;
