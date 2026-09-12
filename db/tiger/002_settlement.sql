-- Persist the reconciliation verdict on the invoice itself.
--
-- Without this, every snapshot build would have to re-run reconcile() against Nessie to
-- learn which invoices are still open. The sync already pulls those flows, so it matches
-- once and records the answer here; snapshot building then becomes a pure database read.

alter table invoices add column if not exists settled_at      date;
alter table invoices add column if not exists settled_flow_id text;
alter table invoices add column if not exists match_method    text;

alter table invoices drop constraint if exists invoices_match_method_check;
alter table invoices add constraint invoices_match_method_check
  check (match_method is null or match_method in ('reference','fuzzy'));

-- Settled means all three are known, or none are. A partial settlement record would let
-- an invoice count as both collected and outstanding.
alter table invoices drop constraint if exists invoices_settlement_complete;
alter table invoices add constraint invoices_settlement_complete
  check (num_nulls(settled_at, settled_flow_id, match_method) in (0, 3));

-- Open receivables are the hot query: every forecast run reads them.
drop index if exists invoices_open_receivables_idx;
create index if not exists invoices_open_receivables_idx
  on invoices (tenant_id, due_date)
  where direction = 'issued' and metodo_pago = 'PPD' and settled_at is null;
