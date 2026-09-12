-- Registration, second attempt — and a correction.
--
-- 005 assumed `tsdbadmin` is a superuser, so a SECURITY DEFINER function owned by it
-- would bypass RLS. On Tiger Cloud it is not:
--
--     tsdbadmin   superuser=false   bypassrls=false
--     tenants     owner=tsdbadmin   FORCE ROW LEVEL SECURITY=true
--
-- It owns the tables, and FORCE makes the owner subject to its own policies, so the
-- insert failed inside the function exactly as it did outside:
--
--     new row violates row-level security policy for table "tenants"
--
-- (The FORCE in 003 was still necessary and still correct: without it a table owner
-- bypasses RLS, which is what made the policies inert. The reason was ownership, not
-- superuser status.)
--
-- THE ACTUAL FIX, which needs no privilege at all: generate the tenant id first, declare
-- it as the session tenant, then insert. `with check (id = current_tenant())` is then
-- satisfied, and so is the SELECT policy that INSERT ... RETURNING has to pass.
--
-- So SECURITY DEFINER is dropped. There is now no privileged entry point anywhere in the
-- schema — a smaller attack surface than 005 proposed, arrived at by working with the
-- policy instead of around it.

drop function if exists register_tenant(text, text, text);

create or replace function register_tenant(
  p_email         text,
  p_password_hash text,
  p_razon_social  text
) returns table (user_id uuid, tenant_id uuid)
language plpgsql
security invoker                      -- runs as app_api; no elevated rights needed
set search_path = public
as $fn$
declare
  v_user_id   uuid;
  v_tenant_id uuid := gen_random_uuid();
begin
  if p_email is null or btrim(p_email) = '' then
    raise exception 'email required' using errcode = 'invalid_parameter_value';
  end if;
  -- The column name `password_hash` does not enforce hashing; this does. An endpoint that
  -- forgets to hash fails loudly instead of storing a plaintext password.
  if p_password_hash is null or p_password_hash not like '$argon2%' then
    raise exception 'password must be argon2-hashed'
      using errcode = 'invalid_parameter_value';
  end if;

  insert into users (email, password_hash)
  values (lower(btrim(p_email)), p_password_hash)
  returning id into v_user_id;

  -- Become the tenant we are about to create, so RLS has something to match. Transaction
  -- scoped, so it cannot outlive this request on a pooled connection.
  perform set_config('app.tenant_id', v_tenant_id::text, true);

  insert into tenants (id, owner_id, razon_social)
  values (v_tenant_id, v_user_id,
          coalesce(nullif(btrim(p_razon_social), ''), lower(btrim(p_email))));

  return query select v_user_id, v_tenant_id;
end $fn$;

revoke all on function register_tenant(text, text, text) from public;
grant execute on function register_tenant(text, text, text) to app_api;

comment on function register_tenant(text, text, text) is
  'Bootstrap a user and their tenant. SECURITY INVOKER: it pre-generates the tenant id '
  'and sets app.tenant_id so RLS is satisfied without any privilege escalation.';
