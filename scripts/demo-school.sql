-- Demo school for Play Store testers and reviewers.
--
-- Creates "Sunrise Public School (Demo)" with made-up data only: about 90
-- students across Nursery to Class 10, 8 teachers, a fee structure with
-- invoices and payments (some families behind), a month of attendance,
-- Half Yearly results, homework, notices and calendar events.
--
-- How to run: Supabase dashboard -> SQL Editor -> paste this file -> Run.
-- Running it again wipes the demo school and builds it fresh, so it also
-- works as a "reset" after testers have changed things. It refuses to touch
-- any school that isn't this demo school.
--
-- Before running, fill in the two lists just below:
--   owner_email  your own Google account (you become the demo school's owner)
--   testers      the Gmail IDs of your Play testers (they sign in with Google
--                and get the admin role in the demo school only)
--
-- Logins it gives you:
--   Staff:  "Sign in with Google" with any email listed below.
--   Parent: mobile 6000000001, password aarav2016
--           (two children: Aarav Sharma, Class 5 A and Anaya Sharma, KG 1 A)

do $demo$
declare
  -- ===== Fill these in =====================================================
  owner_email text := 'you@gmail.com';
  testers text := '
    tester1@gmail.com
    tester2@gmail.com
  ';  -- one per line (or separated by commas); delete the example lines
  -- =========================================================================

  demo_slug constant text := 'demo-sunrise';
  demo_name constant text := 'Sunrise Public School (Demo)';
  parent_phone constant text := '+916000000001';

  sid uuid;      -- school
  ses uuid;      -- session 2026-27
  h_tuition uuid;
  h_annual uuid;
  plan_monthly uuid;

  classes text[] := array['Nursery', 'KG 1', 'KG 2', '1', '2', '3', '4', '5', '6', '7', '8', '9', '10'];
  two_sections text[] := array['1', '2', '3', '4', '5'];
  girls text[] := array['Aadhya', 'Ananya', 'Diya', 'Ishita', 'Kavya', 'Meera', 'Myra', 'Navya', 'Pari', 'Riya',
                        'Saanvi', 'Sara', 'Tanvi', 'Vanya', 'Zoya', 'Kiara', 'Avni', 'Nisha', 'Pooja', 'Siya'];
  boys text[] := array['Aarav', 'Arjun', 'Ayaan', 'Dev', 'Ishaan', 'Kabir', 'Krish', 'Laksh', 'Neel', 'Om',
                       'Reyansh', 'Rohan', 'Sahil', 'Shaurya', 'Vihaan', 'Yash', 'Aditya', 'Kunal', 'Manav', 'Rudra'];
  surnames text[] := array['Agarwal', 'Bansal', 'Chauhan', 'Gupta', 'Jain', 'Kapoor', 'Khan', 'Malhotra', 'Mehta', 'Mishra',
                           'Patel', 'Rana', 'Rawat', 'Saini', 'Sethi', 'Singh', 'Tyagi', 'Verma', 'Yadav', 'Joshi'];
  dads text[] := array['Rajesh', 'Sanjay', 'Amit', 'Vikas', 'Manoj', 'Sunil', 'Deepak', 'Rakesh', 'Anil', 'Pankaj'];
  moms text[] := array['Sunita', 'Neha', 'Priya', 'Anjali', 'Kavita', 'Rekha', 'Pooja', 'Seema', 'Ritu', 'Shalini'];

  teacher_emails text[] := array['neha.sharma@demo.godview.in', 'rahul.verma@demo.godview.in', 'pooja.gupta@demo.godview.in',
                                 'amit.singh@demo.godview.in', 'kavita.joshi@demo.godview.in', 'sandeep.yadav@demo.godview.in',
                                 'ritu.mehta@demo.godview.in', 'vivek.rana@demo.godview.in'];
  teacher_names text[] := array['Neha Sharma', 'Rahul Verma', 'Pooja Gupta', 'Amit Singh', 'Kavita Joshi', 'Sandeep Yadav',
                                'Ritu Mehta', 'Vivek Rana'];
  teacher_titles text[] := array['PRT', 'TGT Maths', 'PRT', 'TGT Science', 'TGT English', 'PGT Social Science',
                                 'Nursery Teacher', 'TGT Hindi'];

  c text; sec text; sections text[];
  n int := 0; i int; k int;
  stu uuid; inv uuid; pay uuid;
  girl boolean; first text; surname text; birth date; age int;
  monthly numeric; paid_through int; receipt int := 0;
  d date; st text; t_email text; ci int;
  subj text; subjects text[]; mk numeric;
  m date;
begin
  perform setseed(0.42);

  if owner_email = 'you@gmail.com' then
    raise exception 'Put your own Google email in owner_email at the top of the script first.';
  end if;

  -- ----- Remove the previous demo school (and only that one) -----
  select id into sid from public.schools where slug = demo_slug;
  if sid is not null then
    if (select name from public.schools where id = sid) <> demo_name then
      raise exception 'A school with slug % exists but is not the demo school. Not touching it.', demo_slug;
    end if;
    delete from public.fee_allocations where school_id = sid;
    delete from public.fee_payments where school_id = sid;
    delete from public.fee_invoices where school_id = sid;
    delete from public.fee_schedule where school_id = sid;
    delete from public.student_certificates where school_id = sid;
    delete from public.schools where id = sid;
  end if;

  -- The demo parent must not be a parent in any real school, or they would
  -- see that school's children too.
  if exists (select 1 from public.guardians where phone = parent_phone) then
    raise exception 'Parent number % is already used in another school. Change parent_phone.', parent_phone;
  end if;

  -- ----- School -----
  insert into public.schools (slug, name, short_name, board, principal_name, address, city, state, pincode,
                              phone, email, office_hours)
  values (demo_slug, demo_name, 'Sunrise', 'CBSE', 'Dr. Meenakshi Rao', '12 Demo Road, Sector 21', 'Dehradun',
          'Uttarakhand', '248001', '+91 6000000000', 'demo@godview.in', 'Mon–Sat, 8:00 am – 2:00 pm')
  returning id into sid;

  insert into public.academic_sessions (school_id, name, starts_on, ends_on)
  values (sid, '2026-27', '2026-04-01', '2027-03-31') returning id into ses;

  -- New schools start with Nursery to 12 and three fee plans (triggers on
  -- schools). The demo school goes up to Class 10, with sections.
  delete from public.school_grades where school_id = sid;
  for i in 1 .. array_length(classes, 1) loop
    insert into public.school_grades (school_id, code, label, sort, sections, seats)
    values (sid, classes[i],
            case when classes[i] ~ '^\d+$' then 'Grade ' || classes[i] else classes[i] end,
            i - 1,
            case when classes[i] = any (two_sections) then array['A', 'B'] else array['A'] end,
            40);
  end loop;

  -- ----- People with logins -----
  insert into public.school_members (school_id, email, role, full_name, added_by)
  values (sid, lower(trim(owner_email)), 'owner', null, 'demo script');

  insert into public.school_members (school_id, email, role, added_by)
  select sid, lower(trim(e)), 'admin', 'demo script'
  from regexp_split_to_table(testers, '[\s,]+') e
  where e like '%@%' and e not in ('tester1@gmail.com', 'tester2@gmail.com')
    and lower(trim(e)) <> lower(trim(owner_email))
  on conflict do nothing;

  -- A made-up principal who signs the notices.
  insert into public.school_members (school_id, email, role, full_name, designation, added_by)
  values (sid, 'principal@demo.godview.in', 'principal', 'Dr. Meenakshi Rao', 'Principal', 'demo script');

  -- Made-up teachers (their emails can't sign in; they fill the staff list).
  -- The trigger on school_members adds each one to employees.
  for i in 1 .. array_length(teacher_emails, 1) loop
    insert into public.school_members (school_id, email, role, full_name, designation, phone, added_by)
    values (sid, teacher_emails[i], 'teacher', teacher_names[i], teacher_titles[i],
            '+91 60000001' || lpad(i::text, 2, '0'), 'demo script');
  end loop;

  -- ----- Fee structure -----
  insert into public.fee_heads (school_id, name, sort) values (sid, 'Tuition Fee', 0) returning id into h_tuition;
  insert into public.fee_heads (school_id, name, sort) values (sid, 'Annual Charges', 1) returning id into h_annual;
  select id into plan_monthly from public.fee_plans where school_id = sid and name = 'Monthly';

  foreach c in array classes loop
    insert into public.fee_schedule (school_id, session_id, class, head_id, amount, frequency, start_month, due_day, plan_id)
    values (sid, ses, c, h_tuition,
            case when c in ('Nursery', 'KG 1', 'KG 2') then 1800 when c::text in ('1', '2', '3', '4', '5') then 2200
                 when c in ('6', '7', '8') then 2600 else 3000 end,
            'monthly', 4, 10, plan_monthly);
  end loop;
  insert into public.fee_schedule (school_id, session_id, class, head_id, amount, frequency, start_month, due_day)
  values (sid, ses, null, h_annual, 6000, 'annual', 4, 10);

  -- ----- Class teachers -----
  ci := 0;
  foreach c in array classes loop
    sections := case when c = any (two_sections) then array['A', 'B'] else array['A'] end;
    foreach sec in array sections loop
      ci := ci + 1;
      insert into public.teacher_classes (school_id, email, session_id, class, section, is_class_teacher)
      values (sid, teacher_emails[1 + (ci - 1) % array_length(teacher_emails, 1)], ses, c, sec, true);
    end loop;
  end loop;

  -- ----- Students, fees and attendance -----
  foreach c in array classes loop
    sections := case when c = any (two_sections) then array['A', 'B'] else array['A'] end;
    age := case c when 'Nursery' then 3 when 'KG 1' then 4 when 'KG 2' then 5 else 5 + c::int end;
    monthly := case when c in ('Nursery', 'KG 1', 'KG 2') then 1800 when c in ('1', '2', '3', '4', '5') then 2200
                    when c in ('6', '7', '8') then 2600 else 3000 end;
    select email into t_email from public.teacher_classes
      where school_id = sid and session_id = ses and class = c and section = 'A';

    foreach sec in array sections loop
      for k in 1 .. 5 loop
        n := n + 1;
        girl := random() < 0.5;
        first := case when girl then girls[1 + floor(random() * 20)::int] else boys[1 + floor(random() * 20)::int] end;
        surname := surnames[1 + floor(random() * 20)::int];
        birth := make_date(2026 - age - 1, 1 + floor(random() * 12)::int, 1 + floor(random() * 28)::int);

        -- The demo parent's two children.
        if c = '5' and sec = 'A' and k = 1 then
          girl := false; first := 'Aarav'; surname := 'Sharma'; birth := '2016-08-14';
        elsif c = 'KG 1' and k = 1 then
          girl := true; first := 'Anaya'; surname := 'Sharma'; birth := '2021-02-03';
        end if;

        insert into public.students (school_id, admission_no, name, gender, dob, father_name, mother_name,
                                     admission_date, status)
        values (sid, 'DEMO-' || lpad(n::text, 3, '0'), first || ' ' || surname, case when girl then 'F' else 'M' end,
                birth,
                case when surname = 'Sharma' and first in ('Aarav', 'Anaya') then 'Rajesh Sharma'
                     else dads[1 + floor(random() * 10)::int] || ' ' || surname end,
                case when surname = 'Sharma' and first in ('Aarav', 'Anaya') then 'Priya Sharma'
                     else moms[1 + floor(random() * 10)::int] || ' ' || surname end,
                make_date(2026 - floor(random() * 5)::int, 4, 1), 'active')
        returning id into stu;

        insert into public.student_enrolments (student_id, session_id, school_id, class, section, roll_no, status)
        values (stu, ses, sid, c, sec, k::text, 'active');

        -- Parent phones: the demo parent for the Sharma children; for
        -- everyone else a made-up number in the 6000-series. Only the demo
        -- parent's number is meant to log in.
        insert into public.student_private (student_id, school_id, father_phone, address, city, state, category, religion)
        values (stu, sid,
                case when surname = 'Sharma' and first in ('Aarav', 'Anaya') then parent_phone
                     else '+9160000' || lpad((10000 + n)::text, 5, '0') end,
                (10 + floor(random() * 200)::int) || ', Demo Colony', 'Dehradun', 'Uttarakhand',
                (array['General', 'OBC', 'SC', 'ST'])[1 + floor(random() * 4)::int],
                (array['Hindu', 'Muslim', 'Sikh', 'Christian'])[1 + floor(random() * 4)::int]);

        -- Invoices: tuition April to March, annual charges in April.
        insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
        values (sid, ses, stu, h_annual, 'annual', 'Annual', 6000, '2026-04-10');
        for i in 0 .. 11 loop
          m := ('2026-04-01'::date + make_interval(months => i))::date;
          insert into public.fee_invoices (school_id, session_id, student_id, head_id, period, label, amount, due_date)
          values (sid, ses, stu, h_tuition, to_char(m, 'YYYY-MM'), to_char(m, 'Mon YYYY'), monthly, m + 9);
        end loop;

        -- Payments: most families are paid up to November, some are behind.
        paid_through := case when first = 'Aarav' and surname = 'Sharma' then 6   -- Sep: shows dues for the demo parent
                             when random() < 0.7 then 8                           -- Nov
                             when random() < 0.67 then 6                          -- Sep
                             else 4 end;                                          -- Jul
        for i in 0 .. paid_through - 1 loop
          m := ('2026-04-01'::date + make_interval(months => i))::date;
          receipt := receipt + 1;
          insert into public.fee_payments (school_id, student_id, amount, method, reference, paid_on, receipt_no,
                                           status, received_by, collected_by)
          values (sid, stu, monthly + case when i = 0 then 6000 else 0 end,
                  (array['cash', 'upi', 'upi', 'cheque'])[1 + floor(random() * 4)::int],
                  null, m + floor(random() * 9)::int, 'DEMO-R' || lpad(receipt::text, 5, '0'),
                  'success', 'demo script', 'Office')
          returning id into pay;
          insert into public.fee_allocations (payment_id, invoice_id, school_id, amount)
          select pay, fi.id, sid, fi.amount from public.fee_invoices fi
          where fi.student_id = stu and fi.session_id = ses
            and (fi.period = to_char(m, 'YYYY-MM') or (i = 0 and fi.period = 'annual'));
        end loop;

        -- Attendance for the last month (Mon–Sat, Diwali break off).
        d := '2026-10-19';
        while d <= '2026-11-19' loop
          if extract(isodow from d) < 7 and d not between '2026-11-07' and '2026-11-10' then
            st := case when random() < 0.9 then 'present' when random() < 0.4 then 'absent'
                       when random() < 0.5 then 'late' else 'leave' end;
            insert into public.attendance (student_id, day, school_id, session_id, status, marked_by)
            values (stu, d, sid, ses, st, t_email);
          end if;
          d := d + 1;
        end loop;

        -- Half Yearly results (Class 1 and up).
        if c ~ '^\d+$' then
          subjects := case when c::int <= 5 then array['English', 'Hindi', 'Maths', 'EVS']
                           else array['English', 'Hindi', 'Maths', 'Science', 'Social Science'] end;
          foreach subj in array subjects loop
            mk := 45 + floor(random() * 54);
            insert into public.exam_results (school_id, session_id, student_id, exam, subject, marks, max_marks, grade,
                                             entered_by)
            values (sid, ses, stu, 'Half Yearly', subj, mk, 100,
                    case when mk >= 91 then 'A1' when mk >= 81 then 'A2' when mk >= 71 then 'B1' when mk >= 61 then 'B2'
                         when mk >= 51 then 'C1' else 'C2' end,
                    t_email);
          end loop;
        end if;
      end loop;
    end loop;
  end loop;

  -- ----- Homework -----
  insert into public.homework (school_id, session_id, class, section, subject, body, due_date, created_by, author_name)
  select sid, ses, tc.class, tc.section, hw.subject, hw.body, hw.due, tc.email,
         (select full_name from public.school_members sm where sm.school_id = sid and sm.email = tc.email)
  from public.teacher_classes tc
  cross join (values
    ('English', 'Read the chapter "The Little Seed" and write five new words with their meanings.', date '2026-11-20'),
    ('Maths', 'Complete exercise 4.2, questions 1 to 10, in your notebook.', date '2026-11-21')
  ) hw(subject, body, due)
  where tc.school_id = sid and tc.session_id = ses;

  -- ----- Notices -----
  insert into public.notices (school_id, title, body, for_parents, pinned, created_by, author_name, category, created_at)
  values
    (sid, 'Annual Sports Day on 5 December',
     'Our Annual Sports Day will be held on Saturday, 5 December, from 9 am. Students should come in their house T-shirts. Parents are welcome.',
     true, true, 'principal@demo.godview.in', null, 'sports', now() - interval '1 day'),
    (sid, 'Parent–teacher meeting',
     'The parent–teacher meeting for all classes is on Saturday, 28 November, 9 am to 12 noon. Half Yearly report cards will be shared.',
     true, false, 'principal@demo.godview.in', null, 'academic', now() - interval '3 days'),
    (sid, 'Winter uniform from 1 December',
     'Students should wear the full winter uniform (navy blazer and sweater) from 1 December.',
     true, false, 'principal@demo.godview.in', null, 'other', now() - interval '6 days'),
    (sid, 'Staff meeting on Friday',
     'All teachers please stay back for 30 minutes after school on Friday to plan the Sports Day.',
     false, false, 'principal@demo.godview.in', null, 'other', now() - interval '2 days');

  -- ----- Calendar -----
  insert into public.calendar_events (school_id, title, kind, starts_on, ends_on, note, for_parents, created_by)
  values
    (sid, 'Diwali break', 'holiday', '2026-11-07', '2026-11-10', '', true, 'principal@demo.godview.in'),
    (sid, 'Parent–teacher meeting', 'meeting', '2026-11-28', null, '9 am to 12 noon', true, 'principal@demo.godview.in'),
    (sid, 'Annual Sports Day', 'event', '2026-12-05', null, 'From 9 am on the school ground', true, 'principal@demo.godview.in'),
    (sid, 'Winter break', 'holiday', '2026-12-25', '2027-01-01', '', true, 'principal@demo.godview.in'),
    (sid, 'Final exams begin', 'exam', '2027-02-22', null, 'Datesheet will be shared in January', true, 'principal@demo.godview.in');

  -- None of the made-up parent numbers may belong to a parent in a real
  -- school (that parent would then see the demo children). Undo if so.
  if exists (select 1 from public.guardians g
             join public.guardians o on o.phone = g.phone and o.school_id <> g.school_id
             where g.school_id = sid) then
    raise exception 'A made-up parent number clashes with a real school. Nothing was saved.';
  end if;

  raise notice 'Demo school ready: % students, % fee payments. School id %', n, receipt, sid;
end
$demo$;
