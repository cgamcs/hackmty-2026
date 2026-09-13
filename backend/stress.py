"""Stress-scenario logic for the Stress Lab.

Separate from `main.py` so it carries no FastAPI dependency: the scenario arithmetic is the
part worth testing, and it should run without a web framework, a database, or an API key
installed. The risk grade comes from the engine, the same one Predicción shows.

Shapes fixed by `StressRequest` / `StressSimulationResponse` in `frontend/src/types.ts`.
"""

from __future__ import annotations

from dataclasses import replace as dc_replace

from pydantic import BaseModel, Field

from financial_engine import FinancialEngine, StressScenario

HORIZON_DAYS = 30


class StressRequest(BaseModel):
    income_change_pct: float = Field(default=0, ge=-100, le=200)
    variable_expense_change_pct: float = Field(default=0, ge=-100, le=300)
    receivable_delay_days: int = Field(default=0, ge=0, le=90)
    available_cash_buffer: float | None = Field(default=None, ge=0)


def analysis(result) -> dict:
    # The engine already grades the future (risk_level), so the baseline curve here reads
    # exactly like Predicción and a stressed curve is comparable to it.
    return result.to_dict()


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
