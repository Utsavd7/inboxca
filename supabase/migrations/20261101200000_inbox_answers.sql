-- Inbox, answered B and C (PLAN.md): InboxCA answers a client asking whether a return is filed,
-- which papers are still needed or what is due, from its own records, and sends a receipt for
-- saved papers and for a notice. The answer's state lives in email_events.delivery, as the
-- papers receipt's did: ack is held (Ask me first: it waits in the Inbox for a person), queued
-- (Auto: it goes after a 5 minute Undo, or a person pressed Send), sending, ready (the mailbox
-- asked to wait), sent, or stopped (a person said not to send it). asked keeps which return and
-- period a question names, never its words.

alter table public.email_events drop constraint if exists email_events_label_check;
alter table public.email_events add constraint email_events_label_check
  check (label in ('records_past', 'records_current', 'notice_received', 'data_gst', 'data_income_tax', 'data_tax_audit', 'ask_filed', 'ask_papers', 'ask_due', 'other'));

-- What InboxCA did with each email, as before, with two more outcomes:
--   draft: InboxCA wrote an answer and it waits for a person to send it (Ask me first)
--   queued: InboxCA's answer goes soon (Auto, until its Undo ends)
-- A question InboxCA answers counts as unanswered until it has an answer of any state.
create or replace view public.email_outcomes with (security_invoker = true) as
select e.id, e.firm_id, e.client_id, e.contact_id, e.received_at, e.label, e.decision_source, e.provider_message_id,
  array_remove(array[
    case when r.status = 'pending' then case when r.details ->> 'snooze' > to_char(now() at time zone 'Asia/Kolkata', 'YYYY-MM-DD') then 'snoozed' else 'reply' end end,
    case when 'waiting' = any(s.states) then 'approval' end,
    case when r.status is null and e.delivery ->> 'ack' = 'held' then 'draft' end,
    case when 'to_check' = any(d.states) then 'check' end,
    case when r.status is null and s.states is null and not e.delivery ? 'ack' and e.label in ('records_past', 'records_current', 'ask_filed', 'ask_papers', 'ask_due') then 'unanswered' end,
    case when r.status is null and e.delivery ->> 'ack' in ('queued', 'sending', 'ready') then 'queued' end,
    case when r.status is null and ('sent' = any(s.states) or e.delivery ->> 'ack' = 'sent') then 'answered' end,
    case when r.status = 'done' and r.details ->> 'replied' = 'true' then 'replied' end,
    case when exists (select 1 from public.tasks t where t.kind = 'notice' and t.details ->> 'email_event_id' = e.id::text) then 'notice' end,
    case when d.states <> '{to_check}' then 'filed' end
  ], null) as outcomes
from public.email_events e
left join public.requests r on r.kind = 'team_reply' and r.entity_type = 'email' and r.entity_id = e.id
left join lateral (select array_agg(distinct status) as states from public.shares where email_event_id = e.id) s on true
left join lateral (select array_agg(distinct status) as states from public.documents where email_event_id = e.id) d on true;

-- The Inbox lists the answers waiting for a person or going soon, by their state.
create index if not exists email_events_answer on public.email_events (firm_id, (delivery ->> 'ack'));

-- An answer that went: marked sent once, and logged with its template and who sent it (none
-- when InboxCA sent it by itself). Replaces finish_mail_ack, which only the papers receipt used.
drop function if exists public.finish_mail_ack(uuid, int);
create or replace function public.finish_answer(event_id uuid, template text, actor uuid default null) returns void
language sql security definer set search_path = '' as $$
  with sent as (
    update public.email_events set delivery = delivery || '{"ack":"sent"}' where id = event_id and delivery ->> 'ack' = 'sending' returning firm_id, id
  ) insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
    select firm_id, actor, 'email.answered', 'email', id, jsonb_build_object('template', template) from sent
$$;
revoke all on function public.finish_answer(uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.finish_answer(uuid, text, uuid) to service_role;
