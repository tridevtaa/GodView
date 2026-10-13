-- Only the owner deletes student and staff profiles (admins used to be
-- allowed at the table level, though the app never offered it).
--
-- Students with fee payments can't be deleted: receipts are kept for the
-- school's accounts (the payments table refuses it). They're marked Left
-- instead, which keeps every record.
--
-- Deleting a staff profile also takes away that person's app access and
-- class assignments; otherwise their next sign-in would bring the profile
-- back. The owner can't delete themself or another owner.

drop policy "admins delete students" on public.students;
drop policy "admins delete employees" on public.employees;

create policy "owner deletes students" on public.students
  for delete to authenticated using (public.is_owner(school_id));
create policy "owner deletes employees" on public.employees
  for delete to authenticated using (public.is_owner(school_id));

-- What deleting would remove, so the owner can decide. Null when not
-- allowed to delete.
create function public.delete_preview(p_kind text, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = '' as $$
declare
  school uuid;
  mail text;
  member_role text;
begin
  if p_kind = 'student' then
    select s.school_id into school from public.students s where s.id = p_id;
    if school is null or not public.is_owner(school) then
      return null;
    end if;
    return jsonb_build_object(
      'payments', (select count(*) from public.fee_payments p where p.student_id = p_id),
      'dues', (select count(*) from public.fee_invoices i where i.student_id = p_id),
      'results', (select count(*) from public.exam_results r where r.student_id = p_id),
      'attendance', (select count(*) from public.attendance a where a.student_id = p_id),
      'messages', (select count(*) from public.messages m where m.student_id = p_id),
      'requests', (select count(*) from public.parent_requests q where q.student_id = p_id)
    );
  elsif p_kind = 'employee' then
    select e.school_id, lower(e.email) into school, mail from public.employees e where e.id = p_id;
    if school is null or not public.is_owner(school) then
      return null;
    end if;
    select m.role::text into member_role from public.school_members m where m.school_id = school and m.email = mail;
    return jsonb_build_object(
      'access', member_role,
      'classes', (select count(*) from public.teacher_classes t where t.school_id = school and t.email = mail),
      'self', mail is not null and mail = public.current_email(),
      'owner', member_role = 'owner'
    );
  end if;
  return null;
end
$$;

create function public.delete_student(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  school uuid;
begin
  select s.school_id into school from public.students s where s.id = p_id;
  if school is null or not public.is_owner(school) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if exists (select 1 from public.fee_payments p where p.student_id = p_id) then
    raise exception 'has payments' using errcode = 'P0001', hint = 'has-payments';
  end if;
  delete from public.students s where s.id = p_id;
end
$$;

create function public.delete_employee(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  school uuid;
  mail text;
begin
  select e.school_id, lower(e.email) into school, mail from public.employees e where e.id = p_id;
  if school is null or not public.is_owner(school) then
    raise exception 'not allowed' using errcode = '42501';
  end if;
  if mail is not null and mail = public.current_email() then
    raise exception 'is self' using errcode = 'P0001', hint = 'is-self';
  end if;
  if exists (select 1 from public.school_members m where m.school_id = school and m.email = mail and m.role = 'owner') then
    raise exception 'is owner' using errcode = 'P0001', hint = 'is-owner';
  end if;
  if mail is not null then
    delete from public.teacher_classes t where t.school_id = school and t.email = mail;
    delete from public.school_members m where m.school_id = school and m.email = mail;
  end if;
  delete from public.employees e where e.id = p_id;
end
$$;

revoke execute on function public.delete_preview(text, uuid) from public, anon;
revoke execute on function public.delete_student(uuid) from public, anon;
revoke execute on function public.delete_employee(uuid) from public, anon;
grant execute on function public.delete_preview(text, uuid) to authenticated;
grant execute on function public.delete_student(uuid) to authenticated;
grant execute on function public.delete_employee(uuid) to authenticated;
