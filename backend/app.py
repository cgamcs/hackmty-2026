from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from collections import defaultdict
from dataclasses import dataclass, replace
from datetime import timedelta
from pathlib import Path
from time import monotonic
from typing import Any

from fastapi import Depends, FastAPI, Header, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from engine.nessie import Nessie
from financial_engine import (
    BusinessSnapshot,
    FinancialEngine,
    StressScenario,
    find_company_account,
    snapshot_from_live_nessie,
)


ROOT = Path(__file__).resolve().parents[1]
MANIFEST_PATH = ROOT / "mocks/out/seed-manifest.json"


@dataclass(frozen=True)
class Tenant:
    slug: str
    name: str
    rfc: str
    owner: str

    @property
    def cfdi_directory(self) -> Path:
        return ROOT / "mocks/out/cfdi" / self.rfc


TENANTS = {
    "esperanza": Tenant("esperanza", "Abarrotes La Esperanza", "ALE240517H23", "Abarrotes La Esperanza"),
    "bajio": Tenant("bajio", "Comercializadora del Bajio", "CBA190803M71", "Comercializadora del Bajio"),
    "roble": Tenant("roble", "Minisuper El Roble", "MER210126F09", "Minisuper El Roble"),
}


class StressRequest(BaseModel):
    income_change_pct: float = Field(default=0, ge=-100, le=200)
    variable_expense_change_pct: float = Field(default=0, ge=-100, le=300)
    receivable_delay_days: int = Field(default=0, ge=0, le=90)
    available_cash_buffer: float | None = Field(default=None, ge=0)


def _json_env(name: str) -> dict[str, str]:
    raw = os.environ.get(name, "{}")
    try:
        value = json.loads(raw)
    except json.JSONDecodeError as exc:
        raise RuntimeError(f"{name} must contain a valid JSON object") from exc
    if not isinstance(value, dict):
        raise RuntimeError(f"{name} must contain a JSON object")
    return {str(key): str(item) for key, item in value.items()}


def _supabase_user(token: str) -> dict[str, Any]:
    url = os.environ.get("SUPABASE_URL", "").rstrip("/")
    anon_key = os.environ.get("SUPABASE_ANON_KEY", "")
    if not url or not anon_key:
        raise RuntimeError("Supabase authentication is not configured")
    request = urllib.request.Request(
        f"{url}/auth/v1/user",
        headers={"apikey": anon_key, "Authorization": f"Bearer {token}"},
    )
    try:
        with urllib.request.urlopen(request, timeout=10) as response:
            return json.loads(response.read())
    except (urllib.error.HTTPError, urllib.error.URLError, TimeoutError) as exc:
        raise HTTPException(status_code=401, detail="Invalid or expired session") from exc


def resolve_tenant(authorization: str | None = Header(default=None)) -> Tenant:
    """Resolve the data owner on the server; account IDs are never accepted from the UI."""

    auth_enabled = bool(os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_ANON_KEY"))
    if not auth_enabled:
        slug = os.environ.get("DEMO_TENANT_SLUG", "bajio")
    else:
        scheme, _, token = (authorization or "").partition(" ")
        if scheme.lower() != "bearer" or not token:
            raise HTTPException(status_code=401, detail="Authentication required")
        user = _supabase_user(token)
        app_metadata = user.get("app_metadata") or {}
        slug = app_metadata.get("tenant_slug")
        if not slug:
            user_map = _json_env("TENANT_USER_MAP_JSON")
            slug = user_map.get(str(user.get("id"))) or user_map.get(str(user.get("email")))
        if not slug:
            raise HTTPException(status_code=403, detail="This user is not linked to a business")

    tenant = TENANTS.get(str(slug))
    if tenant is None:
        raise HTTPException(status_code=403, detail="Unknown business tenant")
    return tenant


_snapshot_cache: dict[str, tuple[float, BusinessSnapshot, dict[str, Any]]] = {}


def _load_snapshot(tenant: Tenant) -> tuple[BusinessSnapshot, dict[str, Any]]:
    cached = _snapshot_cache.get(tenant.slug)
    if cached and monotonic() - cached[0] < 60:
        return cached[1], cached[2]

    manifest = json.loads(MANIFEST_PATH.read_text())
    manifest_account_id = manifest[tenant.slug]["account_id"]
    client = Nessie()
    account = client.account(manifest_account_id)
    if account is None:
        account = find_company_account(client, tenant.name)
    if account is None:
        raise HTTPException(status_code=503, detail="The business account is unavailable in Nessie")

    snapshot = snapshot_from_live_nessie(
        account_id=account["_id"],
        owner_rfc=tenant.rfc,
        cfdi_directory=tenant.cfdi_directory,
        client=client,
    )
    _snapshot_cache[tenant.slug] = (monotonic(), snapshot, account)
    return snapshot, account


def _risk_level(result: dict[str, Any]) -> str:
    gap = result["gap_type"]
    if gap == "none":
        return "BAJO"
    if gap == "structural":
        return "CRITICO"
    shortfall = float((result.get("breach") or {}).get("shortfall", 0))
    monthly_inflow = sum(float(point["expected_inflow"]) for point in result["points"])
    return "MEDIO" if monthly_inflow and shortfall / monthly_inflow < 0.20 else "ALTO"


def _analysis_payload(result: Any) -> dict[str, Any]:
    payload = result.to_dict()
    payload["risk_level"] = _risk_level(payload)
    return payload


def _change_pct(current: float, previous: float) -> float:
    if previous <= 0:
        return 0.0
    return round((current - previous) / previous * 100, 1)


def _obligation_kind(category: str) -> str:
    normalized = category.casefold()
    if "payroll" in normalized or "nomina" in normalized or "nómina" in normalized:
        return "PAYROLL"
    if "tax" in normalized or "sat" in normalized or "impuesto" in normalized:
        return "TAXES"
    if "rent" in normalized or "renta" in normalized:
        return "RENT"
    return "SUPPLIER"


def _initials(name: str) -> str:
    words = [word for word in name.split() if len(word) > 2]
    return "".join(word[0] for word in words[:2]).upper() or "PY"


def _dashboard_payload(
    tenant: Tenant,
    snapshot: BusinessSnapshot,
    account: dict[str, Any],
    result: Any,
) -> dict[str, Any]:
    analysis = _analysis_payload(result)
    as_of = snapshot.as_of
    current_start = as_of - timedelta(days=29)
    previous_start = as_of - timedelta(days=59)

    current_flows = [flow for flow in snapshot.historical_flows if current_start <= flow.date <= as_of]
    previous_flows = [flow for flow in snapshot.historical_flows if previous_start <= flow.date < current_start]
    current_income = sum(flow.amount for flow in current_flows if flow.amount > 0)
    previous_income = sum(flow.amount for flow in previous_flows if flow.amount > 0)
    current_expense = sum(-flow.amount for flow in current_flows if flow.amount < 0)
    previous_expense = sum(-flow.amount for flow in previous_flows if flow.amount < 0)

    expense_groups: dict[str, float] = defaultdict(float)
    for flow in current_flows:
        if flow.amount < 0:
            expense_groups[flow.category or "operations"] += -flow.amount
    expense_lines = [
        {"label": category.replace("_", " ").title(), "amount": round(amount, 2)}
        for category, amount in sorted(expense_groups.items(), key=lambda item: -item[1])[:4]
    ]

    daily: dict[str, dict[str, float]] = {}
    for offset in range(13, -1, -1):
        key = (as_of - timedelta(days=offset)).isoformat()
        daily[key] = {"date": key, "inflow": 0.0, "outflow": 0.0}
    for flow in current_flows:
        key = flow.date.isoformat()
        if key not in daily:
            continue
        if flow.amount >= 0:
            daily[key]["inflow"] += flow.amount
        else:
            daily[key]["outflow"] += -flow.amount

    movements = []
    for index, flow in enumerate(sorted(current_flows, key=lambda item: item.date, reverse=True)[:8]):
        movement_type = "deposit" if flow.amount >= 0 else (
            "withdrawal" if "withdrawal" in flow.source else "purchase"
        )
        movements.append(
            {
                "id": f"{flow.date.isoformat()}-{index}",
                "date": flow.date.isoformat(),
                "description": flow.category.replace("_", " ").title(),
                "amount": round(flow.amount, 2),
                "type": movement_type,
            }
        )

    receivables = [
        {
            "id": item.id,
            "folio": item.id,
            "client": item.customer,
            "amount": round(item.amount, 2),
            "dueDate": item.due_date.isoformat(),
            "dsoDays": max(0, (item.due_date - as_of).days),
            "accelerable": bool(item.earliest_collection_date and item.earliest_collection_date < item.due_date),
        }
        for item in snapshot.receivables
    ]
    payables = [
        {
            "id": item.id,
            "payee": item.payee,
            "reference": item.id,
            "kind": _obligation_kind(item.category),
            "amount": round(item.amount, 2),
            "dueDate": item.due_date.isoformat(),
            "rigidity": "hard" if item.hard_deadline else "slack",
            "slackDays": item.slack_days,
        }
        for item in snapshot.obligations
    ]
    payable_by_id = {item["id"]: item for item in payables}

    breach = None
    if analysis["breach"]:
        source = analysis["breach"]
        obligation = payable_by_id.get(source["obligation_id"])
        if obligation is None:
            obligation = {
                "id": source["obligation_id"],
                "payee": source["obligation"],
                "reference": source["obligation_id"],
                "kind": "SUPPLIER",
                "amount": source["amount"],
                "dueDate": source["date"],
                "rigidity": "hard",
                "slackDays": 0,
            }
        breach = {
            "date": source["date"],
            "obligation": obligation,
            "balance": round(source["amount"] - source["shortfall"], 2),
            "shortfall": source["shortfall"],
            "daysUntil": (next(item.date for item in result.points if item.date.isoformat() == source["date"]) - as_of).days,
        }

    receivable_total = sum(item.amount for item in snapshot.receivables)
    payable_total = sum(item.amount for item in snapshot.obligations)
    collection_total = current_income + receivable_total
    collected_pct = round(current_income / collection_total * 100) if collection_total else 100
    receivable_pct = 100 - collected_pct
    overdue_total = sum(item.amount for item in snapshot.receivables if item.due_date <= as_of)
    overdue_pct = round(overdue_total / collection_total * 100) if collection_total else 0

    aging = {"0–15 d": 0.0, "16–30 d": 0.0, "31–60 d": 0.0, "60+ d": 0.0}
    for item in snapshot.receivables:
        days = max(0, (item.due_date - as_of).days)
        label = "0–15 d" if days <= 15 else "16–30 d" if days <= 30 else "31–60 d" if days <= 60 else "60+ d"
        aging[label] += item.amount

    action_map = {
        "accelerate_receivable": ("ACCELERATE", "1 · Cobranza", "Adelantar cobranza"),
        "shift_obligation": ("SHIFT", "2 · Diferir pagos", "Diferir pagos"),
        "draw_cash_buffer": ("BUFFER", "3 · Buffer", "Usar buffer de caja"),
        "compare_credit": ("CREDIT", "4 · Crédito", "Crédito puente"),
    }
    recommendation_by_action = {item["action"]: item for item in analysis["recommendations"]}
    steps = []
    for action, (rung, short, fallback_title) in action_map.items():
        recommendation = recommendation_by_action.get(action)
        closes = float(recommendation["cash_impact"]) if recommendation else 0.0
        steps.append(
            {
                "rung": rung,
                "short": short,
                "title": recommendation["title"] if recommendation else fallback_title,
                "phrase": recommendation["description"] if recommendation else "",
                "closes": closes,
                "available": recommendation is not None,
                "applied": recommendation is not None,
            }
        )

    financing = analysis["financing_decision"]
    operational_impact = sum(step["closes"] for step in steps if step["rung"] != "CREDIT")
    account_view = {
        "id": f"acct-{str(account.get('_id', tenant.slug))[-4:]}",
        "nickname": str(account.get("nickname", "Cuenta operativa")),
        "bank": "Capital One",
        "balance": round(snapshot.current_balance, 2),
        "balanceAt": f"{as_of.isoformat()} · Nessie",
        "live": True,
    }

    return {
        "today": as_of.isoformat(),
        "business": {
            "name": tenant.name,
            "rfc": tenant.rfc,
            "owner": tenant.owner,
            "ownerInitials": _initials(tenant.owner),
        },
        "account": account_view,
        "accounts": [account_view],
        "healthScore": analysis["health_score"],
        "resilienceScore": analysis["resilience_score"],
        "collection": {
            "collectedPct": collected_pct,
            "receivablePct": receivable_pct,
            "overduePct": overdue_pct,
        },
        "income30": {
            "total": round(current_income, 2),
            "changePct": _change_pct(current_income, previous_income),
            "cash": round(current_income, 2),
            "cfdi": 0.0,
        },
        "expense30": {
            "total": round(current_expense, 2),
            "changePct": _change_pct(current_expense, previous_expense),
            "lines": expense_lines,
        },
        "cfdi": {
            "receivableTotal": round(receivable_total, 2),
            "receivableCount": len(receivables),
            "payableTotal": round(payable_total, 2),
            "payableCount": len(payables),
            "aging": [{"label": label, "amount": round(amount, 2)} for label, amount in aging.items()],
        },
        "cashflow": list(daily.values()),
        "movementsCount": len(snapshot.historical_flows),
        "movements": movements,
        "receivables": receivables,
        "payables": payables,
        "settled": [],
        "forecast": [
            {
                "date": item["date"],
                "expected": item["expected_balance"],
                "pessimistic": item["pessimistic_balance"],
            }
            for item in analysis["points"]
        ],
        "bufferAvailable": snapshot.available_cash_buffer,
        "breach": breach,
        "gap": analysis["gap_type"].upper(),
        "risk": analysis["risk_level"],
        "residualPct": (breach["shortfall"] / current_income) if breach and current_income else 0.0,
        "ladder": {
            "steps": steps,
            "residual": financing["residual_shortfall"],
            "creditAmount": financing["suggested_amount"],
            "creditDeclined": financing["status"] == "not_recommended_structural",
            "adjustedMin": round(analysis["diagnostics"]["minimum_pessimistic_balance"] + operational_impact, 2),
        },
    }


app = FastAPI(title="Beel Financial Engine API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=[item.strip() for item in os.environ.get("CORS_ORIGINS", "http://localhost:5173").split(",")],
    allow_credentials=True,
    allow_methods=["GET", "POST", "OPTIONS"],
    allow_headers=["Authorization", "Content-Type"],
)


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/api/dashboard")
def dashboard(tenant: Tenant = Depends(resolve_tenant)) -> dict[str, Any]:
    try:
        snapshot, account = _load_snapshot(tenant)
        result = FinancialEngine(horizon_days=30).forecast(snapshot)
        return _dashboard_payload(tenant, snapshot, account, result)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Nessie rejected the request ({exc.code}). Check the server API_KEY.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not load the business dashboard") from exc


@app.post("/api/stress")
def simulate_stress(
    request: StressRequest,
    tenant: Tenant = Depends(resolve_tenant),
) -> dict[str, Any]:
    try:
        snapshot, account = _load_snapshot(tenant)
    except HTTPException:
        raise
    except urllib.error.HTTPError as exc:
        raise HTTPException(
            status_code=502,
            detail=f"Nessie rejected the request ({exc.code}). Check the server API_KEY.",
        ) from exc
    except Exception as exc:
        raise HTTPException(status_code=502, detail="Could not load the business financial data") from exc

    engine = FinancialEngine(horizon_days=30)
    baseline = engine.forecast(snapshot)
    scenario_snapshot = snapshot
    if request.available_cash_buffer is not None:
        scenario_snapshot = replace(
            snapshot, available_cash_buffer=request.available_cash_buffer
        )
    scenario = StressScenario(
        name="custom",
        inflow_change_pct=request.income_change_pct / 100,
        variable_expense_change_pct=request.variable_expense_change_pct / 100,
        receivable_delay_days=request.receivable_delay_days,
    )
    stressed = engine.simulate(scenario_snapshot, scenario)
    return {
        "business": {"slug": tenant.slug, "name": tenant.name, "rfc": tenant.rfc, "owner": tenant.owner},
        "account": {
            "nickname": str(account.get("nickname", "Cuenta operativa")),
            "balance": snapshot.current_balance,
            "live": True,
        },
        "available_cash_buffer": scenario_snapshot.available_cash_buffer,
        "baseline": _analysis_payload(baseline),
        "result": _analysis_payload(stressed),
    }
