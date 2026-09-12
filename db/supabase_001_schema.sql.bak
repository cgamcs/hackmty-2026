-- SMB Working Capital Broker — Supabase schema
-- Paste into the Supabase SQL editor. Idempotent: safe to re-run.
--
-- Design notes that matter:
--   * invoices.uuid is the CFDI folio fiscal and carries a UNIQUE constraint. Without it
--     re-uploading the same SAT export double-counts the receivable book — and that
--     failure does not raise, it silently recommends collecting money that does not exist.
--   * Every table is tenant-scoped with RLS on. One SMB must never read another's rows.
--   * `terms` is a cache of what engine/terms.py derives, and `reconciliations` is a cache
--     of engine/reconcile.py. Both are recomputable and can be dropped if time runs out.

-- ── tenants ──────────────────────────────────────────────────────────────────
create table if not exists tenants (
  id                     uuid primary key default gen_random_uuid(),
  owner_id               uuid not null unique references auth.users(id) on delete cascade,
  razon_social           text not null,
  rfc                    text,                       -- derived from CFDI, user-confirmed
  account_id             text,                       -- Nessie account _id
  account_number_last4   text,                       -- display only; never store in full
  created_at             timestamptz not null default now()
);

-- ── invoices (parsed CFDI) ───────────────────────────────────────────────────
create table if not exists invoices (
  uuid               text primary key,               -- CFDI folio fiscal (TimbreFiscalDigital)
  tenant_id          uuid not null references tenants(id) on delete cascade,
  serie              text,
  folio              text,
  direction          text not null check (direction in ('issued','received')),
  tipo               text not null,                  -- I | E | T | N | P
  metodo_pago        text check (metodo_pago in ('PUE','PPD')),
  forma_pago         text,
  counterparty_rfc   text,
  counterparty_name  text,
  fecha              date not null,
  due_date           date,                           -- derived: CFDI carries no due date
  subtotal           numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,
  storage_path       text,                           -- cfdi/{tenant_id}/{uuid}.xml
  created_at         timestamptz not null default now()
);

create index if not exists invoices_tenant_fecha_idx
  on invoices (tenant_id, fecha desc);
create index if not exists invoices_open_receivables_idx
  on invoices (tenant_id, due_date)
  where direction = 'issued' and metodo_pago = 'PPD';

-- ── obligations (the hard-date form) ─────────────────────────────────────────
create table if not exists obligations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  bill_id       text,                                -- Nessie bill _id when detected
  payee         text not null,
  amount        numeric(14,2) not null,
  day_of_month  int not null check (day_of_month between 1 and 31),
  kind          text not null check (kind in
                  ('payroll','tax','rent','supplier','utility','other')),
  rigidity      text not null default 'hard' check (rigidity in ('hard','slack')),
  slack_days    int not null default 0 check (slack_days >= 0),
  source        text not null default 'detected' check (source in ('detected','user')),
  created_at    timestamptz not null default now()
);

-- Payroll and taxes are legally dated: the ladder must not be able to propose shifting
-- them even if a client edits the form. Enforced here rather than trusted to the UI.
alter table obligations drop constraint if exists obligations_hard_kinds_immovable;
alter table obligations add constraint obligations_hard_kinds_immovable
  check (kind not in ('payroll','tax') or (rigidity = 'hard' and slack_days = 0));

-- ── forecast_runs (the audit trail) ──────────────────────────────────────────
-- Snapshotted so a recommendation can be replayed against the numbers that produced it.
-- "Why did it recommend that?" must be answerable from a stored row, not a re-run.
create table if not exists forecast_runs (
  id              uuid primary key default gen_random_uuid(),
  tenant_id       uuid not null references tenants(id) on delete cascade,
  created_at      timestamptz not null default now(),
  horizon_days    int not null default 30,
  balance_at_run  numeric(14,2) not null,
  curve           jsonb not null,     -- [{date, expected, pessimistic}]
  breach          jsonb,              -- {date, shortfall, obligation} or null
  verdict         text not null check (verdict in ('none','timing','structural'))
);

create index if not exists forecast_runs_tenant_idx
  on forecast_runs (tenant_id, created_at desc);

-- ── suppressions (instead of a blacklist) ────────────────────────────────────
-- Self-expiring, evidence-backed, lifted by data rather than paperwork. See CONCEPT.md §7
-- for why a permanent blacklist was rejected.
create table if not exists suppressions (
  id               uuid primary key default gen_random_uuid(),
  tenant_id        uuid not null references tenants(id) on delete cascade,
  reason           text not null,
  forecast_run_id  uuid references forecast_runs(id) on delete set null,
  expires_at       timestamptz not null,
  created_at       timestamptz not null default now()
);

-- ── caches — droppable if time runs short ────────────────────────────────────
create table if not exists terms (
  tenant_id         uuid not null references tenants(id) on delete cascade,
  counterparty_rfc  text not null,
  days              int not null,
  observations      int not null default 0,
  spread            int not null default 0,
  learned           boolean not null default false,
  updated_at        timestamptz not null default now(),
  primary key (tenant_id, counterparty_rfc)
);

create table if not exists reconciliations (
  id            uuid primary key default gen_random_uuid(),
  tenant_id     uuid not null references tenants(id) on delete cascade,
  invoice_uuid  text not null references invoices(uuid) on delete cascade,
  flow_id       text not null,                       -- Nessie deposit/purchase _id
  flow_kind     text not null check (flow_kind in ('deposit','purchase')),
  method        text not null check (method in ('reference','fuzzy')),
  flow_date     date not null,
  unique (tenant_id, invoice_uuid)
);

-- ── row level security ───────────────────────────────────────────────────────
alter table tenants         enable row level security;
alter table invoices        enable row level security;
alter table obligations     enable row level security;
alter table forecast_runs   enable row level security;
alter table suppressions    enable row level security;
alter table terms           enable row level security;
alter table reconciliations enable row level security;

drop policy if exists tenants_own on tenants;
create policy tenants_own on tenants
  for all using (owner_id = auth.uid()) with check (owner_id = auth.uid());

-- One policy shape for every tenant-scoped table.
do $$
declare t text;
begin
  foreach t in array array['invoices','obligations','forecast_runs',
                           'suppressions','terms','reconciliations']
  loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format($f$
      create policy %I_own on %I for all
        using (tenant_id in (select id from tenants where owner_id = auth.uid()))
        with check (tenant_id in (select id from tenants where owner_id = auth.uid()))
    $f$, t || '_own', t);
  end loop;
end $$;

-- ── storage bucket for raw CFDI XML ──────────────────────────────────────────
insert into storage.buckets (id, name, public)
values ('cfdi', 'cfdi', false)
on conflict (id) do nothing;

-- Object paths are relative to the bucket: upload to "{tenant_id}/{uuid}.xml" inside the
-- `cfdi` bucket, NOT "cfdi/{tenant_id}/{uuid}.xml" — the bucket name is not part of the
-- object name, so an extra prefix would put every file in a folder called "cfdi" and the
-- first path segment would stop being the tenant id, breaking this policy open.
-- `with check` is required as well as `using`: `using` alone does not cover INSERT, so
-- uploads would be rejected.
drop policy if exists cfdi_own on storage.objects;
create policy cfdi_own on storage.objects
  for all
  using (
    bucket_id = 'cfdi'
    and (storage.foldername(name))[1] in (
      select id::text from tenants where owner_id = auth.uid()
    )
  )
  with check (
    bucket_id = 'cfdi'
    and (storage.foldername(name))[1] in (
      select id::text from tenants where owner_id = auth.uid()
    )
  );
