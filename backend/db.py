"""Tiger Cloud connection and per-request tenant scoping.

The API connects as a single database role, so there is no `auth.uid()` equivalent.
Tenant isolation comes from `SET LOCAL app.tenant_id`, which the RLS policies read
through `current_tenant()`.

`SET LOCAL` rather than `SET` is the whole point: it is scoped to the transaction, so a
pooled connection cannot carry one request's tenant into the next request that borrows
it. A plain `SET` would survive the connection's return to the pool and leak across
tenants — silently, and only under load, which is the worst way to find out.
"""

from __future__ import annotations

import os
from contextlib import contextmanager
from pathlib import Path

try:
    import psycopg
    from psycopg.rows import dict_row
except ModuleNotFoundError as exc:      # pragma: no cover
    raise ModuleNotFoundError(
        'psycopg is required: pip install "psycopg[binary]"'
    ) from exc


def _env(name: str) -> str | None:
    if name in os.environ:
        return os.environ[name]
    env = Path(__file__).parent.parent / ".env"
    if env.is_file():
        for line in env.read_text().splitlines():
            key, sep, value = line.partition("=")
            if sep and key.strip() == name:
                return value.strip().strip('"').strip("'")
    return None


def dsn() -> str:
    url = _env("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL not set (Tiger Cloud connection string)")
    # Tiger Cloud requires TLS. Refusing to fall back to plaintext is deliberate:
    # a silent downgrade would send every RFC and balance over the open network.
    if "sslmode=" not in url:
        url += ("&" if "?" in url else "?") + "sslmode=require"
    return url


@contextmanager
def connect():
    with psycopg.connect(dsn(), row_factory=dict_row) as conn:
        yield conn


@contextmanager
def tenant_tx(tenant_id: str):
    """One transaction scoped to a tenant. Every query inside is RLS-filtered."""
    with connect() as conn:
        with conn.transaction():
            with conn.cursor() as cur:
                # Parameterised, not interpolated: set_config is a function call, so the
                # tenant id can never be concatenated into SQL.
                cur.execute("select set_config('app.tenant_id', %s, true)",
                            (str(tenant_id),))
            yield conn


def fetch_all(conn, sql: str, params: tuple = ()) -> list[dict]:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchall()


def fetch_one(conn, sql: str, params: tuple = ()) -> dict | None:
    with conn.cursor() as cur:
        cur.execute(sql, params)
        return cur.fetchone()


def execute(conn, sql: str, params: tuple = ()) -> None:
    with conn.cursor() as cur:
        cur.execute(sql, params)


def execute_many(conn, sql: str, rows: list[tuple]) -> None:
    if not rows:
        return
    with conn.cursor() as cur:
        cur.executemany(sql, rows)
