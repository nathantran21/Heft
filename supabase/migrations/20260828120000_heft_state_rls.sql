-- Heft RLS: the publishable anon key lives in the client (public repo).
-- That is safe only if every row is scoped to auth.uid().
-- Apply against the live project (dashboard SQL editor or `supabase db push`
-- after `supabase link --project-ref ezmqnbfpnulsgcemmiia`).

-- ===== heft_state: one JSON blob per auth user =====
alter table public.heft_state enable row level security;

drop policy if exists "heft_state_select_own" on public.heft_state;
create policy "heft_state_select_own"
  on public.heft_state for select
  to authenticated
  using (auth.uid() = user_id);

drop policy if exists "heft_state_insert_own" on public.heft_state;
create policy "heft_state_insert_own"
  on public.heft_state for insert
  to authenticated
  with check (auth.uid() = user_id);

drop policy if exists "heft_state_update_own" on public.heft_state;
create policy "heft_state_update_own"
  on public.heft_state for update
  to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "heft_state_delete_own" on public.heft_state;
create policy "heft_state_delete_own"
  on public.heft_state for delete
  to authenticated
  using (auth.uid() = user_id);

-- Anon has no policies → PostgREST returns [] without a user JWT.

-- ===== avatars: public read (profile photos), write only own folder =====
-- Object paths are `{user_id}/{timestamp}.jpg`.
insert into storage.buckets (id, name, public)
values ('avatars', 'avatars', true)
on conflict (id) do update set public = true;

drop policy if exists "avatars_select_public" on storage.objects;
create policy "avatars_select_public"
  on storage.objects for select
  using (bucket_id = 'avatars');

drop policy if exists "avatars_insert_own" on storage.objects;
create policy "avatars_insert_own"
  on storage.objects for insert
  to authenticated
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "avatars_update_own" on storage.objects;
create policy "avatars_update_own"
  on storage.objects for update
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  )
  with check (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );

drop policy if exists "avatars_delete_own" on storage.objects;
create policy "avatars_delete_own"
  on storage.objects for delete
  to authenticated
  using (
    bucket_id = 'avatars'
    and split_part(name, '/', 1) = auth.uid()::text
  );
