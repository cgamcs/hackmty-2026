-- Make the schema correct for more than one tenant, and restate app_api's privileges.
--
-- Every failure since the first account (007, 008, 009 and the one fixed here) had the same
-- shape: the schema had only ever run with ONE tenant, and a second one exposed an assumption
-- a single tenant never tests. After this migration run backend/check_tenants.py, which replays
-- all of them with two tenants inside a rolled-back transaction.

-- ── 1. invoices: the CFDI UUID is unique per tenant, not globally ────────────────────────
-- The same folio fiscal legitimately belongs to two tenants: the issuer's SAT download and
-- the receiver's both contain it. With `uuid` as a global primary key, the second tenant's
-- upload hit the first tenant's row in ON CONFLICT, and RLS refused to update a row that
-- tenant may not see:
--
--     new row violates row-level security policy (USING expression) for table "invoices"
--
-- The global key also let one tenant learn whether a UUID exists in another. Every other
-- tenant table already keys on tenant_id. invoices is not a hypertable, so the composite key
-- needs no time column, and no foreign key references invoices(uuid).
alter table invoices drop constraint if exists invoices_pkey;
alter table invoices add constraint invoices_pkey primary key (tenant_id, uuid);

-- A CFDI without a TimbreFiscalDigital has no UUID. Every such document collapsed onto the
-- same '' key and overwrote the previous one. The API skips them; the database now refuses
-- them too.
--
-- NOT VALID: existing rows are not re-checked, because under FORCE RLS a migration cannot see
-- them to clean up. To remove one, run as that tenant, in a transaction:
--   select set_config('app.tenant_id', '<tenant uuid>', true);
--   delete from invoices where btrim(uuid) = '';
-- then: alter table invoices validate constraint invoices_uuid_present;
alter table invoices drop constraint if exists invoices_uuid_present;
alter table invoices add constraint invoices_uuid_present check (btrim(uuid) <> '') not valid;

-- ── 2. app_api privileges, stated once ───────────────────────────────────────────────────
-- Registration failed because the live ACLs had lost INSERT on users and tenants. 003 has
-- always granted it, no file in this repo revokes it, and the database kept no record of who
-- did. GRANT is idempotent, so this block restates the API's whole contract: re-running it
-- repairs any drift. backend/check_tenants.py exercises every privilege listed here.
grant usage on schema public to app_api;

grant select, insert, update, delete on
  tenants, invoices, cash_flows, forecast_runs, obligations, terms, suppressions
  to app_api;

grant select, insert         on users     to app_api;   -- registration and login
grant select, insert, delete on sessions  to app_api;   -- login, lookup, logout
grant select, insert         on audit_log to app_api;   -- append-only
grant usage, select on sequence audit_log_id_seq to app_api;
grant select on daily_flows to app_api;
grant execute on function register_tenant(text, text, text) to app_api;

-- The raw continuous aggregate ignores RLS; only the daily_flows wrapper is reachable.
revoke all on cash_flows_daily from app_api, public;
