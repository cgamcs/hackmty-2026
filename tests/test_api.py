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

import base64
import os
import unittest
from dataclasses import replace
from datetime import date, timedelta
from unittest.mock import patch

from backend.crypto import decrypt_xml, encrypt_xml
from backend.dashboard import build as build_dashboard
from backend.stress import StressRequest, run_stress
from financial_engine import BusinessSnapshot, CashFlow, FinancialEngine, Obligation


class CryptoKeyTests(unittest.TestCase):
    def test_unpadded_32_byte_base64_key_is_accepted(self):
        key = base64.b64encode(b"k" * 32).decode().rstrip("=")
        with patch.dict(os.environ, {"CFDI_ENC_KEY": key}):
            xml = '<cfdi:Comprobante Total="1.00"/>'
            encrypted = encrypt_xml(xml, "TEST-UUID")
            self.assertEqual(decrypt_xml(encrypted, "TEST-UUID"), xml)


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


class RiskConsistencyTests(unittest.TestCase):
    def test_stress_baseline_is_graded_like_the_forecast(self) -> None:
        # A small shortfall (about 4% of monthly inflow) two days away: the old Stress Lab
        # rule said MEDIO while the dashboard said ALTO for the very same future.
        snapshot = replace(_snapshot(balance=2_000), obligations=[
            Obligation("payroll", TODAY + timedelta(days=2), 12_000, "Nómina", hard_deadline=True)])
        payload = run_stress(StressRequest(), snapshot, {"nickname": "x"},
                             {"slug": "t", "name": "", "rfc": "", "owner": ""})
        forecast = FinancialEngine().analyze(snapshot).to_dict()
        self.assertEqual(payload["baseline"]["risk_level"], forecast["risk_level"])
        self.assertEqual(payload["baseline"]["risk_level"], "ALTO")


class DashboardBufferTests(unittest.TestCase):
    def test_buffer_shown_is_the_stored_cash_buffer(self) -> None:
        # bufferAvailable used to be the minimum pessimistic balance, which Recovery then
        # spent as if it were reserve cash.
        data = build_dashboard(
            tenant={}, account={}, accounts=[], flows=[], invoices=[], obligations=[],
            result={"points": [], "risk_level": "BAJO",
                    "diagnostics": {"minimum_pessimistic_balance": -9_000}},
            today=TODAY, cash_buffer=15_000)
        self.assertEqual(data["bufferAvailable"], 15_000)
        self.assertEqual(data["risk"], "BAJO")


if __name__ == "__main__":
    unittest.main()
