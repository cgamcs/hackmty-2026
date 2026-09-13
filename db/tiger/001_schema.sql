-- SMB Working Capital Broker — TigerData (Tiger Cloud / TimescaleDB) schema
-- Replaces db/001_schema.sql and db/002_financial_engine.sql, which targeted Supabase.
--
-- What changed moving off Supabase:
--   * No `auth` schema. We own users, and tenant scoping comes from a session variable
--     the API sets per request rather than from auth.uid().
--   * No Storage buckets. Raw CFDI XML lives in a column — a few hundred invoices at
--     ~2 KB each is nothing, and it removes an entire dependency.
--   * cash_flows and forecast_runs become hypertables. This is the honest reason to be
--     on TigerData: settled bank movements are genuinely time-series, and the daily
--     rollups the forecast needs become a continuous aggregate maintained by the
--     database instead of recomputed in Pandas on every request.
--
-- Hypertable gotcha that bites hard: TimescaleDB requires the partitioning column to be
-- part of every UNIQUE or PRIMARY KEY constraint on the table. A bare `id uuid primary
-- key` is rejected once the table is a hypertable, so those keys are composite below.

create extension if not exists timescaledb;
create extension if not exists pgcrypto;

-- ── users and tenants ────────────────────────────────────────────────────────
create table if not exists users (
  id             uuid primary key default gen_random_uuid(),
  email          text not null unique,
  password_hash  text not null,
  created_at     timestamptz not null default now()
);

create table if not exists tenants (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null unique references users(id) on delete cascade,
  razon_social          text not null,
  rfc                   text,
  account_id            text,               -- Nessie account _id
  account_number_last4  text,               -- display only; never stored in full
  created_at            timestamptz not null default now()
);

-- ── tenant scoping ───────────────────────────────────────────────────────────
-- FastAPI connects as one role, so auth.uid() has no equivalent. Instead the API runs
-- `SET LOCAL app.tenant_id = '<uuid>'` at the start of each request's transaction, and
-- RLS reads it. SET LOCAL is transaction-scoped, so a pooled connection cannot leak one
-- request's tenant into the next.
create or replace function current_tenant() returns uuid
language sql stable as $$
  select nullif(current_setting('app.tenant_id', true), '')::uuid
$$;

-- ── invoices (parsed CFDI + the raw XML) ─────────────────────────────────────
create table if not exists invoices (
  uuid               text primary key,      -- CFDI folio fiscal: the natural key
  tenant_id          uuid not null references tenants(id) on delete cascade,
  serie              text,
  folio              text,
  direction          text not null check (direction in ('issued','received')),
  tipo               text not null,         -- I | E | T | N | P
  metodo_pago        text check (metodo_pago in ('PUE','PPD')),
  forma_pago         text,
  counterparty_rfc   text,
  counterparty_name  text,
  fecha              date not null,
  due_date           date,                  -- derived; CFDI carries no due date
  subtotal           numeric(14,2) not null default 0,
  total              numeric(14,2) not null default 0,
  xml                text,                  -- raw document, for re-parsing and audit
  created_at         timestamptz not null default now()
);

create index if not exists invoices_tenant_fecha_idx on invoices (tenant_id, fecha desc);
create index if not exists invoices_open_receivables_idx
  on invoices (tenant_id, due_date)
  where direction = 'issued' and metodo_pago = 'PPD';

-- ── cash_flows: hypertable of settled bank movements ─────────────────────────
-- Mirrors Nessie deposits/purchases/withdrawals so the forecast reads one local
-- time-series instead of paging the API on every run. Income positive, expense negative,
-- matching financial_engine.models.CashFlow.
create table if not exists cash_flows (
  tenant_id   uuid not null references tenants(id) on delete cascade,
  occurred_at timestamptz not null,
  flow_id     text not null,                -- Nessie _id, for idempotent re-sync
  amount      numeric(14,2) not null,
  category    text not null default 'other',
  source      text not null default 'bank',
  description text,
  primary key (tenant_id, flow_id, occurred_at)
);

select create_hypertable('cash_flows', 'occurred_at', if_not_exists => true);

-- ── forecast_runs: hypertable of engine output ───────────────────────────────
-- The whole ForecastResult.to_dict() goes in `result`; columns are promoted only for
-- what gets filtered, sorted or listed. The algorithm is still moving, and jsonb absorbs
-- new fields without a migration while the promoted columns stay queryable.
create table if not exists forecast_runs (
  id                uuid not null default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  created_at        timestamptz not null default now(),
  horizon_days      int not null default 30,
  scenario          text not null default 'baseline',
  balance_at_run    numeric(14,2) not null,
  verdict           text not null check (verdict in ('none','timing','structural')),
  health_score      int check (health_score between 0 and 100),
  resilience_score  int check (resilience_score between 0 and 100),
  financing_status  text check (financing_status in (
                      'not_needed','covered_by_recovery_plan',
                      'recommended','not_recommended_structural')),
  breach_date       date,
  breach_shortfall  numeric(14,2),
  result            jsonb not null,
  primary key (id, created_at),

  -- Half a breach is a bug.
  constraint forecast_runs_breach_paired
    check ((breach_date is null) = (breach_shortfall is null)),

  -- The product's central promise, enforced here rather than trusted to whichever
  -- caller writes the row: a structural deficit never gets a financing recommendation.
  constraint forecast_runs_structural_never_recommends
    check (not (verdict = 'structural' and financing_status = 'recommended'))
);

select create_hypertable('forecast_runs', 'created_at', if_not_exists => true);

create index if not exists forecast_runs_tenant_idx
  on forecast_runs (tenant_id, created_at desc);
create index if not exists forecast_runs_breach_idx
  on forecast_runs (tenant_id, breach_date) where breach_date is not null;

-- ── obligations (the hard-date form) ─────────────────────────────────────────
create table if not exists obligations (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenants(id) on delete cascade,
  bill_id            text,                  -- Nessie bill _id when detected
  payee              text not null,
  amount             numeric(14,2) not null,
  day_of_month       int not null check (day_of_month between 1 and 31),
  kind               text not null check (kind in
                       ('payroll','tax','rent','supplier','utility','other')),
  rigidity           text not null default 'hard' check (rigidity in ('hard','slack')),
  slack_days         int not null default 0 check (slack_days >= 0),
  relationship_cost  numeric(14,2) not null default 0 check (relationship_cost >= 0),
  source             text not null default 'detected'
                       check (source in ('detected','user')),
  created_at         timestamptz not null default now(),

  -- Payroll and taxes are legally dated. The ladder must not be able to propose shifting
  -- them even if a client edits the form, so the rule lives here and not only in the UI.
  constraint obligations_hard_kinds_immovable
    check (kind not in ('payroll','tax') or (rigidity = 'hard' and slack_days = 0))
);

-- ── learned payment terms ────────────────────────────────────────────────────
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

-- ── suppressions (instead of a blacklist) ────────────────────────────────────
create table if not exists suppressions (
  id                uuid primary key default gen_random_uuid(),
  tenant_id         uuid not null references tenants(id) on delete cascade,
  reason            text not null,
  financing_status  text,
  forecast_run_id   uuid,
  expires_at        timestamptz not null,
  created_at        timestamptz not null default now()
);

comment on table suppressions is
  'Self-expiring credit suppression, written when a run returns financing_status = '
  'not_recommended_structural. Deliberately NOT a blacklist: it expires on its own and '
  'lifts when the verdict stops being structural. See README.md, Financial engine.';

-- ── continuous aggregate: daily net flow per tenant ──────────────────────────
-- The forecast's baseline and day-of-week factors are built from daily totals. Letting
-- the database maintain them incrementally means the engine reads 120 rows instead of
-- thousands of movements, and the rollup stays correct as new flows arrive.
create materialized view if not exists cash_flows_daily
with (timescaledb.continuous) as
select
  tenant_id,
  time_bucket('1 day', occurred_at) as day,
  sum(amount)                         as net,
  sum(case when amount > 0 then amount else 0 end)  as inflow,
  sum(case when amount < 0 then -amount else 0 end) as outflow,
  count(*)                            as movements
from cash_flows
group by tenant_id, day
with no data;

select add_continuous_aggregate_policy('cash_flows_daily',
  start_offset => interval '30 days',
  end_offset   => interval '1 hour',
  schedule_interval => interval '1 hour',
  if_not_exists => true);

-- ── row level security ───────────────────────────────────────────────────────
-- Defence in depth: the API already scopes every query by tenant, but a missed WHERE
-- clause must not become a cross-tenant leak.
alter table tenants      enable row level security;
alter table invoices     enable row level security;
alter table cash_flows   enable row level security;
alter table forecast_runs enable row level security;
alter table obligations  enable row level security;
alter table terms        enable row level security;
alter table suppressions enable row level security;

drop policy if exists tenants_own on tenants;
create policy tenants_own on tenants for all
  using (id = current_tenant()) with check (id = current_tenant());

do $$
declare t text;
begin
  foreach t in array array['invoices','cash_flows','forecast_runs',
                           'obligations','terms','suppressions']
  loop
    execute format('drop policy if exists %I on %I', t || '_own', t);
    execute format(
      'create policy %I on %I for all using (tenant_id = current_tenant()) '
      'with check (tenant_id = current_tenant())', t || '_own', t);
  end loop;
end $$;

-- A continuous aggregate is a materialized view refreshed by a background worker, so it
-- does NOT inherit RLS from cash_flows, and `security_invoker` is a plain-view option
-- that cannot be applied to it. Querying cash_flows_daily directly therefore returns
-- every tenant's daily totals.
--
-- So it is never queried directly. This wrapper runs with its owner's read privilege but
-- has a security barrier and an explicit current_tenant() filter. `security_invoker=true`
-- cannot be used here: PostgreSQL would then require app_api to read the unfiltered
-- aggregate underneath, defeating the revoke below.
create or replace view daily_flows
with (security_barrier = true, security_invoker = false) as
select day, net, inflow, outflow, movements
from cash_flows_daily
where tenant_id = current_tenant();

revoke all on cash_flows_daily from public;
