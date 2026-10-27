-- Functions nothing in the app, its jobs, the worker or a cron calls any more: Home's old month
-- ribbon and progress by return, the late returns and week ahead lists Today replaced
-- (late_clients and the calendar), and the firm's state from its GSTIN, which nothing reads.
drop function if exists public.month_load(date);
drop function if exists public.month_by_return(date);
drop function if exists public.late_returns(uuid);
drop function if exists public.due_soon(uuid);
drop function if exists public.firm_state(public.firms);
