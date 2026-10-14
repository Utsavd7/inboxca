-- M0 step 2: the tenancy core. Firms, their groups and members, and the activity log.
-- PLAN.md section 6 (D34: minimal by design) and section 8.5 (who can see what).
-- Every tenant table carries firm_id, is locked to its firm by row level security,
-- and links inside the firm with composite foreign keys (firm_id, id).
-- No updated_at, created_at only where a rule needs it: when something changed, and
-- who changed it, is in activity_log and nowhere else.

-- Firms. Created by the server at sign up (status pending); the first payment makes it
-- active, and an unpaid pending firm is removed after 7 days (hence created_at).
-- A GSTIN starts with the state code, so the state is stored only for a firm without one.
create table public.firms (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(name) between 1 and 200),
  gstin text unique check (gstin ~ '^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$'),
  state_code text check (state_code ~ '^[0-9]{2}$'),
  status text not null default 'pending'
    check (status in ('pending', 'active', 'grace', 'read_only', 'suspended', 'closed')),
  settings jsonb not null default '{}',
  created_at timestamptz not null default now(),
  check ((gstin is null) <> (state_code is null))
);

-- The firm's state, read from the GSTIN when there is one.
create function public.firm_state(f public.firms) returns text
language sql immutable set search_path = '' as $$
  select coalesce(left(f.gstin, 2), f.state_code)
$$;

-- Branches, teams and client groups are one table; a kind is a column (D34).
create table public.groups (
  id uuid primary key default gen_random_uuid(),
  firm_id uuid not null references public.firms (id) on delete cascade,
  kind text not null check (kind in ('branch', 'team', 'client_group')),
  name text not null check (length(name) between 1 and 120),
  settings jsonb not null default '{}',
  unique (firm_id, id)
);

-- The people of a firm, one row per person per firm; the owner is a member too.
-- A person in a firm is (firm_id, user_id); there is no separate id.
create table public.firm_members (
  firm_id uuid not null references public.firms (id) on delete cascade,
  user_id uuid not null references auth.users (id) on delete cascade,
  role text not null check (role in ('owner', 'partner', 'manager', 'staff', 'front_desk')),
  branch_id uuid,
  team_id uuid,
  status text not null default 'invited' check (status in ('invited', 'active', 'deactivated')),
  access jsonb,
  primary key (firm_id, user_id),
  foreign key (firm_id, branch_id) references public.groups (firm_id, id),
  foreign key (firm_id, team_id) references public.groups (firm_id, id)
);
-- "Which firms is this person in", read at every sign in.
create index firm_members_user on public.firm_members (user_id);

-- The signed in person's role in a firm, or null. Security definer so that policies
-- can call it without recursing into firm_members' own policies. One primary key lookup.
create function public.member_role(target_firm uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.firm_members m
  where m.firm_id = target_firm and m.user_id = (select auth.uid()) and m.status = 'active'
$$;

-- Activity log: who did what and when (D18). Append only, so rows need no id.
-- Partitioned by month so that whole months can be dropped after the firm's retention
-- period (a later step) instead of deleting row by row.
create table public.activity_log (
  firm_id uuid not null references public.firms (id) on delete cascade,
  actor_id uuid,
  action text not null check (length(action) between 1 and 80),
  entity_type text,
  entity_id uuid,
  at timestamptz not null default now(),
  details jsonb not null default '{}'
) partition by range (at);
create table public.activity_log_default partition of public.activity_log default;
create index activity_log_firm_at on public.activity_log (firm_id, at desc);

-- Nobody edits the log, and nobody deletes from it except the firm deletion and the
-- retention purge, which set app.log_purge for their own transaction only.
create function public.activity_log_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and current_setting('app.log_purge', true) = 'on' then
    return old;
  end if;
  raise exception 'activity_log is append only' using errcode = '42501';
end;
$$;
create trigger activity_log_no_update before update on public.activity_log
  for each row execute function public.activity_log_guard();
create trigger activity_log_no_delete before delete on public.activity_log
  for each row execute function public.activity_log_guard();
create trigger activity_log_no_truncate before truncate on public.activity_log
  for each statement execute function public.activity_log_guard();

-- Row level security on every table.
alter table public.firms enable row level security;
alter table public.groups enable row level security;
alter table public.firm_members enable row level security;
alter table public.activity_log enable row level security;

-- Grants: nothing for visitors who are not signed in; signed in people get only what the
-- policies below can allow. A firm's status and GSTIN change only on the server.
revoke all on public.firms, public.groups, public.firm_members, public.activity_log,
  public.activity_log_default from anon, authenticated;
revoke update, delete, truncate on public.activity_log, public.activity_log_default from service_role;

grant select on public.firms to authenticated;
grant update (name, settings) on public.firms to authenticated;
grant select, insert, update, delete on public.groups to authenticated;
grant select on public.firm_members to authenticated;
grant insert (firm_id, user_id, role, branch_id, team_id, access) on public.firm_members to authenticated;
grant update (role, branch_id, team_id, status, access) on public.firm_members to authenticated;
grant select on public.activity_log to authenticated;

-- Firms: members see their own firm; only the owner changes its name and settings.
create policy firms_select on public.firms for select to authenticated
  using (public.member_role(id) is not null);
create policy firms_update on public.firms for update to authenticated
  using (public.member_role(id) = 'owner')
  with check (public.member_role(id) = 'owner');

-- Groups: members see them; only the owner makes or changes them.
create policy groups_select on public.groups for select to authenticated
  using (public.member_role(firm_id) is not null);
create policy groups_insert on public.groups for insert to authenticated
  with check (public.member_role(firm_id) = 'owner');
create policy groups_update on public.groups for update to authenticated
  using (public.member_role(firm_id) = 'owner')
  with check (public.member_role(firm_id) = 'owner');
create policy groups_delete on public.groups for delete to authenticated
  using (public.member_role(firm_id) = 'owner');

-- Members: everyone in a firm sees its people. Only the owner invites and changes people,
-- never makes another owner this way, and never changes their own row, so the owner can
-- not lock themselves out and nobody raises their own role.
create policy members_select on public.firm_members for select to authenticated
  using (public.member_role(firm_id) is not null);
create policy members_insert on public.firm_members for insert to authenticated
  with check (public.member_role(firm_id) = 'owner' and role <> 'owner');
create policy members_update on public.firm_members for update to authenticated
  using (public.member_role(firm_id) = 'owner' and user_id <> (select auth.uid()))
  with check (
    public.member_role(firm_id) = 'owner' and user_id <> (select auth.uid()) and role <> 'owner'
  );

-- Activity log: the owner reads the firm's log. Rows are written by the server only.
create policy activity_select on public.activity_log for select to authenticated
  using (public.member_role(firm_id) = 'owner');
