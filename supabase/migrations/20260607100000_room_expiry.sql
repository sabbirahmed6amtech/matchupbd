-- Add expiry timestamp to WAITING rooms (10-minute window to find an opponent)
alter table public.match_rooms
  add column if not exists expires_at timestamptz not null default (now() + interval '10 minutes');

-- Backfill: existing WAITING rooms get 10 min from their creation time
update public.match_rooms
  set expires_at = created_at + interval '10 minutes'
  where status = 'WAITING';

-- Close all expired WAITING rooms in one pass; callable by any authenticated user
create or replace function public.close_expired_rooms()
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.match_rooms
  set status = 'CLOSED', closed_at = now()
  where status = 'WAITING' and expires_at <= now();
end;
$$;

grant execute on function public.close_expired_rooms() to authenticated, anon;
