-- What InboxCA did with each email it read (PLAN.md 5.5, "Inbox, answered" A), worked out from
-- the records the firm already has, the most pressing first:
--   snoozed or reply: it waits for a person (a team reply request, snoozed to a later day or not)
--   approval: a paper for it waits for someone to approve it
--   check: its papers wait under To check
--   unanswered: InboxCA has not answered its request for a paper yet
--   answered: InboxCA sent the paper asked for, or the receipt for its papers
--   replied: the team answered it from the Inbox
--   notice: a notice was recorded from it
--   filed: its papers were filed (one may since be an earlier version, or deleted)
-- None of these: no reply was needed (or the team said so). The Inbox lists and filters its
-- email through this view. It reads as the person asking (security_invoker), so row level
-- security decides which emails, and which of their records, count.
create or replace view public.email_outcomes with (security_invoker = true) as
select e.id, e.firm_id, e.client_id, e.contact_id, e.received_at, e.label, e.decision_source, e.provider_message_id,
  array_remove(array[
    case when r.status = 'pending' then case when r.details ->> 'snooze' > to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then 'snoozed' else 'reply' end end,
    case when 'waiting' = any(s.states) then 'approval' end,
    case when 'to_check' = any(d.states) then 'check' end,
    case when r.status is null and s.states is null and e.label in ('records_past', 'records_current') then 'unanswered' end,
    case when r.status is null and ('sent' = any(s.states) or e.delivery ->> 'ack' = 'sent') then 'answered' end,
    case when r.status = 'done' and r.details ->> 'replied' = 'true' then 'replied' end,
    case when exists (select 1 from public.tasks t where t.kind = 'notice' and t.details ->> 'email_event_id' = e.id::text) then 'notice' end,
    case when d.states <> '{to_check}' then 'filed' end
  ], null) as outcomes
from public.email_events e
left join public.requests r on r.kind = 'team_reply' and r.entity_type = 'email' and r.entity_id = e.id
left join lateral (select array_agg(distinct status) as states from public.shares where email_event_id = e.id) s on true
left join lateral (select array_agg(distinct status) as states from public.documents where email_event_id = e.id) d on true;
revoke all on public.email_outcomes from anon, authenticated;
grant select on public.email_outcomes to authenticated;

-- The papers sent and the notices recorded for an email, found by the email.
create index if not exists shares_email_event on public.shares (email_event_id) where email_event_id is not null;
create index if not exists tasks_notice_email on public.tasks ((details ->> 'email_event_id')) where kind = 'notice';

-- A reply from the Inbox now marks its email's request replied; replies sent before say so too.
update public.requests r set details = r.details || '{"replied": true}'
where r.kind = 'team_reply' and r.status = 'done' and not r.details ? 'replied'
  and exists (select 1 from public.activity_log l where l.action = 'email.replied' and l.entity_type = 'email' and l.entity_id = r.entity_id);
