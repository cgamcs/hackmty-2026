from datetime import date, timedelta
import json

from financial_engine import BusinessSnapshot, CashFlow, FinancialEngine, Obligation, Receivable


TODAY = date(2026, 9, 12)


def build_timing_gap() -> BusinessSnapshot:
    flows = []
    for days_ago in range(1, 57):
        day = TODAY - timedelta(days=days_ago)
        if day.weekday() < 5:
            flows.append(CashFlow(day, 2_400, "sales"))
            flows.append(CashFlow(day, -900, "operations"))
    return BusinessSnapshot(
        as_of=TODAY,
        current_balance=18_000,
        safety_buffer=5_000,
        available_cash_buffer=8_000,
        historical_flows=flows,
        obligations=[
            Obligation("PAY-SEP", TODAY + timedelta(days=8), 32_000, "Nómina", "payroll", True),
            Obligation("SUP-104", TODAY + timedelta(days=6), 7_500, "Proveedor Norte"),
        ],
        receivables=[
            Receivable(
                "A-4471",
                TODAY + timedelta(days=14),
                25_000,
                "Ferretería López",
                collection_probability=0.9,
                earliest_collection_date=TODAY + timedelta(days=4),
                early_payment_discount=0.02,
            )
        ],
    )


if __name__ == "__main__":
    result = FinancialEngine().analyze(build_timing_gap())
    print(json.dumps(result.to_dict(), indent=2, ensure_ascii=False))
