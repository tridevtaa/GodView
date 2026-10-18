-- A notice can be tagged with a category (sports, academic, cultural,
-- environment, other). Tagged notices with a picture show up in the
-- homepage's "News & Achievements" strip, alongside the plain noticeboard.

alter table public.notices add column category text
  check (category is null or category in ('sports', 'academic', 'cultural', 'environment', 'other'));
