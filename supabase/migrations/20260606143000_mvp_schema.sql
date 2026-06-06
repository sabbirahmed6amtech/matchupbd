create extension if not exists pgcrypto;

create type public.platform_type as enum ('Mobile', 'PlayStation', 'Xbox', 'PC');
create type public.room_status as enum ('WAITING', 'MATCHED', 'PLAYING', 'RATING', 'CLOSED');
create type public.rating_value as enum ('GOOD', 'NEUTRAL', 'BAD');

create table if not exists public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  username text not null,
  avatar_url text,
  country text not null default 'Bangladesh',
  platform public.platform_type not null,
  efootball_id text,
  favorite_team text,
  division text,
  reputation_score numeric(5,4) not null default 0,
  matches_played integer not null default 0,
  last_seen timestamptz,
  created_at timestamptz not null default now(),
  constraint username_length check (char_length(username) between 3 and 24)
);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  constraint chat_message_len check (char_length(message) between 1 and 300)
);

create table if not exists public.match_rooms (
  id uuid primary key default gen_random_uuid(),
  host_id uuid not null references public.profiles (id) on delete cascade,
  guest_id uuid references public.profiles (id) on delete set null,
  platform public.platform_type not null,
  division text,
  status public.room_status not null default 'WAITING',
  created_at timestamptz not null default now(),
  closed_at timestamptz,
  constraint room_max_two_players check (host_id is distinct from guest_id)
);

create table if not exists public.room_messages (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.match_rooms (id) on delete cascade,
  user_id uuid not null references public.profiles (id) on delete cascade,
  message text not null,
  created_at timestamptz not null default now(),
  constraint room_message_len check (char_length(message) between 1 and 300)
);

create table if not exists public.ratings (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.match_rooms (id) on delete cascade,
  from_user_id uuid not null references public.profiles (id) on delete cascade,
  to_user_id uuid not null references public.profiles (id) on delete cascade,
  rating public.rating_value not null,
  created_at timestamptz not null default now(),
  unique (room_id, from_user_id),
  constraint rating_no_self check (from_user_id is distinct from to_user_id)
);

create unique index if not exists match_rooms_one_host_active_idx
  on public.match_rooms (host_id)
  where status in ('WAITING', 'MATCHED', 'PLAYING', 'RATING');

create unique index if not exists match_rooms_one_guest_active_idx
  on public.match_rooms (guest_id)
  where status in ('WAITING', 'MATCHED', 'PLAYING', 'RATING') and guest_id is not null;

create index if not exists chat_messages_created_at_idx on public.chat_messages (created_at desc);
create index if not exists room_messages_room_created_idx on public.room_messages (room_id, created_at);
create index if not exists ratings_room_id_idx on public.ratings (room_id);

create or replace function public.enforce_room_creation_cooldown()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  latest_room timestamptz;
begin
  select created_at into latest_room
  from public.match_rooms
  where host_id = new.host_id and id is distinct from new.id
  order by created_at desc
  limit 1;

  if latest_room is not null and latest_room > now() - interval '30 seconds' then
    raise exception 'Please wait 30 seconds before creating another room';
  end if;

  return new;
end;
$$;

create trigger trg_enforce_room_creation_cooldown
before insert on public.match_rooms
for each row execute function public.enforce_room_creation_cooldown();

create or replace function public.refresh_user_reputation(target_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  total_count int;
  good_count int;
  played_count int;
begin
  select count(*) filter (where rating = 'GOOD'), count(*)
  into good_count, total_count
  from public.ratings
  where to_user_id = target_user;

  select count(*)
  into played_count
  from public.match_rooms
  where status = 'CLOSED' and (host_id = target_user or guest_id = target_user);

  update public.profiles
  set
    reputation_score = case when total_count = 0 then 0 else round(good_count::numeric / total_count::numeric, 4) end,
    matches_played = played_count
  where id = target_user;
end;
$$;

create or replace function public.close_room_if_fully_rated(input_room_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  host_user uuid;
  guest_user uuid;
  unique_raters int;
begin
  select host_id, guest_id into host_user, guest_user from public.match_rooms where id = input_room_id;

  if host_user is null or guest_user is null then
    return;
  end if;

  select count(distinct from_user_id) into unique_raters from public.ratings where room_id = input_room_id;

  if unique_raters >= 2 then
    update public.match_rooms
    set status = 'CLOSED', closed_at = now()
    where id = input_room_id and status = 'RATING';

    perform public.refresh_user_reputation(host_user);
    perform public.refresh_user_reputation(guest_user);
  end if;
end;
$$;

alter table public.profiles enable row level security;
alter table public.chat_messages enable row level security;
alter table public.match_rooms enable row level security;
alter table public.room_messages enable row level security;
alter table public.ratings enable row level security;

create policy "profiles_select_all" on public.profiles for select using (true);
create policy "profiles_upsert_self" on public.profiles for insert with check (auth.uid() = id);
create policy "profiles_update_self" on public.profiles for update using (auth.uid() = id);

create policy "chat_read_all" on public.chat_messages for select using (true);
create policy "chat_insert_self" on public.chat_messages for insert with check (auth.uid() = user_id);

create policy "rooms_read_all" on public.match_rooms for select using (true);
create policy "rooms_insert_host" on public.match_rooms for insert with check (auth.uid() = host_id);
create policy "rooms_update_member" on public.match_rooms
  for update
  using (auth.uid() = host_id or auth.uid() = guest_id)
  with check (auth.uid() = host_id or auth.uid() = guest_id or guest_id = auth.uid());

create policy "room_messages_read_room_members" on public.room_messages
  for select
  using (
    exists (
      select 1
      from public.match_rooms mr
      where mr.id = room_id and (mr.host_id = auth.uid() or mr.guest_id = auth.uid())
    )
  );

create policy "room_messages_insert_room_members" on public.room_messages
  for insert
  with check (
    auth.uid() = user_id
    and exists (
      select 1
      from public.match_rooms mr
      where mr.id = room_id and (mr.host_id = auth.uid() or mr.guest_id = auth.uid())
    )
  );

create policy "ratings_read_room_members" on public.ratings
  for select
  using (
    exists (
      select 1
      from public.match_rooms mr
      where mr.id = room_id and (mr.host_id = auth.uid() or mr.guest_id = auth.uid())
    )
  );

create policy "ratings_upsert_self" on public.ratings
  for insert
  with check (
    auth.uid() = from_user_id
    and exists (
      select 1
      from public.match_rooms mr
      where mr.id = room_id
        and mr.status = 'RATING'
        and (mr.host_id = auth.uid() or mr.guest_id = auth.uid())
        and (to_user_id = mr.host_id or to_user_id = mr.guest_id)
    )
  );

create policy "ratings_update_self" on public.ratings
  for update
  using (auth.uid() = from_user_id)
  with check (auth.uid() = from_user_id);

alter publication supabase_realtime add table public.profiles;
alter publication supabase_realtime add table public.chat_messages;
alter publication supabase_realtime add table public.match_rooms;
alter publication supabase_realtime add table public.room_messages;
alter publication supabase_realtime add table public.ratings;
