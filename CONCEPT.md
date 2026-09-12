# SMB Working Capital Broker

Hackathon concept — Capital One Nessie API.
Track: SMB Cash-Flow & Working Capital Intelligence (B2B).

See `NESSIE-API.md` for the verified API reference and `nessie-openapi-spec.yaml` for the spec.

---

## 0. Scope and split — under 24 hours

Sections 1–4 describe the product. What is actually being built in the time available is
narrower, and the cuts are deliberate.

### Shipping

| Area | Owner | State |
|------|-------|-------|
| Mock data (CFDI + Nessie seeding) | — | **done** — `mocks/`, 3 scenarios verified |
| CFDI parser | — | **done** — `engine/cfdi_parser.py` |
| Reconciliation CFDI ↔ Nessie | — | **done** — `engine/reconcile.py` |
| Learned payment terms | — | **done** — `engine/terms.py` |
| Forecast engine + breach + classifier | teammate | to build — contract in §5 Phases 3–6 |
| Supabase schema and wiring | project owner | to build — schema in §3 |
| React + Tailwind front end | — | to build — views in §6 |

Every finished module runs standalone as its own check: `python3 engine/reconcile.py`,
`python3 engine/terms.py`, `python3 mocks/generate.py`.

### Cut

- **The bank / portfolio view.** It is the Capital One differentiator and costs little —
  the same engine in a loop — but the product stands without it and does not stand
  without the business view. Section 4's adapter layer and §5 Phase 8 stay as design
  narrative, not as code.
- **Any simulated bank connection.** A fake OAuth handshake returning a token nothing
  consumes is theatre. Replaced by account-number entry (§6).
- **Credit blacklist.** Considered and rejected — see §7.

### The interface between the two builders

The forecast engine consumes what reconciliation already produces and nothing else:

```python
rec    = reconcile(batch, deposits, purchases)   # engine/reconcile.py
terms  = learn_terms(rec.matched)                # engine/terms.py
tuned  = apply_terms(rec, terms)

tuned.expected_collections(HORIZON_DAYS)  # -> {date: amount}, already risk-discounted
tuned.open_receivables                    # -> [OpenItem] with expected_date, amount
tuned.open_payables
rec.cash_sales                            # deposits with no invoice — retail norm
```

Plus, straight from Nessie: `account.balance`, `deposits`, `purchases`, `bills`.

---

## 1. The idea

We are not a bank. We are the **intermediary between banks and the SMB**.

The product ingests a business's invoices (CFDI) and its real bank position, forecasts
30-day liquidity, and when a shortfall appears it works down a ladder of solutions —
**cheapest first, credit last**:

1. Accelerate a receivable (collect early, possibly with a discount)
2. Shift a payable or payroll date
3. Draw on the existing cash buffer
4. **Only if none of the above closes the gap:** shop credit across banks for the best rate

> "On the 24th you are 25,300 short for payroll. You do not need a loan — collecting
> invoice A-4471 four days early closes it. If you would rather not push that client,
> here are three credit lines, cheapest first."

### Why being the intermediary is the whole point

A bank's own tool sells the bank's own loan. It cannot credibly tell a business *not* to
borrow. We can — and that inverted incentive is both the differentiator and the reason
banks want the funnel: applications arriving here are pre-qualified against a real 30-day
projection, and the ones that would have defaulted were talked out of it.

B2B on every side: SMB as the user, banks as the counterparty. No consumer anywhere.

## 2. Two data layers — the gap between them is the product

The core architectural claim. CFDI and Nessie are not competing sources.

```
CFDI (uploaded XML)   →  OBLIGATION layer
                         who owes us, who we owe, due dates, terms (PUE / PPD)

Nessie (Capital One)  →  SETTLEMENT layer
                         account.balance = actual money in the bank
                         deposits / withdrawals / purchases = movements that happened
```

An issued CFDI is **not cash** — it is a promise. The entire working-capital problem lives
in the delta between *invoiced* and *collected*.

From CFDI alone you cannot say "you are 25,300 short on the 24th", because you do not know
the opening balance. **CFDI gives the flows; Nessie gives the position.** Neither
substitutes for the other.

### Obligations are exact, not predicted

Nessie's `bills` carry a complete obligation record. All 151 in the dataset have both
`recurring_date` and `upcoming_payment_date`; status splits 105 `pending`, 45 `recurring`,
1 `cancelled`.

```json
{
  "payee": "Campus housing",
  "payment_amount": 450.0,
  "payment_date": "2026-09-20",
  "recurring_date": 1,
  "upcoming_payment_date": "2026-10-01",
  "status": "pending",
  "account_id": "5bc495a1-3d2b-4b15-8dcd-334691933d48"
}
```

So the fixed-outflow side of the forecast needs no model. Only inflows are forecast, which
makes the critical claim — "you cannot cover this obligation" — arithmetic rather than
estimation.

## 3. Architecture

**Stack:** React + Tailwind · FastAPI · Pandas + NumPy · Supabase · Nessie.

```
┌────────────────────────────────────────────────┐
│  React + Tailwind                              │
│  CFDI upload · projection · action ladder      │
└───────────────────┬────────────────────────────┘
                    │
┌───────────────────▼────────────────────────────┐
│  FastAPI                                       │
│                                                │
│  CFDI parser     ──► obligations, receivables  │
│  Forecast engine ──► 30-day dual-band curve    │  Pandas
│  Breach detector ──► date · amount · obligation│  + NumPy
│  Gap classifier  ──► timing vs structural      │
│  Action ladder   ──► counterfactual simulator  │
│  Rate shopper    ──► ranked offers             │
└─────┬─────────────────────────────────┬────────┘
      │                                 │
┌─────▼──────────────────┐  ┌───────────▼────────────────────┐
│  Supabase              │  │  BankAdapter (interface)       │
│  auth (tenant per SMB) │  │   ├── CapitalOneAdapter ← LIVE │
│  storage (CFDI XML)    │  │   ├── BanorteAdapter    ← mock │
│  postgres:             │  │   ├── BBVAAdapter       ← mock │
│   invoices             │  │   └── SantanderAdapter  ← mock │
│   reconciliation       │  └────────────────────────────────┘
│   forecast runs        │
│   offers               │
└────────────────────────┘
```

### Where state lives

Nessie is the **bank of record** and is never our database. It holds position, settled
flows and obligations, and we read them every run rather than caching them as truth.

Supabase holds everything Nessie has no concept of:

- **storage** — uploaded CFDI XML, kept for re-parsing when the parser improves
- **invoices** — parsed CFDI: issuer, receiver, amount, date, terms, aging
- **reconciliation** — the CFDI ↔ Nessie flow matching from Phase 2
- **forecast runs** — each projection snapshotted, so a recommendation can be replayed
  against the numbers that produced it
- **offers** — quotes returned by each adapter, with the ranking that was shown
- **auth** — one tenant per SMB, which a broker needs from day one

Snapshotting forecast runs matters more than it looks: when a judge asks "why did it
recommend that?", the answer is a stored row, not a re-run that may now differ.

### Schema

```sql
tenants          id, razon_social, rfc, account_id, account_number_last4, created_at
invoices         uuid PK, tenant_id, direction, tipo, metodo_pago,
                 counterparty_rfc, counterparty_name,
                 fecha, due_date, total, subtotal, storage_path, created_at
reconciliations  id, tenant_id, invoice_uuid, flow_id, flow_kind, method, flow_date
terms            tenant_id, counterparty_rfc, days, observations, spread, learned
obligations      id, tenant_id, payee, amount, day_of_month,
                 kind, rigidity, slack_days, source
forecast_runs    id, tenant_id, created_at, horizon_days, balance_at_run,
                 curve jsonb, breach jsonb, verdict
suppressions     tenant_id, reason, forecast_run_id, expires_at
```

`invoices.uuid` is the CFDI folio fiscal and **must carry a unique constraint**. It is the
natural key, and without it re-uploading the same SAT export double-counts the receivable
book. That failure does not raise an error — it silently produces a recommendation to
collect money that does not exist.

`account_number` is never stored in full: the tenant types it once, the server resolves it
to an `account_id`, and only the last four digits are kept for display.

### Storing the CFDI XML

```
upload ZIP
  -> unzip in FastAPI (the ZIP itself is never stored)
  -> each XML to Storage:  cfdi/{tenant_id}/{uuid}.xml
  -> parse ONCE
  -> extracted fields to invoices
```

**Never parse on read.** Queries hit Postgres; Storage is not touched again in normal
operation. A dashboard that parses on every load re-reads hundreds of objects per page
view.

The raw XML is still worth keeping: to re-parse when the parser improves, because the UUID
and seal are the legal artefact if an amount is disputed, and for SAT traceability.

### Forecast engine — Pandas and NumPy

The whole of Phase 3 is a few vectorized operations, no ML dependency:

| Step | Implementation |
|------|----------------|
| baseline | `df.resample('D').sum().median()` |
| day-of-week factors | `df.groupby(df.index.dayofweek).median()` normalized |
| dominant period | `numpy.correlate` on the mean-centred series, peak after lag 0 |
| dispersion / p20 band | `df.quantile(0.20)` on the daily distribution |
| 30-day projection | one DataFrame indexed by date, cumulative sum of net flow |

Keeping the projection in a single date-indexed DataFrame is what makes Phase 7 cheap: a
counterfactual is the same frame with one row's amount or date changed, re-summed.

## 4. The bank adapter layer

An aggregator needs one connectivity contract that every bank implements. Capital One is the
only one that is real.

```python
class BankAdapter(Protocol):
    def get_position(self, account_id: str) -> Money: ...
    def get_settled_flows(self, account_id: str, since: date) -> list[Flow]: ...
    def get_obligations(self, account_id: str) -> list[Obligation]: ...
    def quote_credit(self, profile: CreditProfile, amount: Money, term_months: int) -> Offer: ...
    def apply(self, offer: Offer) -> Application: ...
```

### What is real vs mocked — state this explicitly

| Method | Capital One | Other banks |
|--------|-------------|-------------|
| `get_position` | **real** — `GET /accounts/{id}` → `balance` | mock |
| `get_settled_flows` | **real** — `/deposits`, `/withdrawals`, `/purchases` | mock |
| `get_obligations` | **real** — `/accounts/{id}/bills` | mock |
| `apply` | **real** — `POST /accounts/{id}/loans` | mock |
| `quote_credit` | **mocked** | mock |

`quote_credit` is mocked for *every* bank, Capital One included. Nessie's `Loan` schema has
`amount`, `monthly_payment`, `credit_score`, `type`, `status` and **no interest rate field**
— verified against the spec. No bank exposes live pricing to a hackathon either. So the
quoting layer is ours: a `credit_score → rate` curve per bank, each mock given a distinct
risk appetite so the ranking has something to rank.

Implied APR is recoverable from `monthly_payment` against `amount` and term, which is how a
Capital One loan created through `apply` is priced back into the comparison.

### Why the mocks are honest, not filler

The claim being demoed is *"we compare banks and route you to the cheapest option that
fits"*. What must be real for that claim to hold is the **position, the flows, the
obligations and the application rail** — and all four are real, against Capital One. Rate
curves are policy parameters, not infrastructure. Replacing a mock with a real bank is one
class, and the demo says so out loud rather than implying four live integrations.

## 5. Workflow

### Phase 0 — Seed (once)

Nessie's sandbox starts empty, and its global dataset is consumer-shaped — bills are
`Campus housing` (47), `Mobile plan` (46), `Fit24`, `Geico`; accounts are `Scurry trip goal`,
`Spring break '27`, `PartyFund`; amounts run 15–65. That is a student paying rent, not an
SMB. Demoing over `/enterprise` would read as B2C and undercut the whole framing, so we
create our own businesses.

| Source | Nessie call |
|--------|-------------|
| business | `POST /customers` |
| operating account | `POST /customers/{id}/accounts` — `balance` = current cash |
| suppliers | `POST /merchants` |
| sales history | `POST /accounts/{id}/deposits` |
| restock history | `POST /accounts/{id}/purchases` |
| payroll / premises rent / utilities | `POST /accounts/{id}/bills` with `recurring_date` |

`DepositCreate` requires `transaction_date`, so sales history backdates correctly.
`PurchaseCreate` requires only `merchant_id`, `medium`, `amount` — see Open Risks.

Seed several businesses with **different cash shapes**: one steady, one strongly seasonal,
one genuinely sinking. If they all look alike, the gap classifier has nothing to prove on
stage.

### Phase 1 — Ingest

```
CFDI upload  → receivables (emitidos) + payables (recibidos) + terms
Nessie       → GET /accounts/{id}              balance
               GET /accounts/{id}/deposits     settled inflows
               GET /accounts/{id}/purchases    settled outflows
               GET /accounts/{id}/withdrawals  settled outflows
               GET /accounts/{id}/bills        fixed obligations (exact)
```

A 404 here means *empty*, not *wrong URL* — `GET /accounts/{id}/transfers` returns
`404 "No transfers found for this account"`. Treating it as an error stops the pipeline on
the first quiet account.

### Phase 2 — Reconcile the two layers

Match settled Nessie flows against CFDI documents. What is left over is the working capital
picture:

- CFDI issued, no matching deposit → **open receivable**, aged
- CFDI received, no matching purchase → **open payable**, with its due date
- Deposit with no CFDI → cash sale (common in abarrotes)

Aging on open receivables is what makes rung 1 of the ladder possible at all.

### Phase 3 — Decompose inflows

From settled deposits:

- **baseline** — daily median, not mean; one 10x day destroys a mean
- **day-of-week factors** — 7 multipliers
- **dominant period** — autocorrelation over the series
- **dispersion** — needed for the pessimistic band

Detecting the period instead of hardcoding it is what generalizes this. For Mexican SMBs the
*quincena* cycle falls out on its own, and the same code picks up a net-30 invoicing cycle.

### Phase 4 — Project 30 days

```
for d in 1..30:
    inflow  = baseline × dow[d] × period[d]
            + receivables_due_on(d) × collection_probability
    outflow = bills_due_on(d) + payables_due_on(d) + projected_variable(d)
    balance[d] = balance[d-1] + inflow − outflow
```

Two curves, not one: expected, and **pessimistic** (inflow at p20, collection probability
discounted). A liquidity decision is taken against the bad scenario; a single mean line is
not actionable.

`bills_due_on(d)` expands `payment_date` for `pending` bills and `recurring_date` for
`recurring` ones — both occur in the data.

### Phase 5 — Detect the breach

The event is not "the balance dips". It is "an obligation cannot be covered".

```
for each obligation due on day d:
    if balance_pessimistic[d] < obligation.amount:
        breach = { date: d, shortfall: amount − balance[d], obligation: payee }
```

First failure wins. Date, amount, and the specific thing that goes unpaid.

### Phase 6 — Classify the gap

```
net_30d = Σ inflow − Σ outflow

net ≥ 0 and balance recovers  →  TIMING GAP         → the ladder can fix this
net < 0 sustained             →  STRUCTURAL DEFICIT → credit makes it worse
```

The single most important piece of intelligence in the system. A dip that recovers is a
calendar problem. A sustained shortfall is insolvency, and lending into it harms the
business.

### Phase 7 — Work the ladder

Each rung is a **simulated counterfactual against the real Nessie balance**, not a
suggestion. Re-run Phase 4 with the change applied and check whether the breach clears.

```
TIMING GAP
 ├─ 1. Accelerate a receivable
 │       open receivables that could land before the breach date
 │       cost = early-payment discount offered
 ├─ 2. Shift a payable
 │       never past a hard legal date; slack is derived, not configured
 │       cost = supplier relationship risk, which is NOT zero
 ├─ 3. Draw down buffer
 │       cost = zero, if the buffer survives the rest of the horizon
 └─ 4. Credit — only if 1–3 leave a residual gap
         amount = residual shortfall + margin
         term   = days underwater
         → rate shopper ranks offers across adapters
         → apply() on the winner; real for Capital One

STRUCTURAL DEFICIT
 └─ Say so. Model the loan payment against the projection, and if it worsens the
    balance, decline to recommend it and show why.
```

That last clause is deliberate. A broker that sometimes refuses to place a loan is the one
whose recommendations mean anything.

### Rung 2 has a real cost, and it is derivable

Treating "delay a supplier payment" as free is how a tool like this loses a business its
suppliers. Uniform terms are not a feature — they are the failure mode. Slack per supplier
comes from what the data already shows:

- **Dependence.** Restock frequency, plus whether the merchant list holds alternatives in
  the same category. A supplier delivering every three days with no substitute is
  untouchable regardless of arithmetic.
- **Proven tolerance.** If this business has already paid this supplier late and the
  relationship continued, that tolerance is observed rather than guessed. No late payment
  in the history means no evidence of slack, so assume none.
- **Concentration.** Share of total spend. Delaying the largest supplier is the highest-risk
  move available and should rank below drawing a credit line, not above it.

Where the data is silent, the answer is zero slack. The ladder proposes moving a payable
only when it can point at evidence, and payroll and taxes never move at all.

### Phase 8 — Two views

```
one SMB    → breach alert + ranked ladder        (the business)
all SMBs   → portfolio ranked by breach risk     (the bank's funnel)
             + pre-qualified applications
```

Both read our own seeded sandbox through the customer key. The bank view is the same engine
in a loop, and it is what a bank is actually buying: pre-qualified demand.

The enterprise key stays in the design as the "how this works at bank scale" narrative, not
as a demo data source.

## 6. Views

Business view only. The bank view is cut (§0).

| View | Purpose | Depends on |
|------|---------|-----------|
| Login | Supabase auth, one tenant per SMB | — |
| Integration | Razón social · account number · CFDI upload · confirm obligations | Login |
| Dashboard | "What is happening?" — position, 30-day dual-band curve, open receivables and payables | Integration |
| Warnings / solutions | System **push**: a breach was detected, here is the ranked ladder | Dashboard data |
| Simulations | User **pull**: manual what-if ("delay Bimbo 5 days?") | Dashboard data |

### The integration view — four fields

| # | Field | How it arrives |
|---|-------|----------------|
| 1 | Razón social | typed |
| 2 | Account number | typed — see below |
| 3 | CFDI | ZIP / multi-file upload |
| 4 | Obligations | **pre-filled** from Nessie `bills`; the tenant sets rigidity and slack only |

Fields 2 and 4 are not free data entry, and field 4 is the reason the form is cheap to
build: `bills` already carry `payee`, `payment_amount` and `recurring_date`, so the tenant
confirms rather than types. The RFC is likewise derived from the uploaded CFDI and only
confirmed.

`payroll` and `tax` obligations are `hard` and **not editable**. Shifting payroll past its
legal date violates the LFT, so the engine must not be able to propose it even with the
user's consent. `slack_days` defaults to **0**: no stated slack means no slack.

### Account number, not a dropdown

One API key sees every account in the sandbox, so a dropdown would show one business the
other tenants. The tenant types their account number instead.

**The lookup must be server-side.** A front end that calls `GET /accounts` and filters in
JavaScript leaks the full list into the browser's network tab — the same exposure, merely
hidden.

```
POST /connect  {account_number}
  -> FastAPI resolves it with the server-side key
  -> stores tenant_id -> account_id
  -> returns only that account's {nickname, balance}
```

A miss returns "not found", never "exists but is not yours".

Demo account numbers:

| Business | Account number | Verdict |
|----------|----------------|---------|
| Abarrotes La Esperanza | 1808841382767043 | no breach |
| Comercializadora del Bajio | 3505305311636760 | timing gap |
| Minisuper El Roble | 9424778033669495 | structural |

### Two things to settle before building

**Warnings and Simulations are the same engine.** The split is *who initiates*: warnings are
pushed when the breach detector fires; simulations are pulled when the user changes an
input. Both call the same Phase 7 counterfactual. Define this now or the same screen gets
built twice.

**First-run order is Login → Integration → everything else.** Dashboard, warnings and
simulations are all empty until integration completes, so the empty state is not a polish
item — it is the first screen anyone sees, including the judges.

## 7. Input data contract

### Where each datum comes from

| Datum | Source | How |
|-------|--------|-----|
| RFC | CFDI — `cfdi:Emisor/@Rfc` | **Infer it.** The RFC appearing constantly in the `Emisor` position across the batch is theirs. Ask for confirmation, not entry. |
| Operating account | Nessie — `GET /accounts?key=` | User picks from the enumerated list. CFDI carries no bank account. |
| Hard-date obligations | Neither | Rules classifier plus user override, stored per tenant. |

### Classifying obligation rigidity

Nessie's `bills` carry no rigidity field — `status` is `pending`/`recurring`/`cancelled`,
nothing legal. The SAT issues no CFDI for our own tax payments. So:

```
TipoDeComprobante="N" + nomina12:Nomina    → PAYROLL   → hard (LFT)
fiscal calendar (IVA / ISR, day 17)        → TAXES     → hard (in no dataset at all)
TipoDeComprobante="I" + MetodoPago="PPD"   → SUPPLIER  → slack, user-editable
```

Payroll is unambiguous: `TipoDeComprobante="N"` with the `nomina12:Nomina` complement *is*
a payroll receipt. Tax deadlines are calendar knowledge we hardcode — they arrive in no
document.

### How much CFDI is needed

| Uploaded | Unlocks |
|----------|---------|
| One CFDI | Nothing. A single invoice is not a state or a history. |
| **All open CFDI** (issued uncollected + received unpaid) | The minimum. Ladder rungs 1 and 2 do not exist without it. |
| **+ 6–12 months of history** | Per-client payment behaviour (real DSO), which is what makes rung 1 credible. |

To say "collect from Ferretería López, they pay in 4 days" we need how *López* pays, not an
industry average. That comes from matching historical CFDI against settled deposits.

The SAT allows bulk CFDI download, so requesting a ZIP of the last 6–12 months is realistic.
**Design the upload for multi-file or ZIP from the start**, never a single file.

### Payment terms are learned, not assumed

CFDI records that a PPD invoice is paid later but **never says when** — terms are
commercial, not fiscal, so the SAT does not collect them. A single global default is
wrong twice over: it describes no real business, and it does not generalize to an SMB
whose clients pay at 15, 60 or 90 days.

Reconciliation already produces the answer. Every matched invoice carries its issue date
and the date the money actually landed, and that difference *is* that counterparty's
behaviour:

```
observed history  ->  median issue-to-settlement lag per counterparty
no history        ->  NET_TERMS_DAYS (cold start only)
```

The default stops being an assumption about everybody and becomes a fallback for a
counterparty we have never been paid by. Measured on the seeded scenarios:

| Client | Learned | Spread | Verdict |
|--------|---------|--------|---------|
| Tiendas Del Valle | 15d | 2d | reliable |
| Super Mercados Norte | 45d | 2d | reliable |
| Autoservicio La Central | 38d | 30d | **variable — do not trust the date** |
| Cocina Economica Doña Mari | 28d | 4d | reliable |

The spread matters as much as the median. A counterparty whose lag swings 30 days has a
median that means nothing operationally, and rung 1 must not present its landing date as
dependable.

**Why this is worth the effort:** on `bajio` the learned terms leave the 30-day
collection total completely unchanged at 180,625 while moving every landing date — one
invoice from day 22 to day 7, another from day 12 to day 27. An aggregate metric would
report that nothing happened. The liquidity decision changes entirely.

`NET_TERMS_DAYS` and `HORIZON_DAYS` both default to 30 but are unrelated quantities —
one a commercial term, the other a projection window. They are separate config so that
changing the forecast horizon cannot silently reprice every client's credit terms.

### The PUE / PPD trap

`MetodoPago="PUE"` means **already paid**. It is not a receivable.

Only `PPD` invoices are open receivables. Treating every issued CFDI as a receivable inflates
the book massively and makes rung 1 recommend collecting invoices that are already collected.
Filter on `MetodoPago="PPD"` and cross-check the payment complement.

### No credit blacklist — suppression with an expiry instead

A permanent "never offer credit to this SMB" list was considered and rejected.

**It is already computed.** The timing-vs-structural classifier *is* the decision not to
offer credit. A blacklist duplicates it as stored state, and stored state goes stale: a
business classified structural in September may be healthy in December, and the list would
keep refusing it. **Eligibility is a function, not a state** — evaluated fresh each run
against today's data. A function cannot go stale.

**It also inverts the product's own posture.** The differentiator is being able to say
"do not borrow" as revisable advice on the client's side. A blacklist is a permanent
judgement about a business, held by the intermediary — the thing banks do badly and this
product exists to improve on.

**And it edges toward a regulated activity.** In Mexico, maintaining a register of
businesses denied credit resembles what a *sociedad de información crediticia* does (Buró
de Crédito, Círculo de Crédito), which requires authorisation. Whether a broker's internal
list falls under it is a question for counsel — but "we keep our own blacklist" is an
awkward answer to give a judge at a banking hackathon.

What gets built instead, derived from the same classifier:

```jsonc
{
  "rfc": "...",
  "reason": "structural_deficit",
  "forecast_run_id": "...",        // the snapshot that produced it — auditable
  "expires_at": "...",             // self-clearing, no manual removal
  "lifts_when": "verdict is no longer structural"
}
```

It expires on its own, points at its evidence so the business can see why, and lifts on
data rather than on paperwork.

**The one legitimate hard exclusion** is sanctions lists and declared bankruptcies — and
those have a defining property: they come from outside. We consume them, we do not author
them. That is compliance, not opinion. If we wrote the entry, it is a temporary
suppression with evidence; if an authority wrote it, it is a hard filter.

### What we never ask for

**Never the bank API key.** Nessie has no OAuth — the spec contains zero consent flow, only
`ApiKeyAuth` as a query parameter — but an input reading "paste your bank API key" is the
credential-sharing antipattern and reads as a red flag in any fintech review.

The key lives in server-side environment config. The "Connect bank" button simulates the
consent handshake and stores a token reference in Supabase. The key never reaches the browser.
In production this is open banking under Ley Fintech, or an aggregator (Belvo, Finerio,
Prometeo).

## 8. Mock data generator

We have no real company, so both layers are synthetic. The generator is a deliverable, not a
throwaway script.

### One generator, two outputs

```
scenario definition (business · 12 months · cash shape)
        │
        ├──► CFDI XML   issued PPD/PUE · received · payroll (N)
        └──► Nessie     deposits settling a SUBSET · purchases · bills
```

Generating the two sides independently is the failure mode: Phase 2 would reconcile nothing
and the demo would show 100% unmatched, which reads as a broken product rather than as test
data. One scenario, both outputs, shared identifiers.

**Leave some PPD invoices deliberately unsettled.** Those are the open receivables the ladder
acts on. That is the demo, not a gap in the data.

### Scenarios

Three businesses with distinct cash shapes, so the Phase 6 classifier has something to prove:

| Scenario | Shape | Expected verdict |
|----------|-------|------------------|
| Healthy | inflow comfortably covers obligations | no breach |
| Timing gap | net positive over 30 days, dips below payroll mid-month | TIMING → ladder resolves it |
| Structural | outflow exceeds inflow persistently | STRUCTURAL → decline to recommend credit |

### What is fake, and what must not be

CFDI mocks are **structurally** realistic with fake `UUID` and `Sello`. Making them
SAT-valid would require a CSD certificate, so **the parser must not validate the seal** —
otherwise it can never be tested.

Build the generator from a real sample CFDI as a structural template rather than from the
specification; catalogues and attribute casing are where the time goes.

## 9. Where Capital One is load-bearing

Remove Capital One and three things break. Worth being able to answer directly when asked
why the sponsor API is not decorative:

1. **No cash position.** `account.balance` is the only real starting point; CFDI cannot
   supply it.
2. **Nowhere to simulate.** The ladder's counterfactuals run against a real bank sandbox,
   which is what separates them from a spreadsheet.
3. **Nowhere to land the offer.** `POST /accounts/{id}/loans` makes the winning application
   real instead of a mockup.

## 10. Where Nessie does not help

- **No accounts receivable.** No invoice entity at all. Receivables come entirely from CFDI.
- **No interest rates.** `Loan` carries no rate field, so pricing is our layer.
- **`transfers` is thin.** The seeded record has only date, amount and description — no
  payer/payee. Do not use it as an inter-business payment rail.

## 11. Build order

Phases 0, 1 and 2 and the learned-terms layer are done (§0). What remains, in order:

1. **Phases 3, 4, 5** — decompose inflows, project 30 days, detect the breach. The
   smallest slice that shows something real. Consumes the reconciliation output in §0.
2. **Phase 6** — the timing-vs-structural classifier. One comparison, and the single most
   important piece of intelligence in the system.
3. **Supabase wiring** — schema in §3, then the integration view's four fields.
4. **Phase 7** — the ladder. Rungs 1 and 2 already have their data.
5. Dashboard, then warnings and simulations off the same engine.

If time collapses, the seeded scenarios already carry the three verdicts, so the classifier
can be demonstrated against `mocks/out/seed-manifest.json` before any front end exists.

### Demo path

Log in as Comercializadora del Bajio, account `3505305311636760`. It has a payroll breach
on day 3 with a 24,600 shortfall, four open receivables totalling 212,500, and learned
terms that move those collections from days 12–28 to days 7–27. It is the one scenario
where every part of the product has something to say.

## 12. Deliberate non-goals

- **No neural forecasting.** Seasonal decomposition beats a model trained on weeks of sparse
  data at a 30-day horizon, and it explains itself to a judge and to a shopkeeper. "Your
  Thursday before payday is your worst cash day" sells; a weight vector does not.
- **No real multi-bank integration.** Adapters are mocked by design, and we say so.
- **No simulated bank connection.** A fake consent handshake returning a token nothing
  consumes is theatre. Account-number entry, and one honest sentence in the pitch about
  what production would do instead.
- **No credit blacklist.** Rejected on design and regulatory grounds — see §7.
- **No bank / portfolio view** in this build. Design retained in §4 and §5 Phase 8.
- **No CFDI cancellation, complemento chains, or tax computation.** Parse only what the
  forecast needs: issuer, receiver, amount, date, terms.
- **No multi-currency or multi-entity consolidation.**

## 13. Open risks

| Risk | Impact | Action |
|------|--------|--------|
| ~~`purchase_date` backdating unverified~~ **RESOLVED** | — | Verified: `purchase_date` is accepted on create and honoured despite being absent from `PurchaseCreate`. Backdated restock history works. |
| `balance` is immutable after account creation. Posted flows do not move it, and `PUT /accounts/{id}` ignores the field while returning 202 and echoing the old value. | A seeded scenario cannot be re-tuned through the balance; a wrong opening balance means deleting and recreating the account. | Set the balance in the creating `POST`. Tune scenarios through `bills`, which `PUT` honours in full. |
| Auth enforcement is route-dependent. `POST /accounts/{id}/loans` returns `"Invalid API key."`, while purchases and withdrawals return field-validation errors first. | A 400 is not proof the key works, and the 401 path exists on some routes only. | Validate keys against `GET /customers`. |
| `Purchase`, `Withdrawal` and `Transfer` are absent from the OpenAPI spec. | Generated clients are incomplete. | Shapes recovered from live responses; hand-write those types. |
| Fresh sandbox is empty. | Nothing to forecast until seeded. | Phase 0 is a hard dependency for any live demo. |
| Nessie's global dataset is consumer data, not SMB data. | Demoing over `/enterprise` reads as B2C. | Seed our own SMBs; never demo `/enterprise`. |
| CFDI parsing is the least certain component. | Rung 1 of the ladder depends on it. | Build it after the engine works; hardcode receivables until then. |
| Another team has seeded business records into the shared dataset. | Shared data may shift under us. | Depend only on our own sandbox for anything demoed. |

---

*Nessie behavior verified against `https://prod-api.nessieisreal.com` on 2026-09-11.*
