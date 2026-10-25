-- M9 leads (PLAN.md 5.12, 6): a lead is a client at an earlier stage, so Won turns the same
-- row into a client and nothing is copied. Its enquiry fields (service, urgency, the phone
-- encrypted by the app, the follow-up day, why it was lost) sit in details; its notes are
-- encrypted by the app. Only the owner, partners and the front desk see and work leads
-- (PLAN.md 3); everyone's client lists keep to stage 'client'. Every change to a lead goes
-- through the functions below, which write one plain line in the log each.

alter table public.clients
  add column if not exists stage text not null default 'client' check (stage in ('lead_new', 'qualifying', 'proposal', 'client', 'lost', 'cold')),
  add column if not exists details jsonb not null default '{}',
  add column if not exists notes_enc text;
create index if not exists clients_leads on public.clients (firm_id, stage) where stage <> 'client';
-- The enquiry form's link is found by its key (firms.settings.enquiry_form.key).
create index if not exists firms_enquiry_form on public.firms ((settings -> 'enquiry_form' ->> 'key'));

-- A column now named stage on clients would win over this function's own stage argument, so
-- the argument is named in full (the same function otherwise).
create or replace function public.claim_notice_alert(task_id uuid, stage text) returns jsonb
language sql security definer set search_path = '' as $$
  update public.tasks t set details=jsonb_set(t.details,'{notice_alerts}',coalesce(t.details->'notice_alerts','{}') || jsonb_build_object(claim_notice_alert.stage,true))
  from public.clients c where t.id=task_id and c.id=t.client_id and c.firm_id=t.firm_id and c.archived_at is null
    and t.kind='notice' and t.status in ('upcoming','in_progress') and private.notice_stage(t.due_on,t.details)=claim_notice_alert.stage
    and not coalesce(t.details->'notice_alerts','{}') ? claim_notice_alert.stage
  returning jsonb_build_object('firm_id',t.firm_id,'client_id',t.client_id,'stage',claim_notice_alert.stage)
$$;

-- The firms whose leads the person works now.
create or replace function public.lead_firms() returns setof uuid
language sql stable security definer set search_path = '' as $$
  select m.firm_id from public.firm_members m
  where m.user_id = (select auth.uid()) and public.member_role(m.firm_id) in ('owner', 'partner', 'front_desk')
$$;
revoke all on function public.lead_firms() from public, anon;
grant execute on function public.lead_firms() to authenticated;

drop policy if exists clients_select on public.clients;
create policy clients_select on public.clients for select to authenticated
  using (stage = 'client' and (firm_id in (select public.open_firms()) or id in (select public.assigned_clients()))
    or stage <> 'client' and firm_id in (select public.lead_firms()));
-- An email offered as a possible lead (reason 'enquiry') shows only to those who work leads.
drop policy if exists email_events_select on public.email_events;
create policy email_events_select on public.email_events for select to authenticated
  using (firm_id in (select public.my_firms()) and (client_id is null or firm_id in (select public.open_firms()) or client_id in (select public.assigned_clients()))
    and (reason_code is distinct from 'enquiry' or firm_id in (select public.lead_firms())));

-- The general change log stands aside while a function that writes its own plainer line runs.
create or replace function public.log_change() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  row jsonb := coalesce(to_jsonb(new), to_jsonb(old));
begin
  -- Deleting a whole firm removes everything in it; that is not a change to log.
  if current_setting('app.logged', true) = 'on' or not exists (select 1 from public.firms where id = (row ->> 'firm_id')::uuid) then
    return null;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values ((row ->> 'firm_id')::uuid, (select auth.uid()),
    tg_argv[0] || case tg_op when 'INSERT' then '.added' when 'DELETE' then '.removed' else '.changed' end,
    coalesce(tg_argv[2], 'client'), (row ->> tg_argv[1])::uuid,
    case when tg_op = 'UPDATE' then jsonb_build_object('changed',
      (select jsonb_agg(key) from jsonb_each(to_jsonb(new)) n where n.value is distinct from to_jsonb(old) -> n.key))
    else jsonb_strip_nulls(jsonb_build_object('kind', row ->> 'kind')) end);
  return null;
end;
$$;

-- A new lead and its line: where it came from (form, email, staff) and, for the form, the
-- sender's keyed address hash for the rate limit. The app encrypted its fields for this id;
-- an empty one is none.
create or replace function private.put_lead(target_firm uuid, lead uuid, actor uuid, lead_name text, lead_kind text, lead_email_enc text, lead_email_bidx text, lead_details jsonb, lead_notes_enc text, source text, ip text)
returns void
language plpgsql security definer set search_path = '' as $$
begin
  perform set_config('app.logged', 'on', true);
  insert into public.clients (id, firm_id, name, kind, stage, email_enc, email_bidx, details, notes_enc)
  values (lead, target_firm, lead_name, lead_kind, 'lead_new', nullif(lead_email_enc, ''), nullif(lead_email_bidx, ''), coalesce(lead_details, '{}'), nullif(lead_notes_enc, ''));
  perform set_config('app.logged', 'off', true);
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values (target_firm, actor, 'lead.added', 'client', lead, jsonb_strip_nulls(jsonb_build_object('source', source, 'ip', ip)));
end;
$$;
revoke all on function private.put_lead(uuid, uuid, uuid, text, text, text, text, jsonb, text, text, text) from public, anon, authenticated, service_role;

-- The public enquiry form, for the server alone, after it checked the form's key and limits.
create or replace function public.add_form_lead(target_firm uuid, lead uuid, lead_name text, lead_kind text, lead_email_enc text, lead_email_bidx text, lead_details jsonb, lead_notes_enc text, ip text)
returns void
language sql security definer set search_path = '' as $$
  select private.put_lead(target_firm, lead, null, lead_name, lead_kind, lead_email_enc, lead_email_bidx, lead_details, lead_notes_enc, 'form', ip)
$$;
revoke all on function public.add_form_lead(uuid, uuid, text, text, text, text, jsonb, text, text) from public, anon, authenticated;
grant execute on function public.add_form_lead(uuid, uuid, text, text, text, text, jsonb, text, text) to service_role;

-- A lead added by hand, or from an email offered as one, which is then used up.
create or replace function public.add_lead(target_firm uuid, lead uuid, lead_name text, lead_kind text, lead_email_enc text, lead_email_bidx text, lead_details jsonb, lead_notes_enc text, enquiry uuid default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'front_desk') then
    return false;
  end if;
  if enquiry is not null then
    delete from public.email_events where id = enquiry and firm_id = target_firm and reason_code = 'enquiry';
    if not found then
      return false;
    end if;
  end if;
  perform private.put_lead(target_firm, lead, (select auth.uid()), lead_name, lead_kind, lead_email_enc, lead_email_bidx, lead_details, lead_notes_enc, case when enquiry is null then 'staff' else 'email' end, null);
  return true;
end;
$$;

-- Not a lead: the offered email is forgotten (it stays in the mailbox), and that is logged.
create or replace function public.dismiss_enquiry(target_firm uuid, enquiry uuid)
returns boolean
language plpgsql security definer set search_path = '' as $$
begin
  if coalesce(public.member_role(target_firm), '') not in ('owner', 'partner', 'front_desk') then
    return false;
  end if;
  delete from public.email_events where id = enquiry and firm_id = target_firm and reason_code = 'enquiry';
  if not found then
    return false;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id)
  values (target_firm, (select auth.uid()), 'enquiry.dismissed', 'email', enquiry);
  return true;
end;
$$;

-- One change to a lead and its line: move (to New, Qualifying, Proposal or Cold), lost (with
-- its reason's code), won (it becomes a client: the owner or a partner, who add clients),
-- follow_up (the day to follow up, or none), followed_up (an email went; the next day, or
-- none) and notes (encrypted by the app, or none).
create or replace function public.change_lead(target_firm uuid, lead uuid, change text, val text default null)
returns boolean
language plpgsql security definer set search_path = '' as $$
declare
  my_role text := coalesce(public.member_role(target_firm), '');
  stage_now text;
  on_day text := case when val ~ '^20\d\d-\d\d-\d\d$' then val end;
begin
  if my_role not in ('owner', 'partner', 'front_desk') or (change = 'won' and my_role = 'front_desk') then
    return false;
  end if;
  select c.stage into stage_now from public.clients c where c.id = lead and c.firm_id = target_firm and c.stage <> 'client' for update;
  if stage_now is null
    or change = 'move' and (val is null or val not in ('lead_new', 'qualifying', 'proposal', 'cold') or val = stage_now)
    or change = 'lost' and (val is null or val !~ '^[a-z_]{1,24}$')
    or change in ('follow_up', 'followed_up') and val is not null and on_day is null
    or change not in ('move', 'lost', 'won', 'follow_up', 'followed_up', 'notes') then
    return false;
  end if;
  perform set_config('app.logged', 'on', true);
  update public.clients c set
    stage = case change when 'move' then val when 'lost' then 'lost' when 'won' then 'client' else c.stage end,
    details = case change
      when 'move' then c.details - 'lost_reason'
      when 'lost' then c.details - 'follow_up_on' || jsonb_build_object('lost_reason', val)
      when 'won' then c.details - 'follow_up_on' - 'lost_reason'
      when 'notes' then c.details
      else case when on_day is null then c.details - 'follow_up_on' else c.details || jsonb_build_object('follow_up_on', on_day) end
    end,
    notes_enc = case when change = 'notes' then nullif(val, '') else c.notes_enc end
  where c.id = lead and c.firm_id = target_firm;
  perform set_config('app.logged', 'off', true);
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values (target_firm, (select auth.uid()),
    'lead.' || case change when 'move' then 'moved' when 'lost' then 'lost' when 'won' then 'won' when 'follow_up' then 'follow_up_set' when 'followed_up' then 'followed_up' else 'noted' end,
    'client', lead,
    case change when 'move' then jsonb_build_object('stage', val) when 'lost' then jsonb_build_object('reason', val)
      when 'follow_up' then jsonb_strip_nulls(jsonb_build_object('on', on_day)) when 'followed_up' then jsonb_strip_nulls(jsonb_build_object('next', on_day)) else '{}' end);
  return true;
end;
$$;

-- The leads won in the last 30 days, newest first, for the board's Won column.
create or replace function public.won_leads(target_firm uuid)
returns table (id uuid, name text, at timestamptz)
language sql stable security definer set search_path = '' as $$
  select c.id, c.name, l.at from public.activity_log l
  join public.clients c on c.id = l.entity_id and c.firm_id = l.firm_id
  where l.firm_id = target_firm and l.action = 'lead.won' and l.at > now() - interval '30 days'
    and target_firm in (select public.lead_firms())
  order by l.at desc
  limit 20
$$;

revoke all on function public.add_lead(uuid, uuid, text, text, text, text, jsonb, text, uuid), public.dismiss_enquiry(uuid, uuid), public.change_lead(uuid, uuid, text, text), public.won_leads(uuid) from public, anon, authenticated, service_role;
grant execute on function public.add_lead(uuid, uuid, text, text, text, text, jsonb, text, uuid), public.dismiss_enquiry(uuid, uuid), public.change_lead(uuid, uuid, text, text), public.won_leads(uuid) to authenticated;
