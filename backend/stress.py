"""Stress-scenario logic for the Stress Lab.

Separate from `main.py` so it carries no FastAPI dependency: the scenario arithmetic and
the risk grading are the parts worth testing, and they should run without a web framework,
a database, or an API key installed.

Shapes fixed by `StressRequest` / `StressSimulationResponse` in `frontend/src/types.ts`.
"""

from __future__ import annotations

from dataclasses import replace as dc_replace

from pydantic import BaseModel, Field

from financial_engine import FinancialEngine, StressScenario

HORIZON_DAYS = 30
# Below this share of monthly inflow a timing gap is uncomfortable rather than dangerous.
MEDIO_THRESHOLD = 0.20


class StressRequest(BaseModel):
    income_change_pct: float = Field(default=0, ge=-100, le=200)
    variable_expense_change_pct: float = Field(default=0, ge=-100, le=300)
    receivable_delay_days: int = Field(default=0, ge=0, le=90)
    available_cash_buffer: float | None = Field(default=None, ge=0)


def risk_level(result: dict) -> str:
    """Grade one engine analysis for the UI badge."""
    gap = result.get("gap_type")
    if gap == "none":
        return "BAJO"
    if gap == "structural":
        # Never softened by a healthy-looking curve. A reassuring badge on a business
        # whose outflows persistently exceed inflows is the worst thing to display.
        return "CRITICO"
    shortfall = float((result.get("breach") or {}).get("shortfall", 0))
    monthly_inflow = sum(float(p["expected_inflow"]) for p in result.get("points", []))
    # Relative to what the business actually takes in: the same peso shortfall means very
    # different things at different revenues. No inflow at all is never the mild case.
    return ("MEDIO" if monthly_inflow and shortfall / monthly_inflow < MEDIO_THRESHOLD
            else "ALTO")


def analysis(result) -> dict:
    payload = result.to_dict()
    payload["risk_level"] = risk_level(payload)
    return payload


def run_stress(request: StressRequest, snapshot, account: dict, business: dict) -> dict:
    """Baseline and stressed analysis for one already-loaded snapshot."""
    engine = FinancialEngine(horizon_days=HORIZON_DAYS)
    baseline = engine.forecast(snapshot)

    scenario_snapshot = snapshot
    if request.available_cash_buffer is not None:
        scenario_snapshot = dc_replace(
            snapshot, available_cash_buffer=request.available_cash_buffer)

    scenario = StressScenario(
        name="custom",
        # The UI sends whole percentages; the engine works in fractions. Passing 30 where
        # 0.30 was meant applies a 3000% shock and still returns a plausible curve.
        inflow_change_pct=request.income_change_pct / 100,
        variable_expense_change_pct=request.variable_expense_change_pct / 100,
        receivable_delay_days=request.receivable_delay_days,
    )
    stressed = engine.simulate(scenario_snapshot, scenario)

    return {
        "business": business,
        "account": {
            "nickname": str(account.get("nickname", "Cuenta Operativa")),
            "balance": snapshot.current_balance,
            "live": True,
        },
        "available_cash_buffer": scenario_snapshot.available_cash_buffer,
        "baseline": analysis(baseline),
        "result": analysis(stressed),
    }
