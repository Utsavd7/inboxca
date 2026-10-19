-- M7 step 5: permission requests (PLAN.md 5.17.2). An employee or manager asks to upload,
-- send or remove a file; the answer is a one-time grant that lasts an hour and is used up by
-- the action itself, so no file waits anywhere. An unanswered request lapses after 4 hours.
-- Written by the server only, after it checks who may ask and who may answer.
alter table public.requests drop constraint requests_kind_check;
alter table public.requests add constraint requests_kind_check check (kind in ('team_reply', 'documents', 'alert', 'import', 'permission'));
alter table public.requests drop constraint requests_status_check;
alter table public.requests add constraint requests_status_check check (status in ('pending', 'done', 'approved', 'refused', 'used'));
create index requests_permission on public.requests (firm_id, client_id) where kind = 'permission' and status in ('pending', 'approved');
