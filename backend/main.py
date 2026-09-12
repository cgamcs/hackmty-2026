"""FastAPI surface for the working-capital broker.

Contracts fixed by `frontend/src/api/client.ts`:

    GET  /api/sme/{account_id}  ->  DashboardData             (404 = not yet integrated)
    POST /api/stress            ->  StressSimulationResponse

Everything else exists to make those calls legitimate: registration, login, connecting an
account, uploading CFDI, and running a sync.

This module replaces the earlier `backend/app.py`, which read snapshots from the mock CFDI
directories and authenticated against Supabase. Both data paths are now one: Tiger for
stored state, Nessie live for the balance. The scenario arithmetic lives in
`backend/stress.py` so it stays testable without FastAPI.

**Authentication.** Server-side sessions in an httpOnly cookie, issued by `/api/auth/*`.
`DEMO_MODE=1` bypasses them for local demos only: with it on, anyone who knows an account
id reads that business's data, which is exactly the hole the rest of the security work
closes. It is off by default and prints a warning at startup.
"""

from __future__ import annotations

import os
import secrets
import sys
import zipfile
from datetime import date, datetime, timedelta, timezone
from io import BytesIO
from pathlib import Path

from fastapi import Cookie, Depends, FastAPI, File, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

ROOT = Path(__file__).parent.parent
for extra in (ROOT / "engine", ROOT, Path(__file__).parent):
    if str(extra) not in sys.path:
        sys.path.insert(0, str(extra))

import cfdi_parser                                    # noqa: E402
import dashboard                                      # noqa: E402
import snapshot as snapshot_mod                       # noqa: E402
import sync as sync_mod                               # noqa: E402
from crypto import encrypt_xml, hash_password, verify_password   # noqa: E402
from db import connect, execute, fetch_all, fetch_one, tenant_tx  # noqa: E402
from financial_engine import FinancialEngine                      # noqa: E402
from financial_engine.contracts import snapshot_from_dict         # noqa: E402
from nessie import Nessie                             # noqa: E402
from stress import StressRequest, run_stress          # noqa: E402

DEMO_MODE = os.environ.get("DEMO_MODE") == "1"
COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "1") != "0"
SESSION_HOURS = 12
ALLOWED_ORIGINS = [o for o in os.environ.get(
    "CORS_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",") if o]

app = FastAPI(title="Working Capital Broker API")
app.add_middleware(
    CORSMiddleware,
    allow_origins=ALLOWED_ORIGINS,      # never "*": the session cookie travels on these
    allow_credentials=True,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=["Content-Type"],
)

if DEMO_MODE:
    print("!! DEMO_MODE=1 — /api/sme/{account_id} serves without a session. "
          "Never enable outside a local demo.", flush=True)


# ── sessions ─────────────────────────────────────────────────────────────────
# Opaque random tokens in an httpOnly cookie rather than a JWT: there is no third party
# to verify signatures, and a server-side row can be revoked, which a JWT cannot.

def _new_session(conn, user_id: str) -> str:
    token = secrets.token_urlsafe(32)
    # make_interval, not "interval '%s hours'": the latter would send the placeholder as
    # a quoted string inside the literal and fail to parse.
    execute(conn, """
        insert into sessions (token, user_id, expires_at)
        values (%s, %s, now() + make_interval(hours => %s))
    """, (token, user_id, SESSION_HOURS))
    return token


def _set_cookie(response: Response, token: str) -> None:
    response.set_cookie(
        "wcb_session", token,
        httponly=True,           # unreadable from JavaScript, so XSS cannot steal it
        samesite="lax",
        secure=COOKIE_SECURE and not DEMO_MODE,
        max_age=SESSION_HOURS * 3600,
        path="/")


def current_tenant_id(wcb_session: str | None = Cookie(default=None)) -> str | None:
    if not wcb_session:
        return None
    with connect() as conn:
        row = fetch_one(conn, "select tenant_for_session(%s) as id", (wcb_session,))
    # A scalar SQL function still returns one row when its value is NULL. Checking only
    # the row would turn an expired token into the literal tenant id "None" and fail
    # later with an invalid-UUID database error instead of returning 401.
    return str(row["id"]) if row and row["id"] else None


def require_tenant(tenant_id: str | None = Depends(current_tenant_id)) -> str:
    if not tenant_id:
        raise HTTPException(401, "Sesión expirada o ausente.")
    return tenant_id


# ── auth ─────────────────────────────────────────────────────────────────────
@app.post("/api/auth/register")
def register(response: Response, payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    razon_social = (payload.get("razon_social") or "").strip()
    if not email or len(password) < 8:
        raise HTTPException(400, "Correo requerido y contraseña de al menos 8 caracteres.")

    with connect() as conn:
        if fetch_one(conn, "select 1 from users where email = %s", (email,)):
            raise HTTPException(409, "Ese correo ya está registrado.")
        created = fetch_one(
            conn,
            "select * from register_user_tenant(%s, %s, %s)",
            (email, hash_password(password), razon_social or email),
        )
        token = _new_session(conn, str(created["user_id"]))

    _set_cookie(response, token)
    return {"tenant_id": str(created["tenant_id"]), "email": email}


@app.post("/api/auth/login")
def login(response: Response, payload: dict):
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    with connect() as conn:
        user = fetch_one(conn,
                         "select id, password_hash from users where email = %s", (email,))
        # Same message and roughly the same work either way, so the response does not
        # reveal whether the address exists.
        if not user or not verify_password(user["password_hash"], password):
            raise HTTPException(401, "Correo o contraseña incorrectos.")
        token = _new_session(conn, str(user["id"]))
    _set_cookie(response, token)
    return {"email": email}


@app.post("/api/auth/logout")
def logout(response: Response, wcb_session: str | None = Cookie(default=None)):
    if wcb_session:
        with connect() as conn:
            execute(conn, "delete from sessions where token = %s", (wcb_session,))
    response.delete_cookie("wcb_session", path="/")
    return {"ok": True}


@app.get("/api/auth/me")
def me(tenant_id: str | None = Depends(current_tenant_id)):
    if not tenant_id:
        raise HTTPException(401, "Sin sesión.")
    with tenant_tx(tenant_id) as conn:
        row = fetch_one(conn, """
            select t.id, t.razon_social, t.rfc, t.account_id, u.email
            from tenants t join users u on u.id = t.owner_id
            where t.id = %s
        """, (tenant_id,))
    return {"tenant_id": tenant_id, "email": row["email"],
            "razon_social": row["razon_social"], "rfc": row["rfc"],
            "account_id": row["account_id"],
            "connected": bool(row["account_id"])}


# ── integration ──────────────────────────────────────────────────────────────
@app.post("/api/connect")
def connect_account(payload: dict, tenant_id: str = Depends(require_tenant)):
    """Resolve a typed account number to a Nessie account id.

    The lookup runs here and not in the browser. A front end that fetched every account
    and filtered client-side would leak the full list into the network tab — the same
    exposure a dropdown would cause, merely less visible.
    """
    number = (payload.get("account_number") or "").strip()
    if not number:
        raise HTTPException(400, "Número de cuenta requerido.")

    match = next((a for a in Nessie().accounts()
                  if str(a.get("account_number")) == number), None)
    # Never "exists but is not yours": that answer confirms other tenants' accounts.
    if not match:
        raise HTTPException(404, "No encontramos esa cuenta.")

    with tenant_tx(tenant_id) as conn:
        execute(conn, """
            update tenants set account_id = %s, account_number_last4 = %s where id = %s
        """, (match["_id"], number[-4:], tenant_id))

    return {"account_id": match["_id"], "nickname": match.get("nickname"),
            "balance": match.get("balance"), "last4": number[-4:]}


@app.get("/api/setup/status")
def setup_status(tenant_id: str = Depends(require_tenant)):
    """What the tenant still has to provide before any figure can be shown.

    The server decides this, not the UI. If the front end inferred completeness from
    whatever it happened to have fetched, a half-configured tenant would render a
    confident-looking dashboard built on missing inputs.
    """
    with tenant_tx(tenant_id) as conn:
        row = fetch_one(conn, """
            select
              t.razon_social, t.rfc, t.account_id, t.account_number_last4,
              (select count(*) from invoices  i where i.tenant_id = t.id) as cfdi_count,
              (select count(*) from obligations o where o.tenant_id = t.id) as obligation_count,
              (select count(*) from cash_flows f where f.tenant_id = t.id) as flow_count,
              (select count(*) from invoices i
                 where i.tenant_id = t.id and i.direction = 'issued'
                   and i.metodo_pago = 'PPD' and i.settled_at is null) as open_receivables
            from tenants t where t.id = %s
        """, (tenant_id,))

    steps = {
        "razon_social": bool((row["razon_social"] or "").strip()),
        "account": bool(row["account_id"]),
        "cfdi": row["cfdi_count"] > 0,
        "obligations": row["obligation_count"] > 0,
        "synced": row["flow_count"] > 0,
    }
    return {
        "steps": steps,
        "complete": all(steps.values()),
        "razon_social": row["razon_social"],
        "rfc": row["rfc"],
        # The front end addresses /api/sme/{account_id}, so it has to learn the id the
        # server resolved — it never sees the account list to pick from.
        "account_id": row["account_id"],
        "account_last4": row["account_number_last4"],
        "counts": {"cfdi": row["cfdi_count"], "obligations": row["obligation_count"],
                   "flows": row["flow_count"], "open_receivables": row["open_receivables"]},
    }


@app.post("/api/profile")
def update_profile(payload: dict, tenant_id: str = Depends(require_tenant)):
    razon_social = (payload.get("razon_social") or "").strip()
    if not razon_social:
        raise HTTPException(400, "La razón social es requerida.")
    with tenant_tx(tenant_id) as conn:
        execute(conn, "update tenants set razon_social = %s where id = %s",
                (razon_social, tenant_id))
    return {"razon_social": razon_social}


@app.post("/api/cfdi/upload")
async def upload_cfdi(file: UploadFile = File(...),
                      tenant_id: str = Depends(require_tenant)):
    """Accept a ZIP or a single XML, parse once, store parsed fields plus ciphertext."""
    raw = await file.read()
    documents: list[tuple[str, str]] = []

    if zipfile.is_zipfile(BytesIO(raw)):
        with zipfile.ZipFile(BytesIO(raw)) as zf:
            for name in zf.namelist():
                if name.lower().endswith(".xml") and not name.startswith("__MACOSX"):
                    documents.append((name, zf.read(name).decode("utf-8", "replace")))
    else:
        documents.append((file.filename or "cfdi.xml", raw.decode("utf-8", "replace")))

    if not documents:
        raise HTTPException(400, "No encontramos XML en el archivo.")

    tmp = Path("/tmp") / f"cfdi-{tenant_id}"
    tmp.mkdir(parents=True, exist_ok=True)
    for name, text in documents:
        (tmp / Path(name).name).write_text(text)
    batch = cfdi_parser.parse_dir(tmp)
    for f in tmp.glob("*.xml"):
        f.unlink()

    by_uuid = {}
    for name, text in documents:
        by_uuid[Path(name).name] = text

    stored = 0
    with tenant_tx(tenant_id) as conn:
        if batch.own_rfc:
            execute(conn, "update tenants set rfc = coalesce(rfc, %s) where id = %s",
                    (batch.own_rfc, tenant_id))
        for inv in batch.invoices:
            xml_text = by_uuid.get(inv.source_file, "")
            # The UUID is the folio fiscal and the primary key: re-uploading the same SAT
            # export updates rather than duplicating. Without this, the receivable book
            # silently doubles and the product recommends collecting money that does not
            # exist.
            execute(conn, """
                insert into invoices
                  (uuid, tenant_id, serie, folio, direction, tipo, metodo_pago,
                   forma_pago, counterparty_rfc, counterparty_name, fecha, due_date,
                   subtotal, total, xml_enc)
                values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
                on conflict (uuid) do update set
                  serie = excluded.serie, folio = excluded.folio,
                  direction = excluded.direction, metodo_pago = excluded.metodo_pago,
                  counterparty_rfc = excluded.counterparty_rfc,
                  counterparty_name = excluded.counterparty_name,
                  due_date = excluded.due_date, total = excluded.total,
                  xml_enc = excluded.xml_enc
            """, (inv.uuid, tenant_id, inv.serie, inv.folio, inv.direction, inv.tipo,
                  inv.metodo_pago, inv.forma_pago, inv.counterparty_rfc,
                  inv.counterparty_name, inv.fecha, inv.due_date,
                  inv.subtotal, inv.total,
                  encrypt_xml(xml_text, inv.uuid) if xml_text else None))
            stored += 1

    return {"parsed": stored, "skipped": len(batch.skipped), "rfc": batch.own_rfc}


@app.post("/api/sync")
def run_sync(tenant_id: str = Depends(require_tenant)):
    try:
        return sync_mod.sync_tenant(tenant_id)
    except ValueError as exc:
        raise HTTPException(409, str(exc)) from exc


@app.get("/api/obligations")
def list_obligations(tenant_id: str = Depends(require_tenant)):
    with tenant_tx(tenant_id) as conn:
        return fetch_all(conn, """
            select id, payee, amount, day_of_month, kind, rigidity,
                   slack_days, relationship_cost, source
            from obligations where tenant_id = %s order by day_of_month
        """, (tenant_id,))


@app.post("/api/obligations/{obligation_id}")
def update_obligation(obligation_id: str, payload: dict,
                      tenant_id: str = Depends(require_tenant)):
    """Set rigidity and slack. Payroll and taxes are refused here and by a CHECK
    constraint: shifting them past a legal date is not the user's to authorise."""
    rigidity = payload.get("rigidity", "hard")
    slack = int(payload.get("slack_days") or 0)
    cost = float(payload.get("relationship_cost") or 0)
    with tenant_tx(tenant_id) as conn:
        row = fetch_one(conn, "select kind from obligations where id = %s",
                        (obligation_id,))
        if not row:
            raise HTTPException(404, "Obligación no encontrada.")
        if row["kind"] in ("payroll", "tax") and (rigidity != "hard" or slack):
            raise HTTPException(
                422, "Nómina e impuestos tienen fecha legal y no admiten holgura.")
        execute(conn, """
            update obligations set rigidity = %s, slack_days = %s,
                   relationship_cost = %s, source = 'user'
            where id = %s
        """, (rigidity, slack, cost, obligation_id))
    return {"ok": True}


# ── the dashboard ────────────────────────────────────────────────────────────
def _resolve_tenant(account_id: str, session_tenant: str | None) -> str:
    if session_tenant:
        with tenant_tx(session_tenant) as conn:
            row = fetch_one(conn, "select account_id from tenants where id = %s",
                            (session_tenant,))
        if not row or not row["account_id"]:
            raise HTTPException(404, "Integración incompleta.")
        # A session must not be able to read another tenant's account by changing the URL.
        if row["account_id"] != account_id:
            raise HTTPException(403, "Esa cuenta no pertenece a tu negocio.")
        return session_tenant

    if not DEMO_MODE:
        raise HTTPException(401, "Sesión expirada o ausente.")
    with connect() as conn:
        row = fetch_one(conn, "select id from tenants where account_id = %s",
                        (account_id,))
    if not row:
        raise HTTPException(404, "Integración incompleta.")
    return str(row["id"])


def _require_complete_setup(tenant_id: str) -> None:
    """404 until every input exists.

    A dashboard rendered on partial inputs is worse than no dashboard: the figures look
    authoritative while resting on data the tenant never supplied. The front end treats
    404 as its first-run gate, so this routes them to finish setup instead.
    """
    with tenant_tx(tenant_id) as conn:
        row = fetch_one(conn, """
            select t.razon_social, t.account_id,
              (select count(*) from invoices i where i.tenant_id = t.id) as cfdi,
              (select count(*) from obligations o where o.tenant_id = t.id) as obligations,
              (select count(*) from cash_flows f where f.tenant_id = t.id) as flows
            from tenants t where t.id = %s
        """, (tenant_id,))
    missing = [name for name, ok in (
        ("razon_social", bool((row["razon_social"] or "").strip())),
        ("account", bool(row["account_id"])),
        ("cfdi", row["cfdi"] > 0),
        ("obligations", row["obligations"] > 0),
        ("sync", row["flows"] > 0),
    ) if not ok]
    if missing:
        raise HTTPException(404, f"Integración incompleta: falta {', '.join(missing)}.")


@app.get("/api/sme/{account_id}")
def sme_dashboard(account_id: str,
                  session_tenant: str | None = Depends(current_tenant_id)):
    tenant_id = _resolve_tenant(account_id, session_tenant)
    _require_complete_setup(tenant_id)
    api = Nessie()

    account = api.account(account_id)
    if account is None:
        raise HTTPException(404, "Cuenta no visible con la llave actual.")

    today = date.today()
    with tenant_tx(tenant_id) as conn:
        tenant = fetch_one(conn, """
            select t.razon_social, t.rfc, u.email as owner_email
            from tenants t join users u on u.id = t.owner_id where t.id = %s
        """, (tenant_id,)) or {}

        flows = fetch_all(conn, """
            select occurred_at::date as date, flow_id, amount, category, description
            from cash_flows where tenant_id = %s and occurred_at >= %s
            order by occurred_at desc
        """, (tenant_id, today - timedelta(days=120)))

        invoices = fetch_all(conn, """
            select i.uuid, i.serie, i.folio, i.direction, i.metodo_pago, i.fecha,
                   i.due_date, i.total, i.counterparty_rfc, i.counterparty_name,
                   i.settled_at, t.days as dso_days,
                   (t.learned and t.spread <= %s) as accelerable
            from invoices i
            left join terms t on t.tenant_id = i.tenant_id
                             and t.counterparty_rfc = i.counterparty_rfc
            where i.tenant_id = %s
        """, (snapshot_mod.MAX_SPREAD_FOR_EARLY_REQUEST, tenant_id))

        obligation_rows = fetch_all(conn, """
            select id, bill_id, payee, amount, day_of_month, kind, rigidity, slack_days
            from obligations where tenant_id = %s
        """, (tenant_id,))

        payload = snapshot_mod.build(conn, tenant_id, as_of=today)

    # The live balance is authoritative; the snapshot falls back to the last run when it
    # cannot reach Nessie, and a stale opening balance would shift the whole curve.
    payload["current_balance"] = float(account.get("balance", 0))

    result = FinancialEngine().analyze(snapshot_from_dict(payload)).to_dict()

    for ob in obligation_rows:
        occurrences = snapshot_mod.occurrences(ob["day_of_month"], today,
                                               today + timedelta(days=30))
        ob["next_due"] = occurrences[0] if occurrences else today

    with tenant_tx(tenant_id) as conn:
        breach = result.get("breach")
        execute(conn, """
            insert into forecast_runs
              (tenant_id, horizon_days, scenario, balance_at_run, verdict,
               health_score, resilience_score, financing_status,
               breach_date, breach_shortfall, result)
            values (%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s)
        """, (tenant_id, 30, "baseline", payload["current_balance"],
              result.get("gap_type"), result.get("health_score"),
              result.get("resilience_score"),
              (result.get("financing_decision") or {}).get("status"),
              breach["date"] if breach else None,
              breach["shortfall"] if breach else None,
              __import__("json").dumps(result)))

    account_view = {
        "id": account["_id"], "nickname": account.get("nickname") or "Cuenta Operativa",
        "bank": "Capital One", "balance": float(account.get("balance", 0)),
        "balanceAt": datetime.now(timezone.utc).isoformat(), "live": True,
    }

    return dashboard.build(
        tenant=tenant, account=account_view, accounts=[account_view],
        flows=flows, invoices=invoices, obligations=obligation_rows,
        result=result, today=today)


@app.post("/api/stress")
def stress(request: StressRequest,
           session_tenant: str | None = Depends(current_tenant_id)):
    tenant_id = session_tenant
    if not tenant_id:
        if not DEMO_MODE:
            raise HTTPException(401, "Sesión expirada o ausente.")
        with connect() as conn:
            row = fetch_one(conn, """
                select id from tenants where account_id is not null
                order by created_at limit 1
            """)
        if not row:
            raise HTTPException(404, "No hay negocios conectados.")
        tenant_id = str(row["id"])

    with tenant_tx(tenant_id) as conn:
        tenant = fetch_one(conn, """
            select t.id, t.razon_social, t.rfc, t.account_id, u.email
            from tenants t join users u on u.id = t.owner_id where t.id = %s
        """, (tenant_id,))
        if not tenant or not tenant["account_id"]:
            raise HTTPException(404, "Integración incompleta.")
        payload = snapshot_mod.build(conn, tenant_id, as_of=date.today())

    account = Nessie().account(tenant["account_id"])
    if account is None:
        raise HTTPException(503, "La cuenta no está disponible en Nessie.")
    payload["current_balance"] = float(account.get("balance", 0))

    return run_stress(request, snapshot_from_dict(payload), account, {
        "slug": str(tenant["id"]), "name": tenant["razon_social"] or "",
        "rfc": tenant["rfc"] or "", "owner": tenant["email"],
    })


@app.get("/api/health")
def health():
    return {"ok": True, "status": "ok", "demo_mode": DEMO_MODE}
