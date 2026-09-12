-- Security hardening.
--
-- THE CRITICAL FIX IS THE FIRST BLOCK. Every policy written in 001_schema.sql is
-- currently inert.
--
-- PostgreSQL does not apply row level security to a table's OWNER, and never applies it
-- to a superuser. Tiger Cloud hands you `tsdbadmin`, which is a superuser and which owns
-- everything created with it — so the schema was created by, and the API connects as, a
-- role that RLS does not constrain. The policies exist, they validate, and they filter
-- nothing. There is no error and no warning: cross-tenant reads simply succeed.
--
-- Two changes are needed, and neither alone is enough:
--   1. FORCE ROW LEVEL SECURITY, so the owner is subject to its own policies.
--   2. A non-superuser application role, so the API is not a superuser in the first
--      place (FORCE still does not constrain a superuser).

-- ── 1. make RLS actually apply ───────────────────────────────────────────────
alter table tenants       force row level security;
alter table invoices      force row level security;
alter table cash_flows    force row level security;
alter table forecast_runs force row level security;
alter table obligations   force row level security;
alter table terms         force row level security;
alter table suppressions  force row level security;

-- Note for maintenance: with FORCE on, even tsdbadmin must set the tenant before
-- touching rows —  select set_config('app.tenant_id', '<uuid>', true);
-- DDL is unaffected. To run a genuine cross-tenant admin task, disable deliberately:
--   alter table <t> no force row level security;  -- and put it back.

-- ── 2. least-privilege application role ──────────────────────────────────────
-- Set a real password before running, and put THIS role in DATABASE_URL — not tsdbadmin.
do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'app_api') then
    create role app_api login password 'CHANGE_ME_BEFORE_RUNNING'
      nosuperuser nocreatedb nocreaterole noinherit nobypassrls;
  end if;
end $$;

grant usage on schema public to app_api;

grant select, insert, update, delete on
  tenants, invoices, cash_flows, forecast_runs, obligations, terms, suppressions
  to app_api;

grant select, insert on users to app_api;   -- registration and login; no deletes
grant select on daily_flows to app_api;

-- cash_flows_daily is the raw continuous aggregate and does NOT honour RLS, because it
-- is materialised by a background worker. Only the daily_flows wrapper is reachable.
revoke all on cash_flows_daily from app_api, public;

-- Nothing future-granted by accident.
alter default privileges in schema public revoke all on tables from public;

-- ── 3. audit log ─────────────────────────────────────────────────────────────
-- Writes are captured by trigger. Reads cannot be: PostgreSQL has no SELECT trigger, so
-- read access is logged by the API layer instead. Saying so explicitly is better than
-- implying the table is a complete access record.
create table if not exists audit_log (
  id          bigserial,
  at          timestamptz not null default now(),
  tenant_id   uuid,
  db_role     text not null default current_user,
  action      text not null,
  table_name  text,
  row_key     text,
  detail      jsonb,
  primary key (id, at)
);

select create_hypertable('audit_log', 'at', if_not_exists => true);
create index if not exists audit_log_tenant_idx on audit_log (tenant_id, at desc);

create or replace function audit_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  key text;
  tid uuid;
begin
  if tg_op = 'DELETE' then
    tid := old.tenant_id;
    key := coalesce(old.uuid::text, old.id::text, '');
  else
    tid := new.tenant_id;
    key := coalesce(new.uuid::text, new.id::text, '');
  end if;
  insert into audit_log (tenant_id, action, table_name, row_key)
  values (tid, tg_op, tg_table_name, key);
  return null;
end $$;

do $$
declare t text;
begin
  foreach t in array array['invoices','obligations','suppressions','terms']
  loop
    execute format('drop trigger if exists %I on %I', 'audit_' || t, t);
    execute format(
      'create trigger %I after insert or update or delete on %I '
      'for each row execute function audit_write()', 'audit_' || t, t);
  end loop;
end $$;

-- Append-only from the application's point of view: it may write entries and read its
-- own, but never edit or erase them.
alter table audit_log enable row level security;
alter table audit_log force row level security;
drop policy if exists audit_log_own on audit_log;
create policy audit_log_own on audit_log for select
  using (tenant_id = current_tenant());
grant select, insert on audit_log to app_api;
grant usage, select on sequence audit_log_id_seq to app_api;

-- ── 4. encrypted CFDI storage ────────────────────────────────────────────────
-- The raw XML moves to a ciphertext column. Encryption happens in the API with a key the
-- database never receives, so this protects against database-level exposure — a leaked
-- backup, a misconfigured replica, anyone with direct database access — and NOT against
-- a compromise of the API itself, which holds the key. Naming the threat it does not
-- cover is the difference between a control and security theatre.
--
-- The XML is never filtered or joined on, so losing queryability costs nothing. The
-- parsed fields stay in plain columns precisely because those are what we query.
alter table invoices add column if not exists xml_enc bytea;
alter table invoices drop column if exists xml;

comment on column invoices.xml_enc is
  'AES-256-GCM ciphertext of the original CFDI XML: 12-byte nonce || ciphertext || tag. '
  'Key held by the API (CFDI_ENC_KEY), never sent to the database. See backend/crypto.py.';
