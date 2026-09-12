from __future__ import annotations

import argparse
import json
from pathlib import Path

from financial_engine import FinancialEngine, snapshot_from_mock_files


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("slug", choices=("esperanza", "bajio", "roble"), nargs="?")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    slugs = [args.slug] if args.slug else ["esperanza", "bajio", "roble"]
    engine = FinancialEngine()
    for slug in slugs:
        result = engine.analyze(snapshot_from_mock_files(slug, ROOT))
        if args.json:
            print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
            continue
        breach = result.breach
        breach_text = (
            f"{breach.date} · {breach.obligation} · ${breach.shortfall:,.0f}"
            if breach
            else "sin breach"
        )
        print(
            f"{slug:10} verdict={result.gap_type.value:10} "
            f"health={result.health_score:3} resilience={result.resilience_score:3} "
            f"financing={result.financing_decision.status.value:28} {breach_text}"
        )


if __name__ == "__main__":
    main()
