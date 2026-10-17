-- M4 step 1: the firm's drive (PLAN.md 5.5.1, D36). A drive is a connected account like
-- the mailbox. Connecting it records the owner's consent (the access level and the version
-- of the Drive access terms they agreed to) in the activity log, in the same statement.
-- "local" is a test drive on the developer's computer, offered only where the server has
-- one (DRIVE_LOCAL_DIR); OneDrive and Dropbox follow once InboxCA's apps are registered.

alter table public.connected_accounts drop constraint connected_accounts_kind_check,
  add constraint connected_accounts_kind_check check (kind in ('mail', 'drive')),
  drop constraint connected_accounts_provider_check,
  add constraint connected_accounts_provider_check check (provider in ('imap', 'local', 'onedrive', 'dropbox'));
-- The drive is connected only through connect_drive, with its consent.
drop policy accounts_insert on public.connected_accounts;
create policy accounts_insert on public.connected_accounts for insert to authenticated
  with check (public.member_role(firm_id) = 'owner' and kind = 'mail');

create function public.connect_drive(target_firm uuid, account uuid, drive_provider text, address text, credentials text, drive_settings jsonb, level text, terms_version text)
returns boolean language plpgsql security definer set search_path = '' as $$
begin
  if public.member_role(target_firm) is distinct from 'owner' or level not in ('own_folder', 'whole_drive') then
    return false;
  end if;
  insert into public.connected_accounts (id, firm_id, kind, provider, address_enc, credentials_enc, settings)
  values (account, target_firm, 'drive', drive_provider, address, credentials, drive_settings || jsonb_build_object('level', level))
  on conflict (firm_id, kind) do nothing;
  if not found then
    return false;
  end if;
  insert into public.activity_log (firm_id, actor_id, action, entity_type, entity_id, details)
  values (target_firm, (select auth.uid()), 'drive.consent', 'account', account,
    jsonb_build_object('provider', drive_provider, 'level', level, 'terms_version', terms_version));
  return true;
end;
$$;
revoke all on function public.connect_drive(uuid, uuid, text, text, text, jsonb, text, text) from public, anon, service_role;
grant execute on function public.connect_drive(uuid, uuid, text, text, text, jsonb, text, text) to authenticated;
