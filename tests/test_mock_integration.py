from datetime import date
from pathlib import Path
import unittest

from financial_engine import FinancialEngine, GapType, parse_cfdi_directory, snapshot_from_mock_files


ROOT = Path(__file__).resolve().parents[1]
AS_OF = date(2026, 9, 12)


class MockIntegrationTests(unittest.TestCase):
    def test_checked_in_scenarios_match_their_expected_verdicts(self) -> None:
        engine = FinancialEngine()
        expected = {
            "esperanza": GapType.NONE,
            "bajio": GapType.TIMING,
            "roble": GapType.STRUCTURAL,
        }
        for slug, verdict in expected.items():
            with self.subTest(slug=slug):
                snapshot = snapshot_from_mock_files(slug, ROOT, as_of=AS_OF)
                self.assertEqual(engine.analyze(snapshot).gap_type, verdict)

    def test_bajio_joins_nessie_history_and_only_open_ppd_invoices(self) -> None:
        snapshot = snapshot_from_mock_files("bajio", ROOT, as_of=AS_OF)
        self.assertGreater(len(snapshot.historical_flows), 200)
        self.assertEqual({item.id for item in snapshot.receivables}, {"A4003", "A4004", "A4005", "A4006"})
        payroll = [item for item in snapshot.obligations if item.category == "payroll"]
        self.assertTrue(payroll)
        self.assertTrue(all(item.hard_deadline for item in payroll))

    def test_cfdi_parser_recognizes_invoice_and_payroll(self) -> None:
        documents = parse_cfdi_directory(ROOT / "mocks/out/cfdi/CBA190803M71")
        invoice = next(item for item in documents if item.document_id == "A4001")
        payroll = next(item for item in documents if item.document_id == "N7001")
        self.assertEqual(invoice.payment_method, "PPD")
        self.assertEqual(invoice.total, 58_000)
        self.assertTrue(payroll.has_payroll_complement)


if __name__ == "__main__":
    unittest.main()
