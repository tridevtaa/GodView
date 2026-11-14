-- Staff dates of birth, for Home's staff birthdays widget. Optional.
alter table public.employees add column dob date check (dob >= date '1930-01-01');
