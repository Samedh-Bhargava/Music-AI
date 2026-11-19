create table if not exists public.sonora_libraries (
    user_id uuid primary key references auth.users (id) on delete cascade,
    projects jsonb not null default '[]'::jsonb check (jsonb_typeof(projects) = 'array'),
    deleted_ids jsonb not null default '[]'::jsonb check (jsonb_typeof(deleted_ids) = 'array'),
    current_id text,
    note_names_visible boolean not null default false,
    updated_at timestamptz not null default now()
);

alter table public.sonora_libraries enable row level security;

drop policy if exists "Users can read their own Sonora library" on public.sonora_libraries;
create policy "Users can read their own Sonora library"
    on public.sonora_libraries for select to authenticated
    using ((select auth.uid()) = user_id);

drop policy if exists "Users can create their own Sonora library" on public.sonora_libraries;
create policy "Users can create their own Sonora library"
    on public.sonora_libraries for insert to authenticated
    with check ((select auth.uid()) = user_id);

drop policy if exists "Users can update their own Sonora library" on public.sonora_libraries;
create policy "Users can update their own Sonora library"
    on public.sonora_libraries for update to authenticated
    using ((select auth.uid()) = user_id)
    with check ((select auth.uid()) = user_id);

grant select, insert, update on public.sonora_libraries to authenticated;
