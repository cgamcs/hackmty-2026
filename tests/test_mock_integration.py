from datetime import date
import json
from pathlib import Path
import unittest

from financial_engine import (
    FinancialEngine,
    GapType,
    parse_cfdi_directory,
    snapshot_from_live_nessie,
    snapshot_from_mock_files,
)


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
        manifest = json.loads((ROOT / "mocks/out/seed-manifest.json").read_text())
        expected_open = {
            item["folio"]
            for item in manifest["bajio"]["receivables"]
            if item["open"]
        }
        self.assertGreater(len(snapshot.historical_flows), 200)
        self.assertEqual({item.id for item in snapshot.receivables}, expected_open)
        payroll = [item for item in snapshot.obligations if item.category == "payroll"]
        self.assertTrue(payroll)
        self.assertTrue(all(item.hard_deadline for item in payroll))

    def test_cfdi_parser_recognizes_invoice_and_payroll(self) -> None:
        documents = parse_cfdi_directory(ROOT / "mocks/out/cfdi/CBA190803M71")
        invoice = next(item for item in documents if item.document_id == "A4001")
        payroll = next(item for item in documents if item.document_id == "N7001")
        manifest = json.loads((ROOT / "mocks/out/seed-manifest.json").read_text())
        expected_amount = manifest["bajio"]["receivables"][0]["amount"]
        self.assertEqual(invoice.payment_method, "PPD")
        self.assertAlmostEqual(invoice.total, expected_amount, places=1)
        self.assertTrue(payroll.has_payroll_complement)

    def test_live_adapter_reads_one_account_from_api_client(self) -> None:
        class FakeNessie:
            def __init__(self) -> None:
                self.requested: list[tuple[str, str]] = []

            def account(self, account_id: str):
                self.requested.append(("account", account_id))
                return {"_id": account_id, "balance": 12_500}

            def deposits(self, account_id: str):
                self.requested.append(("deposits", account_id))
                return [{
                    "_id": "deposit-1",
                    "transaction_date": "2026-09-10",
                    "status": "completed",
                    "amount": 4_000,
                    "description": "Cobro factura A4001",
                }]

            def purchases(self, account_id: str):
                self.requested.append(("purchases", account_id))
                return []

            def withdrawals(self, account_id: str):
                self.requested.append(("withdrawals", account_id))
                return []

            def bills(self, account_id: str):
                self.requested.append(("bills", account_id))
                return []

        client = FakeNessie()
        snapshot = snapshot_from_live_nessie(
            account_id="only-this-account",
            cfdi_directory=ROOT / "mocks/out/cfdi/CBA190803M71",
            owner_rfc="CBA190803M71",
            as_of=AS_OF,
            client=client,
        )
        self.assertEqual(snapshot.current_balance, 12_500)
        self.assertNotIn("A4001", {item.id for item in snapshot.receivables})
        self.assertEqual(
            {account_id for _, account_id in client.requested},
            {"only-this-account"},
        )


if __name__ == "__main__":
    unittest.main()
