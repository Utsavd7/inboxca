-- Papers from clients, end to end (PLAN.md 5.2, 5.3.1; user, 26 Oct 2026). InboxCA asks for a
-- return's papers itself and follows up; after two follow ups with nothing back, whoever looks
-- after the client is asked to call; when every paper is in, they are told to check the
-- figures. Rules on InboxCA's own records only.

-- Whether this person looks after a client: the owner and partners every client; anyone else
-- the clients assigned to them or their team, and a manager also those assigned to the people
-- of their team. The row rules still apply (security invoker).
create or replace function public.looks_after(target_firm uuid, client uuid) returns boolean
language sql stable set search_path = '' as $$
  select coalesce(public.member_role(target_firm) in ('owner', 'partner'), false)
    or exists (
      select 1 from public.client_assignments a
      join public.firm_members m on m.firm_id = a.firm_id and m.user_id = (select auth.uid())
      where a.firm_id = target_firm and a.client_id = client and public.member_role(target_firm) is not null
        and (a.user_id = m.user_id or a.team_id = m.team_id
             or m.role = 'manager' and a.user_id in (select t.user_id from public.firm_members t where t.firm_id = target_firm and t.team_id = m.team_id)))
$$;
revoke all on function public.looks_after(uuid, uuid) from public, anon;
grant execute on function public.looks_after(uuid, uuid) to authenticated;

-- Today's paper items for this person, on the clients they look after. call: a request
-- followed up twice or more with nothing back, that nobody chased (by phone, or by a reminder
-- sent by hand) since the last follow up. papers_in: a request whose every paper arrived,
-- until someone opens the figures. id and details are the request's own.
create or replace function public.paper_items(target_firm uuid)
returns table (id uuid, kind text, client_id uuid, client_name text, details jsonb)
language sql stable set search_path = '' as $$
  select r.id, case when a.id is null then 'call' else 'papers_in' end, r.client_id, c.name, r.details
  from public.requests r
  join public.clients c on c.id = r.client_id and c.archived_at is null
  left join public.requests a on a.firm_id = r.firm_id and a.kind = 'alert' and a.entity_type = 'papers_in' and a.entity_id = r.id and a.status = 'pending'
  where r.firm_id = target_firm and r.kind = 'documents'
    and (r.status = 'done' and a.id is not null
      or r.status = 'pending' and r.expires_at > now() and jsonb_array_length(coalesce(r.details -> 'followups', '[]')) >= 2
        and coalesce(r.details ->> 'chased', '') < r.details -> 'followups' ->> -1)
    and public.looks_after(target_firm, r.client_id)
  limit 200
$$;
revoke all on function public.paper_items(uuid) from public, anon;
grant execute on function public.paper_items(uuid) to authenticated;

-- Every paper in: the request's papers_in item opens (or opens again); a paper asked for once
-- more closes it. The forms are prepared from here (PLAN.md 5.7).
create or replace function private.papers_in() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if new.status = 'done' then
    insert into public.requests (firm_id, kind, client_id, entity_type, entity_id, reason_code, status)
    values (new.firm_id, 'alert', new.client_id, 'papers_in', new.id, 'papers_in', 'pending')
    on conflict (kind, entity_type, entity_id) do update set status = 'pending';
  else
    update public.requests set status = 'done' where kind = 'alert' and entity_type = 'papers_in' and entity_id = new.id and status = 'pending';
  end if;
  return null;
end;
$$;
revoke all on function private.papers_in() from public, anon, authenticated;
drop trigger if exists requests_papers_in on public.requests;
create trigger requests_papers_in after update of status on public.requests
  for each row when (new.kind = 'documents' and new.status is distinct from old.status)
  execute function private.papers_in();
