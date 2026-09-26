-- Run this once in your Supabase project's SQL editor
-- (Project -> SQL Editor -> New query), so the anon key baked into
-- app.js can only ever read/write a signed-in user's OWN row, even
-- though the key itself is public in the client code (that's normal
-- for Supabase — RLS is the real gate, not the key).

alter table public.user_syllabus_data enable row level security;

create policy "select own row"
  on public.user_syllabus_data for select
  using (auth.uid() = user_id);

create policy "insert own row"
  on public.user_syllabus_data for insert
  with check (auth.uid() = user_id);

create policy "update own row"
  on public.user_syllabus_data for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- If a policy with the same name already exists, drop it first:
-- drop policy "select own row" on public.user_syllabus_data;
