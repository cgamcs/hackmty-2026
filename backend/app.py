from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from dataclasses import dataclass, replace
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


@app.post("/api/stress")
def simulate_stress(
    request: StressRequest,
    tenant: Tenant = Depends(resolve_tenant),
) -> dict[str, Any]:
    try:
        snapshot, account = _load_snapshot(tenant)
    except HTTPException:
        raise
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
