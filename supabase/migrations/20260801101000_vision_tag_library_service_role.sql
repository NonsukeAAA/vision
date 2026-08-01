-- vision tag library — single-tenant, service_role managed (no auth.users FK).
-- Apply once in Supabase SQL Editor, then use the service_role key in the app.

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

-- No anon/authenticated policies: only service_role (bypasses RLS) can access.
revoke all on public.vision_tag_sets from anon, authenticated;
revoke all on public.vision_tag_dictionary from anon, authenticated;
grant all on public.vision_tag_sets to service_role;
grant all on public.vision_tag_dictionary to service_role;

-- Expose via Data API
notify pgrst, 'reload schema';
