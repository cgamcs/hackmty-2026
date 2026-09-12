# Financial engine

The `financial_engine` package implements the explainable, per-SMB working-capital core of
the product. It combines the current bank position from Nessie with unsettled obligations
from CFDI, projects liquidity for 30 days, detects the first payment that cannot be covered,
and tests a cheapest-first recovery ladder before suggesting debt.

The formulas are reusable across businesses, but every run processes exactly one authenticated
tenant. Data from different SMBs is never combined into one `BusinessSnapshot`.

## End-to-end flow

```text
Authenticated tenant
        |
        +-- Nessie account balance ------------------------+
        +-- deposits / purchases / withdrawals ------------+--> BusinessSnapshot
        +-- recurring bills -------------------------------+
        +-- uploaded CFDI XML -> reconcile -> learned terms+
                                                               |
                                                               v
                                                     FinancialEngine
                                                               |
                 +----------------+----------------+------------+-------------+
                 |                |                |                          |
                 v                v                v                          v
          30-day forecast   breach + verdict   health/resilience      recovery + credit
```

For the live path, Nessie is read on every run. The manifest is used only to resolve the
demo tenant's `account_id`; it is not used as a source of balances or transactions.

## 1. Input contract

`FinancialEngine` consumes a normalized `BusinessSnapshot`:

- `current_balance`: current operating-account balance from Nessie.
- `historical_flows`: settled deposits as positive amounts and purchases/withdrawals as
  negative amounts.
- `obligations`: exact future payments. Payroll and taxes use `hard_deadline=True`.
- `receivables`: issued PPD CFDI that reconciliation did not match to a deposit.
- `available_cash_buffer`: a separate reserve that may be transferred to operations.
- `safety_buffer`: the minimum cash balance the tenant wants to preserve.

Dates use `datetime.date`, and every amount in a snapshot must use the same currency. A
production persistence layer should store money as integer minor units or fixed-precision
decimal values.

## 2. Live ingestion and CFDI reconciliation

`snapshot_from_live_nessie(...)` fetches one account and its related collections:

```text
GET /accounts
GET /accounts/{id}/deposits
GET /accounts/{id}/purchases
GET /accounts/{id}/withdrawals
GET /accounts/{id}/bills
```

It then runs the modules delivered with the data pipeline:

```python
batch = parse_dir(cfdi_directory)
reconciled = reconcile(batch, deposits, purchases)
terms = learn_terms(reconciled.matched)
tuned = apply_terms(reconciled, terms)
```

Reconciliation first looks for the CFDI reference in the Nessie transaction description.
When no reference exists, it uses an amount tolerance and a settlement-date window. The
remaining issued PPD invoices become open receivables; unmatched received invoices become
open payables. PUE invoices are not treated as receivables.

Payment terms are learned per customer from the median issue-to-settlement lag of matched
historical invoices. A 30-day cold-start default is used only when that customer has
insufficient history. Overdue but still-open receivables land on the first forecast day
instead of disappearing outside the horizon.

## 3. Historical cash-flow profile

The engine builds a calendar-day history and separates income from variable spending. For
each weekday it calculates:

```text
expected income = median(non-zero income) x observed activity rate
pessimistic income = 20th percentile of all daily income observations
variable spending = median(non-zero spending) x observed activity rate
```

Using medians limits the effect of one unusually large transaction. Including the activity
rate prevents sparse deposits or supplier purchases from being projected as if they happened
every day.

This implementation currently models weekday behavior and dispersion. Dominant-period
autocorrelation described in `CONCEPT.md` remains a future enhancement.

## 4. Thirty-day forecast

For every day in the horizon, the engine calculates two paths:

```text
expected inflow
  = expected historical income
  + receivables due that day x collection probability

pessimistic inflow
  = p20 historical income
  + receivables due that day x max(collection probability - 0.25, 0)

outflow
  = projected variable spending
  + exact Nessie bills
  + open CFDI payables

balance[d]
  = balance[d - 1] + inflow[d] - outflow[d]
```

The output contains one `ForecastPoint` per day with expected and pessimistic inflows,
variable spending, exact obligations, and both ending balances. The pessimistic path drives
liquidity decisions.

## 5. Breach detection

A breach is not merely a negative chart point. Before each exact obligation is paid, the
engine asks whether pessimistic available cash can cover it. Hard obligations receive first
claim on cash when several payments share a date.

The first failure returns:

```json
{
  "date": "2026-09-15",
  "obligation": "Nomina Operativa Quincenal",
  "amount": 78000,
  "shortfall": 35689.16
}
```

This makes the warning actionable: it names the date, payment, full amount, and missing cash.

## 6. Gap classification

The engine classifies the projection as:

- `none`: every obligation can be covered.
- `timing`: an obligation fails temporarily, but cash recovers within the horizon.
- `structural`: the pessimistic path does not recover and additional debt would worsen the
  underlying deficit.

This distinction controls both the Recovery Plan and financing eligibility.

## 7. Health Score

`health_score` ranges from 0 to 100 and combines:

- expected inflow-to-outflow coverage;
- whether the minimum expected balance preserves the safety buffer;
- the 30-day direction of the expected ending balance.

The score is capped at 100 and is intended as an explainable operating-health indicator, not
a regulated credit score.

## 8. Resilience Score

`resilience_score` also ranges from 0 to 100. It measures the ability to absorb downside
using:

- operating cash plus the separate available reserve;
- approximate days of spending covered;
- the minimum pessimistic balance relative to the safety buffer;
- the breach amount relative to total projected outflow.

A healthy expected curve can therefore coexist with a lower resilience score when the bad
scenario falls deeply negative.

## 9. Stress Lab

Stress Lab uses the same forecast engine with changed inputs, so warnings and simulations
cannot disagree. A scenario may combine:

- percentage change in historical inflows;
- percentage change in variable expenses;
- delay in every open receivable;
- a one-time unexpected expense on a selected date.

```python
from financial_engine import FinancialEngine, StressScenario

stress = StressScenario(
    name="sales -25%, customer +5 days",
    inflow_change_pct=-0.25,
    receivable_delay_days=5,
    unexpected_expense=12_000,
)

result = FinancialEngine().simulate(snapshot, stress)
```

Several scenarios can be evaluated together:

```python
results = FinancialEngine().stress_lab(
    snapshot,
    [sales_down, delayed_customer, higher_costs],
)
```

## 10. Recovery Plan

For a timing gap, the engine works down a cheapest-first ladder. Every step is a
counterfactual: the engine applies the change, reruns all 30 days, and marks whether that
step completes the plan or only improves it.

1. **Accelerate an open receivable.** Move an eligible PPD invoice before the breach and
   subtract its early-payment discount.
2. **Shift a supplier payable.** Allowed only when `slack_days > 0`. Silence means zero
   slack; payroll and taxes can never move. `relationship_cost` makes this action explicitly
   non-free.
3. **Draw the cash reserve.** Transfer only the amount needed, capped by the tenant's
   available reserve.
4. **Compare credit.** Reached only if the operational actions leave a residual timing gap.

Actions accumulate into one plan. `resolves_breach=False` means the action helps, but at
least one later obligation still fails inside the horizon. The first action marked `True`
completes the cumulative plan.

For a structural deficit, the ladder stops and recommends correcting the operating deficit
instead of adding debt service.

## 11. Financing decision

The result exposes a separate, explicit decision:

- `not_needed`: the baseline contains no breach.
- `covered_by_recovery_plan`: operational actions eliminate the gap without debt.
- `recommended`: a residual timing gap remains after receivables, proven payable slack, and
  cash reserves. The engine returns the residual, a 10% margin-rounded amount, and the number
  of days underwater.
- `not_recommended_structural`: projected cash generation cannot support more debt.

Eligibility is recalculated on every run. It is not stored as a permanent blacklist.

## 12. Output contract

```python
from financial_engine import FinancialEngine

result = FinancialEngine(horizon_days=30).forecast(snapshot)
payload = result.to_dict()
```

The result contains:

- `points`: both daily curves for all 30 days;
- `breach`: the first uncovered obligation, or `null`;
- `gap_type`;
- `health_score` and `resilience_score`;
- `recommendations`;
- `financing_decision`;
- `diagnostics`, including ending and minimum balances.

## 13. Running the engine

Run one demo SMB against the current Nessie API data:

```bash
PYTHONPATH=. python3 examples/analyze_live.py bajio
```

The default output is a complete human-readable report with the 30-day table. Alternative
formats are:

```bash
PYTHONPATH=. python3 examples/analyze_live.py bajio --summary
PYTHONPATH=. python3 examples/analyze_live.py bajio --json
```

The live path requires `API_KEY` in the repository `.env` or `engine/.env`. The key remains
server-side and must never be sent by the browser.

The deterministic offline scenarios remain available for regression checks only:

```bash
PYTHONPATH=. python3 examples/analyze_mocks.py bajio
```

Run the complete test suite with:

```bash
python3 -m unittest discover -s tests -v
```

## 14. Tenant isolation

The production backend must resolve the tenant from the authenticated session, then load the
stored `account_id` and CFDI records for that tenant. It must not trust a browser-provided
`company_id`, enumerate accounts in the front end, or expose another tenant's account data.

```text
Supabase session -> tenant_id -> account_id + invoices -> BusinessSnapshot -> result
```

The financial engine remains stateless: isolation is enforced while building the snapshot,
and each invocation receives data for exactly one SMB.
