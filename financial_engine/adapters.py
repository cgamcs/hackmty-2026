from __future__ import annotations

import calendar
import json
import re
import sys
from dataclasses import replace
from datetime import date, timedelta
from pathlib import Path
from typing import Any, Iterable

from .cfdi_parser import open_receivables_from_cfdi
from .models import BusinessSnapshot, CashFlow, Obligation, Receivable


FOLIO_PATTERN = re.compile(r"\b([A-Z]\d{4,})\b", re.IGNORECASE)


def find_company_account(client: Any, company_name: str) -> dict[str, Any] | None:
    """Find the operating account for a company in the API key's own sandbox."""

    normalized = company_name.casefold().strip()
    customer = next(
        (
            item
            for item in client.customers()
            if " ".join(
                part for part in (item.get("first_name", ""), item.get("last_name", "")) if part
            ).casefold().startswith(normalized)
        ),
        None,
    )
    if customer is None:
        return None
    accounts = [
        item for item in client.accounts() if item.get("customer_id") == customer.get("_id")
    ]
    return next(
        (item for item in accounts if item.get("nickname") == "Cuenta Operativa"),
        accounts[0] if accounts else None,
    )


def _as_date(value: str | date | None) -> date | None:
    if not value:
        return None
    if isinstance(value, date):
        return value
    return date.fromisoformat(value[:10])


def _transaction_date(item: dict[str, Any]) -> date | None:
    for field in ("transaction_date", "purchase_date", "payment_date", "date"):
        parsed = _as_date(item.get(field))
        if parsed:
            return parsed
    return None


def _settled_folios(deposits: Iterable[dict[str, Any]]) -> set[str]:
    folios: set[str] = set()
    for deposit in deposits:
        description = str(deposit.get("description", ""))
        match = FOLIO_PATTERN.search(description)
        if match:
            folios.add(match.group(1).upper())
    return folios


def _recurring_dates(day_of_month: int, as_of: date, horizon_days: int) -> list[date]:
    end = as_of + timedelta(days=horizon_days)
    year, month = as_of.year, as_of.month
    dates: list[date] = []
    while date(year, month, 1) <= end:
        last_day = calendar.monthrange(year, month)[1]
        candidate = date(year, month, min(day_of_month, last_day))
        if as_of < candidate <= end:
            dates.append(candidate)
        if month == 12:
            year, month = year + 1, 1
        else:
            month += 1
    return dates


def snapshot_from_sources(
    *,
    account: dict[str, Any],
    deposits: list[dict[str, Any]],
    purchases: list[dict[str, Any]],
    withdrawals: list[dict[str, Any]],
    bills: list[dict[str, Any]],
    cfdi_directory: str | Path,
    owner_rfc: str,
    as_of: date,
    horizon_days: int = 30,
    settled_document_ids: set[str] | None = None,
    safety_buffer: float = 0.0,
    available_cash_buffer: float = 0.0,
) -> BusinessSnapshot:
    """Join raw Nessie-shaped responses and CFDI XML into the engine contract."""

    flows: list[CashFlow] = []
    for item in deposits:
        movement_date = _transaction_date(item)
        if movement_date and movement_date <= as_of and item.get("status", "completed") == "completed":
            flows.append(
                CashFlow(
                    date=movement_date,
                    amount=float(item.get("amount", 0)),
                    category="sales",
                    source="nessie_deposit",
                )
            )
    for source, items in (("nessie_purchase", purchases), ("nessie_withdrawal", withdrawals)):
        for item in items:
            movement_date = _transaction_date(item)
            if movement_date and movement_date <= as_of and item.get("status", "completed") == "completed":
                flows.append(
                    CashFlow(
                        date=movement_date,
                        amount=-abs(float(item.get("amount", 0))),
                        category=str(item.get("category", item.get("description", "operations"))),
                        source=source,
                    )
                )

    obligations: list[Obligation] = []
    for bill in bills:
        if bill.get("status") == "cancelled":
            continue
        category = str(bill.get("nickname", bill.get("kind", "other"))).lower()
        is_hard = category in {"payroll", "tax", "taxes", "nomina", "nómina"}
        recurring_day = bill.get("recurring_date")
        if recurring_day:
            due_dates = _recurring_dates(int(recurring_day), as_of, horizon_days)
        else:
            due = _as_date(bill.get("upcoming_payment_date") or bill.get("payment_date"))
            due_dates = [due] if due and as_of < due <= as_of + timedelta(days=horizon_days) else []
        for due in due_dates:
            bill_id = str(bill.get("_id", bill.get("id", bill.get("payee", "bill"))))
            obligations.append(
                Obligation(
                    id=f"{bill_id}:{due.isoformat()}",
                    due_date=due,
                    amount=float(bill.get("payment_amount", bill.get("amount", 0))),
                    payee=str(bill.get("payee", "Obligación")),
                    category=category,
                    hard_deadline=is_hard,
                    slack_days=int(bill.get("slack_days", 0)),
                    relationship_cost=float(bill.get("relationship_cost", 0)),
                )
            )

    settled = settled_document_ids if settled_document_ids is not None else _settled_folios(deposits)
    receivables = open_receivables_from_cfdi(
        cfdi_directory,
        owner_rfc,
        settled_document_ids={item.upper() for item in settled},
    )
    earliest = as_of + timedelta(days=1)
    receivables = [
        type(item)(
            id=item.id,
            # An overdue, still-open PPD invoice remains collectible. Put it on
            # day one instead of silently dropping it outside the forecast.
            due_date=max(item.due_date, earliest),
            amount=item.amount,
            customer=item.customer,
            collection_probability=item.collection_probability,
            earliest_collection_date=earliest,
            early_payment_discount=item.early_payment_discount,
        )
        for item in receivables
    ]
    return BusinessSnapshot(
        as_of=as_of,
        current_balance=float(account.get("balance", 0)),
        historical_flows=flows,
        obligations=obligations,
        receivables=receivables,
        available_cash_buffer=available_cash_buffer,
        safety_buffer=safety_buffer,
    )


def snapshot_from_live_nessie(
    *,
    account_id: str,
    cfdi_directory: str | Path,
    owner_rfc: str,
    as_of: date | None = None,
    horizon_days: int = 30,
    safety_buffer: float = 0.0,
    available_cash_buffer: float = 0.0,
    client: Any | None = None,
) -> BusinessSnapshot:
    """Fetch one PyME's current data from Nessie and join its CFDI documents.

    `client` is injectable so tests never need network access. In the application,
    account_id and CFDI directory must be resolved from the authenticated tenant.
    """

    if client is None:
        from engine.nessie import Nessie

        try:
            client = Nessie()
        except FileNotFoundError as exc:
            raise RuntimeError(
                "Nessie API_KEY is missing. Set the API_KEY environment variable "
                "or add API_KEY=... to the repository .env file."
            ) from exc
    account = client.account(account_id)
    if account is None:
        raise ValueError(f"Nessie account not found: {account_id}")
    deposits = client.deposits(account_id)
    purchases = client.purchases(account_id)
    withdrawals = client.withdrawals(account_id)
    bills = client.bills(account_id)
    snapshot = snapshot_from_sources(
        account=account,
        deposits=deposits,
        purchases=purchases,
        withdrawals=withdrawals,
        bills=bills,
        cfdi_directory=cfdi_directory,
        owner_rfc=owner_rfc,
        as_of=as_of or date.today(),
        horizon_days=horizon_days,
        safety_buffer=safety_buffer,
        available_cash_buffer=available_cash_buffer,
    )

    # Use the reconciliation and learned-terms pipeline delivered by the CFDI/API
    # builder. It performs reference + fuzzy matching and learns each client's
    # observed payment lag instead of assuming net-30 for everybody.
    engine_dir = Path(__file__).resolve().parents[1] / "engine"
    if str(engine_dir) not in sys.path:
        sys.path.insert(0, str(engine_dir))
    from cfdi_parser import parse_dir
    from config import COLLECTION_PROBABILITY
    from reconcile import reconcile
    from terms import apply_terms, learn_terms

    batch = parse_dir(cfdi_directory)
    reconciled = reconcile(batch, deposits, purchases)
    learned_terms = learn_terms(reconciled.matched)
    tuned = apply_terms(reconciled, learned_terms)
    tomorrow = (as_of or date.today()) + timedelta(days=1)
    receivables = [
        Receivable(
            id=item.invoice.reference,
            due_date=max(item.expected_date, tomorrow),
            amount=item.amount,
            customer=item.invoice.counterparty_name,
            collection_probability=COLLECTION_PROBABILITY,
            earliest_collection_date=tomorrow,
            early_payment_discount=0.02,
        )
        for item in tuned.open_receivables
    ]
    open_payables = [
        Obligation(
            id=f"cfdi:{item.invoice.reference}",
            due_date=max(item.expected_date, tomorrow),
            amount=item.amount,
            payee=item.invoice.counterparty_name,
            category="supplier",
            hard_deadline=False,
            # CONCEPT.md: silence is zero slack. A later persistence layer can
            # populate this only from proven supplier tolerance.
            slack_days=0,
            relationship_cost=0.0,
        )
        for item in tuned.open_payables
    ]
    return replace(
        snapshot,
        receivables=receivables,
        obligations=[*snapshot.obligations, *open_payables],
    )


def snapshot_from_mock_files(
    slug: str,
    project_root: str | Path,
    as_of: date | None = None,
    horizon_days: int = 30,
) -> BusinessSnapshot:
    """Load one checked-in scenario without making network calls to Nessie."""

    from mocks.generate import daily_sales
    from mocks.scenarios import HISTORY_DAYS, SCENARIOS

    as_of = as_of or date.today()
    root = Path(project_root)
    manifest = json.loads((root / "mocks/out/seed-manifest.json").read_text())
    scenario = next((item for item in SCENARIOS if item.slug == slug), None)
    if scenario is None:
        raise ValueError(f"unknown mock scenario: {slug}")
    entry = manifest[slug]

    deposits: list[dict[str, Any]] = []
    purchases: list[dict[str, Any]] = []
    for days_ago in range(HISTORY_DAYS, 0, -1):
        day = as_of - timedelta(days=days_ago)
        gross = daily_sales(scenario, day, HISTORY_DAYS - days_ago)
        cash = int(gross * scenario.cash_sale_share)
        deposits.append(
            {
                "transaction_date": day.isoformat(),
                "status": "completed",
                "amount": cash,
                "description": "Venta diaria mostrador",
            }
        )

    credit_share = 1 - scenario.cash_sale_share
    for days_ago in range(HISTORY_DAYS + scenario.collection_lag_days, 0, -1):
        sold = as_of - timedelta(days=days_ago)
        settles = sold + timedelta(days=scenario.collection_lag_days)
        if settles > as_of:
            continue
        gross = daily_sales(
            scenario, sold, HISTORY_DAYS + scenario.collection_lag_days - days_ago
        )
        amount = int(gross * credit_share)
        if amount > 0:
            deposits.append(
                {
                    "transaction_date": settles.isoformat(),
                    "status": "completed",
                    "amount": amount,
                    "description": f"Cobranza credito ventas {sold.isoformat()}",
                }
            )

    for receivable in entry.get("receivables", []):
        if receivable.get("settled"):
            deposits.append(
                {
                    "transaction_date": receivable["settled"],
                    "status": "completed",
                    "amount": receivable["amount"],
                    "description": f"Cobro factura {receivable['folio']} {receivable['client']}",
                }
            )

    for supplier in scenario.suppliers:
        for days_ago in range(HISTORY_DAYS, 0, -supplier.restock_every_days):
            day = as_of - timedelta(days=days_ago)
            gross = daily_sales(scenario, day, HISTORY_DAYS - days_ago)
            amount = int(
                gross
                * scenario.restock_ratio
                * supplier.restock_every_days
                / max(len(scenario.suppliers), 1)
            )
            purchases.append(
                {
                    "purchase_date": day.isoformat(),
                    "status": "completed",
                    "amount": amount,
                    "description": f"Resurtido {supplier.category}",
                }
            )

    bills = [
        {
            **bill,
            "_id": bill["id"],
            "nickname": bill["kind"],
            "payment_amount": bill["amount"],
            "status": "recurring",
        }
        for bill in entry["bills"]
    ]
    settled_folios = {
        item["folio"] for item in entry.get("receivables", []) if not item.get("open", True)
    }
    return snapshot_from_sources(
        account={"_id": entry["account_id"], "balance": scenario.starting_balance},
        deposits=deposits,
        purchases=purchases,
        withdrawals=[],
        bills=bills,
        cfdi_directory=root / "mocks/out/cfdi" / scenario.rfc,
        owner_rfc=scenario.rfc,
        as_of=as_of,
        horizon_days=horizon_days,
        settled_document_ids=settled_folios,
        safety_buffer=round(scenario.starting_balance * 0.10),
    )
