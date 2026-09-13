"""Assemble the DashboardData payload the front end expects.

The shape is fixed by `frontend/src/types.ts` — camelCase, and deliberately mirrored
field for field so nothing has to be guessed on either side.

This module is pure: it takes already-fetched rows and an engine result and returns a
dict. No database, no HTTP. That keeps the mapping — which is where the bugs live —
testable without a Tiger connection or a running API.
"""

from __future__ import annotations

from collections import OrderedDict
from datetime import date, timedelta
from typing import Any

# financial_engine action -> the rung the UI renders
RUNG_BY_ACTION = {
    "accelerate_receivable": "ACCELERATE",
    "shift_obligation": "SHIFT",
    "draw_cash_buffer": "BUFFER",
    "compare_credit": "CREDIT",
    "reduce_structural_deficit": "CREDIT",
}

RUNG_SHORT = {
    "ACCELERATE": "1 · Cobranza",
    "SHIFT": "2 · Calendario",
    "BUFFER": "3 · Colchón",
    "CREDIT": "4 · Crédito",
}

# obligations.kind -> ObligationKind in types.ts
KIND_MAP = {
    "payroll": "PAYROLL",
    "tax": "TAXES",
    "rent": "RENT",
    "supplier": "SUPPLIER",
    "utility": "SUPPLIER",
    "other": "SUPPLIER",
}

AGING_BUCKETS = (("Por vencer", 0), ("1–30 días", 1), ("31–60 días", 31), ("60+ días", 61))


def _pct_change(current: float, previous: float) -> float:
    if previous <= 0:
        return 0.0
    return round((current - previous) / previous * 100, 1)


def aging(receivables: list[dict], today: date) -> list[dict]:
    buckets = OrderedDict((label, 0.0) for label, _ in AGING_BUCKETS)
    for r in receivables:
        due = date.fromisoformat(r["dueDate"])
        overdue = (today - due).days
        if overdue <= 0:
            label = "Por vencer"
        elif overdue <= 30:
            label = "1–30 días"
        elif overdue <= 60:
            label = "31–60 días"
        else:
            label = "60+ días"
        buckets[label] += r["amount"]
    return [{"label": k, "amount": round(v, 2)} for k, v in buckets.items()]


def daily_flows(flows: list[dict], today: date, days: int = 30) -> list[dict]:
    """One row per day, including days with no movement.

    Gaps matter: a chart that silently skips quiet days compresses the timeline and makes
    a dry week look like a normal one.
    """
    start = today - timedelta(days=days - 1)
    table = {start + timedelta(days=i): [0.0, 0.0] for i in range(days)}
    for f in flows:
        when = f["date"] if isinstance(f["date"], date) else date.fromisoformat(f["date"])
        if when not in table:
            continue
        amount = float(f["amount"])
        if amount >= 0:
            table[when][0] += amount
        else:
            table[when][1] += -amount
    return [{"date": d.isoformat(), "inflow": round(i, 2), "outflow": round(o, 2)}
            for d, (i, o) in sorted(table.items())]


def build_ladder(result: dict, breach: dict | None) -> dict:
    """Map the engine's recovery plan onto the four-rung ladder.

    Every rung is always present, so the UI can show which options exist and which do not.
    The plan is the engine's: each recommendation was re-projected, so amounts and the
    residual come from it rather than from subtraction in the browser. A rung with several
    recommendations (two invoices collected early) counts all of them.
    """
    financing = result.get("financing_decision") or {}
    declined = financing.get("status") == "not_recommended_structural"
    shortfall = float(breach["shortfall"]) if breach else 0.0

    by_rung: dict[str, list[dict]] = {rung: [] for rung in RUNG_SHORT}
    for rec in result.get("recommendations") or []:
        rung = RUNG_BY_ACTION.get(rec.get("action", ""))
        # A structural deficit is a refusal, not a rung the owner can apply.
        if rung and rec.get("action") != "reduce_structural_deficit":
            by_rung[rung].append(rec)

    steps = []
    for rung, recs in by_rung.items():
        first = recs[0] if recs else {}
        steps.append({
            "rung": rung,
            "short": RUNG_SHORT[rung],
            "title": first.get("title") or RUNG_SHORT[rung],
            "phrase": first.get("description") or "",
            "closes": round(sum(float(rec.get("cash_impact", 0)) for rec in recs), 2),
            "available": bool(recs),
            # The engine stops at the first rung that clears the breach, so every
            # recommendation it emitted was needed.
            "applied": bool(recs),
            "resolves": any(rec.get("resolves_breach") for rec in recs),
            # Where this rung first acted in the engine's plan. The ladder restarts from the
            # cheapest rung after each shortfall, so the buffer can come before a collection.
            "order": min((int(rec.get("rank", 0)) for rec in recs), default=None),
            "actions": [{
                "targetId": str((rec.get("parameters") or {}).get("receivable_id")
                                or (rec.get("parameters") or {}).get("obligation_id") or ""),
                "newDate": (rec.get("parameters") or {}).get("new_date"),
                "amount": round(float(rec.get("cash_impact", 0)), 2),
            } for rec in recs],
        })

    credit = by_rung["CREDIT"][0] if by_rung["CREDIT"] else None
    if credit:
        residual = float((credit.get("parameters") or {}).get("residual_shortfall", shortfall))
    else:
        # Without a credit rung the operational rungs cleared the breach, unless the gap is
        # structural and the ladder never ran.
        residual = shortfall if declined else 0.0
    credit_amount = 0.0 if declined else float(financing.get("suggested_amount", 0) or 0)

    return {
        "steps": steps,
        "residual": round(residual, 2),
        "creditAmount": round(credit_amount, 2),
        "creditDeclined": declined,
        "adjustedMin": None,
    }


def build(
    *,
    tenant: dict,
    account: dict,
    accounts: list[dict],
    flows: list[dict],
    invoices: list[dict],
    obligations: list[dict],
    result: dict,
    today: date | None = None,
    cash_buffer: float = 0.0,
) -> dict[str, Any]:
    today = today or date.today()
    window_start = today - timedelta(days=30)
    prev_start = today - timedelta(days=60)

    def in_window(f, start, end):
        when = f["date"] if isinstance(f["date"], date) else date.fromisoformat(f["date"])
        return start <= when < end

    inflow_30 = sum(float(f["amount"]) for f in flows
                    if float(f["amount"]) > 0 and in_window(f, window_start, today + timedelta(days=1)))
    inflow_prev = sum(float(f["amount"]) for f in flows
                      if float(f["amount"]) > 0 and in_window(f, prev_start, window_start))
    outflow_30 = sum(-float(f["amount"]) for f in flows
                     if float(f["amount"]) < 0 and in_window(f, window_start, today + timedelta(days=1)))
    outflow_prev = sum(-float(f["amount"]) for f in flows
                       if float(f["amount"]) < 0 and in_window(f, prev_start, window_start))

    cfdi_backed = sum(float(f["amount"]) for f in flows
                      if float(f["amount"]) > 0
                      and in_window(f, window_start, today + timedelta(days=1))
                      and (f.get("description") or "").lower().startswith("cobro factura"))

    receivables, payables, settled = [], [], []
    receivable_total = payable_total = 0.0

    for inv in invoices:
        issued = inv["direction"] == "issued"
        due = inv.get("due_date") or inv["fecha"]
        due_iso = due.isoformat() if isinstance(due, date) else str(due)
        if issued and inv.get("metodo_pago") == "PPD":
            if inv.get("settled_at"):
                continue
            receivable_total += float(inv["total"])
            receivables.append({
                "id": inv["uuid"],
                "folio": f"{inv.get('serie') or ''}{inv.get('folio') or ''}",
                "client": inv.get("counterparty_name") or inv.get("counterparty_rfc") or "?",
                "amount": round(float(inv["total"]), 2),
                "dueDate": due_iso,
                "dsoDays": int(inv.get("dso_days") or 0),
                # Only a payer with a tight observed spread can credibly be asked to pay
                # early; offering it for an erratic client is a promise we cannot keep.
                "accelerable": bool(inv.get("accelerable")),
            })
        elif not issued:
            if inv.get("settled_at"):
                settled.append({
                    "id": inv["uuid"],
                    "payee": inv.get("counterparty_name") or "?",
                    "kind": "SUPPLIER",
                    "amount": round(float(inv["total"]), 2),
                    "date": inv["settled_at"].isoformat()
                            if isinstance(inv["settled_at"], date) else str(inv["settled_at"]),
                })
            else:
                payable_total += float(inv["total"])
                payables.append({
                    "id": inv["uuid"],
                    "payee": inv.get("counterparty_name") or "?",
                    "reference": f"{inv.get('serie') or ''}{inv.get('folio') or ''}",
                    "kind": "SUPPLIER",
                    "amount": round(float(inv["total"]), 2),
                    "dueDate": due_iso,
                    "rigidity": "slack",
                    "slackDays": 0,
                })

    # Recurring obligations from the form join the payable list: the UI shows one
    # calendar, and payroll must appear on it or the breach has no visible cause.
    for ob in obligations:
        payables.append({
            "id": str(ob["id"]),
            "payee": ob["payee"],
            "reference": ob.get("bill_id") or "",
            "kind": KIND_MAP.get(ob["kind"], "SUPPLIER"),
            "amount": round(float(ob["amount"]), 2),
            "dueDate": ob["next_due"].isoformat()
                       if isinstance(ob.get("next_due"), date) else str(ob.get("next_due") or ""),
            "rigidity": ob.get("rigidity", "hard"),
            "slackDays": int(ob.get("slack_days") or 0),
        })

    engine_breach = result.get("breach")
    breach = None
    if engine_breach:
        breach_date = engine_breach["date"]
        match = next((p for p in payables if p["id"].startswith(str(engine_breach.get("obligation_id", "")).split(":")[0])), None)
        breach = {
            "date": breach_date,
            "obligation": match or {
                "id": engine_breach.get("obligation_id", ""),
                "payee": engine_breach.get("obligation", "?"),
                "reference": "", "kind": "SUPPLIER",
                "amount": round(float(engine_breach.get("amount", 0)), 2),
                "dueDate": breach_date, "rigidity": "hard", "slackDays": 0,
            },
            "balance": round(float(
                next((p["pessimistic_balance"] for p in result.get("points", [])
                      if p["date"] == breach_date), 0)), 2),
            "shortfall": round(float(engine_breach["shortfall"]), 2),
            "daysUntil": (date.fromisoformat(breach_date) - today).days,
        }

    gap = str(result.get("gap_type", "none")).upper()
    health = int(result.get("health_score", 0))
    ladder = build_ladder(result, breach)
    shortfall = breach["shortfall"] if breach else 0.0

    movements = sorted(
        (
            {
                "id": f["flow_id"],
                "date": (f["date"].isoformat() if isinstance(f["date"], date)
                         else str(f["date"])),
                "description": f.get("description") or "",
                "amount": round(float(f["amount"]), 2),
                "type": ("deposit" if float(f["amount"]) > 0
                         else "withdrawal" if f.get("category") == "withdrawal"
                         else "purchase"),
            }
            for f in flows
        ),
        key=lambda m: m["date"], reverse=True)

    collected = max(inflow_30, 0.0)
    denominator = collected + receivable_total or 1.0
    overdue_total = sum(r["amount"] for r in receivables
                        if date.fromisoformat(r["dueDate"]) < today)

    return {
        "today": today.isoformat(),
        "business": {
            "name": tenant.get("razon_social") or "",
            "rfc": tenant.get("rfc") or "",
            "owner": tenant.get("owner_email") or "",
            "ownerInitials": "".join(
                w[0] for w in (tenant.get("razon_social") or "  ").split()[:2]).upper(),
        },
        "account": account,
        "accounts": accounts,
        "healthScore": health,
        "resilienceScore": int(result.get("resilience_score", 0)),
        "collection": {
            "collectedPct": round(collected / denominator * 100, 1),
            "receivablePct": round(receivable_total / denominator * 100, 1),
            "overduePct": round(overdue_total / denominator * 100, 1),
        },
        "income30": {
            "total": round(inflow_30, 2),
            "changePct": _pct_change(inflow_30, inflow_prev),
            "cash": round(max(inflow_30 - cfdi_backed, 0.0), 2),
            "cfdi": round(cfdi_backed, 2),
        },
        "expense30": {
            "total": round(outflow_30, 2),
            "changePct": _pct_change(outflow_30, outflow_prev),
            "lines": [{"label": ob["payee"], "amount": round(float(ob["amount"]), 2)}
                      for ob in obligations],
        },
        "cfdi": {
            "receivableTotal": round(receivable_total, 2),
            "receivableCount": len(receivables),
            "payableTotal": round(payable_total, 2),
            "payableCount": sum(1 for p in payables if p["kind"] == "SUPPLIER"),
            "aging": aging(receivables, today),
        },
        "cashflow": daily_flows(flows, today),
        "movementsCount": len(movements),
        "movements": movements[:50],
        "receivables": receivables,
        "payables": sorted(payables, key=lambda p: p["dueDate"]),
        "settled": settled,
        "forecast": [
            {"date": p["date"],
             "expected": round(float(p["expected_balance"]), 2),
             "pessimistic": round(float(p["pessimistic_balance"]), 2)}
            for p in result.get("points", [])
        ],
        # Reserve cash the owner declared in Ajustes. It used to be the minimum pessimistic
        # balance, which Recovery then spent as if it were money in hand.
        "bufferAvailable": round(float(cash_buffer), 2),
        "breach": breach,
        "gap": gap,
        # Graded by the engine, so this badge matches the Stress Lab baseline exactly.
        "risk": result["risk_level"],
        "residualPct": round(ladder["residual"] / shortfall * 100, 1) if shortfall else 0.0,
        "ladder": ladder,
    }


def demo() -> None:
    """Self-check on the pure mapping, no database or engine run required."""
    today = date(2026, 9, 12)

    # Quiet days still produce rows, so the chart cannot compress a dry week away.
    flows = [{"date": today, "amount": 100.0}, {"date": today, "amount": -40.0}]
    rows = daily_flows(flows, today, days=30)
    assert len(rows) == 30, len(rows)
    assert rows[-1] == {"date": today.isoformat(), "inflow": 100.0, "outflow": 40.0}
    assert rows[0]["inflow"] == 0.0

    # Aging splits on the right side of each boundary.
    recv = [
        {"amount": 10.0, "dueDate": (today + timedelta(days=5)).isoformat()},
        {"amount": 20.0, "dueDate": (today - timedelta(days=10)).isoformat()},
        {"amount": 30.0, "dueDate": (today - timedelta(days=45)).isoformat()},
        {"amount": 40.0, "dueDate": (today - timedelta(days=90)).isoformat()},
    ]
    by_label = {b["label"]: b["amount"] for b in aging(recv, today)}
    assert by_label == {"Por vencer": 10.0, "1–30 días": 20.0,
                        "31–60 días": 30.0, "60+ días": 40.0}, by_label

    # A structural verdict never surfaces a credit amount, whatever the engine suggested.
    ladder = build_ladder(
        {"financing_decision": {"status": "not_recommended_structural",
                                "suggested_amount": 50_000},
         "recommendations": []},
        {"shortfall": 25_000})
    assert ladder["creditDeclined"] is True
    assert ladder["creditAmount"] == 0.0

    # All four rungs always render, so a ruled-out option is visible as unavailable.
    assert [s["rung"] for s in ladder["steps"]] == \
        ["ACCELERATE", "SHIFT", "BUFFER", "CREDIT"]
    assert all(s["available"] is False for s in ladder["steps"])

    # Cheapest-first: the engine stopped at cobranza, so the buffer rung is not applied.
    ladder2 = build_ladder(
        {"financing_decision": {"status": "covered_by_recovery_plan"},
         "recommendations": [
             {"action": "accelerate_receivable", "cash_impact": 30_000, "title": "A",
              "resolves_breach": True},
         ]},
        {"shortfall": 25_000})
    applied = {s["rung"]: s["applied"] for s in ladder2["steps"]}
    assert applied["ACCELERATE"] is True, applied
    assert applied["BUFFER"] is False, applied
    assert ladder2["residual"] == 0.0

    print("dashboard: all checks passed")


if __name__ == "__main__":
    demo()
