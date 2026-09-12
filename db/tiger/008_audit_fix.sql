-- Fix the audit trigger, which made every audited write fail.
--
-- BUG 1: audit_write() read `new.uuid` and `new.id`. PL/pgSQL resolves a record field when
-- the expression runs and fails if the table lacks it; coalesce does not short-circuit that.
-- invoices has only `uuid`, obligations/suppressions only `id`, and terms neither (its key
-- is tenant_id + counterparty_rfc). Every insert, update and delete on all four raised:
--
--     record "new" has no field "id"
--
-- BUG 2: audit_log is FORCE ROW LEVEL SECURITY with only a SELECT policy, so RLS refuses
-- every insert, the trigger's included: the SECURITY DEFINER owner (tsdbadmin) does not
-- bypass RLS on Tiger Cloud (see 006). Measured as app_api:
--
--     new row violates row-level security policy for table "audit_log"
--
-- FIX: read the row through to_jsonb, where a missing key is just NULL, and allow inserts
-- for the tenant in scope only. There is still no UPDATE or DELETE policy, so the log stays
-- append-only.

create or replace function audit_write() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  r jsonb;
begin
  if tg_op = 'DELETE' then r := to_jsonb(old); else r := to_jsonb(new); end if;
  insert into audit_log (tenant_id, action, table_name, row_key)
  values ((r->>'tenant_id')::uuid, tg_op, tg_table_name,
          coalesce(r->>'uuid', r->>'id', r->>'counterparty_rfc', ''));
  return null;
end $$;

-- ponytail: a write with no tenant in scope (e.g. a cascade from deleting a tenant outside
-- tenant_tx) is refused here too; set app.tenant_id for that path if it is ever needed.
drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log for insert
  with check (tenant_id = current_tenant());
