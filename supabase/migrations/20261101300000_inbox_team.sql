-- Emails InboxCA cannot answer, for people (PLAN.md "Inbox, answered" E). Each email waiting in
-- Needs reply is for the person a teammate gave it to, or else for the client's own person:
-- the staff member assigned to the client first, then its manager, then its partner in charge;
-- with only a team assigned, that team's manager first, then anyone in it; with nobody, the
-- firm's owner. Only a person's own choice is kept (details.assignee, null for nobody), so a
-- change to the client's people moves the emails nobody picked by hand. How long each has
-- waited counts in days since it came (India time), and it is late once it has waited more
-- working days than the firm allows (settings.reply_days, 2 unless the owner changed it),
-- Sundays and the firm's holidays left out. Snoozed emails wait for their day. Read as the
-- person asking, so row level security decides which emails and which people count.
create or replace function public.team_replies(target_firm uuid)
returns table (id uuid, email_id uuid, client_id uuid, client_name text, reason_code text, assignee uuid, received_at timestamptz, days int, late boolean)
language sql stable set search_path = '' as $$
  select r.id, r.entity_id, r.client_id, c.name, r.reason_code,
    case when r.details ? 'assignee' then (r.details ->> 'assignee')::uuid else p.user_id end,
    e.received_at, t.today - t.came,
    (select count(*) from generate_series(t.came + 1, t.today, interval '1 day') d
      where extract(isodow from d) <> 7 and not coalesce(f.settings -> 'holidays', '[]') ? to_char(d, 'YYYY-MM-DD'))
      > coalesce(substring(f.settings ->> 'reply_days' from '^[0-9]{1,2}$')::int, 2)
  from public.requests r
  join public.email_events e on e.id = r.entity_id
  join public.firms f on f.id = r.firm_id
  left join public.clients c on c.id = r.client_id
  cross join lateral (select (now() at time zone 'Asia/Kolkata')::date as today, (e.received_at at time zone 'Asia/Kolkata')::date as came) t
  left join lateral (
    select m.user_id from public.firm_members m
    left join public.client_assignments a on a.firm_id = m.firm_id and a.client_id = r.client_id and (a.user_id = m.user_id or a.team_id = m.team_id)
    where m.firm_id = r.firm_id and m.status = 'active' and (a.client_id is not null or m.role = 'owner')
    order by a.user_id is null, a.team_id is null, array_position(array['staff', 'manager', 'partner_in_charge'], a.role),
      array_position(array['manager', 'partner', 'staff', 'front_desk', 'owner'], m.role), m.user_id
    limit 1
  ) p on true
  where r.firm_id = target_firm and r.kind = 'team_reply' and r.status = 'pending'
    and coalesce(r.details ->> 'snooze', '') <= to_char(t.today, 'YYYY-MM-DD')
  order by e.received_at, r.id
  limit 1000
$$;
revoke all on function public.team_replies(uuid) from public, anon;
grant execute on function public.team_replies(uuid) to authenticated, service_role;

-- 09:00 India time: a list for the owner of every firm where an email has waited more than a
-- day for a reply, unless the owner turned the list off (settings.reply_list). The job sends it.
create or replace function private.queue_reply_waiting() returns void
language sql security definer set search_path = '' as $$
  insert into public.jobs (firm_id, kind, entity_type, entity_id, idempotency_key)
  select distinct r.firm_id, 'reply_waiting', 'firm', r.firm_id, 'reply_waiting:' || r.firm_id || ':' || (now() at time zone 'Asia/Kolkata')::date
  from public.requests r
  join public.email_events e on e.id = r.entity_id and e.received_at < now() - interval '1 day'
  join public.firms f on f.id = r.firm_id and f.settings ->> 'reply_list' is distinct from 'false'
  where r.kind = 'team_reply' and r.status = 'pending'
    and coalesce(r.details ->> 'snooze', '') <= to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD')
  on conflict (idempotency_key) do nothing
$$;
revoke all on function private.queue_reply_waiting() from public, anon, authenticated, service_role;
select cron.schedule('reply-waiting', '30 3 * * *', 'select private.queue_reply_waiting()');
