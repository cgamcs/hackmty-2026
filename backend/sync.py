"""Sync Nessie into Tiger, then reconcile and learn.

Nessie stays the bank of record; this mirrors it locally so the forecast reads one
time-series instead of paging the API on every run, and so reconciliation happens once
rather than per request.

Order matters. Reconciliation needs the flows, and terms need the matches:

    flows -> obligations -> reconcile -> terms

Everything is idempotent. Re-running after a partial failure converges instead of
duplicating: `cash_flows` is keyed on the Nessie `_id`, obligations on the bill `_id`,
and settlement writes are a straight update of the invoice row.
"""

from __future__ import annotations

import sys
from datetime import date, datetime
from pathlib import Path

ROOT = Path(__file__).parent.parent
for extra in (ROOT / "engine", ROOT):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))

from cfdi_parser import Batch, Invoice          # noqa: E402
from nessie import Nessie                        # noqa: E402
from reconcile import reconcile                  # noqa: E402
from terms import learn_terms                     # noqa: E402

# `db` is imported lazily inside the functions that touch the database, so the pure
# classification logic below stays runnable without a driver installed.

# Nessie bill nicknames carry the kind we seeded; anything else is classified by payee.
PAYROLL_HINTS = ("nomina", "nómina", "payroll", "sueldo")
TAX_HINTS = ("sat", "iva", "isr", "imss", "impuesto")
RENT_HINTS = ("renta", "arrendamiento", "local", "nave")
UTILITY_HINTS = ("cfe", "energia", "energía", "luz", "agua", "internet", "telefon")


def classify_bill(payee: str, nickname: str | None) -> str:
    if nickname in ("payroll", "tax", "rent", "utility", "supplier", "other"):
        return nickname
    text = (payee or "").lower()
    for hints, kind in ((PAYROLL_HINTS, "payroll"), (TAX_HINTS, "tax"),
                        (RENT_HINTS, "rent"), (UTILITY_HINTS, "utility")):
        if any(h in text for h in hints):
            return kind
    return "supplier"


def _as_date(raw: str | None) -> date | None:
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw).date()
    except ValueError:
        return None


def sync_flows(conn, tenant_id: str, api: Nessie, account_id: str) -> dict[str, int]:
    """Mirror deposits, purchases and withdrawals. Income positive, expense negative."""
    from db import execute_many
    rows: list[tuple] = []
    counts = {"deposits": 0, "purchases": 0, "withdrawals": 0}

    for flow in api.deposits(account_id):
        when = _as_date(flow.get("transaction_date"))
        if not when:
            continue
        rows.append((tenant_id, when, flow["_id"], float(flow.get("amount", 0)),
                     "sales", "bank", flow.get("description")))
        counts["deposits"] += 1

    for flow in api.purchases(account_id):
        when = _as_date(flow.get("purchase_date"))
        if not when:
            continue
        rows.append((tenant_id, when, flow["_id"], -float(flow.get("amount", 0)),
                     "restock", "bank", flow.get("description")))
        counts["purchases"] += 1

    for flow in api.withdrawals(account_id):
        when = _as_date(flow.get("transaction_date"))
        if not when:
            continue
        rows.append((tenant_id, when, flow["_id"], -float(flow.get("amount", 0)),
                     "withdrawal", "bank", flow.get("description")))
        counts["withdrawals"] += 1

    execute_many(conn, """
        insert into cash_flows
          (tenant_id, occurred_at, flow_id, amount, category, source, description)
        values (%s, %s, %s, %s, %s, %s, %s)
        on conflict (tenant_id, flow_id, occurred_at) do update
          set amount = excluded.amount,
              category = excluded.category,
              description = excluded.description
    """, rows)
    return counts


def sync_obligations(conn, tenant_id: str, api: Nessie, account_id: str) -> int:
    """Pre-fill the hard-date form from Nessie bills.

    Rigidity is seeded, never final: payroll and tax are forced hard (the database
    constraint enforces it too), everything else arrives as `slack` with zero slack days
    so the tenant has to state any tolerance explicitly.
    """
    from db import execute_many

    rows = []
    for bill in api.bills(account_id):
        kind = classify_bill(bill.get("payee", ""), bill.get("nickname"))
        hard = kind in ("payroll", "tax")
        rows.append((
            tenant_id, bill["_id"], bill.get("payee", "?"),
            float(bill.get("payment_amount", 0)),
            int(bill.get("recurring_date") or 1),
            kind, "hard" if hard else "slack", 0, 0, "detected"))

    execute_many(conn, """
        insert into obligations
          (tenant_id, bill_id, payee, amount, day_of_month, kind,
           rigidity, slack_days, relationship_cost, source)
        values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
        on conflict do nothing
    """, rows)
    return len(rows)


def _invoices_from_db(conn, tenant_id: str) -> Batch:
    """Hydrate Invoice objects from the database.

    Reconciliation and term learning were written against the CFDI parser's output, so
    rebuilding that shape here keeps both reusable instead of forking a database-specific
    copy of the matching logic.
    """
    from db import fetch_all, fetch_one

    rows = fetch_all(conn, """
        select uuid, serie, folio, tipo, fecha, total, subtotal,
               metodo_pago, forma_pago, direction,
               counterparty_rfc, counterparty_name, due_date
        from invoices
        where tenant_id = %s
    """, (tenant_id,))

    tenant = fetch_one(conn, "select rfc, razon_social from tenants where id = %s",
                       (tenant_id,))
    own_rfc = (tenant or {}).get("rfc") or ""
    own_name = (tenant or {}).get("razon_social") or ""

    invoices = []
    for r in rows:
        issued = r["direction"] == "issued"
        inv = Invoice(
            uuid=r["uuid"], serie=r["serie"] or "", folio=r["folio"] or "",
            tipo=r["tipo"], fecha=r["fecha"],
            total=float(r["total"]), subtotal=float(r["subtotal"]),
            metodo_pago=r["metodo_pago"], forma_pago=r["forma_pago"],
            emisor_rfc=own_rfc if issued else (r["counterparty_rfc"] or ""),
            emisor_nombre=own_name if issued else (r["counterparty_name"] or ""),
            receptor_rfc=(r["counterparty_rfc"] or "") if issued else own_rfc,
            receptor_nombre=(r["counterparty_name"] or "") if issued else own_name,
            source_file="db")
        inv.direction = r["direction"]
        inv.due_date = r["due_date"]
        invoices.append(inv)

    return Batch(own_rfc=own_rfc, own_name=own_name, invoices=invoices)


def sync_reconciliation(conn, tenant_id: str, api: Nessie,
                        account_id: str) -> dict[str, int]:
    from db import execute, execute_many

    batch = _invoices_from_db(conn, tenant_id)
    if not batch.invoices:
        return {"matched": 0, "open_receivables": 0, "terms": 0}

    deposits = api.deposits(account_id)
    purchases = api.purchases(account_id)
    rec = reconcile(batch, deposits, purchases)

    execute_many(conn, """
        update invoices
           set settled_at = %s, settled_flow_id = %s, match_method = %s
         where tenant_id = %s and uuid = %s
    """, [(m.flow_date, m.flow["_id"], m.method, tenant_id, m.invoice.uuid)
          for m in rec.matched])

    # An invoice that stops matching must lose its settlement, or it would stay counted
    # as collected after a corrected upload.
    matched_uuids = [m.invoice.uuid for m in rec.matched]
    execute(conn, """
        update invoices
           set settled_at = null, settled_flow_id = null, match_method = null
         where tenant_id = %s
           and settled_at is not null
           and not (uuid = any(%s))
    """, (tenant_id, matched_uuids))

    learned = learn_terms(rec.matched)
    execute_many(conn, """
        insert into terms
          (tenant_id, counterparty_rfc, days, observations, spread, learned, updated_at)
        values (%s, %s, %s, %s, %s, %s, now())
        on conflict (tenant_id, counterparty_rfc) do update
          set days = excluded.days,
              observations = excluded.observations,
              spread = excluded.spread,
              learned = excluded.learned,
              updated_at = now()
    """, [(tenant_id, t.rfc, t.days, t.observations, t.spread, t.learned)
          for t in learned.values()])

    return {"matched": len(rec.matched),
            "open_receivables": len(rec.open_receivables),
            "terms": len(learned)}


def sync_tenant(tenant_id: str) -> dict:
    """Full sync for one tenant. Safe to re-run."""
    from db import fetch_one, tenant_tx

    api = Nessie()
    with tenant_tx(tenant_id) as conn:
        tenant = fetch_one(conn, "select account_id from tenants where id = %s",
                           (tenant_id,))
        if not tenant or not tenant["account_id"]:
            raise ValueError("tenant has no connected account")
        account_id = tenant["account_id"]

        account = api.account(account_id)
        if account is None:
            raise ValueError(f"account {account_id} not visible with this API key")

        flows = sync_flows(conn, tenant_id, api, account_id)
        bills = sync_obligations(conn, tenant_id, api, account_id)
        recon = sync_reconciliation(conn, tenant_id, api, account_id)

    return {"balance": float(account.get("balance", 0)),
            "flows": flows, "obligations": bills, **recon}


def demo() -> None:
    """Self-check on the pure classification logic, no database required."""
    assert classify_bill("Nomina Operativa Quincenal", None) == "payroll"
    assert classify_bill("Renta Nave Industrial", None) == "rent"
    assert classify_bill("CFE Energia", None) == "utility"
    assert classify_bill("Pago IVA mensual", None) == "tax"
    assert classify_bill("Distribuidora Bimbo", None) == "supplier"
    # An explicit nickname always wins over payee guessing.
    assert classify_bill("Renta Nave Industrial", "payroll") == "payroll"
    # Unknown nicknames fall through to the payee heuristic rather than being trusted.
    assert classify_bill("CFE Energia", "string") == "utility"
    print("sync: all checks passed")


if __name__ == "__main__":
    demo()
