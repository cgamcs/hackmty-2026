-- Resolve the caller's tenant from their session under RLS.
--
-- THE BUG: every authenticated endpoint answered 401 right after a successful login.
-- `current_tenant_id()` in main.py runs `sessions join tenants` to DISCOVER the tenant, but
-- at that point app.tenant_id is not set yet, so `tenants_own` hides every row. Measured as
-- app_api: 1 live session, 0 rows from the join.
--
-- Same chicken-and-egg as registration (005/006): you must already be the tenant to read it.
--
-- THE FIX: a second, SELECT-only policy that exposes a tenant to whoever presents a live
-- session token belonging to its owner. The API sets app.session_token (transaction scoped)
-- from the httpOnly cookie. Permissive policies OR together, so tenants_own is unchanged, and
-- nothing is writable through this path.

drop policy if exists tenants_by_session on tenants;
create policy tenants_by_session on tenants for select
  using (owner_id = (
    select s.user_id from sessions s
    where s.token = current_setting('app.session_token', true)
      and s.expires_at > now()
  ));
