-- AI insights for Transport and Results (Premium), alongside Fees.
--
-- area_clean / area_key / place_text: the village matching from
-- frontend/src/data/areas.js, in SQL, so the transport figures put each
-- student in the same village the map does. Keep the two in step.
-- ai_transport_pack(): villages (students, on the bus, distance, whether a
-- stop serves them), routes (bus, seats, riders, stops and times), buses
-- (seats, status, papers due). Owners and admins.
-- ai_results_pack(): exams, class and subject averages, students
-- struggling, dropping or on top. Owners, admins and the principal.

alter table public.ai_insights drop constraint ai_insights_section_check;
alter table public.ai_insights add constraint ai_insights_section_check check (section in ('fees', 'transport', 'results'));

drop policy "admins read insights" on public.ai_insights;
create policy "admins read insights" on public.ai_insights
  for select to authenticated using (
    public.is_school_admin(school_id) or (section = 'results' and public.is_principal(school_id))
  );

-- ----------------------------------------------------- village matching ---

-- Lower case, letters only, without words that aren't the village name.
create function public.area_clean(s text) returns text
language sql immutable set search_path = '' as $$
  select coalesce(string_agg(w, ' ' order by i), '')
  from unnest(regexp_split_to_array(trim(regexp_replace(lower(coalesce(s, '')), '[^a-z ]+', ' ', 'g')), '\s+')) with ordinality as t (w, i)
  where w <> '' and not (w = any (array[
    'village', 'vill', 'vpo', 'po', 'p', 'o', 'v', 'teh', 'tehsil', 'distt', 'dist', 'district', 'near', 'h', 'no',
    'house', 'ward', 'street', 'gali', 'road', 'rd', 'bus', 'stand', 'chowk', 'india', 'haryana', 'hr', 'punjab', 'himachal', 'up', 'pradesh'
  ]))
$$;

-- Spelling-insensitive key: "Hema Majra" = "Hemamajra" (see areaKey()).
create function public.area_key(name text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  w text := replace(public.area_clean(name), ' ', '');
  k text;
  e text := '';
begin
  if w = '' then
    return '';
  end if;
  if w ~ '[aeiouy]$' then
    e := case right(w, 1) when 'a' then 'a' when 'e' then 'i' when 'i' then 'i' when 'y' then 'i' when 'o' then 'u' else 'u' end;
  end if;
  k := regexp_replace(w, '(.)\1+', '\1', 'g');
  k := regexp_replace(k, '([bcdfgjklmnpqrstvxz])h', '\1', 'g');
  k := regexp_replace(k, '[aeiouyw]', '', 'g');
  k := regexp_replace(k, '(.)\1+', '\1', 'g');
  return k || e;
end
$$;

-- The best place name for a student from address, pick-up point or city
-- (see placeText()).
create function public.place_text(address text, pickup text, city text) returns text
language plpgsql immutable set search_path = '' as $$
declare
  raw text;
  c text;
  parts text[];
  pick text;
  wide text[] := array['ambala', 'yamunanagar', 'yamuna nagar', 'panchkula', 'kurukshetra', 'saharanpur', 'haryana', 'india'];
begin
  foreach raw in array array[address, pickup, city] loop
    c := public.area_clean(raw);
    continue when c = '' or c = any (wide);
    select array_agg(x order by i) into parts
    from (
      select public.area_clean(p) as x, i
      from unnest(regexp_split_to_array(coalesce(raw, ''), '[,/]+')) with ordinality as u (p, i)
    ) s
    where x <> '' and not (x = any (wide));
    pick := case when coalesce(array_length(parts, 1), 0) > 1 then parts[array_length(parts, 1)] else c end;
    if length(pick) >= 3 then
      return pick;
    end if;
  end loop;
  return '';
end
$$;

-- Straight-line distance in km.
create function public.km_between(lat1 double precision, lng1 double precision, lat2 double precision, lng2 double precision) returns numeric
language sql immutable set search_path = '' as $$
  select case when lat1 is null or lat2 is null then null else round((
    2 * 6371 * asin(sqrt(
      power(sin(radians(lat2 - lat1) / 2), 2) + cos(radians(lat1)) * cos(radians(lat2)) * power(sin(radians(lng2 - lng1) / 2), 2)
    ))
  )::numeric, 1) end
$$;

-- ------------------------------------------------------------ transport ---

create function public.ai_transport_pack(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess uuid := public.current_session(p_school);
  d date := public.ist_today();
  home record;
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_school_admin(p_school)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;
  select s.lat, s.lng into home from public.schools s where s.id = p_school;

  with
  sp as (
    select e.student_id, st.name, public.class_text(e.class, e.section) as class_name,
      coalesce(p.uses_bus, false) as uses_bus, p.bus_stop_id, p.area_id, p.home_lat,
      public.area_key(public.place_text(p.address, p.pickup_point, p.city)) as key
    from public.student_enrolments e
    join public.students st on st.id = e.student_id
    left join public.student_private p on p.student_id = e.student_id
    where e.session_id = sess and e.status = 'active'
  ),
  alias as (
    select distinct on (k) a.id, k
    from public.school_areas a
    cross join lateral unnest(array_append(a.aliases, public.area_key(a.name))) as k
    where a.school_id = p_school and k <> ''
    order by k, a.name desc -- like the app: the last village by name wins
  ),
  placed as (
    select sp.*, coalesce(a1.id, al.id) as village_id
    from sp
    left join public.school_areas a1 on a1.id = sp.area_id and a1.school_id = p_school
    left join alias al on al.k = sp.key and sp.key <> ''
  ),
  stops as (
    select b.id, b.name, b.route_id, b.sort, b.pickup_at, b.lat, b.lng, r.name as route, al.id as village_id
    from public.bus_stops b
    join public.bus_routes r on r.id = b.route_id
    left join alias al on al.k = public.area_key(b.name)
    where b.school_id = p_school
  ),
  riders as (
    select bus_stop_id, count(*) as n from placed where uses_bus and bus_stop_id is not null group by bus_stop_id
  ),
  villages as (
    select a.id, a.name, a.lat, a.lng,
      count(pl.student_id) as students,
      count(pl.student_id) filter (where pl.uses_bus) as on_bus
    from public.school_areas a
    left join placed pl on pl.village_id = a.id
    where a.school_id = p_school
    group by a.id
  )
  select jsonb_build_object(
    'today', d,
    'school_location_set', home.lat is not null,
    'totals', (
      select jsonb_build_object(
        'students', count(*),
        'on_bus', count(*) filter (where uses_bus),
        'on_bus_without_stop', count(*) filter (where uses_bus and (bus_stop_id is null or not exists (select 1 from stops s where s.id = placed.bus_stop_id))),
        'homes_pinned', count(*) filter (where home_lat is not null),
        'in_a_known_village', count(*) filter (where village_id is not null),
        'village_unknown', count(*) filter (where village_id is null),
        'routes', (select count(*) from public.bus_routes r where r.school_id = p_school),
        'buses', (select count(*) from public.buses b where b.school_id = p_school and b.status <> 'retired')
      ) from placed
    ),
    'villages', (
      select coalesce(jsonb_agg(v order by (v->>'students')::int desc), '[]'::jsonb) from (
        select jsonb_build_object(
          'village', vi.name,
          'students', vi.students,
          'on_bus', vi.on_bus,
          'not_on_bus', vi.students - vi.on_bus,
          'km_from_school', public.km_between(home.lat, home.lng, vi.lat, vi.lng),
          'stop_on_routes', coalesce((select jsonb_agg(distinct s.route) from stops s where s.village_id = vi.id), '[]'::jsonb)
        ) as v
        from villages vi
        where vi.students > 0
        order by vi.students desc
        limit 40
      ) x
    ),
    'routes', (
      select coalesce(jsonb_agg(rt order by rt->>'route'), '[]'::jsonb) from (
        select jsonb_build_object(
          'route', r.name,
          'bus', b.number,
          'bus_status', b.status,
          'seats', b.seats,
          'riders', coalesce((select sum(rd.n) from stops s join riders rd on rd.bus_stop_id = s.id where s.route_id = r.id), 0),
          'morning_start', to_char(r.morning_at, 'HH24:MI'),
          'leaves_school', to_char(r.evening_at, 'HH24:MI'),
          'stops', coalesce((
            select jsonb_agg(jsonb_build_object(
              'stop', s.name,
              'pickup', to_char(s.pickup_at, 'HH24:MI'),
              'riders', coalesce(rd.n, 0),
              'km_from_school', public.km_between(home.lat, home.lng, s.lat, s.lng)
            ) order by s.sort)
            from stops s left join riders rd on rd.bus_stop_id = s.id
            where s.route_id = r.id
          ), '[]'::jsonb)
        ) as rt
        from public.bus_routes r
        left join public.buses b on b.id = r.bus_id
        where r.school_id = p_school
      ) x
    ),
    'buses', (
      select coalesce(jsonb_agg(bj), '[]'::jsonb) from (
        select jsonb_build_object(
          'bus', b.number,
          'name', b.name,
          'seats', b.seats,
          'status', b.status,
          'routes', (select count(*) from public.bus_routes r where r.bus_id = b.id),
          'driver_added', b.driver_name is not null,
          'conductor_added', b.conductor_name is not null,
          'safety_missing', (
            select coalesce(jsonb_agg(x), '[]'::jsonb) from unnest(array[
              case when not b.has_gps then 'GPS' end,
              case when not b.has_cctv then 'CCTV' end,
              case when not b.has_speed_governor then 'speed governor' end,
              case when not b.has_first_aid then 'first aid box' end
            ]) as x where x is not null
          ),
          -- Papers run out or running out within 60 days (negative: ran out)
          'papers_due', (
            select coalesce(jsonb_agg(jsonb_build_object('paper', p.label, 'days_left', p.until - d) order by p.until), '[]'::jsonb)
            from (values
              ('insurance', b.insurance_until), ('fitness', b.fitness_until), ('pollution (PUC)', b.puc_until),
              ('permit', b.permit_until), ('road tax', b.tax_until), ('fire extinguisher', b.extinguisher_until),
              ('driver''s licence', b.licence_until)
            ) as p (label, until)
            where p.until is not null and p.until - d <= 60
          ),
          'papers_not_added', (
            select count(*) from unnest(array[b.insurance_until, b.fitness_until, b.puc_until, b.permit_until, b.tax_until]) as u where u is null
          )
        ) as bj
        from public.buses b
        where b.school_id = p_school and b.status <> 'retired'
      ) x
    )
  ) into out;
  return out;
end
$$;

-- -------------------------------------------------------------- results ---

create function public.ai_results_pack(p_school uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  sess uuid := public.current_session(p_school);
  out jsonb;
begin
  if not (coalesce(auth.role(), '') = 'service_role' or public.is_school_admin(p_school) or public.is_principal(p_school)) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if sess is null then
    return jsonb_build_object('error', 'no session');
  end if;

  with
  en as (
    select e.student_id, st.name, public.class_text(e.class, e.section) as class_name
    from public.student_enrolments e
    join public.students st on st.id = e.student_id
    where e.session_id = sess and e.status = 'active'
  ),
  r as (
    select er.student_id, er.exam, er.subject, er.created_at, en.name, en.class_name,
      100.0 * er.marks / er.max_marks as pct
    from public.exam_results er
    join en on en.student_id = er.student_id
    where er.session_id = sess and er.marks is not null and er.max_marks > 0
  ),
  exams as (
    select exam, row_number() over (order by min(created_at)) as n from r group by exam
  ),
  -- Each student's average in each exam, and overall
  se as (
    select r.student_id, r.name, r.class_name, x.n, r.exam, avg(r.pct) as pct
    from r join exams x on x.exam = r.exam
    group by r.student_id, r.name, r.class_name, x.n, r.exam
  ),
  st as (
    select student_id, name, class_name, avg(pct) as pct, count(*) as exams,
      (array_agg(pct order by n desc))[1] as last_pct,
      (array_agg(pct order by n desc))[2] as previous_pct,
      (array_agg(exam order by n desc))[1] as last_exam,
      (array_agg(exam order by n desc))[2] as previous_exam
    from se group by student_id, name, class_name
  ),
  subj as (
    select student_id, subject, avg(pct) as pct from r group by student_id, subject
  ),
  struggling as (
    select s.*, (select sb.subject from subj sb where sb.student_id = s.student_id order by sb.pct limit 1) as weakest,
      (select count(*) from subj sb where sb.student_id = s.student_id and sb.pct < 33) as below_33_subjects
    from st s order by s.pct limit 20
  ),
  dropped as (
    select * from st where previous_pct is not null and previous_pct - last_pct >= 10
    order by previous_pct - last_pct desc limit 15
  ),
  top as (
    select * from st order by pct desc limit 10
  )
  select jsonb_build_object(
    'session', (select a.name from public.academic_sessions a where a.id = sess),
    'students', (select count(*) from en),
    'students_with_marks', (select count(*) from st),
    'exams', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'exam', x.exam, 'order', x.n,
        'students_with_marks', (select count(distinct r.student_id) from r where r.exam = x.exam),
        'subjects', (select count(distinct r.subject) from r where r.exam = x.exam),
        'average_pct', (select round(avg(r.pct)) from r where r.exam = x.exam)
      ) order by x.n), '[]'::jsonb) from exams x
    ),
    'by_class_exam', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'class', c.class_name, 'exam', c.exam, 'average_pct', c.avg_pct,
        'students_with_marks', c.marked, 'class_size', c.size, 'students_below_33', c.below
      ) order by c.class_name, c.n), '[]'::jsonb)
      from (
        select se.class_name, se.exam, x.n, round(avg(se.pct)) as avg_pct, count(*) as marked,
          (select count(*) from en where en.class_name = se.class_name) as size,
          count(*) filter (where se.pct < 33) as below
        from se join exams x on x.exam = se.exam
        group by se.class_name, se.exam, x.n
      ) c
    ),
    'by_class_subject', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'class', c.class_name, 'subject', c.subject, 'average_pct', c.avg_pct, 'students_below_33', c.below
      ) order by c.class_name, c.avg_pct), '[]'::jsonb)
      from (
        select r.class_name, r.subject, round(avg(r.pct)) as avg_pct,
          count(distinct r.student_id) filter (where r.pct < 33) as below
        from r group by r.class_name, r.subject
      ) c
    ),
    'by_subject', (
      select coalesce(jsonb_agg(jsonb_build_object('subject', s.subject, 'average_pct', s.avg_pct, 'students_below_33', s.below) order by s.avg_pct), '[]'::jsonb)
      from (
        select subject, round(avg(pct)) as avg_pct, count(distinct student_id) filter (where pct < 33) as below
        from r group by subject
      ) s
    ),
    'struggling', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name, 'average_pct', round(s.pct),
        'weakest_subject', s.weakest, 'subjects_below_33', s.below_33_subjects
      ) order by s.pct), '[]'::jsonb) from struggling s
    ),
    'dropped', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name,
        'previous_exam', s.previous_exam, 'previous_pct', round(s.previous_pct),
        'last_exam', s.last_exam, 'last_pct', round(s.last_pct),
        'drop_points', round(s.previous_pct) - round(s.last_pct)
      ) order by s.previous_pct - s.last_pct desc), '[]'::jsonb) from dropped s
    ),
    'top', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', s.student_id, 'name', s.name, 'class', s.class_name, 'average_pct', round(s.pct)
      ) order by s.pct desc), '[]'::jsonb) from top s
    )
  ) into out;
  return out;
end
$$;

revoke execute on function public.area_clean(text) from public, anon;
revoke execute on function public.area_key(text) from public, anon;
revoke execute on function public.place_text(text, text, text) from public, anon;
revoke execute on function public.km_between(double precision, double precision, double precision, double precision) from public, anon;
revoke execute on function public.ai_transport_pack(uuid) from public, anon;
revoke execute on function public.ai_results_pack(uuid) from public, anon;
grant execute on function public.area_key(text) to authenticated, service_role;
grant execute on function public.place_text(text, text, text) to authenticated, service_role;
grant execute on function public.ai_transport_pack(uuid) to authenticated, service_role;
grant execute on function public.ai_results_pack(uuid) to authenticated, service_role;
