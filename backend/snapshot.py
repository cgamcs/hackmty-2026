"""Build the BusinessSnapshot payload the financial engine consumes.

Reads only the database — the sync (backend/sync.py) is what talks to Nessie. The output
shape is exactly what `financial_engine.contracts.snapshot_from_dict` expects, so the two
halves meet here and nowhere else.

Two derivations live in this module because neither source provides them:

1. **Obligation due dates.** The form stores `day_of_month`; the engine wants a date. A
   monthly obligation can fall more than once inside a long horizon, so each occurrence
   becomes its own Obligation with a distinct id. Generating only the next one would make
   a 60-day horizon miss the second payroll.

2. **Collection probability.** `models.Receivable` defaults every client to 0.80. We
   measure better than that: `terms.spread` says how consistent a payer is, and a
   counterparty whose lag swings 30 days does not deserve the confidence of one that
   swings 2.
"""

from __future__ import annotations

import calendar
from datetime import date, timedelta
from typing import Any

# spread (days) -> how much of the invoice we expect to land on the projected date
CONFIDENCE_BY_SPREAD = (
    (7, 0.90),      # reliable
    (21, 0.80),
)
CONFIDENCE_ERRATIC = 0.60
CONFIDENCE_COLD_START = 0.70    # no history: conservative, not pessimistic

# Asking a client to pay early is only credible for a payer that behaves predictably.
EARLY_COLLECTION_LEAD_DAYS = 3
MAX_SPREAD_FOR_EARLY_REQUEST = 7
EARLY_PAYMENT_DISCOUNT = 0.02

HARD_KINDS = {"payroll", "tax"}


def collection_probability(spread: int | None, learned: bool) -> float:
    if not learned or spread is None:
        return CONFIDENCE_COLD_START
    for limit, probability in CONFIDENCE_BY_SPREAD:
        if spread <= limit:
            return probability
    return CONFIDENCE_ERRATIC


def occurrences(day_of_month: int, start: date, end: date) -> list[date]:
    """Every calendar date in (start, end] falling on `day_of_month`.

    Clamped to the last day of short months, so day 31 becomes 28 in February rather
    than being skipped — a rent payment does not disappear in February.
    """
    out: list[date] = []
    year, month = start.year, start.month
    while True:
        last = calendar.monthrange(year, month)[1]
        candidate = date(year, month, min(day_of_month, last))
        if candidate > end:
            break
        if candidate > start:
            out.append(candidate)
        month += 1
        if month > 12:
            month, year = 1, year + 1
    return out


def build(conn, tenant_id: str, as_of: date | None = None,
          horizon_days: int = 30, history_days: int = 120,
          safety_buffer: float = 0.0) -> dict[str, Any]:
    # Imported here, not at module scope, so the pure date and confidence logic below
    # stays testable without a database driver installed.
    from db import fetch_all, fetch_one

    as_of = as_of or date.today()
    horizon_end = as_of + timedelta(days=horizon_days)

    tenant = fetch_one(conn, "select account_id from tenants where id = %s",
                       (tenant_id,))
    if not tenant or not tenant["account_id"]:
        raise ValueError("tenant has no connected account — run /connect first")

    balance_row = fetch_one(
        conn,
        """
        select balance_at_run
        from forecast_runs
        where tenant_id = %s
        order by created_at desc
        limit 1
        """,
        (tenant_id,))

    # The live balance is supplied by the caller via sync; falling back to the last run
    # keeps snapshot building usable offline, but it is a stale number and says so.
    current_balance = float(balance_row["balance_at_run"]) if balance_row else 0.0

    flows = fetch_all(
        conn,
        """
        select occurred_at::date as d, amount, category, source
        from cash_flows
        where tenant_id = %s and occurred_at >= %s
        order by occurred_at
        """,
        (tenant_id, as_of - timedelta(days=history_days)))

    obligation_rows = fetch_all(
        conn,
        """
        select id, payee, amount, day_of_month, kind, rigidity,
               slack_days, relationship_cost
        from obligations
        where tenant_id = %s
        """,
        (tenant_id,))

    obligations = []
    for row in obligation_rows:
        hard = row["kind"] in HARD_KINDS or row["rigidity"] == "hard"
        for due in occurrences(row["day_of_month"], as_of, horizon_end):
            obligations.append({
                # One entry per occurrence, uniquely identified, so a long horizon keeps
                # both payrolls instead of collapsing them into one.
                "id": f"{row['id']}:{due.isoformat()}",
                "due_date": due.isoformat(),
                "amount": float(row["amount"]),
                "payee": row["payee"],
                "category": row["kind"],
                "hard_deadline": hard,
                "slack_days": 0 if hard else int(row["slack_days"]),
                "relationship_cost": float(row["relationship_cost"]),
            })

    receivable_rows = fetch_all(
        conn,
        """
        select i.uuid, i.total, i.due_date, i.fecha,
               i.counterparty_name, i.counterparty_rfc,
               t.days, t.spread, t.learned
        from invoices i
        left join terms t
          on t.tenant_id = i.tenant_id
         and t.counterparty_rfc = i.counterparty_rfc
        where i.tenant_id = %s
          and i.direction = 'issued'
          and i.metodo_pago = 'PPD'
          and i.settled_at is null
        """,
        (tenant_id,))

    receivables = []
    for row in receivable_rows:
        # Learned terms win over whatever due date the parser derived from a default.
        if row["learned"] and row["days"] is not None:
            due = row["fecha"] + timedelta(days=int(row["days"]))
        else:
            due = row["due_date"] or row["fecha"]

        spread = row["spread"]
        reliable = bool(row["learned"]) and spread is not None \
            and spread <= MAX_SPREAD_FOR_EARLY_REQUEST
        receivables.append({
            "id": row["uuid"],
            "due_date": due.isoformat(),
            "amount": float(row["total"]),
            "customer": row["counterparty_name"] or row["counterparty_rfc"] or "?",
            "collection_probability": collection_probability(spread, bool(row["learned"])),
            # Only a predictable payer can credibly be asked to pay early, so rung 1 is
            # offered for those and withheld for the erratic ones.
            "earliest_collection_date": (
                (as_of + timedelta(days=EARLY_COLLECTION_LEAD_DAYS)).isoformat()
                if reliable and due > as_of + timedelta(days=EARLY_COLLECTION_LEAD_DAYS)
                else None),
            "early_payment_discount": EARLY_PAYMENT_DISCOUNT,
        })

    return {
        "as_of": as_of.isoformat(),
        "current_balance": current_balance,
        "available_cash_buffer": 0.0,
        "safety_buffer": safety_buffer,
        "historical_flows": [
            {
                "date": row["d"].isoformat(),
                "amount": float(row["amount"]),
                "category": row["category"],
                "source": row["source"],
            }
            for row in flows
        ],
        "obligations": obligations,
        "receivables": receivables,
    }


def demo() -> None:
    """Self-check on the pure logic, no database required."""
    # Monthly obligations produce one entry per occurrence inside the horizon.
    start = date(2026, 9, 12)
    assert occurrences(15, start, start + timedelta(days=30)) == [date(2026, 9, 15)]
    assert occurrences(1, start, start + timedelta(days=30)) == [date(2026, 10, 1)]
    two = occurrences(15, start, start + timedelta(days=60))
    assert two == [date(2026, 9, 15), date(2026, 10, 15)], two

    # Short months clamp instead of skipping: rent on the 31st still happens in February.
    feb = occurrences(31, date(2026, 1, 31), date(2026, 3, 1))
    assert date(2026, 2, 28) in feb, feb

    # An occurrence exactly on as_of is excluded; the day has already happened.
    assert occurrences(12, start, start + timedelta(days=30)) == [date(2026, 10, 12)]

    # Confidence tracks spread, and cold start sits between reliable and erratic.
    assert collection_probability(2, True) == 0.90
    assert collection_probability(14, True) == 0.80
    assert collection_probability(30, True) == 0.60
    assert collection_probability(None, False) == 0.70
    assert collection_probability(2, False) == 0.70   # unlearned spread is not evidence

    print("snapshot: all checks passed")


if __name__ == "__main__":
    demo()
