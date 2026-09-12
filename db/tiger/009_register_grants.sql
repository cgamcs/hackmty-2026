-- Restore INSERT on users and tenants for app_api.
--
-- THE BUG: registration failed with
--
--     permission denied for table users
--     PL/pgSQL function register_tenant(text,text,text) line 16
--
-- 003 grants `select, insert` on users and `select, insert, update, delete` on tenants, but
-- the live ACLs had lost INSERT on both (users: SELECT only; tenants: SELECT, UPDATE,
-- DELETE). No file in this repo revokes them and the database kept no record of who did.
-- Every other table matches 003. Superseded by 010, which restates the full grant set.
--
-- Since 006, register_tenant is SECURITY INVOKER and runs as app_api, so app_api itself
-- needs INSERT on both tables. Tenants stay protected: tenants_own's WITH CHECK only admits
-- the tenant the function has just put in scope.

grant insert on users   to app_api;
grant insert on tenants to app_api;
