alter table public.profiles
  add column if not exists avatar_preset text,
  add column if not exists avatar_bg     text;
