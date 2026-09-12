# Backend API

## Run

```bash
pip install "psycopg[binary]" fastapi "uvicorn[standard]" python-multipart argon2-cffi cryptography
cd backend && uvicorn main:app --reload --port 8000
```

`.env` at the repo root needs:

| Key | Notes |
|-----|-------|
| `DATABASE_URL` | Tiger Cloud, **user `app_api`, not `tsdbadmin`** — RLS does not constrain a superuser |
| `API_KEY` | Nessie customer key |
| `CFDI_ENC_KEY` | `cd backend && python3 -c 'import crypto; print(crypto.generate_key_b64())'` |
| `CORS_ORIGINS` | defaults to the Vite dev server |
| `DEMO_MODE` | `1` only for a local demo — see below |
| `COOKIE_SECURE` | set `0` only for local HTTP; leave unset/`1` behind HTTPS |

Migrations, in order and as the table owner (`tsdbadmin`): `db/tiger/001` → … → `011`
(`006` supersedes `005`, `010` supersedes `009`). Then, as `app_api`, run
`python3 backend/check_tenants.py`: it must print `ok`. It replays registration, session lookup,
the audit trigger and a CFDI shared by two tenants in a rolled-back transaction.

## Endpoints

| Method | Path | Purpose |
|--------|------|---------|
| POST | `/api/auth/register` | `{email, password, razon_social}` → creates user + tenant, sets cookie |
| POST | `/api/auth/login` | `{email, password}` → sets cookie |
| POST | `/api/auth/logout` | clears the session row and the cookie |
| GET | `/api/auth/me` | current tenant, and whether an account is connected |
| POST | `/api/connect` | `{account_number}` → resolves it to a Nessie account |
| POST | `/api/cfdi/upload` | multipart ZIP or single XML |
| POST | `/api/sync` | Nessie → `cash_flows`, reconcile, learn terms |
| GET | `/api/obligations` | the pre-filled hard-date list |
| POST | `/api/obligations/{id}` | set `rigidity`, `slack_days`, `relationship_cost` |
| **GET** | **`/api/sme/{account_id}`** | **`DashboardData` — the main dashboard call** |
| **POST** | **`/api/stress`** | **`StressSimulationResponse` — the Stress Lab** |
| GET | `/api/health` | liveness, and whether demo mode is on |

`backend/app.py` was merged into `main.py` and deleted. It loaded snapshots from the mock
CFDI directories and authenticated with Supabase bearer tokens; there is now one data path
(Tiger for stored state, Nessie live for the balance) and one session mechanism.

First run for a tenant: register → connect → upload CFDI → sync → dashboard.
`/api/sme/...` returns **404** until an account is connected, which is the front end's
first-run gate.

## Front end

Supabase is gone from the project. `src/lib/auth.ts` replaces it, `src/lib/supabase.ts`
and `@supabase/supabase-js` were deleted, and the session travels as an httpOnly cookie —
`credentials: 'include'` is the whole mechanism, with no token readable from JavaScript.

Run `npm install` in `frontend/` to refresh the lock file after the dependency removal.

`CORS_ORIGINS` must list the front end's exact origin: `allow_origins` cannot be `*` when
credentials are allowed.

**Removed with Supabase:** magic-link sign-in and password reset. Both were Supabase
features with no backend equivalent, and a button that silently does nothing is worse in a
demo than one that is absent. Re-adding them means an email sender and a token table.

`DEMO_MODE=1` is still useful for running the UI with no database: the front end detects
the absence of `VITE_API_BASE_URL` and serves the seeded mock scenario instead.

## Notes

- **Sessions** are opaque random tokens in an httpOnly cookie, not JWTs: there is no third
  party verifying signatures, and a row can be revoked. `secure` is on unless demoing.
- **Every request is tenant-scoped** by `SET LOCAL app.tenant_id` inside one transaction,
  so a pooled connection cannot carry one request's tenant into the next.
- **Changing the account id in the URL returns 403**, not another tenant's data.
- **Each dashboard call writes a `forecast_runs` row.** "Why did it recommend that?" is
  answerable from a stored snapshot rather than a re-run that may now differ.
- **Payroll and taxes refuse slack** in `/api/obligations/{id}` and again in a CHECK
  constraint, because a legal payment date is not the user's to waive.
