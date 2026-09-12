from __future__ import annotations

from collections import defaultdict
from dataclasses import replace
from datetime import date, timedelta
from math import ceil
from statistics import median
from typing import Iterable

from .models import (
    Breach,
    BusinessSnapshot,
    CashFlow,
    ForecastPoint,
    ForecastResult,
    FinancingDecision,
    FinancingStatus,
    GapType,
    Obligation,
    Receivable,
    Recommendation,
    StressScenario,
)


class FinancialEngine:
    """Deterministic and explainable cash-flow forecast.

    The engine deliberately consumes normalized domain objects. Nessie and CFDI
    parsing belong in adapters, which keeps the calculations independently testable.
    """

    def __init__(self, horizon_days: int = 30, pessimistic_quantile: float = 0.20):
        if horizon_days < 1:
            raise ValueError("horizon_days must be positive")
        if not 0 <= pessimistic_quantile <= 1:
            raise ValueError("pessimistic_quantile must be between 0 and 1")
        self.horizon_days = horizon_days
        self.pessimistic_quantile = pessimistic_quantile

    def analyze(
        self,
        snapshot: BusinessSnapshot,
        scenario: StressScenario | None = None,
        include_recommendations: bool = True,
    ) -> ForecastResult:
        self._validate(snapshot)
        scenario = scenario or StressScenario()
        points, daily_available = self._project(snapshot, scenario)
        breach = self._detect_breach(snapshot.obligations, daily_available)
        gap_type = self._classify(snapshot, points, breach)
        health = self._health_score(snapshot, points)
        resilience = self._resilience_score(snapshot, points, breach)
        recommendations = (
            self._build_ladder(snapshot, breach, gap_type)
            if include_recommendations and breach
            else []
        )
        financing_decision = self._decide_financing(
            snapshot, breach, gap_type, recommendations
        )
        inflows = [flow.amount for flow in snapshot.historical_flows if flow.amount > 0]
        outflows = [-flow.amount for flow in snapshot.historical_flows if flow.amount < 0]
        diagnostics = {
            "as_of": snapshot.as_of.isoformat(),
            "horizon_days": self.horizon_days,
            "historical_inflow_median": round(median(inflows), 2) if inflows else 0.0,
            "historical_outflow_median": round(median(outflows), 2) if outflows else 0.0,
            "expected_ending_balance": round(points[-1].expected_balance, 2),
            "pessimistic_ending_balance": round(points[-1].pessimistic_balance, 2),
            "minimum_pessimistic_balance": round(
                min(point.pessimistic_balance for point in points), 2
            ),
            "scenario": scenario.name,
        }
        return ForecastResult(
            points=points,
            breach=breach,
            gap_type=gap_type,
            health_score=health,
            resilience_score=resilience,
            recommendations=recommendations,
            financing_decision=financing_decision,
            diagnostics=diagnostics,
        )

    def forecast(self, snapshot: BusinessSnapshot) -> ForecastResult:
        """Run the complete 30-day baseline financial analysis."""

        return self.analyze(snapshot)

    def simulate(self, snapshot: BusinessSnapshot, scenario: StressScenario) -> ForecastResult:
        return self.analyze(snapshot, scenario=scenario)

    def stress_lab(
        self, snapshot: BusinessSnapshot, scenarios: Iterable[StressScenario]
    ) -> dict[str, ForecastResult]:
        """Compare multiple stress scenarios against the same source snapshot."""

        return {scenario.name: self.simulate(snapshot, scenario) for scenario in scenarios}

    def _project(
        self, snapshot: BusinessSnapshot, scenario: StressScenario
    ) -> tuple[list[ForecastPoint], dict[date, float]]:
        expected_by_dow, pessimistic_by_dow, variable_outflow_by_dow = self._historical_profile(
            snapshot.historical_flows, snapshot.as_of
        )
        obligations = self._group_amounts(snapshot.obligations, "due_date")
        receivables = self._group_receivables(snapshot.receivables, scenario)
        unexpected_date = scenario.unexpected_expense_date or (snapshot.as_of + timedelta(days=1))

        expected_balance = snapshot.current_balance
        pessimistic_balance = snapshot.current_balance
        points: list[ForecastPoint] = []
        daily_available: dict[date, float] = {}

        for offset in range(1, self.horizon_days + 1):
            day = snapshot.as_of + timedelta(days=offset)
            dow = day.weekday()
            historical_expected = expected_by_dow[dow] * (1 + scenario.inflow_change_pct)
            historical_pessimistic = pessimistic_by_dow[dow] * (1 + scenario.inflow_change_pct)
            due_receivables = receivables.get(day, [])
            expected_receivable = sum(r.amount * r.collection_probability for r in due_receivables)
            pessimistic_receivable = sum(
                r.amount * max(0.0, r.collection_probability - 0.25) for r in due_receivables
            )
            expected_inflow = max(0.0, historical_expected + expected_receivable)
            pessimistic_inflow = max(0.0, historical_pessimistic + pessimistic_receivable)
            variable_outflow = max(
                0.0, variable_outflow_by_dow[dow] * (1 + scenario.variable_expense_change_pct)
            )
            if day == unexpected_date:
                variable_outflow += max(0.0, scenario.unexpected_expense)

            obligation_outflow = obligations.get(day, 0.0)
            # Cash available immediately before exact obligations are paid. This is
            # the correct value for answering "can this bill be covered?".
            daily_available[day] = pessimistic_balance + pessimistic_inflow - variable_outflow
            expected_balance += expected_inflow - variable_outflow - obligation_outflow
            pessimistic_balance += pessimistic_inflow - variable_outflow - obligation_outflow
            points.append(
                ForecastPoint(
                    date=day,
                    expected_inflow=round(expected_inflow, 2),
                    pessimistic_inflow=round(pessimistic_inflow, 2),
                    variable_outflow=round(variable_outflow, 2),
                    obligation_outflow=round(obligation_outflow, 2),
                    expected_balance=round(expected_balance, 2),
                    pessimistic_balance=round(pessimistic_balance, 2),
                )
            )
        return points, daily_available

    def _historical_profile(
        self, flows: Iterable[CashFlow], as_of: date
    ) -> tuple[list[float], list[float], list[float]]:
        flows = [flow for flow in flows if flow.date <= as_of]
        if not flows:
            return [0.0] * 7, [0.0] * 7, [0.0] * 7
        first_day = min(flow.date for flow in flows)
        daily_income: dict[date, float] = defaultdict(float)
        daily_variable_outflow: dict[date, float] = defaultdict(float)
        for flow in flows:
            if flow.amount >= 0:
                daily_income[flow.date] += flow.amount
            else:
                daily_variable_outflow[flow.date] += -flow.amount

        by_dow_income: list[list[float]] = [[] for _ in range(7)]
        by_dow_outflow: list[list[float]] = [[] for _ in range(7)]
        day = first_day
        while day <= as_of:
            by_dow_income[day.weekday()].append(daily_income.get(day, 0.0))
            by_dow_outflow[day.weekday()].append(daily_variable_outflow.get(day, 0.0))
            day += timedelta(days=1)

        all_income = [amount for values in by_dow_income for amount in values]
        nonzero_income = [amount for amount in all_income if amount > 0]
        fallback_expected = median(nonzero_income) if nonzero_income else 0.0
        expected: list[float] = []
        pessimistic: list[float] = []
        variable: list[float] = []
        for dow in range(7):
            income_values = by_dow_income[dow]
            positive = [value for value in income_values if value > 0]
            activity_rate = len(positive) / len(income_values) if income_values else 0.0
            expected.append((median(positive) if positive else fallback_expected) * activity_rate)
            pessimistic.append(self._quantile(income_values, self.pessimistic_quantile))
            outflow_values = by_dow_outflow[dow]
            positive_outflows = [value for value in outflow_values if value > 0]
            outflow_activity = (
                len(positive_outflows) / len(outflow_values) if outflow_values else 0.0
            )
            variable.append(
                (median(positive_outflows) if positive_outflows else 0.0) * outflow_activity
            )
        return expected, pessimistic, variable

    def _detect_breach(
        self, obligations: list[Obligation], daily_available: dict[date, float]
    ) -> Breach | None:
        by_day: dict[date, list[Obligation]] = defaultdict(list)
        for obligation in obligations:
            if obligation.due_date in daily_available:
                by_day[obligation.due_date].append(obligation)
        for day in sorted(by_day):
            available = daily_available[day]
            # Hard obligations get first claim on cash; stable ID makes the result deterministic.
            ordered = sorted(by_day[day], key=lambda item: (not item.hard_deadline, item.id))
            for obligation in ordered:
                if available + 1e-9 < obligation.amount:
                    return Breach(
                        date=day,
                        shortfall=round(obligation.amount - available, 2),
                        obligation_id=obligation.id,
                        obligation=obligation.payee,
                        amount=round(obligation.amount, 2),
                    )
                available -= obligation.amount
        return None

    def _classify(
        self, snapshot: BusinessSnapshot, points: list[ForecastPoint], breach: Breach | None
    ) -> GapType:
        if breach is None:
            return GapType.NONE
        start = snapshot.current_balance
        end = points[-1].pessimistic_balance
        recovered_after_breach = any(
            point.date > breach.date and point.pessimistic_balance >= snapshot.safety_buffer
            for point in points
        )
        if end >= start or (end >= snapshot.safety_buffer and recovered_after_breach):
            return GapType.TIMING
        return GapType.STRUCTURAL

    def _health_score(self, snapshot: BusinessSnapshot, points: list[ForecastPoint]) -> int:
        expected_inflow = sum(point.expected_inflow for point in points)
        total_outflow = sum(point.variable_outflow + point.obligation_outflow for point in points)
        coverage = expected_inflow / total_outflow if total_outflow else 2.0
        min_balance = min(point.expected_balance for point in points)
        end_balance = points[-1].expected_balance
        coverage_component = min(40.0, max(0.0, coverage / 1.25 * 40.0))
        liquidity_component = 30.0 if min_balance >= snapshot.safety_buffer else max(
            0.0, 30.0 * (1 - abs(min_balance - snapshot.safety_buffer) / max(total_outflow, 1.0))
        )
        trend_component = min(30.0, max(0.0, 15.0 + 15.0 * (end_balance - snapshot.current_balance) / max(total_outflow, 1.0)))
        return round(coverage_component + liquidity_component + trend_component)

    def _resilience_score(
        self, snapshot: BusinessSnapshot, points: list[ForecastPoint], breach: Breach | None
    ) -> int:
        total_outflow = sum(point.variable_outflow + point.obligation_outflow for point in points)
        daily_burn = total_outflow / self.horizon_days
        reserve_days = (snapshot.current_balance + snapshot.available_cash_buffer) / max(daily_burn, 1.0)
        reserve_component = min(50.0, reserve_days / 30.0 * 50.0)
        downside = min(point.pessimistic_balance for point in points)
        downside_component = 35.0 if downside >= snapshot.safety_buffer else max(
            0.0, 35.0 - abs(downside - snapshot.safety_buffer) / max(total_outflow, 1.0) * 35.0
        )
        breach_component = 15.0 if breach is None else max(0.0, 15.0 - breach.shortfall / max(total_outflow, 1.0) * 15.0)
        return round(reserve_component + downside_component + breach_component)

    def _build_ladder(
        self, snapshot: BusinessSnapshot, breach: Breach, gap_type: GapType
    ) -> list[Recommendation]:
        if gap_type == GapType.STRUCTURAL:
            return [
                Recommendation(
                    rank=1,
                    action="reduce_structural_deficit",
                    title="Corrige el déficit antes de pedir crédito",
                    description=(
                        "Los egresos superan de forma sostenida a los ingresos. Un préstamo "
                        "agregaría pagos al problema; revisa costos, precios y obligaciones."
                    ),
                    cash_impact=0.0,
                    estimated_cost=0.0,
                    resolves_breach=False,
                    parameters={"shortfall": breach.shortfall},
                )
            ]

        recommendations: list[Recommendation] = []
        working_snapshot = snapshot
        residual_breach = breach
        rank = 1
        eligible = sorted(
            (
                item
                for item in snapshot.receivables
                if (item.earliest_collection_date or snapshot.as_of + timedelta(days=1))
                <= breach.date
                and item.due_date > snapshot.as_of
            ),
            key=lambda item: (item.early_payment_discount, -item.amount),
        )
        for receivable in eligible:
            collection_day = max(
                snapshot.as_of + timedelta(days=1),
                receivable.earliest_collection_date or snapshot.as_of + timedelta(days=1),
            )
            accelerated = replace(
                receivable,
                due_date=collection_day,
                amount=receivable.amount * (1 - receivable.early_payment_discount),
                collection_probability=1.0,
            )
            working_snapshot = replace(
                working_snapshot,
                receivables=[
                    accelerated if item.id == receivable.id else item
                    for item in working_snapshot.receivables
                ],
            )
            result = self.analyze(working_snapshot, include_recommendations=False)
            impact = receivable.amount * (1 - receivable.early_payment_discount)
            recommendations.append(
                Recommendation(
                    rank=rank,
                    action="accelerate_receivable",
                    title=f"Cobra antes a {receivable.customer}",
                    description=f"Adelanta la factura {receivable.id} al {collection_day.isoformat()}.",
                    cash_impact=round(impact, 2),
                    estimated_cost=round(receivable.amount * receivable.early_payment_discount, 2),
                    resolves_breach=result.breach is None,
                    parameters={"receivable_id": receivable.id, "new_date": collection_day.isoformat()},
                )
            )
            rank += 1
            if result.breach is None:
                return recommendations
            residual_breach = result.breach

        movable = sorted(
            (
                item
                for item in snapshot.obligations
                if (
                    not item.hard_deadline
                    and item.slack_days > 0
                    and item.due_date <= breach.date
                )
            ),
            key=lambda item: -item.amount,
        )
        for obligation in movable:
            new_date = min(
                snapshot.as_of + timedelta(days=self.horizon_days),
                obligation.due_date + timedelta(days=min(7, obligation.slack_days)),
            )
            shifted = replace(obligation, due_date=new_date)
            working_snapshot = replace(
                working_snapshot,
                obligations=[
                    shifted if item.id == obligation.id else item
                    for item in working_snapshot.obligations
                ],
            )
            result = self.analyze(working_snapshot, include_recommendations=False)
            recommendations.append(
                Recommendation(
                    rank=rank,
                    action="shift_obligation",
                    title=f"Negocia una nueva fecha con {obligation.payee}",
                    description=(
                        f"Mueve {obligation.id} dentro de su holgura comprobada, "
                        f"al {new_date.isoformat()}."
                    ),
                    cash_impact=round(obligation.amount, 2),
                    estimated_cost=round(obligation.relationship_cost, 2),
                    resolves_breach=result.breach is None,
                    parameters={"obligation_id": obligation.id, "new_date": new_date.isoformat()},
                )
            )
            rank += 1
            if result.breach is None:
                return recommendations
            residual_breach = result.breach

        if snapshot.available_cash_buffer > 0:
            injection = min(
                snapshot.available_cash_buffer, ceil(residual_breach.shortfall * 1.05)
            )
            working_snapshot = replace(
                working_snapshot,
                current_balance=working_snapshot.current_balance + injection,
                available_cash_buffer=working_snapshot.available_cash_buffer - injection,
            )
            result = self.analyze(working_snapshot, include_recommendations=False)
            recommendations.append(
                Recommendation(
                    rank=rank,
                    action="draw_cash_buffer",
                    title="Usa la reserva de efectivo",
                    description="Transfiere solo lo necesario de la reserva al flujo operativo.",
                    cash_impact=round(injection, 2),
                    estimated_cost=0.0,
                    resolves_breach=result.breach is None,
                    parameters={"amount": injection},
                )
            )
            rank += 1
            if result.breach is None:
                return recommendations
            residual_breach = result.breach

        credit_amount = ceil(residual_breach.shortfall * 1.10 / 100.0) * 100
        recommendations.append(
            Recommendation(
                rank=rank,
                action="compare_credit",
                title="Compara financiamiento por el faltante residual",
                description="Solicita cotizaciones solo después de agotar las opciones operativas.",
                cash_impact=float(credit_amount),
                estimated_cost=0.0,
                resolves_breach=True,
                parameters={
                    "amount": credit_amount,
                    "residual_shortfall": residual_breach.shortfall,
                    "term_days": self._days_underwater(working_snapshot),
                },
            )
        )
        return recommendations

    def _decide_financing(
        self,
        snapshot: BusinessSnapshot,
        breach: Breach | None,
        gap_type: GapType,
        recommendations: list[Recommendation],
    ) -> FinancingDecision:
        if breach is None:
            return FinancingDecision(
                status=FinancingStatus.NOT_NEEDED,
                should_suggest=False,
                reason="El forecast no detecta obligaciones sin cobertura.",
            )
        if gap_type == GapType.STRUCTURAL:
            return FinancingDecision(
                status=FinancingStatus.NOT_RECOMMENDED_STRUCTURAL,
                should_suggest=False,
                reason=(
                    "El déficit es estructural: agregar pagos de deuda empeoraría "
                    "el flujo proyectado."
                ),
                residual_shortfall=breach.shortfall,
            )
        credit = next(
            (item for item in recommendations if item.action == "compare_credit"), None
        )
        if credit is None:
            return FinancingDecision(
                status=FinancingStatus.COVERED_BY_RECOVERY_PLAN,
                should_suggest=False,
                reason=(
                    "Las acciones operativas del Recovery Plan cubren el faltante "
                    "sin contratar deuda."
                ),
            )
        return FinancingDecision(
            status=FinancingStatus.RECOMMENDED,
            should_suggest=True,
            reason=(
                "Persiste un faltante temporal después de adelantar cobros, mover "
                "pagos flexibles y utilizar la reserva disponible."
            ),
            residual_shortfall=float(credit.parameters["residual_shortfall"]),
            suggested_amount=credit.cash_impact,
            term_days=int(credit.parameters["term_days"]),
        )

    def _days_underwater(self, snapshot: BusinessSnapshot) -> int:
        points, _ = self._project(snapshot, StressScenario())
        return max(1, sum(point.pessimistic_balance < snapshot.safety_buffer for point in points))

    def _group_receivables(
        self, receivables: list[Receivable], scenario: StressScenario
    ) -> dict[date, list[Receivable]]:
        grouped: dict[date, list[Receivable]] = defaultdict(list)
        for receivable in receivables:
            day = receivable.due_date + timedelta(days=max(0, scenario.receivable_delay_days))
            grouped[day].append(receivable)
        return grouped

    @staticmethod
    def _group_amounts(items: Iterable[object], date_field: str) -> dict[date, float]:
        grouped: dict[date, float] = defaultdict(float)
        for item in items:
            grouped[getattr(item, date_field)] += float(getattr(item, "amount"))
        return grouped

    @staticmethod
    def _quantile(values: list[float], q: float) -> float:
        if not values:
            return 0.0
        ordered = sorted(values)
        position = (len(ordered) - 1) * q
        lower = int(position)
        upper = min(lower + 1, len(ordered) - 1)
        weight = position - lower
        return ordered[lower] * (1 - weight) + ordered[upper] * weight

    @staticmethod
    def _validate(snapshot: BusinessSnapshot) -> None:
        if snapshot.current_balance < 0:
            raise ValueError("current_balance cannot be negative")
        if snapshot.available_cash_buffer < 0 or snapshot.safety_buffer < 0:
            raise ValueError("cash buffers cannot be negative")
        for item in snapshot.obligations:
            if item.amount <= 0:
                raise ValueError(f"obligation {item.id} must have a positive amount")
            if item.slack_days < 0:
                raise ValueError(f"obligation {item.id} cannot have negative slack")
        for item in snapshot.receivables:
            if item.amount <= 0:
                raise ValueError(f"receivable {item.id} must have a positive amount")
            if not 0 <= item.collection_probability <= 1:
                raise ValueError(f"receivable {item.id} has an invalid probability")
            if not 0 <= item.early_payment_discount < 1:
                raise ValueError(f"receivable {item.id} has an invalid discount")
