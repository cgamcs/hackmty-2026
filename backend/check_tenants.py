"""Two-tenant database check. Run it after applying migrations, as the API role:

    python3 backend/check_tenants.py

Each step replays a path that broke once the schema met a second tenant: registration
privileges (009/010), session-to-tenant lookup under RLS (007), the audit trigger (008), and
the same CFDI UUID in two tenants (010). It all runs in ONE transaction that is always rolled
back, so it leaves nothing behind and is safe against the live database.
"""

from __future__ import annotations

import secrets

import psycopg

from crypto import hash_password
from db import connect, execute, fetch_one

INVOICE_UPSERT = """
    insert into invoices (uuid, tenant_id, direction, tipo, fecha, total)
    values (%s, %s, 'issued', 'I', current_date, %s)
    on conflict (tenant_id, uuid) do update set total = excluded.total
"""


def _scope(conn, tenant_id: str = "", session_token: str = "") -> None:
    execute(conn, "select set_config('app.tenant_id', %s, true)", (tenant_id,))
    execute(conn, "select set_config('app.session_token', %s, true)", (session_token,))


def _register(conn) -> tuple[str, str]:
    created = fetch_one(conn, "select * from register_tenant(%s, %s, %s)", (
        f"check-{secrets.token_hex(6)}@example.invalid",
        hash_password(secrets.token_urlsafe(12)), "Check SA de CV"))
    token = secrets.token_urlsafe(32)
    execute(conn, """
        insert into sessions (token, user_id, expires_at)
        values (%s, %s, now() + interval '1 hour')
    """, (token, created["user_id"]))
    return str(created["tenant_id"]), token


def run(conn) -> None:
    a, b = _register(conn), _register(conn)

    for tenant_id, token in (a, b):
        _scope(conn, session_token=token)
        row = fetch_one(conn, """
            select t.id from sessions s join tenants t on t.owner_id = s.user_id
            where s.token = %s and s.expires_at > now()
        """, (token,))
        assert row and str(row["id"]) == tenant_id, "007: a session cannot resolve its tenant"

    shared_uuid = f"CHECK-{secrets.token_hex(8)}"
    for tenant_id, _ in (a, b):
        _scope(conn, tenant_id=tenant_id)
        execute(conn, INVOICE_UPSERT, (shared_uuid, tenant_id, 100))
        execute(conn, INVOICE_UPSERT, (shared_uuid, tenant_id, 200))   # ON CONFLICT path
        execute(conn, """
            insert into obligations (tenant_id, payee, amount, day_of_month, kind)
            values (%s, 'check', 1, 1, 'rent')
        """, (tenant_id,))
        execute(conn, """
            insert into terms (tenant_id, counterparty_rfc, days)
            values (%s, 'XAXX010101000', 30)
        """, (tenant_id,))
        execute(conn, """
            insert into cash_flows (tenant_id, occurred_at, flow_id, amount)
            values (%s, now(), 'check', 1)
        """, (tenant_id,))
        fetch_one(conn, "select count(*) from daily_flows")
        audited = fetch_one(conn, "select count(*) n from audit_log where tenant_id = %s",
                            (tenant_id,))["n"]
        assert audited >= 4, "008: the audit trigger did not record the writes"

    # The preceding loop leaves tenant B in scope. Switch back to A so this assertion
    # reaches the UUID constraint instead of being (correctly) rejected by A/B RLS.
    _scope(conn, tenant_id=a[0])
    try:
        with conn.transaction():                                         # savepoint
            execute(conn, INVOICE_UPSERT, ("", a[0], 1))
    except psycopg.errors.CheckViolation:
        pass
    else:
        raise AssertionError("010: an invoice without a UUID was accepted")

    _scope(conn, tenant_id=b[0])
    assert fetch_one(conn, "select count(*) n from tenants")["n"] == 1, \
        "RLS: a tenant can see other tenants"
    assert fetch_one(conn, "select count(*) n from invoices where tenant_id = %s",
                     (a[0],))["n"] == 0, "RLS: a tenant can see another tenant's invoices"

    execute(conn, "delete from sessions where token = %s", (a[1],))         # logout


def main() -> None:
    with connect() as conn:
        try:
            run(conn)
        finally:
            conn.rollback()
    print("ok: registration, sessions, shared CFDI upsert, audit trigger, RLS isolation")


if __name__ == "__main__":
    main()
