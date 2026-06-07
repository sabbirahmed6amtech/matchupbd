-- Fix: guests could not join WAITING rooms because the USING clause checked
-- the row's current state (guest_id IS NULL → auth.uid() ≠ guest_id → denied).
-- The new policy also allows any authenticated non-host user to update a
-- WAITING room that has no guest yet (i.e. to join it).
-- The WITH CHECK still enforces that after the update the caller is a member.

drop policy if exists "rooms_update_member" on public.match_rooms;

create policy "rooms_update_member" on public.match_rooms
  for update
  using (
    auth.uid() = host_id
    or auth.uid() = guest_id
    or (status = 'WAITING' and guest_id is null and auth.uid() != host_id)
  )
  with check (
    auth.uid() = host_id
    or auth.uid() = guest_id
  );
