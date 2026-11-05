-- Report a problem or idea (the app's Help sheet and search palette): one row for each report a
-- person in a firm sends Orelu, for the admin console's list. What they chose and typed, and
-- where they were (the page without its query, their role, browser and screen, and the form,
-- rule, due date or file they said is out of date); never the page's content. Pictures,
-- recordings and files go only in the email to Orelu and are not kept. Kept 12 months, as the
-- privacy notice says. Written by the server only; Orelu admins read it through admin_feedback.
create table if not exists public.feedback (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  kind text not null check (kind in ('broken', 'odd', 'idea', 'old')),
  subject text not null check (length(subject) between 1 and 120),
  details text check (length(details) <= 4000),
  context jsonb not null default '{}',
  created_at timestamptz not null default now()
);
create index if not exists feedback_created on public.feedback (created_at desc);
alter table public.feedback enable row level security;
revoke all on public.feedback from anon, authenticated;

-- The newest reports across every firm, for the admin console.
create or replace function public.admin_feedback()
returns table (id uuid, firm text, person text, kind text, subject text, details text, page text, at timestamptz)
language plpgsql stable security definer set search_path = '' as $$
begin
  if not public.is_orelu_admin() then raise exception 'Orelu admins only' using errcode = '42501'; end if;
  return query
  select r.id, f.name, u.email::text, r.kind, r.subject, r.details, r.context ->> 'page', r.created_at
  from public.feedback r join public.firms f on f.id = r.firm_id left join auth.users u on u.id = r.user_id
  order by r.created_at desc
  limit 200;
end;
$$;
revoke all on function public.admin_feedback() from public, anon;
grant execute on function public.admin_feedback() to authenticated;

select cron.schedule('feedback-cleanup', '30 20 * * *', $$delete from public.feedback where created_at < now() - interval '12 months'$$);
