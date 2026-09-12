from __future__ import annotations

import os
import unittest
from datetime import date, timedelta
from unittest.mock import patch

from backend.app import StressRequest, TENANTS, resolve_tenant, simulate_stress
from financial_engine import BusinessSnapshot, CashFlow


TODAY = date(2026, 9, 12)


class FinancialApiTests(unittest.TestCase):
    def test_demo_tenant_is_resolved_on_the_server(self) -> None:
        with patch.dict(os.environ, {"DEMO_TENANT_SLUG": "roble"}, clear=True):
            tenant = resolve_tenant()
        self.assertEqual(tenant.slug, "roble")

    @patch("backend.app._load_snapshot")
    def test_stress_endpoint_runs_the_python_engine(self, load_snapshot) -> None:
        flows = []
        for days_ago in range(28, 0, -1):
            day = TODAY - timedelta(days=days_ago)
            flows.extend(
                [
                    CashFlow(day, 4_000, "sales"),
                    CashFlow(day, -1_500, "operations"),
                ]
            )
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=50_000,
            historical_flows=flows,
        )
        load_snapshot.return_value = (
            snapshot,
            {"_id": "server-only", "nickname": "Cuenta operativa"},
        )

        payload = simulate_stress(
            StressRequest(income_change_pct=-30, receivable_delay_days=10),
            TENANTS["bajio"],
        )

        self.assertEqual(payload["business"]["slug"], "bajio")
        self.assertEqual(len(payload["result"]["points"]), 30)
        self.assertLess(
            payload["result"]["diagnostics"]["expected_ending_balance"],
            payload["baseline"]["diagnostics"]["expected_ending_balance"],
        )


if __name__ == "__main__":
    unittest.main()
