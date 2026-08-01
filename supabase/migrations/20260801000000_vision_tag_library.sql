-- vision tag library: history / favorites / session / dictionary
-- Scoped per auth user (prefer Anonymous Sign-Ins in the Supabase dashboard).

create extension if not exists "pgcrypto";

create table if not exists public.vision_tag_sets (
  id uuid not null,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('history', 'favorite', 'session')),
  label text not null default '',
  prompt text not null default '',
  caption text,
  mode text not null default 'booru',
  tags jsonb not null default '[]'::jsonb,
  votes jsonb not null default '{}'::jsonb,
  source_note text not null default '',
  image_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, kind)
);

create index if not exists vision_tag_sets_user_kind_created_idx
  on public.vision_tag_sets (user_id, kind, created_at desc);

create index if not exists vision_tag_sets_user_kind_updated_idx
  on public.vision_tag_sets (user_id, kind, updated_at desc);

-- At most one session row per user.
create unique index if not exists vision_tag_sets_one_session_per_user
  on public.vision_tag_sets (user_id)
  where kind = 'session';

create table if not exists public.vision_tag_dictionary (
  user_id uuid not null references auth.users (id) on delete cascade,
  tag text not null,
  category text not null default 'general',
  last_score double precision not null default 0,
  count integer not null default 0,
  custom_ja text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now(),
  primary key (user_id, tag)
);

create index if not exists vision_tag_dictionary_user_updated_idx
  on public.vision_tag_dictionary (user_id, updated_at desc);

alter table public.vision_tag_sets enable row level security;
alter table public.vision_tag_dictionary enable row level security;

drop policy if exists vision_tag_sets_select on public.vision_tag_sets;
drop policy if exists vision_tag_sets_insert on public.vision_tag_sets;
drop policy if exists vision_tag_sets_update on public.vision_tag_sets;
drop policy if exists vision_tag_sets_delete on public.vision_tag_sets;

create policy vision_tag_sets_select on public.vision_tag_sets
  for select to authenticated
  using (auth.uid() = user_id);

create policy vision_tag_sets_insert on public.vision_tag_sets
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy vision_tag_sets_update on public.vision_tag_sets
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy vision_tag_sets_delete on public.vision_tag_sets
  for delete to authenticated
  using (auth.uid() = user_id);

drop policy if exists vision_tag_dictionary_select on public.vision_tag_dictionary;
drop policy if exists vision_tag_dictionary_insert on public.vision_tag_dictionary;
drop policy if exists vision_tag_dictionary_update on public.vision_tag_dictionary;
drop policy if exists vision_tag_dictionary_delete on public.vision_tag_dictionary;

create policy vision_tag_dictionary_select on public.vision_tag_dictionary
  for select to authenticated
  using (auth.uid() = user_id);

create policy vision_tag_dictionary_insert on public.vision_tag_dictionary
  for insert to authenticated
  with check (auth.uid() = user_id);

create policy vision_tag_dictionary_update on public.vision_tag_dictionary
  for update to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

create policy vision_tag_dictionary_delete on public.vision_tag_dictionary
  for delete to authenticated
  using (auth.uid() = user_id);

grant select, insert, update, delete on public.vision_tag_sets to authenticated;
grant select, insert, update, delete on public.vision_tag_dictionary to authenticated;
