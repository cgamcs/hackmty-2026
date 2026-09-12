"""Learn real payment terms per counterparty instead of assuming a global default.

CFDI records that a PPD invoice is paid later but never says when — terms are
commercial, not fiscal. A single hardcoded default is wrong for two reasons: it does
not describe any real business, and it does not generalize to an SMB whose clients pay
at 15, 60 or 90 days.

But reconciliation already produces the answer. Every matched invoice carries both its
issue date and the date its money actually landed, and that difference *is* that
counterparty's behaviour. So:

    observed history  ->  median lag per counterparty     (what they actually do)
    no history        ->  config.NET_TERMS_DAYS           (cold start only)

The default stops being an assumption about everybody and becomes a fallback for a
counterparty we have never been paid by.
"""

from __future__ import annotations

import statistics
from dataclasses import dataclass, replace
from datetime import timedelta

from config import NET_TERMS_DAYS
from reconcile import Match, OpenItem, Reconciliation

# Below this many settled invoices, one late payer would dominate the median.
MIN_OBSERVATIONS = 2


@dataclass
class Terms:
    rfc: str
    name: str
    days: int
    observations: int
    spread: int          # max - min lag, i.e. how reliable this counterparty is
    learned: bool

    @property
    def reliable(self) -> bool:
        """A tight spread means rung 1 of the ladder can trust the landing date."""
        return self.learned and self.spread <= 7


def learn_terms(matches: list[Match],
                default_days: int = NET_TERMS_DAYS) -> dict[str, Terms]:
    """Median issue-to-settlement lag per counterparty, from matched invoices."""
    lags: dict[str, list[int]] = {}
    names: dict[str, str] = {}
    for m in matches:
        if not m.invoice.is_receivable:
            continue
        rfc = m.invoice.counterparty_rfc
        lag = (m.flow_date - m.invoice.fecha).days
        if lag < 0:
            continue                    # settlement before issue: bad match, ignore
        lags.setdefault(rfc, []).append(lag)
        names[rfc] = m.invoice.counterparty_name

    out: dict[str, Terms] = {}
    for rfc, observed in lags.items():
        enough = len(observed) >= MIN_OBSERVATIONS
        out[rfc] = Terms(
            rfc=rfc, name=names[rfc],
            days=int(statistics.median(observed)) if enough else default_days,
            observations=len(observed),
            spread=max(observed) - min(observed),
            learned=enough)
    return out


def apply_terms(rec: Reconciliation,
                terms: dict[str, Terms],
                default_days: int = NET_TERMS_DAYS) -> Reconciliation:
    """Recompute expected landing dates on open receivables using learned terms.

    Returns a new Reconciliation; the input is left untouched so a caller can compare
    the assumed and learned projections side by side.
    """
    updated = []
    for item in rec.open_receivables:
        rfc = item.invoice.counterparty_rfc
        days = terms[rfc].days if rfc in terms else default_days
        updated.append(OpenItem(
            invoice=item.invoice,
            expected_date=item.invoice.fecha + timedelta(days=days),
            amount=item.amount))
    return replace(rec, open_receivables=updated)


def demo() -> None:
    import json
    import sys
    from pathlib import Path

    from cfdi_parser import parse_dir
    from config import HORIZON_DAYS
    from nessie import Nessie
    from reconcile import reconcile

    root = Path(__file__).parent.parent
    manifest = json.loads((root / "mocks" / "out" / "seed-manifest.json").read_text())
    sys.path.insert(0, str(root / "mocks"))
    from scenarios import SCENARIOS
    rfc_by_slug = {s.slug: s.rfc for s in SCENARIOS}

    api = Nessie()
    processed = 0

    for slug, entry in manifest.items():
        batch = parse_dir(root / "mocks" / "out" / "cfdi" / rfc_by_slug[slug])
        aid = entry["account_id"]
        rec = reconcile(batch, api.deposits(aid), api.purchases(aid))
        terms = learn_terms(rec.matched)
        tuned = apply_terms(rec, terms)
        processed += 1

        print(f"\n{batch.own_name}")
        if not terms:
            print("  no settled receivables yet — every counterparty on cold-start "
                  f"default of {NET_TERMS_DAYS}d")
        for t in terms.values():
            tag = (f"learned from {t.observations}" if t.learned
                   else f"default ({t.observations} obs, need {MIN_OBSERVATIONS})")
            rel = "reliable" if t.reliable else "variable"
            print(f"  {t.name:<28} {t.days:>3}d  spread={t.spread:>2}d  {tag}, {rel}")

        before = sum(rec.expected_collections(HORIZON_DAYS).values())
        after = sum(tuned.expected_collections(HORIZON_DAYS).values())
        print(f"  collections in {HORIZON_DAYS}d: assumed {before:>12,.0f} "
              f"-> learned {after:>12,.0f} MXN")

        # The totals can match while the timeline moves completely. For a liquidity
        # decision the dates are what matter: an invoice landing on day 7 covers a
        # payroll on day 15, the same invoice landing on day 22 does not.
        assumed = {i.invoice.reference: i for i in rec.open_receivables}
        shifted = [(assumed[i.invoice.reference], i) for i in tuned.open_receivables
                   if assumed[i.invoice.reference].expected_date != i.expected_date]
        if shifted:
            print("  landing dates moved:")
            for old, new in sorted(shifted, key=lambda p: p[1].expected_date):
                print(f"      {new.invoice.reference:<8} "
                      f"{new.invoice.counterparty_name:<26} {new.amount:>10,.0f}  "
                      f"day {old.days_until:>2} -> day {new.days_until:>2}")
        elif rec.open_receivables:
            print("  landing dates unchanged")

        # Learned terms must never invent or drop a receivable.
        assert len(tuned.open_receivables) == len(rec.open_receivables)
        assert {i.invoice.uuid for i in tuned.open_receivables} == \
               {i.invoice.uuid for i in rec.open_receivables}
        # Every learned term must come from a real observation.
        for t in terms.values():
            assert t.observations > 0
            assert t.days >= 0

    assert processed == len(manifest), f"processed {processed} of {len(manifest)}"
    print(f"\nterms: all checks passed ({processed} scenarios)")


if __name__ == "__main__":
    demo()
