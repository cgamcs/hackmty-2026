-- One obligation per Nessie bill per company.
--
-- THE BUG: sync_obligations inserted with `on conflict do nothing`, but obligations had no
-- unique key on the bill, only a random id. Nothing ever conflicted, so every "Sincronizar
-- ahora" added another copy of each recurring bill. The forecast then subtracted payroll and
-- rent twice and reported shortfalls that do not exist. Proven as app_api in a rolled-back
-- transaction: the same bill synced twice left 2 rows.
--
-- THE FIX: remove existing copies, then make (tenant_id, bill_id) unique. The sync now
-- upserts on that key: it refreshes payee, amount and day, and keeps the rigidity and slack
-- the owner confirmed. bill_id stays nullable, and obligations without a Nessie bill are
-- unaffected because NULLs never collide.
--
-- The cleanup must see every tenant's rows, but FORCE RLS hides them even from the owner
-- (003). So FORCE is lifted on obligations and on audit_log (the delete fires the audit
-- trigger) inside ONE transaction and restored before COMMIT. If any statement fails, the
-- whole transaction rolls back and FORCE is never left off.

begin;

alter table obligations no force row level security;
alter table audit_log   no force row level security;

-- Keep the copy the owner edited (source = 'user'); otherwise keep the oldest.
delete from obligations o
using (
  select id,
         row_number() over (
           partition by tenant_id, bill_id
           order by (source = 'user') desc, created_at, id
         ) as copy
  from obligations
  where bill_id is not null
) ranked
where o.id = ranked.id
  and ranked.copy > 1;

alter table obligations drop constraint if exists obligations_tenant_bill_key;
alter table obligations add constraint obligations_tenant_bill_key unique (tenant_id, bill_id);

alter table obligations force row level security;
alter table audit_log   force row level security;

commit;
