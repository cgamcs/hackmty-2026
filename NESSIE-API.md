# Capital One Nessie API — Reference

Hackathon sandbox API with mock banking data (customers, accounts, transactions)
plus real public data (ATM and branch locations).

- **Docs:** https://prod.nessieisreal.com/docs
- **OpenAPI spec:** https://prod.nessieisreal.com/nessie-openapi-spec.yaml (saved as `nessie-openapi-spec.yaml`)
- **Base URL:** `https://prod-api.nessieisreal.com`

It is a hosted REST API. Nothing runs locally: no Docker, no JAR, no install.

> Not to be confused with **Project Nessie** (`projectnessie/nessie`), an unrelated
> Apache Iceberg catalog for data lakes.

## Hosts

| Host | What it is |
|------|-----------|
| `prod-api.nessieisreal.com` | Production API. The `servers` entry in the official spec. |
| `api.nessieisreal.com` | Legacy API host. Still live and returns identical data. |
| `prod.nessieisreal.com` | Docs frontend only. A single-page app — every path returns the same HTML shell, so it never serves API data. |
| `qa-api.nessieisreal.com` | QA environment, per the spec. |

Use HTTPS. Plain `http://` does not respond on any of them.

## Getting a key

Sign up with GitHub at https://nessieisreal.com, then open your Profile page.
You get two keys:

| Key | Role | Permissions |
|-----|------|-------------|
| Enterprise | Capital One employee | GET only, reads the global dataset |
| Customer | Capital One customer | Full CRUD, scoped to your own sandbox |

## Auth

`ApiKeyAuth`: the key is a **query parameter** named `key` on every request.
There is no header auth.

```
GET https://prod-api.nessieisreal.com/customers?key=YOUR_KEY
```

## Endpoints

From the official spec, cross-checked against the live API on 2026-09-11.
Rows marked ✅ are live but absent from the spec.

### Customers

| Method | Path |
|--------|------|
| GET POST | `/customers` |
| GET PUT | `/customers/{id}` |
| GET | `/customers/{id}/bills` |
| GET | `/accounts/{id}/customer` |

### Accounts

| Method | Path |
|--------|------|
| GET | `/accounts` |
| GET PUT DELETE | `/accounts/{id}` |
| GET POST | `/customers/{id}/accounts` |

### Transactions — nested under an account

| Method | Path | |
|--------|------|---|
| GET POST | `/accounts/{id}/deposits` | |
| GET POST | `/accounts/{id}/withdrawals` | |
| GET POST | `/accounts/{id}/bills` | |
| GET POST | `/accounts/{id}/loans` | |
| GET POST | `/accounts/{id}/purchases` | ✅ |
| GET POST | `/accounts/{id}/transfers` | ✅ |

### Transactions — individual records

Note the **singular** path segment on purchases and withdrawals.

| Method | Path |
|--------|------|
| GET PUT DELETE | `/deposits/{id}` |
| GET PUT DELETE | `/withdrawal/{withdrawal_id}` |
| GET PUT DELETE | `/purchase/{purchase_id}` |
| GET PUT DELETE | `/transfers/{transfer_id}` |
| GET PUT DELETE | `/bills/{billId}` |
| GET PUT DELETE | `/loans/{id}` |
| GET | `/deposits` |

### Merchants, ATMs, Branches

| Method | Path | Notes |
|--------|------|-------|
| GET POST | `/merchants` | |
| GET PUT | `/merchants/{id}` | |
| GET | `/atms` | Supports `lat`, `lng`, `rad` |
| GET | `/atms/{id}` | |
| GET | `/branches` | |
| GET | `/branches/{id}` | |

### Enterprise (read-only, global dataset)

| Path | Live |
|------|------|
| `/enterprise/customers` · `/enterprise/customers/{customer_id}` | 200 |
| `/enterprise/deposits` · `/enterprise/deposits/{deposit_id}` | 200 |
| `/enterprise/withdrawal/{withdrawal_id}` | 200 |
| `/enterprise/accounts` ✅ · `/enterprise/bills` ✅ · `/enterprise/merchants` ✅ · `/enterprise/transfers` ✅ | 200 |
| `/enterprise/purchases` · `/enterprise/loans` | **403 — do not exist** |

## Gotchas

- **A 404 often means "empty", not "wrong URL".** `GET /accounts/{id}/transfers`
  returns `404 "No transfers found for this account"` when the account simply has
  no transfers. Do not treat 404 as a routing bug — read the body.
- **Singular vs plural is inconsistent.** Collections are plural
  (`/accounts/{id}/purchases`), but single records are singular
  (`/purchase/{id}`, `/withdrawal/{id}`). Transfers and deposits stay plural.
- `/purchases`, `/withdrawals`, `/transfers`, `/bills` and `/loans` return **403**
  as top-level collections. They only exist nested under an account.
- **The spec is incomplete.** `/accounts/{id}/purchases`, `/accounts/{id}/transfers`
  and four `/enterprise/*` routes work live but are missing from the YAML. Trust
  the live API over the spec.
- `/customers` and `/merchants` return `[]` with a fresh key. That is correct —
  each key owns an isolated sandbox. Seed it with POST before reading.
- **Validation runs before auth.** POSTing an invalid body with a bogus key returns
  a 400 field-validation error, so a 400 is not proof your key works. Verify the key
  against `GET /customers` instead.
- Public endpoints return 200 even with an invalid key, so a working response is
  never proof of a valid key either.
- **`balance` is immutable after account creation.** Posting deposits, purchases or
  withdrawals does not move it, and `PUT /accounts/{id}` silently ignores the field —
  it returns `202 Accepted account update`, applies `nickname`, and echoes the *old*
  balance back. Set the balance you want in the `POST` that creates the account; the
  only way to change it afterwards is delete and recreate.
- **`PUT /bills/{billId}` works in full**, including `payment_amount`. Bills are the
  practical lever for adjusting a seeded scenario.
- **`purchase_date` is accepted on create and honoured**, even though it is absent
  from `PurchaseCreate`. Backdated restock history works.

## Request bodies

Required fields marked `*`. Taken from the spec, and for the routes missing from it,
from the live API's own validation errors.

```jsonc
// POST /customers
{ "first_name": "*", "last_name": "*", "address": "*" }

// POST /customers/{id}/accounts
{ "type": "*", "nickname": "*", "rewards": 0, "balance": 0 }
// type: "Credit Card" | "Savings" | "Checking"

// POST /accounts/{id}/deposits
{ "medium": "*", "transaction_date": "*", "status": "*", "amount": 0, "description": "*" }

// POST /accounts/{id}/withdrawals
{ "medium": "*", "amount": 0 }

// POST /accounts/{id}/transfers
{ "transaction_date": "*", "status": "*", "amount": 0, "description": "*" }

// POST /accounts/{id}/purchases
{ "merchant_id": "*", "medium": "*", "amount": 0 }

// POST /accounts/{id}/bills
{ "status": "*", "payee": "*", "payment_amount": 0,
  "nickname": "", "payment_date": "", "recurring_date": 0 }
// status: "pending" | "cancelled" | "completed" | "recurring"

// POST /accounts/{id}/loans
{ "type": "*", "status": "*", "credit_score": 0, "monthly_payment": 0,
  "amount": 0, "description": "*" }

// POST /merchants
{ "name": "*", "category": "", "address": {}, "geocode": {} }
```

`address` is `{ street_number, street_name, city, state, zip }`.
`geocode` is `{ lat, lng }`.

## Response shapes

```jsonc
// GET /atms
{
  "_id": "555bed94a520e036e52b1d67",
  "name": "Arlington 1",
  "language_list": ["Portuguese", "English"],
  "geocode": { "lat": 38.8981779, "lng": -77.1211338 },
  "hours": ["24 hours a day, 7 days a week"],
  "accessibility": true,
  "amount_left": 240898
}

// GET /enterprise/customers
{
  "_id": "02ad7a29-c528-4f6a-a024-7570bb436eef",
  "first_name": "Teammate",
  "last_name": "Scurry",
  "address": {
    "street_number": "6100", "street_name": "Main Street",
    "city": "Houston", "state": "TX", "zip": "77005"
  },
  "account_ids": []
}
```

## Quick start

```bash
export NESSIE_KEY=your_key_here
BASE=https://prod-api.nessieisreal.com

# Verify the key works — an invalid key gets 200 on public routes, so test here
curl -s "$BASE/customers?key=$NESSIE_KEY" | jq

# Read public data
curl -s "$BASE/atms?key=$NESSIE_KEY" | jq '.[0]'

# Create a customer
CID=$(curl -s -X POST "$BASE/customers?key=$NESSIE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{
    "first_name": "Ada",
    "last_name": "Lovelace",
    "address": {
      "street_number": "1", "street_name": "Main St",
      "city": "Richmond", "state": "VA", "zip": "23220"
    }
  }' | jq -r '.objectCreated._id')

# Create an account for that customer
curl -s -X POST "$BASE/customers/$CID/accounts?key=$NESSIE_KEY" \
  -H 'Content-Type: application/json' \
  -d '{"type": "Checking", "nickname": "main", "rewards": 0, "balance": 1000}' | jq
```

## SDKs

Official wrappers at https://github.com/nessieisreal — JavaScript, Golang, Ruby,
Android. All are thin HTTP clients; plain `fetch` or `curl` is usually enough.

The local `nessie-openapi-spec.yaml` can generate a typed client instead:

```bash
npx openapi-typescript nessie-openapi-spec.yaml -o nessie.d.ts
```

Remember the spec is missing the purchases and transfers creation routes — you
will have to add those by hand.
