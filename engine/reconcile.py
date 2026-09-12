"""Reconcile CFDI invoices against settled Nessie flows.

CFDI and Nessie share no identifier — Nessie stores no RFC and no UUID anywhere — so
the join is inferential, not referential. Two strategies, in order:

1. **Reference match.** The invoice reference appears in the flow `description`. That
   is the only free-text field Nessie has, and it mirrors reality: in Mexican banking
   the transfer *concepto* is where invoice numbers travel.
2. **Fuzzy match.** Amount within tolerance and date inside the collection window.
   Real bank references are often blank or garbage, so this path carries most of the
   weight in production.

What is left over is the working-capital picture: invoices with no settlement are open
receivables and payables, and settlements with no invoice are cash sales — normal in
retail, not an error.
"""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timedelta

from cfdi_parser import Batch, Invoice
from config import AMOUNT_TOLERANCE, COLLECTION_PROBABILITY, DATE_WINDOW_DAYS


@dataclass
class Match:
    invoice: Invoice
    flow: dict
    method: str          # reference | fuzzy
    flow_date: date


@dataclass
class OpenItem:
    invoice: Invoice
    expected_date: date
    amount: float

    @property
    def days_until(self) -> int:
        return (self.expected_date - date.today()).days

    @property
    def overdue(self) -> bool:
        return self.days_until < 0


@dataclass
class Reconciliation:
    matched: list[Match]
    open_receivables: list[OpenItem]
    open_payables: list[OpenItem]
    cash_sales: list[dict]          # deposits with no invoice — expected in retail
    unreceipted: list[dict]         # purchases with no invoice — flag, do not block

    @property
    def match_rate(self) -> float:
        total = len(self.matched) + len(self.open_receivables) + len(self.open_payables)
        return len(self.matched) / total if total else 0.0

    def expected_collections(self, horizon_days: int) -> dict[date, float]:
        """Open receivables landing inside the horizon, discounted by collection risk.

        This is the term that separates a timing gap from a structural deficit. Omit it
        and every business selling on credit reads as insolvent.
        """
        today, out = date.today(), {}
        for item in self.open_receivables:
            landing = max(item.expected_date, today + timedelta(days=1))
            if landing <= today + timedelta(days=horizon_days):
                out[landing] = out.get(landing, 0) + item.amount * COLLECTION_PROBABILITY
        return out


def _flow_date(flow: dict) -> date | None:
    raw = flow.get("transaction_date") or flow.get("purchase_date")
    if not raw:
        return None
    try:
        return datetime.fromisoformat(raw).date()
    except ValueError:
        return None


def _amounts_close(a: float, b: float) -> bool:
    if a == b:
        return True
    scale = max(abs(a), abs(b), 1.0)
    return abs(a - b) / scale <= AMOUNT_TOLERANCE


def _match_one(
    invoice: Invoice,
    flows: list[dict],
    used: set[str],
    window_start: date,
    window_end: date,
) -> Match | None:
    reference = invoice.reference.upper()

    # Pass 1 — explicit reference in the description.
    for flow in flows:
        if flow["_id"] in used:
            continue
        if reference and reference in (flow.get("description") or "").upper():
            fdate = _flow_date(flow)
            if fdate:
                used.add(flow["_id"])
                return Match(invoice, flow, "reference", fdate)

    # Pass 2 — amount and date. Prefer the closest date to the expected settlement.
    candidates = []
    for flow in flows:
        if flow["_id"] in used:
            continue
        fdate = _flow_date(flow)
        if not fdate or not (window_start <= fdate <= window_end):
            continue
        if _amounts_close(float(flow.get("amount", 0)), invoice.total):
            candidates.append((abs((fdate - window_end).days), flow, fdate))

    if not candidates:
        return None
    candidates.sort(key=lambda c: c[0])
    _, flow, fdate = candidates[0]
    used.add(flow["_id"])
    return Match(invoice, flow, "fuzzy", fdate)


def reconcile(
    batch: Batch,
    deposits: list[dict],
    purchases: list[dict],
    window_days: int = DATE_WINDOW_DAYS,
) -> Reconciliation:
    matched: list[Match] = []
    open_receivables: list[OpenItem] = []
    open_payables: list[OpenItem] = []
    used_deposits: set[str] = set()
    used_purchases: set[str] = set()

    # Receivables settle as deposits, any time from issue until a little past due.
    for inv in batch.receivables:
        due = inv.due_date or inv.fecha
        m = _match_one(inv, deposits, used_deposits,
                       inv.fecha, due + timedelta(days=window_days))
        if m:
            matched.append(m)
        else:
            open_receivables.append(OpenItem(inv, due, inv.total))

    # Payables settle as purchases against the supplier merchant.
    for inv in batch.payables:
        due = inv.due_date or inv.fecha
        m = _match_one(inv, purchases, used_purchases,
                       inv.fecha - timedelta(days=window_days),
                       due + timedelta(days=window_days))
        if m:
            matched.append(m)
        else:
            open_payables.append(OpenItem(inv, due, inv.total))

    cash_sales = [d for d in deposits if d["_id"] not in used_deposits]
    unreceipted = [p for p in purchases if p["_id"] not in used_purchases]

    return Reconciliation(matched, open_receivables, open_payables,
                          cash_sales, unreceipted)


def demo() -> None:
    """Self-check against the seeded sandbox and generated CFDI."""
    import json
    import sys
    from pathlib import Path

    from cfdi_parser import parse_dir
    from config import HORIZON_DAYS
    from nessie import Nessie

    root = Path(__file__).parent.parent
    manifest = json.loads((root / "mocks" / "out" / "seed-manifest.json").read_text())
    api = Nessie()

    # slug -> RFC comes from the scenario definitions; the CFDI directories are named
    # by RFC and the manifest is keyed by slug, with no field linking the two.
    sys.path.insert(0, str(root / "mocks"))
    from scenarios import SCENARIOS
    rfc_by_slug = {s.slug: s.rfc for s in SCENARIOS}

    processed = 0
    for slug, entry in manifest.items():
        rfc = rfc_by_slug.get(slug)
        assert rfc, f"no scenario named {slug!r}"
        cfdi_dir = root / "mocks" / "out" / "cfdi" / rfc
        assert cfdi_dir.is_dir(), f"missing CFDI dir {cfdi_dir}"

        batch = parse_dir(cfdi_dir)
        processed += 1
        aid = entry["account_id"]
        rec = reconcile(batch, api.deposits(aid), api.purchases(aid))

        by_method = {}
        for m in rec.matched:
            by_method[m.method] = by_method.get(m.method, 0) + 1

        print(f"\n{batch.own_name}  ({batch.own_rfc})")
        print(f"  matched            {len(rec.matched):>3}  {by_method}")
        print(f"  open receivables   {len(rec.open_receivables):>3}  "
              f"{sum(i.amount for i in rec.open_receivables):>12,.0f} MXN")
        print(f"  open payables      {len(rec.open_payables):>3}  "
              f"{sum(i.amount for i in rec.open_payables):>12,.0f} MXN")
        print(f"  cash sales         {len(rec.cash_sales):>3}  (no CFDI, expected)")
        print(f"  unreceipted spend  {len(rec.unreceipted):>3}")
        coll = rec.expected_collections(HORIZON_DAYS)
        print(f"  collections in {HORIZON_DAYS}d  {sum(coll.values()):>12,.0f} MXN "
              f"across {len(coll)} dates")
        for item in sorted(rec.open_receivables, key=lambda i: i.expected_date)[:4]:
            flag = "OVERDUE" if item.overdue else f"in {item.days_until}d"
            print(f"      {item.invoice.reference:<8} {item.invoice.counterparty_name:<28}"
                  f" {item.amount:>10,.0f}  {flag}")

        # A matched invoice must never also be reported open.
        open_refs = {i.invoice.uuid for i in rec.open_receivables + rec.open_payables}
        assert not ({m.invoice.uuid for m in rec.matched} & open_refs)
        # Every flow is either matched or left over, never both and never lost.
        assert len(rec.matched) + len(rec.open_receivables) + len(rec.open_payables) \
            == len(batch.receivables) + len(batch.payables)

    # A check that silently processes nothing is worse than no check at all.
    assert processed == len(manifest), f"processed {processed} of {len(manifest)}"
    print(f"\nreconcile: all checks passed ({processed} scenarios)")


if __name__ == "__main__":
    demo()
