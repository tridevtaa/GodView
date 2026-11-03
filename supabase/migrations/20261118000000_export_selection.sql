-- An export request says which students it's for, so the owner approves that
-- list and the one approved download covers exactly that list.
-- student_ids: null on older requests. selection: the list in words.

alter table public.export_requests
  add column student_ids uuid[] check (cardinality(student_ids) between 1 and 20000),
  add column selection text check (length(selection) <= 200);
