-- ===== Run this once in Supabase → SQL Editor → New query → Run =====

-- 1. The table that stores everyone's comments
create table comments (
  id bigint generated always as identity primary key,
  text text not null check (char_length(text) between 1 and 200),
  count int not null default 1,
  mood int not null default 0 check (mood between -1 and 1),
  created_at timestamptz default now()
);

-- No duplicates, even with different capital letters ("good" = "Good")
create unique index comments_text_lower on comments (lower(text));

-- 2. Security: turn on Row Level Security, then allow READING only
alter table comments enable row level security;

create policy "Anyone can read comments"
  on comments for select
  using (true);

-- 3. The ONLY way to write: add a comment, or +1 if it already exists
create or replace function add_comment(new_text text, new_mood int)
returns void
language sql
security definer
set search_path = public
as $$
  insert into comments (text, mood)
  values (trim(new_text), greatest(-1, least(1, new_mood)))
  on conflict ((lower(text)))
  do update set count = comments.count + 1;
$$;

grant execute on function add_comment(text, int) to anon;

-- 4. Starter comments so suggestions work from day one
insert into comments (text, count, mood) values
  ('Good battery life', 12, 1),
  ('Good battery backup, lasts a full day', 9, 1),
  ('Great battery, easily lasts all day', 10, 1),
  ('Battery lasts all day', 10, 1),
  ('Charges very quickly', 7, 1),
  ('Fast charging is a big plus', 5, 1),
  ('Gets through two days on light use', 4, 1),
  ('Excellent standby time', 3, 1),
  ('Average battery, needs a charge by evening', 4, 0),
  ('Battery drains quickly', 3, -1),
  ('Poor battery life with heavy use', 3, -1),
  ('Bad battery, dies before evening', 2, -1),
  ('Charging is slow', 2, -1),
  ('Gets hot while charging', 2, -1);
