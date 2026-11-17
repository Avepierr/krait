-- krait v2 backend schema - paste into Supabase SQL Editor and Run.
-- Owner identity is enforced SERVER-SIDE: the first account created with
-- username 'Avepier' becomes admin; nobody can edit is_admin/banned on
-- any profile unless they are already admin.

-- ── helper: is the signed-in user an admin? ──
create or replace function public.is_admin()
returns boolean
language sql security definer stable
set search_path = public
as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$;

-- ── profiles: one per account ──
create table if not exists public.profiles (
  id           uuid primary key references auth.users(id) on delete cascade,
  username     text unique not null,
  display_name text,
  is_admin     boolean not null default false,
  banned       boolean not null default false,
  ban_reason   text,
  created_at   timestamptz not null default now()
);

-- auto-create a profile when someone signs up; the FIRST account with
-- username 'Avepier' claims the owner seat (table is empty -> safe window)
create or replace function public.handle_new_user()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, username, display_name, is_admin)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || left(new.id::text, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username'),
    case when coalesce(new.raw_user_meta_data->>'username','') = 'Avepier'
          and not exists (select 1 from public.profiles where is_admin)
         then true else false end
  );
  return new;
end;
$$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- nobody (not even the row owner) can change admin/ban fields unless admin
create or replace function public.guard_admin_fields()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  if (new.is_admin is distinct from old.is_admin)
     or (new.banned is distinct from old.banned)
     or (new.ban_reason is distinct from old.ban_reason) then
    if not public.is_admin() then
      raise exception 'only the owner can change admin/ban fields';
    end if;
  end if;
  return new;
end;
$$;
drop trigger if exists guard_admin_fields_trg on public.profiles;
create trigger guard_admin_fields_trg
  before update on public.profiles
  for each row execute function public.guard_admin_fields();

-- ── chat/settings sync: each user owns their threads ──
create table if not exists public.threads (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null default 'chat',
  messages   jsonb not null default '[]'::jsonb,
  updated_at timestamptz not null default now()
);
create index if not exists threads_user_idx on public.threads (user_id, updated_at desc);

-- ── showcase: shared creations ──
create table if not exists public.showcase_posts (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  title      text not null,
  body       text not null default '',
  kind       text not null default 'chat',
  tags       text[] not null default '{}'::text[],
  payload    jsonb not null default '{}'::jsonb,
  likes      integer not null default 0,
  removed    boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists showcase_created_idx on public.showcase_posts (created_at desc);

create table if not exists public.showcase_likes (
  post_id  uuid not null references public.showcase_posts(id) on delete cascade,
  user_id  uuid not null references auth.users(id) on delete cascade,
  primary key (post_id, user_id)
);

create or replace function public.sync_like_count()
returns trigger
language plpgsql security definer
set search_path = public
as $$
begin
  update public.showcase_posts
     set likes = (select count(*) from public.showcase_likes where post_id = coalesce(new.post_id, old.post_id))
   where id = coalesce(new.post_id, old.post_id);
  return null;
end;
$$;
drop trigger if exists likes_count_trg on public.showcase_likes;
create trigger likes_count_trg
  after insert or delete on public.showcase_likes
  for each row execute function public.sync_like_count();

-- ── reports: users report posts/users, owner works the queue ──
create table if not exists public.reports (
  id             uuid primary key default gen_random_uuid(),
  reporter_id    uuid not null references auth.users(id) on delete cascade,
  target_post_id uuid references public.showcase_posts(id) on delete cascade,
  target_user_id uuid references auth.users(id) on delete cascade,
  reason         text not null,
  status         text not null default 'open',
  created_at     timestamptz not null default now()
);

-- ═══════════ ROW LEVEL SECURITY ═══════════
alter table public.profiles       enable row level security;
alter table public.threads        enable row level security;
alter table public.showcase_posts enable row level security;
alter table public.showcase_likes enable row level security;
alter table public.reports        enable row level security;

-- profiles: signed-in users can read (names on showcase), edit their own
create policy "profiles read"    on public.profiles for select to authenticated using (true);
create policy "profiles update"  on public.profiles for update to authenticated using (id = auth.uid()) with check (id = auth.uid());

-- threads: full control of your own rows, nothing else
create policy "threads all" on public.threads for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- showcase: banned users can't post; admins see and manage everything
create policy "showcase read" on public.showcase_posts for select to authenticated
  using (removed = false or public.is_admin());
create policy "showcase insert" on public.showcase_posts for insert to authenticated
  with check (
    user_id = auth.uid()
    and not exists (select 1 from public.profiles where id = auth.uid() and banned)
  );
create policy "showcase update own" on public.showcase_posts for update to authenticated
  using (user_id = auth.uid() or public.is_admin())
  with check (user_id = auth.uid() or public.is_admin());
create policy "showcase delete" on public.showcase_posts for delete to authenticated
  using (user_id = auth.uid() or public.is_admin());

-- likes: one per user per post
create policy "likes read"   on public.showcase_likes for select to authenticated using (true);
create policy "likes insert" on public.showcase_likes for insert to authenticated
  with check (user_id = auth.uid() and not exists (select 1 from public.profiles where id = auth.uid() and banned));
create policy "likes delete" on public.showcase_likes for delete to authenticated using (user_id = auth.uid());

-- reports: anyone signed in can file, only the owner reads/works them
create policy "reports insert" on public.reports for insert to authenticated
  with check (
    reporter_id = auth.uid()
    and not exists (select 1 from public.profiles where id = auth.uid() and banned)
  );
create policy "reports admin read"   on public.reports for select to authenticated using (public.is_admin());
create policy "reports admin update" on public.reports for update to authenticated using (public.is_admin()) with check (public.is_admin());

-- ── real-time for showcase + threads ──
alter publication supabase_realtime add table public.showcase_posts;
alter publication supabase_realtime add table public.threads;
