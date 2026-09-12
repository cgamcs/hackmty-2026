#!/usr/bin/env python3
"""Seed mock SMBs into Nessie and write matching CFDI XML.

One scenario drives both outputs so Phase 2 reconciliation has something to match:
every settled Nessie deposit that corresponds to an invoice shares that invoice's
amount and date. Invoices left open are the receivables ladder rung 1 acts on.

Usage:
    python mocks/generate.py            # seed + write CFDI + verify
    python mocks/generate.py --dry-run  # CFDI only, no POSTs

Reads API_KEY from .env in the repo root. Writes out/seed-manifest.json so a re-run
reuses existing Nessie objects instead of duplicating them (Nessie has no customer
DELETE, so duplicates are permanent).
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import date, timedelta
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import cfdi  # noqa: E402
from scenarios import HISTORY_DAYS, QUINCENA_DAYS, SCENARIOS, Scenario  # noqa: E402

BASE = "https://prod-api.nessieisreal.com"
ROOT = Path(__file__).parent
OUT = ROOT / "out"
MANIFEST = OUT / "seed-manifest.json"
TODAY = date.today()

# Our own RFC stands in for suppliers we receive invoices from.
SUPPLIER_RFCS = {
    "Distribuidora Bimbo del Bajio": "DBB980412T15",
    "Refrescos del Centro SA": "RCE011130Q84",
    "Lacteos Santa Rosa": "LSR050228M37",
    "Abastos Mayoreo Leon": "AML960815W22",
    "Empaques del Centro": "ECE120603J41",
    "Transportes Rapidos GTO": "TRG140922B68",
}


def load_key() -> str:
    for line in (ROOT.parent / ".env").read_text().splitlines():
        if line.startswith("API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("API_KEY not found in .env")


class Nessie:
    def __init__(self, key: str):
        self.key = key
        self.calls = 0

    def _request(self, method: str, path: str, body: dict | None):
        sep = "&" if "?" in path else "?"
        url = f"{BASE}{path}{sep}key={self.key}"
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(
            url, data=data, method=method,
            headers={"Content-Type": "application/json"})
        with urllib.request.urlopen(req, timeout=30) as r:
            self.calls += 1
            return json.loads(r.read() or b"null")

    def post(self, path: str, body: dict, attempts: int = 3):
        for i in range(attempts):
            try:
                res = self._request("POST", path, body)
                created = res.get("objectCreated") if isinstance(res, dict) else None
                return (created or {}).get("_id"), res
            except urllib.error.HTTPError as e:
                detail = (e.read() or b"").decode()[:200]
                if e.code < 500 or i == attempts - 1:
                    raise RuntimeError(f"POST {path} -> {e.code} {detail}") from e
            except urllib.error.URLError:
                if i == attempts - 1:
                    raise
        raise RuntimeError(f"POST {path} exhausted retries")

    def put(self, path: str, body: dict):
        return self._request("PUT", path, body)

    def get(self, path: str):
        try:
            return self._request("GET", path, None)
        except urllib.error.HTTPError as e:
            if e.code == 404:      # 404 means empty on collection routes
                return []
            raise


# ── sales model ───────────────────────────────────────────────────────────────

def daily_sales(sc: Scenario, day: date, index: int) -> int:
    """Deterministic per-day retail sales: baseline x dow x quincena x trend."""
    amount = sc.daily_base_sales
    amount *= sc.dow_factors[day.weekday()]
    if day.day in QUINCENA_DAYS:
        amount *= sc.quincena_factor
    amount *= sc.trend_per_day ** index
    # Deterministic wobble so the series is not perfectly smooth.
    wobble = 1 + 0.06 * ((day.toordinal() * 7919) % 13 - 6) / 6
    return int(round(amount * wobble))


# ── CFDI output ───────────────────────────────────────────────────────────────

def write_cfdi(sc: Scenario) -> dict:
    """Write CFDI XML for receivables, supplier invoices and payroll.

    Returns the receivable metadata the Nessie seeder needs so a settled invoice
    produces a deposit with the same amount and date.
    """
    outdir = OUT / "cfdi" / sc.rfc
    outdir.mkdir(parents=True, exist_ok=True)
    written, receivables = 0, []

    for folio, r in enumerate(sc.receivables, start=4001):
        issued = TODAY - timedelta(days=r.issued_day_offset)
        base = round(r.amount / (1 + cfdi.IVA), 2)
        settled = (issued + timedelta(days=r.settled_after_days)
                   if r.settled_after_days is not None else None)
        # A settled invoice is PUE only if it was paid on issue; these are net-30
        # credit sales, so they stay PPD and the settlement is the deposit.
        xml = cfdi.factura(
            emisor_rfc=sc.rfc, emisor_nombre=sc.name,
            receptor_rfc=r.client_rfc, receptor_nombre=r.client_name,
            receptor_zip=sc.zip, base=base, fecha=issued,
            serie="A", folio=folio, lugar=sc.zip, metodo_pago="PPD")
        (outdir / f"A{folio}-emitida-PPD.xml").write_text(xml)
        written += 1
        receivables.append({
            "folio": f"A{folio}", "client": r.client_name, "amount": r.amount,
            "issued": issued.isoformat(),
            "settled": settled.isoformat() if settled else None,
            "open": settled is None,
        })

    # Supplier invoices received — the payable side.
    folio = 9001
    for sup in sc.suppliers:
        for weeks_ago in (1, 3, 6):
            issued = TODAY - timedelta(days=weeks_ago * 7)
            amount = int(sc.daily_base_sales * sup.restock_every_days * sc.restock_ratio)
            xml = cfdi.factura(
                emisor_rfc=SUPPLIER_RFCS.get(sup.name, "XAXX010101000"),
                emisor_nombre=sup.name,
                receptor_rfc=sc.rfc, receptor_nombre=sc.name, receptor_zip=sc.zip,
                base=round(amount / (1 + cfdi.IVA), 2), fecha=issued,
                serie="P", folio=folio, lugar=sc.zip, metodo_pago="PUE",
                descripcion=f"Resurtido {sup.category}")
            (outdir / f"P{folio}-recibida-PUE.xml").write_text(xml)
            folio += 1
            written += 1

    # Payroll receipts — TipoDeComprobante=N, the hard-date signal.
    folio = 7001
    for b in (b for b in sc.bills if b.kind == "payroll"):
        for months_ago in (0, 1):
            pay_day = min(b.recurring_date, 28)
            month = TODAY.month - months_ago
            year = TODAY.year
            if month < 1:
                month += 12
                year -= 1
            fecha = date(year, month, pay_day)
            if fecha > TODAY:
                continue
            xml = cfdi.nomina(
                emisor_rfc=sc.rfc, emisor_nombre=sc.name,
                receptor_rfc="XAXX010101000", receptor_nombre="Empleado Generico",
                receptor_zip=sc.zip, total_neto=b.amount, fecha=fecha,
                serie="N", folio=folio, lugar=sc.zip)
            (outdir / f"N{folio}-nomina.xml").write_text(xml)
            folio += 1
            written += 1

    return {"cfdi_written": written, "receivables": receivables, "dir": str(outdir)}


# ── Nessie seeding ────────────────────────────────────────────────────────────

def seed(api: Nessie, sc: Scenario, cfdi_meta: dict, existing: dict) -> dict:
    entry = dict(existing)

    if not entry.get("customer_id"):
        cid, _ = api.post("/customers", {
            "first_name": sc.name, "last_name": "SA de CV",
            "address": {"street_number": sc.street_number, "street_name": sc.street_name,
                        "city": sc.city, "state": sc.state, "zip": sc.zip}})
        entry["customer_id"] = cid
        print(f"  customer {cid}")

    if not entry.get("account_id"):
        aid, _ = api.post(f"/customers/{entry['customer_id']}/accounts", {
            "type": "Checking", "nickname": "Cuenta Operativa",
            "rewards": 0, "balance": sc.starting_balance})
        entry["account_id"] = aid
        print(f"  account  {aid}  balance {sc.starting_balance:,}")

    aid = entry["account_id"]

    merchants = entry.setdefault("merchants", {})
    for sup in sc.suppliers:
        if sup.name in merchants:
            continue
        mid, _ = api.post("/merchants", {
            "name": sup.name, "category": sup.category,
            "address": {"street_number": "10", "street_name": "Zona Industrial",
                        "city": sc.city, "state": sc.state, "zip": sc.zip}})
        merchants[sup.name] = mid
    print(f"  merchants {len(merchants)}")

    if not entry.get("bills"):
        bill_ids = []
        for b in sc.bills:
            pay_day = min(b.recurring_date, 28)
            next_month = TODAY.replace(day=1) + timedelta(days=32)
            upcoming = (TODAY.replace(day=pay_day) if pay_day > TODAY.day
                        else next_month.replace(day=pay_day))
            bid, _ = api.post(f"/accounts/{aid}/bills", {
                "status": "recurring", "payee": b.payee,
                "nickname": b.kind, "payment_amount": float(b.amount),
                "recurring_date": b.recurring_date,
                "payment_date": upcoming.isoformat()})
            bill_ids.append({"id": bid, "payee": b.payee, "amount": b.amount,
                             "recurring_date": b.recurring_date, "kind": b.kind})
        entry["bills"] = bill_ids
    print(f"  bills     {len(entry['bills'])}")

    # Nessie quirks, both verified:
    #  - posting deposits/purchases does NOT move `balance`
    #  - PUT /accounts/{id} updates `nickname` but silently ignores `balance`, echoing
    #    the old value back with a 202
    # So the balance is fixed at creation. Tune scenarios through `bills` instead, which
    # PUT honours in full. Warn rather than pretend the write worked.
    live = next((a for a in api.get("/accounts") if a["_id"] == aid), None)
    if live:
        if live["balance"] != sc.starting_balance:
            print(f"  !! balance is {live['balance']:,}, scenario says "
                  f"{sc.starting_balance:,} — immutable, update scenarios.py to match")
        if live.get("nickname") != "Cuenta Operativa":
            api.put(f"/accounts/{aid}", {
                "type": "Checking", "nickname": "Cuenta Operativa",
                "rewards": 0, "balance": live["balance"]})
            print(f"  nickname  restored from {live.get('nickname')!r}")

    # Reconcile bill amounts so a scenario re-tune actually reaches Nessie.
    for stored, want in zip(entry["bills"], sc.bills):
        if stored["amount"] == want.amount:
            continue
        api.put(f"/bills/{stored['id']}", {
            "status": "recurring", "payee": want.payee, "nickname": want.kind,
            "payment_amount": float(want.amount),
            "recurring_date": want.recurring_date})
        print(f"  bill      {want.payee}: {stored['amount']:,} -> {want.amount:,}")
        stored["amount"] = want.amount
        stored["payee"] = want.payee
        stored["kind"] = want.kind

    jobs: list[tuple[str, dict]] = []

    # Credit sales settling on terms. Without these, a business that sells mostly on
    # credit has the bulk of its revenue missing from the data and reads as insolvent.
    if not entry.get("credit_flows_seeded"):
        credit_share = 1 - sc.cash_sale_share
        credit_jobs = 0
        for i in range(HISTORY_DAYS + sc.collection_lag_days, 0, -1):
            sold = TODAY - timedelta(days=i)
            settles = sold + timedelta(days=sc.collection_lag_days)
            if settles > TODAY:
                continue
            gross = daily_sales(sc, sold, HISTORY_DAYS + sc.collection_lag_days - i)
            amount = int(gross * credit_share)
            if amount <= 0:
                continue
            jobs.append((f"/accounts/{aid}/deposits", {
                "medium": "balance", "transaction_date": settles.isoformat(),
                "status": "completed", "amount": amount,
                "description": f"Cobranza credito ventas {sold.isoformat()}"}))
            credit_jobs += 1
        entry["credit_flows_pending"] = credit_jobs

    if entry.get("flows_seeded"):
        print(f"  flows     cash/purchases already seeded; adding "
              f"{len(jobs)} credit settlements")
    else:
        # Retail cash sales -> one deposit per day.
        for i in range(HISTORY_DAYS, 0, -1):
            day = TODAY - timedelta(days=i)
            gross = daily_sales(sc, day, HISTORY_DAYS - i)
            cash = int(gross * sc.cash_sale_share)
            if cash <= 0:
                continue
            jobs.append((f"/accounts/{aid}/deposits", {
                "medium": "balance", "transaction_date": day.isoformat(),
                "status": "completed", "amount": cash,
                "description": "Venta diaria mostrador"}))

        # Settled receivables -> deposits carrying the invoice folio, so Phase 2 matches.
        for r in cfdi_meta["receivables"]:
            if r["open"]:
                continue
            jobs.append((f"/accounts/{aid}/deposits", {
                "medium": "balance", "transaction_date": r["settled"],
                "status": "completed", "amount": r["amount"],
                "description": f"Cobro factura {r['folio']} {r['client']}"}))

        # Restocks -> purchases against the supplier merchant.
        for sup in sc.suppliers:
            mid = merchants[sup.name]
            for i in range(HISTORY_DAYS, 0, -sup.restock_every_days):
                day = TODAY - timedelta(days=i)
                gross = daily_sales(sc, day, HISTORY_DAYS - i)
                amount = int(gross * sc.restock_ratio * sup.restock_every_days
                             / max(len(sc.suppliers), 1))
                if amount <= 0:
                    continue
                jobs.append((f"/accounts/{aid}/purchases", {
                    "merchant_id": mid, "medium": "balance", "amount": amount,
                    "purchase_date": day.isoformat(), "status": "completed",
                    "description": f"Resurtido {sup.category}"}))

    if not jobs:
        print("  flows     nothing to post")
        return entry

    print(f"  flows     posting {len(jobs)} records...", flush=True)
    errors: list[str] = []

    def run(job):
        path, body = job
        try:
            api.post(path, body)
        except Exception as e:  # collected, not raised, so one bad row cannot abort the seed
            errors.append(str(e))

    with ThreadPoolExecutor(max_workers=6) as pool:
        list(pool.map(run, jobs))

    if errors:
        print(f"  !! {len(errors)} failed; first: {errors[0]}")
    entry["flows_seeded"] = entry.get("flows_seeded", 0) + len(jobs) - len(errors)
    entry["flow_errors"] = len(errors)
    entry["credit_flows_seeded"] = True
    entry.pop("credit_flows_pending", None)
    return entry


# ── verification ──────────────────────────────────────────────────────────────

def project(api: Nessie, entry: dict, horizon: int = 30) -> dict:
    """Read back from Nessie and run the Phase 4-6 core.

    This is the runnable check: it fails loudly if a scenario does not produce the
    verdict it was designed for.
    """
    aid = entry["account_id"]
    accounts = api.get("/accounts")
    balance = next((a["balance"] for a in accounts if a["_id"] == aid), 0)

    deposits = api.get(f"/accounts/{aid}/deposits") or []
    purchases = api.get(f"/accounts/{aid}/purchases") or []

    days = max(HISTORY_DAYS, 1)
    inflow_per_day = sum(d.get("amount", 0) for d in deposits) / days
    outflow_per_day = sum(p.get("amount", 0) for p in purchases) / days

    # Open receivables landing inside the horizon. CONCEPT.md Phase 4 includes this
    # term; omitting it makes every credit-selling business read as structural.
    COLLECTION_PROBABILITY = 0.85
    NET_TERMS = 30
    expected: dict[str, float] = {}
    for r in entry.get("receivables", []):
        if not r["open"]:
            continue
        lands = date.fromisoformat(r["issued"]) + timedelta(days=NET_TERMS)
        if TODAY < lands <= TODAY + timedelta(days=horizon):
            expected[lands.isoformat()] = (
                expected.get(lands.isoformat(), 0)
                + r["amount"] * COLLECTION_PROBABILITY)

    bills = entry["bills"]
    running, min_balance, breach = balance, balance, None
    for i in range(1, horizon + 1):
        day = TODAY + timedelta(days=i)
        due = sum(b["amount"] for b in bills if b["recurring_date"] == day.day)
        running += (inflow_per_day - outflow_per_day
                    + expected.get(day.isoformat(), 0) - due)
        if due and running < 0 and breach is None:
            payee = next(b["payee"] for b in bills if b["recurring_date"] == day.day)
            breach = {"date": day.isoformat(), "shortfall": round(-running),
                      "obligation": payee}
        min_balance = min(min_balance, running)

    monthly_bills = sum(b["amount"] for b in bills)
    net = ((inflow_per_day - outflow_per_day) * horizon
           + sum(expected.values()) - monthly_bills)
    if breach is None:
        verdict = "none"
    elif net >= 0:
        verdict = "timing"
    else:
        verdict = "structural"

    return {"balance": balance, "inflow_per_day": round(inflow_per_day),
            "outflow_per_day": round(outflow_per_day), "net_30d": round(net),
            "min_balance": round(min_balance), "breach": breach, "verdict": verdict,
            "expected_collections": round(sum(expected.values())),
            "open_receivables": sum(1 for r in entry.get("receivables", []) if r["open"])}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true", help="CFDI only, no Nessie POSTs")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    manifest = json.loads(MANIFEST.read_text()) if MANIFEST.exists() else {}

    api = None if args.dry_run else Nessie(load_key())

    for sc in SCENARIOS:
        print(f"\n{sc.name}  ({sc.rfc})  expected: {sc.expected_verdict}")
        meta = write_cfdi(sc)
        print(f"  cfdi      {meta['cfdi_written']} files -> {meta['dir']}")
        if api is None:
            continue
        entry = seed(api, sc, meta, manifest.get(sc.slug, {}))
        entry["receivables"] = meta["receivables"]
        entry["expected_verdict"] = sc.expected_verdict
        manifest[sc.slug] = entry
        MANIFEST.write_text(json.dumps(manifest, indent=2))

    if api is None:
        print("\ndry run — no Nessie writes")
        return 0

    print(f"\n{'':-<64}\nverification ({api.calls} API calls so far)")
    failures = []
    for sc in SCENARIOS:
        p = project(api, manifest[sc.slug])
        manifest[sc.slug]["projection"] = p
        ok = p["verdict"] == sc.expected_verdict
        mark = "ok " if ok else "FAIL"
        print(f"  [{mark}] {sc.name:<30} verdict={p['verdict']:<11} "
              f"expected={sc.expected_verdict:<11} net30={p['net_30d']:>9,} "
              f"min={p['min_balance']:>9,}")
        if p["breach"]:
            print(f"         breach {p['breach']['date']} "
                  f"short {p['breach']['shortfall']:,} on {p['breach']['obligation']}")
        if not ok:
            failures.append(sc.slug)

    MANIFEST.write_text(json.dumps(manifest, indent=2))
    print(f"\nmanifest -> {MANIFEST}")

    if failures:
        print(f"\nscenarios not matching their expected verdict: {failures}")
        print("tune scenarios.py amounts — the three must land on distinct verdicts")
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
