-- Server-side sessions.
--
-- Opaque random tokens rather than JWTs: there is no third party that needs to verify a
-- signature here, and a row can be revoked on logout or on suspicion. A JWT cannot be
-- withdrawn before it expires.
--
-- No RLS: this table is consulted to DISCOVER which tenant is calling, so a policy keyed
-- on the tenant would be circular. It is protected by never being exposed through an
-- endpoint and by the grants below — select and insert for the API, plus delete so
-- logout works, and nothing else.

create table if not exists sessions (
  token       text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

grant select, insert, delete on sessions to app_api;

-- Tenant discovery must cross the tenants RLS boundary before the request can set
-- app.tenant_id. Keep that one operation inside a narrow SECURITY DEFINER function;
-- granting SELECT on sessions alone is not enough because the join to tenants would
-- otherwise be filtered to zero rows.
create or replace function tenant_for_session(p_token text) returns uuid
language sql stable security definer set search_path = public as $$
  select t.id
  from sessions s
  join tenants t on t.owner_id = s.user_id
  where s.token = p_token and s.expires_at > now()
$$;

revoke all on function tenant_for_session(text) from public;
grant execute on function tenant_for_session(text) to app_api;

-- Registration happens before a tenant id exists, so the normal tenants RLS policy
-- cannot authorize that first insert. This is the only bootstrap path and accepts only
-- the three fields needed to create the user and its one tenant atomically.
create or replace function register_user_tenant(
  p_email text,
  p_password_hash text,
  p_razon_social text
) returns table(user_id uuid, tenant_id uuid)
language plpgsql security definer set search_path = public as $$
declare
  new_user_id uuid;
  new_tenant_id uuid;
begin
  insert into users (email, password_hash)
  values (p_email, p_password_hash)
  returning id into new_user_id;

  insert into tenants (owner_id, razon_social)
  values (new_user_id, p_razon_social)
  returning id into new_tenant_id;

  return query select new_user_id, new_tenant_id;
end
$$;

revoke all on function register_user_tenant(text, text, text) from public;
grant execute on function register_user_tenant(text, text, text) to app_api;

-- The API uses the bootstrap function instead of broad unscoped INSERT privileges.
revoke insert on users from app_api;
revoke insert on tenants from app_api;

-- Expired rows are useless and a token that lingers is a token that can leak. Sweep them
-- opportunistically; a scheduled job would be better in production.
create or replace function purge_expired_sessions() returns void
language sql as $$
  delete from sessions where expires_at < now()
$$;
