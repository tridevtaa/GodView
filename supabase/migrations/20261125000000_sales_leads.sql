-- Sales leads: schools asking for a call back from the landing page
-- ("Contact Sales" in Goddess's box). Visitors aren't signed in, so they
-- can't touch the table: they go through request_sales_call(), which checks
-- the input and keeps one request per phone number a day. Nobody in the app
-- reads these; the Godview team sees them in the Supabase dashboard.

create table public.sales_leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  name text not null check (length(trim(name)) between 1 and 80),
  school text not null check (length(trim(school)) between 1 and 120),
  phone text not null check (phone ~ '^\+91[6-9]\d{9}$'),
  status text not null default 'new' check (status in ('new', 'contacted', 'closed'))
);

create index sales_leads_created on public.sales_leads (created_at desc);

alter table public.sales_leads enable row level security;
revoke all on public.sales_leads from anon, authenticated;

create function public.request_sales_call(p_name text, p_school text, p_phone text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  ph text := '+91' || right(digits, 10);
begin
  if length(trim(coalesce(p_name, ''))) not between 1 and 80
    or length(trim(coalesce(p_school, ''))) not between 1 and 120 then
    raise exception 'Name and school, please.' using errcode = '22023';
  end if;
  if length(digits) < 10 or ph !~ '^\+91[6-9]\d{9}$' then
    raise exception 'A 10-digit mobile number, please.' using errcode = '22023';
  end if;
  -- Asked already today: nothing more to do.
  if exists (select 1 from sales_leads where phone = ph and created_at > now() - interval '1 day') then
    return;
  end if;
  -- A guard against floods.
  if (select count(*) from sales_leads where created_at > now() - interval '1 day') >= 300 then
    raise exception 'Too many requests today. Please try again tomorrow.' using errcode = '53400';
  end if;
  insert into sales_leads (name, school, phone) values (trim(p_name), trim(p_school), ph);
end;
$$;

revoke execute on function public.request_sales_call(text, text, text) from public;
grant execute on function public.request_sales_call(text, text, text) to anon, authenticated;
