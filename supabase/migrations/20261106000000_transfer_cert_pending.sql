-- A transfer certificate (SLC) is required for any admission above the
-- school's entry grade, but it often arrives late from the previous school,
-- or the parent simply doesn't have it on hand at admission time. Rather
-- than blocking the admission, the add-student form lets staff mark it
-- "collect later"; this flag is how that follow-up is tracked and surfaced
-- (a filter on the students list) until the document is actually uploaded.

alter table public.students add column transfer_cert_pending boolean not null default false;
