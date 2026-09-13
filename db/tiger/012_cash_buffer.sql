-- Store each company's cash buffer.
--
-- Rung 3 of the recovery ladder draws on money the owner can move into the operating
-- account: savings or another account. There was nowhere to record it, so the live snapshot
-- always passed 0 and the rung never appeared outside the Stress Lab.
--
-- It must be money OUTSIDE the operating account. The live Nessie balance is already the
-- projection's opening balance, so counting it again here would inflate every forecast.
--
-- tenants already carries RLS (tenants_own) and app_api holds UPDATE on it (010), so no new
-- policy or grant is needed. backend/check_tenants.py verifies both the write and the check.

alter table tenants add column if not exists cash_buffer numeric(14,2) not null default 0;

alter table tenants drop constraint if exists tenants_cash_buffer_nonnegative;
alter table tenants add constraint tenants_cash_buffer_nonnegative check (cash_buffer >= 0);
