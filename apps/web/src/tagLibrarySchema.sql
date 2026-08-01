-- Paste into Supabase Dashboard → SQL Editor → Run (once).
-- vision tag library — public anon access (personal Pages app)

create extension if not exists "pgcrypto";

create table if not exists public.vision_tag_sets (
  id uuid not null,
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

create index if not exists vision_tag_sets_kind_created_idx
  on public.vision_tag_sets (kind, created_at desc);

create index if not exists vision_tag_sets_kind_updated_idx
  on public.vision_tag_sets (kind, updated_at desc);

create table if not exists public.vision_tag_dictionary (
  tag text primary key,
  category text not null default 'general',
  last_score double precision not null default 0,
  count integer not null default 0,
  custom_ja text not null default '',
  note text not null default '',
  updated_at timestamptz not null default now()
);

create index if not exists vision_tag_dictionary_updated_idx
  on public.vision_tag_dictionary (updated_at desc);

alter table public.vision_tag_sets enable row level security;
alter table public.vision_tag_dictionary enable row level security;

grant select, insert, update, delete on public.vision_tag_sets to anon, authenticated;
grant select, insert, update, delete on public.vision_tag_dictionary to anon, authenticated;
grant all on public.vision_tag_sets to service_role;
grant all on public.vision_tag_dictionary to service_role;

drop policy if exists vision_tag_sets_anon_all on public.vision_tag_sets;
create policy vision_tag_sets_anon_all
  on public.vision_tag_sets
  for all
  to anon, authenticated
  using (true)
  with check (true);

drop policy if exists vision_tag_dictionary_anon_all on public.vision_tag_dictionary;
create policy vision_tag_dictionary_anon_all
  on public.vision_tag_dictionary
  for all
  to anon, authenticated
  using (true)
  with check (true);

notify pgrst, 'reload schema';
