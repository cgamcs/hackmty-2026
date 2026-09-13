# Beel — Financial Resilience for SMBs

Beel combines live bank activity from Capital One Nessie with uploaded Mexican CFDI
invoices to help an SMB understand its next 30 days of liquidity. Each company signs in to
an isolated workspace, sees its own forecast and can test recovery actions before taking
on debt.

The product answers three questions:

1. Which obligation may become impossible to cover, and when?
2. Can an operational action close the gap?
3. If the gap remains, is bridge financing appropriate or would more debt make it worse?

## Core capabilities

- Private account and data isolation for every SMB.
- CFDI XML or ZIP ingestion, parsing and encrypted raw-document storage.
- Live balances, deposits, purchases, withdrawals and bills from Nessie.
- CFDI-to-bank reconciliation and learned customer payment terms.
- Expected and pessimistic 30-day cash-flow forecasts.
- Health Score and Resilience Score.
- First-liquidity-breach detection and timing-versus-structural classification.
- Stress Lab for changes in income, expenses, receivable delays and cash buffer.
- Ranked Recovery Plan: accelerate receivables, shift flexible obligations, use reserves,
  then consider credit.
- Financing guardrail: bridge credit is suggested only for an unresolved timing gap and
  refused for a structural deficit.
- Audit history and forecast snapshots in TigerData.

## Architecture

```text
React + Vite
     │  /api through the local Vite proxy
     ▼
FastAPI ───────► Capital One Nessie API
     │             balance + settled flows + bills
     │
     ├──────────► Financial engine
     │             forecast + scores + stress + recovery + funding decision
     │
     ▼
TigerData / TimescaleDB
  users · tenants · sessions · invoices · cash flows
  obligations · learned terms · forecast runs · audit log
```

Authentication uses opaque server-side sessions stored in an `httpOnly` cookie. Every
database request is scoped to one tenant with transaction-local PostgreSQL settings and
Row-Level Security (RLS).

## Technology

- React 18, TypeScript, Vite, Tailwind CSS, Recharts, TanStack Query and Zustand.
- FastAPI, Psycopg, Argon2id and AES-256-GCM.
- TigerData / PostgreSQL / TimescaleDB.
- Capital One Nessie API.
- Deterministic Python financial engine with Pandas and NumPy available for data work.

## Repository layout

```text
backend/             FastAPI, authentication, TigerData access and API orchestration
db/tiger/            Ordered TigerData migrations (001 through 011)
engine/              Nessie client, CFDI parsing, reconciliation and learned terms
financial_engine/    Forecast, scores, stress scenarios and recovery decisions
frontend/            React application
frontend/public/brand/ Logo variants, sun mark and generated visual concept
mocks/               Seeded SMB scenarios and CFDI fixtures
examples/            Command-line demonstrations
tests/               Unit and integration tests
requirements.txt     Python dependencies
.env.example         Safe environment-variable template
```

Generated directories such as `.venv`, `node_modules`, `dist`, `.vite`, `__pycache__` and
TypeScript build metadata are ignored by Git.

## Prerequisites

- Python 3.11 or newer.
- Node.js 20 or newer and npm.
- A Tiger Cloud service and its administrative connection for migrations.
- A least-privilege TigerData role named `app_api` for the running application.
- A Capital One Nessie API key.

## Environment configuration

Copy the template and fill in the values:

```bash
cp .env.example .env
```

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | TigerData connection used by FastAPI. It must use `app_api`, never `tsdbadmin`. |
| `API_KEY` | Nessie customer key. It stays on the server. |
| `CFDI_ENC_KEY` | 32-byte Base64 key used to encrypt stored CFDI XML. |
| `CORS_ORIGINS` | Allowed frontend origins when frontend and backend use different origins. |
| `COOKIE_SECURE` | Use `0` for local HTTP and `1` behind HTTPS. |
| `DEMO_MODE` | Backend-only authentication bypass. Keep `0` outside an isolated demo. |

Generate the CFDI encryption key once:

```bash
cd backend
python3 -c 'import crypto; print(crypto.generate_key_b64())'
cd ..
```

The downloaded Tiger credential file contains `TIMESCALE_SERVICE_URL` for administrative
migrations. Keep it local; `*credentials.env` and `.env` are ignored by Git. The application
must continue using the restricted `DATABASE_URL`.

## Database setup

Run every SQL file in `db/tiger/` in numeric order, from `001_schema.sql` through
`011_daily_flows_access.sql`, using the Tiger Cloud SQL editor or an administrative
`tsdbadmin` connection.

Migration `003` creates `app_api` with a placeholder password when the role does not yet
exist. Set a real password from the administrative connection, then use that same password
in `DATABASE_URL`:

```sql
ALTER ROLE app_api PASSWORD 'replace-with-a-strong-password';
```

Important migration notes:

- `006` supersedes the first registration approach in `005`.
- `010` restates the complete multi-tenant privileges and supersedes `009`.
- `011` exposes only tenant-filtered daily flows while keeping the raw continuous
  aggregate private.

After applying the migrations, validate the live schema through the restricted application
role. The check creates two temporary tenants in one transaction and always rolls it back:

```bash
PYTHONPATH=backend:. .venv/bin/python backend/check_tenants.py
```

Expected output:

```text
ok: registration, sessions, shared CFDI upsert, audit trigger, RLS isolation
```

## Install dependencies

Python:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Frontend:

```bash
cd frontend
npm install
cd ..
```

## Run locally

Start the backend from the repository root:

```bash
COOKIE_SECURE=0 .venv/bin/uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000
```

Start the frontend in a second terminal:

```bash
cd frontend
npm run dev
```

Open [http://localhost:5173](http://localhost:5173). Vite proxies `/api` to
`http://127.0.0.1:8000`, so no frontend API URL is required for local development.

Useful endpoints:

- Frontend: `http://localhost:5173`
- API health: `http://127.0.0.1:8000/api/health`
- Interactive API documentation: `http://127.0.0.1:8000/docs`

Do not set `VITE_DEMO=1` when testing TigerData and Nessie. That flag intentionally serves
the seeded frontend scenario without calling the backend.

## First-time company flow

1. Create an SMB account with an email and a password of at least eight characters.
2. Save the legal business name.
3. Enter the Nessie operating-account number. Account lookup happens only on the server.
4. Upload individual CFDI XML files or a SAT bulk-download ZIP.
5. Synchronize Nessie transactions and obligations.
6. Confirm which obligations are hard deadlines and which have proven slack.
7. Open the dashboard, forecast, Stress Lab, Recovery and Funding views.

The dashboard remains empty until the integration has enough data. This prevents partial
inputs from producing confident-looking but misleading financial results.

## Financial engine

The engine consumes normalized business data rather than calling external services itself.
For each of the next 30 days it combines:

- Historical income and variable-expense behavior by weekday.
- Current live balance from Nessie.
- Exact recurring obligations and open payables.
- Open PPD receivables with learned collection dates and probabilities.
- An expected inflow curve and a pessimistic p20 curve.

It then identifies the first uncovered obligation, classifies the gap and runs recovery
counterfactuals against the same snapshot. All calculations are deterministic and
explainable; the same inputs produce the same decision.

## API overview

| Method | Endpoint | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Create a user and its tenant. |
| `POST` | `/api/auth/login` | Start a server-side session. |
| `POST` | `/api/auth/logout` | Revoke the session. |
| `GET` | `/api/auth/me` | Read the authenticated company identity. |
| `GET` | `/api/setup/status` | Check onboarding completeness. |
| `POST` | `/api/profile` | Update the legal business name. |
| `POST` | `/api/connect` | Resolve and connect a Nessie account number. |
| `POST` | `/api/cfdi/upload` | Upload XML files or a ZIP. |
| `POST` | `/api/sync` | Synchronize Nessie, reconcile CFDI and learn terms. |
| `GET` | `/api/obligations` | List detected obligations. |
| `POST` | `/api/obligations/{id}` | Confirm rigidity and allowed slack. |
| `GET` | `/api/sme/{account_id}` | Build the private SMB dashboard and forecast. |
| `POST` | `/api/stress` | Run the Stress Lab against current company data. |
| `GET` | `/api/health` | Check API liveness. |

## Tests

Run the Python suite:

```bash
PYTHONDONTWRITEBYTECODE=1 .venv/bin/python -m unittest discover -s tests -v
```

Build and type-check the frontend:

```bash
cd frontend
npm run build
```

Run one live command-line analysis using Nessie and the checked-in CFDI fixtures:

```bash
PYTHONPATH=. .venv/bin/python examples/analyze_live.py bajio
```

Use `esperanza`, `bajio` or `roble`; add `--json` for the complete API-shaped result.

## Demo boundaries

- Funding offers are illustrative comparisons; Beel does not submit a real loan
  application.
- Alerts are currently in-app, not email, SMS or push notifications.
- Each SMB connects one operating account.
- The shipped product is the private SMB view, not a bank-wide portfolio dashboard.
- The forecast is a decision-support tool, not accounting, tax or legal advice.
