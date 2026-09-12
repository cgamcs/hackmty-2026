# Security posture

The demo data is synthetic. The controls are not, because the product would handle real
CFDI — which carry RFCs, personal data under Mexico's LFPDPPP — and real bank positions.
Everything below is implemented and runnable, not aspirational.

## The bug this document started with

Every RLS policy in `db/tiger/001_schema.sql` was **inert** on first deployment.

PostgreSQL does not apply row level security to a table's owner, and never applies it to
a superuser. Tiger Cloud issues `tsdbadmin`, a superuser that owns everything created
with it — so the schema was created by, and the API connected as, a role RLS does not
constrain. The policies existed, validated, and filtered nothing. No error, no warning:
cross-tenant reads simply succeeded.

Fixed in `003_security.sql` by two changes, neither sufficient alone:

1. `FORCE ROW LEVEL SECURITY` on every table, so the owner is subject to its own policies.
2. A non-superuser `app_api` role, because `FORCE` still does not constrain a superuser.

**`DATABASE_URL` must name `app_api`, never `tsdbadmin`.** That single line is the
difference between the policies working and being decoration.

This was the third failure of the same shape found while building: a control that looks
correct, raises nothing, and returns other tenants' data. The other two were a Supabase
Storage path that put every tenant's files under one folder, and a continuous aggregate
that does not inherit RLS because a background worker materialises it. All three failed
open.

## Controls

| Control | Where | Protects against |
|---------|-------|------------------|
| Row level security, forced | `003_security.sql` | A missed `WHERE tenant_id` becoming a cross-tenant leak |
| Least-privilege DB role | `app_api`, no superuser, no `BYPASSRLS` | RLS bypass; accidental DDL from the API |
| Transaction-scoped tenant | `SET LOCAL app.tenant_id`, `backend/db.py` | A pooled connection carrying one request's tenant into the next |
| Fail-closed scoping | `current_tenant()` returns NULL when unset | A forgotten scope denying everything rather than exposing everything |
| TLS enforced | `sslmode=require` appended in `backend/db.py` | Balances and RFCs crossing the network in plaintext |
| CFDI encrypted at rest | AES-256-GCM, `backend/crypto.py` | A leaked backup, a misconfigured replica, direct database access |
| Ciphertext bound to its row | invoice UUID as AES-GCM additional data | A blob moved to another invoice decrypting successfully |
| Argon2id password hashing | `backend/crypto.py` | A `password_hash` column holding plaintext |
| Write audit trail | trigger → `audit_log` hypertable | No record of who changed what |
| Business rules as constraints | `forecast_runs`, `obligations` | An endpoint bypassing the rule that structural deficits never get a credit recommendation, or that payroll can be shifted |
| Full account number never stored | `account_number_last4` | Retaining an identifier the product does not need |
| Encryption at rest, AES-256 / AWS KMS | Tiger Cloud | Physical and platform-level disk exposure |

## Threat model — what each layer does not cover

Being explicit about the gaps is the point; a control whose limits are unstated invites
false confidence.

- **CFDI encryption does not survive an API compromise.** The key lives in the API
  process, so anything that owns the API owns the plaintext. It protects the database
  tier, not the application tier.
- **`audit_log` records writes, not reads.** PostgreSQL has no `SELECT` trigger, so read
  access must be logged by the API. The table is not a complete access record and should
  not be presented as one.
- **RLS is defence in depth, not the primary boundary.** The API is expected to scope
  every query; RLS exists so that a bug there is contained rather than catastrophic.
- **The Nessie API key is a single shared secret** for the whole sandbox, with no per-
  tenant scoping available. In production this is where open banking consent tokens
  belong — one per business, revocable.

## Deliberately not done

- **Encrypting the parsed invoice fields.** They are what we filter and join on;
  encrypting them would break every query and protect nothing the blob encryption and
  platform at-rest encryption do not already cover.
- **Encrypting RFCs.** Needed for the joins that learn payment terms. In a real
  deployment this is where a deterministic-lookup-plus-encrypted-display scheme belongs;
  it is real work and was not attempted.
- **A key management service.** The key is an environment variable. Rotation, envelope
  encryption and KMS custody are the correct production answer.
- **Rate limiting and brute-force lockout** on authentication.

## Operational rules

- **Secret files are gitignored: `*.env`, `*credentials.env`.** This was not always true.
  `tiger-cloud-db-26588-credentials.env` — containing `PGPASSWORD`, `PGUSER`, `PGHOST`
  for the Tiger Cloud database — was committed locally in `f50fcdf`. It was caught before
  that commit reached a remote: the pushed tip of `feat/backend-db` predated it, and
  `git rev-list origin/feat/backend-db --objects` confirmed nothing in the remote history
  referenced the blob. Removed with `git rm --cached` plus `commit --amend`, then purged
  from the object store with `reflog expire --expire-unreachable=now` and
  `gc --prune=now`; the blob no longer exists in the repository. No rotation was required
  because the credentials never left the machine.

  Verify before every push:
  ```
  git rev-list --all --objects | rg '\.env$|credentials'
  ```
  Had it been pushed, the only correct response would have been to rotate the Tiger
  Cloud password immediately — history rewriting does not un-publish a secret.
- Never log `DATABASE_URL`, `CFDI_ENC_KEY`, `API_KEY`, or decrypted XML.
- `CFDI_ENC_KEY` is 32 random bytes, base64. Generate with
  `python3 -c 'import crypto; print(crypto.generate_key_b64())'` from `backend/`.
  **Losing it makes every stored CFDI unrecoverable** — the parsed fields survive, the
  original documents do not.
- With `FORCE ROW LEVEL SECURITY` on, maintenance queries as `tsdbadmin` must set a
  tenant first: `select set_config('app.tenant_id', '<uuid>', true);`
