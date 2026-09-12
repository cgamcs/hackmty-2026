# SMB Working Capital Broker

Hackathon concept — Capital One Nessie API.
Track: SMB Cash-Flow & Working Capital Intelligence (B2B).

See `NESSIE-API.md` for the verified API reference and `nessie-openapi-spec.yaml` for the spec.

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
 ├─ 2. Shift a payable or payroll date
 │       only obligations with slack; never past a hard legal date
 │       cost = zero, or a supplier relationship cost
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

| View | Purpose | Depends on |
|------|---------|-----------|
| Login | Supabase auth, one tenant per SMB | — |
| Integration config | CFDI upload · bank connection · hard-date obligations | Login |
| Dashboard | "What is happening?" — position, 30-day dual-band curve, open receivables and payables | Integration |
| Warnings / solutions | System **push**: a breach was detected, here is the ranked ladder | Dashboard data |
| Simulations | User **pull**: manual what-if ("delay Bimbo 5 days?") | Dashboard data |

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

### The PUE / PPD trap

`MetodoPago="PUE"` means **already paid**. It is not a receivable.

Only `PPD` invoices are open receivables. Treating every issued CFDI as a receivable inflates
the book massively and makes rung 1 recommend collecting invoices that are already collected.
Filter on `MetodoPago="PPD"` and cross-check the payment complement.

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

1. **Phase 0** — seed several SMBs with distinct cash shapes. Nothing demos without it.
2. **Phases 1, 3, 4, 5** — ingest, model, project, detect breach. Smallest real slice.
3. **Phases 6, 7** — classifier and ladder. This is what wins.
4. **Phase 2** — CFDI reconciliation. Needed for rung 1 of the ladder.
5. **Phase 8** — portfolio loop. Nearly free once the engine exists.

If time collapses, a hardcoded receivables list keeps the ladder demoable while the CFDI
parser lands.

## 12. Deliberate non-goals

- **No neural forecasting.** Seasonal decomposition beats a model trained on weeks of sparse
  data at a 30-day horizon, and it explains itself to a judge and to a shopkeeper. "Your
  Thursday before payday is your worst cash day" sells; a weight vector does not.
- **No real multi-bank integration.** Adapters are mocked by design, and we say so.
- **No CFDI cancellation, complemento chains, or tax computation.** Parse only what the
  forecast needs: issuer, receiver, amount, date, terms.
- **No multi-currency or multi-entity consolidation.**

## 13. Open risks

| Risk | Impact | Action |
|------|--------|--------|
| `PurchaseCreate` has no date field; `Purchase` responses carry `purchase_date`. Backdating unverified. | Restock history collapses onto today and the outflow model breaks. | Test with a real customer key before writing the seeder. |
| Auth enforcement is route-dependent. `POST /accounts/{id}/loans` returns `"Invalid API key."`, while purchases and withdrawals return field-validation errors first. | A 400 is not proof the key works, and the 401 path exists on some routes only. | Validate keys against `GET /customers`. |
| `Purchase`, `Withdrawal` and `Transfer` are absent from the OpenAPI spec. | Generated clients are incomplete. | Shapes recovered from live responses; hand-write those types. |
| Fresh sandbox is empty. | Nothing to forecast until seeded. | Phase 0 is a hard dependency for any live demo. |
| Nessie's global dataset is consumer data, not SMB data. | Demoing over `/enterprise` reads as B2C. | Seed our own SMBs; never demo `/enterprise`. |
| CFDI parsing is the least certain component. | Rung 1 of the ladder depends on it. | Build it after the engine works; hardcode receivables until then. |
| Another team has seeded business records into the shared dataset. | Shared data may shift under us. | Depend only on our own sandbox for anything demoed. |

---

*Nessie behavior verified against `https://prod-api.nessieisreal.com` on 2026-09-11.*
