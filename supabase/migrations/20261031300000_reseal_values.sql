-- After a key rotation (scripts/rotate-keys.mts), scripts/reseal-values.mts seals each older
-- value again with the firm's newest key (PLAN.md 8.4). sealed_key reads which of the firm's
-- keys sealed a value: its second byte, or null for anything that is not a sealed value.
-- swap_sealed swaps sealed values inside a jsonb document for their new sealing; JSON text
-- holds them as they are, since base64url needs no escaping.
create or replace function private.sealed_key(value text) returns int
language sql immutable set search_path = '' as $$
  select case when value ~ '^[A-Za-z0-9_-]{4}' then (
    select case when get_byte(b, 0) = 1 then get_byte(b, 1) end
    from decode(translate(substr(value, 1, 4), '-_', '+/'), 'base64') b
  ) end
$$;
revoke all on function private.sealed_key(text) from public, anon, authenticated, service_role;

create or replace function private.swap_sealed(doc jsonb, olds text[], news text[]) returns jsonb
language plpgsql immutable set search_path = '' as $$
declare
  body text := doc::text;
begin
  for i in 1 .. coalesce(array_length(olds, 1), 0) loop
    body := replace(body, '"' || olds[i] || '"', '"' || news[i] || '"');
  end loop;
  return body::jsonb;
end;
$$;
revoke all on function private.swap_sealed(jsonb, text[], text[]) from public, anon, authenticated, service_role;

-- The log stays append only. The one change allowed: a sealed value in a line's details
-- swapped for one sealed with a newer key of the firm, with nothing else in the line changed.
create or replace function public.activity_log_guard() returns trigger
language plpgsql set search_path = '' as $$
declare
  sealed constant text[] := array['text_enc', 'before', 'after', 'reason_enc'];
begin
  if tg_op = 'DELETE' and current_setting('app.log_purge', true) = 'on' then
    return old;
  end if;
  if tg_op = 'UPDATE'
    and (new.firm_id, new.actor_id, new.action, new.entity_type, new.entity_id, new.at)
      is not distinct from (old.firm_id, old.actor_id, old.action, old.entity_type, old.entity_id, old.at)
    and new.details - sealed = old.details - sealed
    and not exists (
      select 1 from unnest(sealed) k
      where new.details -> k is distinct from old.details -> k
        and coalesce(private.sealed_key(new.details ->> k) > private.sealed_key(old.details ->> k), false) is false
    ) then
    return new;
  end if;
  raise exception 'activity_log is append only' using errcode = '42501';
end;
$$;
