-- Server-side sessions.
--
-- Opaque random tokens rather than JWTs: there is no third party that needs to verify a
-- signature here, and a row can be revoked on logout or on suspicion. A JWT cannot be
-- withdrawn before it expires.
--
-- No RLS: this table is consulted to DISCOVER which tenant is calling, so a policy keyed
-- on the tenant would be circular. It is protected by never being exposed through an
-- endpoint and by the grants below — select and insert for the API, plus delete so
-- logout works, and nothing else.

create table if not exists sessions (
  token       text primary key,
  user_id     uuid not null references users(id) on delete cascade,
  created_at  timestamptz not null default now(),
  expires_at  timestamptz not null
);

create index if not exists sessions_user_idx on sessions (user_id);
create index if not exists sessions_expiry_idx on sessions (expires_at);

grant select, insert, delete on sessions to app_api;

-- Expired rows are useless and a token that lingers is a token that can leak. Sweep them
-- opportunistically; a scheduled job would be better in production.
create or replace function purge_expired_sessions() returns void
language sql as $$
  delete from sessions where expires_at < now()
$$;
