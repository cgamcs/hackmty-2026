-- Expose tenant-filtered daily flows without granting the API access to the raw aggregate.
--
-- The original wrapper used security_invoker=true while cash_flows_daily was deliberately
-- revoked from app_api. An invoker view requires the caller to hold privileges on every
-- underlying relation, so all snapshot reads failed with:
--
--   permission denied for view cash_flows_daily
--
-- This view uses its owner's read privilege, keeps the raw aggregate private, and applies
-- a security barrier plus the transaction-scoped tenant filter before returning rows.

create or replace view daily_flows
with (security_barrier = true, security_invoker = false) as
select day, net, inflow, outflow, movements
from cash_flows_daily
where tenant_id = current_tenant();

revoke all on cash_flows_daily from app_api, public;
grant select on daily_flows to app_api;
