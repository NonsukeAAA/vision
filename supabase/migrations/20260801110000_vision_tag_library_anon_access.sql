-- Open vision tag library to the public anon key (personal Pages app).
-- App ships the publishable/anon key; no Settings paste required.

grant select, insert, update, delete on public.vision_tag_sets to anon, authenticated;
grant select, insert, update, delete on public.vision_tag_dictionary to anon, authenticated;

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
