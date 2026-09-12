from datetime import date, timedelta
import unittest

from financial_engine import (
    BusinessSnapshot,
    CashFlow,
    FinancialEngine,
    FinancingStatus,
    GapType,
    Obligation,
    Receivable,
    StressScenario,
    snapshot_from_dict,
)


TODAY = date(2026, 9, 12)


def weekday_history(income: float, expense: float, days: int = 56) -> list[CashFlow]:
    flows: list[CashFlow] = []
    for days_ago in range(1, days + 1):
        day = TODAY - timedelta(days=days_ago)
        if day.weekday() < 5:
            flows.append(CashFlow(day, income, "sales"))
            if expense:
                flows.append(CashFlow(day, -expense, "operations"))
    return flows


class FinancialEngineTests(unittest.TestCase):
    def setUp(self) -> None:
        self.engine = FinancialEngine()

    def test_healthy_business_has_no_breach(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=50_000,
            safety_buffer=10_000,
            historical_flows=weekday_history(5_000, 1_000),
            obligations=[Obligation("rent", TODAY + timedelta(days=10), 8_000, "Renta")],
        )
        result = self.engine.analyze(snapshot)
        self.assertIsNone(result.breach)
        self.assertEqual(result.gap_type, GapType.NONE)
        self.assertGreater(result.health_score, 70)

    def test_timing_gap_is_resolved_by_early_receivable(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=8_000,
            safety_buffer=2_000,
            historical_flows=weekday_history(3_000, 900),
            obligations=[
                Obligation("payroll", TODAY + timedelta(days=4), 20_000, "Nómina", hard_deadline=True)
            ],
            receivables=[
                Receivable(
                    "invoice-1",
                    TODAY + timedelta(days=8),
                    25_000,
                    "Cliente Uno",
                    0.9,
                    TODAY + timedelta(days=2),
                    0.02,
                )
            ],
        )
        result = self.engine.analyze(snapshot)
        self.assertIsNotNone(result.breach)
        self.assertEqual(result.gap_type, GapType.TIMING)
        self.assertEqual(result.recommendations[0].action, "accelerate_receivable")
        self.assertTrue(result.recommendations[0].resolves_breach)
        self.assertEqual(
            result.financing_decision.status,
            FinancingStatus.COVERED_BY_RECOVERY_PLAN,
        )
        self.assertFalse(result.financing_decision.should_suggest)

    def test_structural_gap_does_not_recommend_credit(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=5_000,
            historical_flows=weekday_history(500, 2_000),
            obligations=[
                Obligation("payroll", TODAY + timedelta(days=3), 12_000, "Nómina", hard_deadline=True)
            ],
        )
        result = self.engine.analyze(snapshot)
        self.assertEqual(result.gap_type, GapType.STRUCTURAL)
        self.assertEqual(result.recommendations[0].action, "reduce_structural_deficit")
        self.assertEqual(
            result.financing_decision.status,
            FinancingStatus.NOT_RECOMMENDED_STRUCTURAL,
        )

    def test_credit_is_only_suggested_for_unresolved_timing_gap(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=1_000,
            historical_flows=weekday_history(3_000, 0),
            obligations=[
                Obligation("urgent", TODAY + timedelta(days=1), 5_000, "Pago urgente", hard_deadline=True)
            ],
        )
        result = self.engine.analyze(snapshot)
        self.assertEqual(result.gap_type, GapType.TIMING)
        self.assertEqual(result.financing_decision.status, FinancingStatus.RECOMMENDED)
        self.assertTrue(result.financing_decision.should_suggest)
        self.assertGreaterEqual(result.financing_decision.suggested_amount, 4_000)

    def test_stress_lab_compares_named_scenarios(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=20_000,
            historical_flows=weekday_history(3_000, 1_000),
        )
        results = self.engine.stress_lab(
            snapshot,
            [
                StressScenario(name="ventas -20%", inflow_change_pct=-0.20),
                StressScenario(name="gasto inesperado", unexpected_expense=5_000),
            ],
        )
        self.assertEqual(set(results), {"ventas -20%", "gasto inesperado"})

    def test_stress_scenario_reduces_ending_balance(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=20_000,
            historical_flows=weekday_history(3_000, 1_000),
        )
        baseline = self.engine.analyze(snapshot)
        stressed = self.engine.simulate(
            snapshot,
            StressScenario(name="sales-down", inflow_change_pct=-0.30, unexpected_expense=5_000),
        )
        self.assertLess(
            stressed.diagnostics["expected_ending_balance"],
            baseline.diagnostics["expected_ending_balance"],
        )

    def test_json_contract_uses_iso_dates_and_enum_values(self) -> None:
        result = self.engine.analyze(
            BusinessSnapshot(as_of=TODAY, current_balance=1_000)
        ).to_dict()
        self.assertEqual(result["gap_type"], "none")
        self.assertEqual(result["points"][0]["date"], "2026-09-13")

    def test_shortfall_includes_existing_negative_position(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=1_000,
            historical_flows=[CashFlow(TODAY - timedelta(days=6), -2_000)],
            obligations=[Obligation("bill", TODAY + timedelta(days=1), 500, "Servicio")],
        )
        result = self.engine.analyze(snapshot)
        self.assertEqual(result.breach.shortfall, 1_500)

    def test_multiple_receivables_form_one_recovery_plan(self) -> None:
        snapshot = BusinessSnapshot(
            as_of=TODAY,
            current_balance=1_000,
            historical_flows=[],
            obligations=[
                Obligation("payroll", TODAY + timedelta(days=4), 10_000, "Nómina", hard_deadline=True)
            ],
            receivables=[
                Receivable("a", TODAY + timedelta(days=8), 8_000, "A", 0.9),
                Receivable("b", TODAY + timedelta(days=9), 8_000, "B", 0.9),
            ],
        )
        result = self.engine.analyze(snapshot)
        self.assertEqual(len(result.recommendations), 2)
        self.assertFalse(result.recommendations[0].resolves_breach)
        self.assertTrue(result.recommendations[1].resolves_breach)

    def test_normalized_json_can_build_snapshot(self) -> None:
        snapshot = snapshot_from_dict(
            {
                "as_of": "2026-09-12",
                "current_balance": 1000,
                "obligations": [
                    {"id": "x", "due_date": "2026-09-13", "amount": 100, "payee": "SAT"}
                ],
            }
        )
        self.assertEqual(snapshot.as_of, TODAY)
        self.assertEqual(snapshot.obligations[0].amount, 100)


if __name__ == "__main__":
    unittest.main()
