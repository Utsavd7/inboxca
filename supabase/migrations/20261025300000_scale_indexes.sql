-- M11 scale check: the owner's returns meter (firm_usage) counted the year's returns by
-- reading every task of the firm; with 200,000 returns that took most of Settings' time.
create index if not exists tasks_compliance_due on public.tasks (firm_id, due_on) where kind = 'compliance';
