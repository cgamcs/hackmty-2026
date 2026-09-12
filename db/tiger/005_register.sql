-- Fix registration under RLS.
--
-- THE BUG: `tenants_own` is `for all` with `check (id = current_tenant())`. During
-- registration no tenant exists yet, so current_tenant() is NULL, `id = NULL` is never
-- true, and the insert is refused:
--
--     InsufficientPrivilege: new row violates row-level security policy for "tenants"
--
-- A chicken-and-egg: the policy requires you to already be the tenant you are creating.
--
-- Loosening INSERT alone does not fix it either. `INSERT ... RETURNING` must also satisfy
-- the SELECT policy for the returned row, which fails for the same reason — so the API
-- could create a tenant but not learn its id.
--
-- THE FIX: one SECURITY DEFINER function that performs exactly this bootstrap and nothing
-- else. It is narrow on purpose:
--   * fixed body, no dynamic SQL, so no input can change what it executes
--   * search_path pinned, so it cannot be redirected to a shadowed table
--   * EXECUTE granted only to app_api, revoked from public
--   * `tenants.owner_id` is UNIQUE, so it cannot mint a second tenant for a user
--
-- Everything after registration stays under RLS. This is the only privileged entry point,
-- and it can only ever create one user plus that user's own tenant.

create or replace function register_tenant(
  p_email         text,
  p_password_hash text,
  p_razon_social  text
) returns table (user_id uuid, tenant_id uuid)
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_user_id   uuid;
  v_tenant_id uuid;
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email required' using errcode = 'invalid_parameter_value';
  end if;
  if p_password_hash is null or p_password_hash not like '$argon2%' then
    -- Refuse anything that is not an Argon2 hash. The column name does not enforce
    -- hashing; this does, so a plaintext password cannot be stored by mistake.
    raise exception 'password must be argon2-hashed'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into users (email, password_hash)
  values (lower(btrim(p_email)), p_password_hash)
  returning id into v_user_id;

  insert into tenants (owner_id, razon_social)
  values (v_user_id, coalesce(nullif(btrim(p_razon_social), ''), lower(btrim(p_email))))
  returning id into v_tenant_id;

  return query select v_user_id, v_tenant_id;
end $fn$;

revoke all on function register_tenant(text, text, text) from public;
grant execute on function register_tenant(text, text, text) to app_api;

comment on function register_tenant(text, text, text) is
  'Bootstrap a user and their tenant. SECURITY DEFINER because RLS on tenants cannot be '
  'satisfied before the tenant exists. Fixed body, pinned search_path, app_api only.';
