-- A to-do for a client (competitor review 4 Nov 2026, gap 4): a task of kind 'todo' with the
-- firm's own words in details ({"title": ..., "for": the person's user id, if one}), its date in
-- due_on, open (upcoming) or done (closed). No code, no rule, no reminder to the client: the
-- reminder jobs, the Calendar and the return counts read compliance and licence tasks only.
-- Today shows it to its person, or to the owner when it names nobody; the owner and partners see
-- every one. Adding one is the server's, after the same check as changing the client.
alter table public.tasks drop constraint if exists tasks_kind_check;
alter table public.tasks add constraint tasks_kind_check check (kind in ('compliance', 'notice', 'licence', 'todo'));
alter table public.tasks drop constraint if exists tasks_status_check;
alter table public.tasks add constraint tasks_status_check check (
  (kind in ('compliance', 'licence') and status in ('upcoming', 'in_progress', 'filed'))
  or (kind = 'notice' and status in ('upcoming', 'in_progress', 'replied', 'closed'))
  or (kind = 'todo' and status in ('upcoming', 'closed')));

-- Done and Undo follow the rule for changing the client (clients_update): the owner, a partner
-- or a manager.
drop policy if exists tasks_todo_right on public.tasks;
create policy tasks_todo_right on public.tasks as restrictive for update to authenticated
  using (kind <> 'todo' or public.member_role(firm_id) in ('owner', 'partner', 'manager'))
  with check (kind <> 'todo' or public.member_role(firm_id) in ('owner', 'partner', 'manager'));
