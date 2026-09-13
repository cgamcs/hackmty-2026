from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from enum import Enum
from typing import Any


class GapType(str, Enum):
    NONE = "none"
    TIMING = "timing"
    STRUCTURAL = "structural"


class FinancingStatus(str, Enum):
    NOT_NEEDED = "not_needed"
    COVERED_BY_RECOVERY_PLAN = "covered_by_recovery_plan"
    RECOMMENDED = "recommended"
    NOT_RECOMMENDED_STRUCTURAL = "not_recommended_structural"


@dataclass(frozen=True)
class CashFlow:
    """A settled historical movement. Income is positive, expense is negative."""

    date: date
    amount: float
    category: str = "other"
    source: str = "bank"


@dataclass(frozen=True)
class Obligation:
    id: str
    due_date: date
    amount: float
    payee: str
    category: str = "supplier"
    hard_deadline: bool = False
    slack_days: int = 0
    relationship_cost: float = 0.0


@dataclass(frozen=True)
class Receivable:
    id: str
    due_date: date
    amount: float
    customer: str
    collection_probability: float = 0.80
    # None: the client cannot be asked to pay early, so ladder rung 1 skips it.
    earliest_collection_date: date | None = None
    early_payment_discount: float = 0.02


@dataclass(frozen=True)
class BusinessSnapshot:
    as_of: date
    current_balance: float
    historical_flows: list[CashFlow] = field(default_factory=list)
    obligations: list[Obligation] = field(default_factory=list)
    receivables: list[Receivable] = field(default_factory=list)
    available_cash_buffer: float = 0.0
    safety_buffer: float = 0.0


@dataclass(frozen=True)
class StressScenario:
    name: str = "custom"
    inflow_change_pct: float = 0.0
    variable_expense_change_pct: float = 0.0
    receivable_delay_days: int = 0
    unexpected_expense: float = 0.0
    unexpected_expense_date: date | None = None


@dataclass(frozen=True)
class ForecastPoint:
    date: date
    expected_inflow: float
    pessimistic_inflow: float
    variable_outflow: float
    obligation_outflow: float
    expected_balance: float
    pessimistic_balance: float


@dataclass(frozen=True)
class Breach:
    date: date
    shortfall: float
    obligation_id: str
    obligation: str
    amount: float


@dataclass(frozen=True)
class Recommendation:
    rank: int
    action: str
    title: str
    description: str
    cash_impact: float
    estimated_cost: float
    resolves_breach: bool
    parameters: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class FinancingDecision:
    status: FinancingStatus
    should_suggest: bool
    reason: str
    residual_shortfall: float = 0.0
    suggested_amount: float = 0.0
    term_days: int = 0


@dataclass(frozen=True)
class ForecastResult:
    points: list[ForecastPoint]
    breach: Breach | None
    gap_type: GapType
    health_score: int
    resilience_score: int
    recommendations: list[Recommendation]
    financing_decision: FinancingDecision
    diagnostics: dict[str, Any]

    def to_dict(self) -> dict[str, Any]:
        def convert(value: Any) -> Any:
            if isinstance(value, date):
                return value.isoformat()
            if isinstance(value, Enum):
                return value.value
            if isinstance(value, list):
                return [convert(item) for item in value]
            if isinstance(value, dict):
                return {key: convert(item) for key, item in value.items()}
            if hasattr(value, "__dataclass_fields__"):
                return convert(asdict(value))
            return value

        return convert(self)
