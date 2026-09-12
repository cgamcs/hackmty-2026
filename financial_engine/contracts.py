from __future__ import annotations

from datetime import date
from typing import Any

from .models import BusinessSnapshot, CashFlow, Obligation, Receivable, StressScenario


def _date(value: str | date | None) -> date | None:
    if value is None or isinstance(value, date):
        return value
    return date.fromisoformat(value)


def snapshot_from_dict(payload: dict[str, Any]) -> BusinessSnapshot:
    """Convert the normalized backend JSON contract into domain objects."""

    return BusinessSnapshot(
        as_of=_date(payload["as_of"]),  # type: ignore[arg-type]
        current_balance=float(payload["current_balance"]),
        available_cash_buffer=float(payload.get("available_cash_buffer", 0)),
        safety_buffer=float(payload.get("safety_buffer", 0)),
        historical_flows=[
            CashFlow(
                date=_date(item["date"]),  # type: ignore[arg-type]
                amount=float(item["amount"]),
                category=item.get("category", "other"),
                source=item.get("source", "bank"),
            )
            for item in payload.get("historical_flows", [])
        ],
        obligations=[
            Obligation(
                id=str(item["id"]),
                due_date=_date(item["due_date"]),  # type: ignore[arg-type]
                amount=float(item["amount"]),
                payee=item["payee"],
                category=item.get("category", "supplier"),
                hard_deadline=bool(item.get("hard_deadline", False)),
                slack_days=int(item.get("slack_days", 0)),
                relationship_cost=float(item.get("relationship_cost", 0)),
            )
            for item in payload.get("obligations", [])
        ],
        receivables=[
            Receivable(
                id=str(item["id"]),
                due_date=_date(item["due_date"]),  # type: ignore[arg-type]
                amount=float(item["amount"]),
                customer=item["customer"],
                collection_probability=float(item.get("collection_probability", 0.80)),
                earliest_collection_date=_date(item.get("earliest_collection_date")),
                early_payment_discount=float(item.get("early_payment_discount", 0.02)),
            )
            for item in payload.get("receivables", [])
        ],
    )


def scenario_from_dict(payload: dict[str, Any]) -> StressScenario:
    return StressScenario(
        name=payload.get("name", "custom"),
        inflow_change_pct=float(payload.get("inflow_change_pct", 0)),
        variable_expense_change_pct=float(payload.get("variable_expense_change_pct", 0)),
        receivable_delay_days=int(payload.get("receivable_delay_days", 0)),
        unexpected_expense=float(payload.get("unexpected_expense", 0)),
        unexpected_expense_date=_date(payload.get("unexpected_expense_date")),
    )
