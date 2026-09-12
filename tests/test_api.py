"""API-layer tests.

Previously these targeted `backend.app`, which resolved tenants from a hardcoded slug map
and authenticated against Supabase. Both are gone: tenants live in Tiger and sessions are
server-side cookies. The scenario logic moved to `backend.stress`, which carries no
FastAPI dependency, so these run without the web framework installed:

  * the stress scenario arithmetic actually reaches the engine, and
  * risk is graded relative to the business's own revenue, not an absolute peso amount.

`run_stress` is deliberately pure, so neither test needs a database, an API key, or a
running server.
"""

from __future__ import annotations

import unittest
from datetime import date, timedelta

from backend.stress import StressRequest, risk_level, run_stress
from financial_engine import BusinessSnapshot, CashFlow

TODAY = date(2026, 9, 12)


def _snapshot(balance: float = 50_000) -> BusinessSnapshot:
    flows = []
    for days_ago in range(28, 0, -1):
        day = TODAY - timedelta(days=days_ago)
        flows.extend([CashFlow(day, 4_000, "sales"),
                      CashFlow(day, -1_500, "operations")])
    return BusinessSnapshot(as_of=TODAY, current_balance=balance,
                            historical_flows=flows)

class StressTests(unittest.TestCase):
    def test_stress_runs_the_python_engine(self) -> None:
        payload = run_stress(
            StressRequest(income_change_pct=-30, receivable_delay_days=10),
            _snapshot(),
            {"_id": "server-only", "nickname": "Cuenta operativa"},
            {"slug": "t-1", "name": "Comercializadora del Bajio",
             "rfc": "CBA190803M71", "owner": "owner@example.com"},
        )

        self.assertEqual(payload["business"]["name"], "Comercializadora del Bajio")
        self.assertEqual(len(payload["result"]["points"]), 30)
        self.assertLess(
            payload["result"]["diagnostics"]["expected_ending_balance"],
            payload["baseline"]["diagnostics"]["expected_ending_balance"],
        )

    def test_percentages_are_converted_to_fractions(self) -> None:
        """The UI sends whole percentages; the engine expects fractions.

        Passing 30 where 0.30 was meant would apply a 3000% shock and still return a
        plausible-looking curve, so the conversion is asserted rather than assumed.
        """
        mild = run_stress(StressRequest(income_change_pct=-10), _snapshot(),
                          {"nickname": "x"}, {"slug": "t", "name": "", "rfc": "",
                                              "owner": ""})
        severe = run_stress(StressRequest(income_change_pct=-60), _snapshot(),
                            {"nickname": "x"}, {"slug": "t", "name": "", "rfc": "",
                                                "owner": ""})
        self.assertLess(
            severe["result"]["diagnostics"]["expected_ending_balance"],
            mild["result"]["diagnostics"]["expected_ending_balance"],
        )

    def test_buffer_override_reaches_the_scenario(self) -> None:
        payload = run_stress(
            StressRequest(available_cash_buffer=12_345), _snapshot(),
            {"nickname": "x"}, {"slug": "t", "name": "", "rfc": "", "owner": ""})
        self.assertEqual(payload["available_cash_buffer"], 12_345)


class RiskLevelTests(unittest.TestCase):
    def test_structural_is_always_critical(self) -> None:
        # Never softened by a healthy-looking curve: a reassuring badge on a business
        # whose outflows persistently exceed inflows is the worst thing to display.
        self.assertEqual(risk_level({"gap_type": "structural", "points": []}), "CRITICO")

    def test_no_gap_is_low(self) -> None:
        self.assertEqual(risk_level({"gap_type": "none", "points": []}), "BAJO")

    def test_gap_is_graded_against_revenue(self) -> None:
        points = [{"expected_inflow": 10_000} for _ in range(30)]   # 300,000 total
        small = {"gap_type": "timing", "points": points,
                 "breach": {"shortfall": 30_000}}      # 10%
        large = {"gap_type": "timing", "points": points,
                 "breach": {"shortfall": 90_000}}      # 30%
        self.assertEqual(risk_level(small), "MEDIO")
        self.assertEqual(risk_level(large), "ALTO")

    def test_no_revenue_is_not_treated_as_low_risk(self) -> None:
        # Dividing by zero inflow must not silently grade a shortfall as MEDIO.
        self.assertEqual(
            risk_level({"gap_type": "timing", "points": [],
                        "breach": {"shortfall": 1_000}}), "ALTO")


if __name__ == "__main__":
    unittest.main()
