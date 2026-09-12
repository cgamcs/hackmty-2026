"""Read-only Nessie client.

The engine never writes to Nessie: it is the bank of record, not our database. Writes
belong to the seeder (mocks/generate.py) and to the credit application rail.
"""

from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from pathlib import Path

BASE = "https://prod-api.nessieisreal.com"


def load_key() -> str:
    candidates = (
        Path(__file__).parent.parent / ".env",
        Path(__file__).parent / ".env",
    )
    for env in candidates:
        if not env.is_file():
            continue
        for line in env.read_text().splitlines():
            name, separator, value = line.partition("=")
            if separator and name.strip() == "API_KEY":
                return value.strip().strip('"').strip("'")
    raise RuntimeError("API_KEY not found in repository .env or engine/.env")


class Nessie:
    def __init__(self, key: str | None = None):
        self.key = key or os.environ.get("API_KEY") or load_key()

    def get(self, path: str):
        url = f"{BASE}{path}{'&' if '?' in path else '?'}key={self.key}"
        try:
            with urllib.request.urlopen(url, timeout=30) as r:
                return json.loads(r.read() or b"null")
        except urllib.error.HTTPError as e:
            # 404 on a collection route means empty, not missing. Treating it as an
            # error stops any pipeline on the first quiet account.
            if e.code == 404:
                return []
            raise

    def accounts(self) -> list[dict]:
        return self.get("/accounts") or []

    def customers(self) -> list[dict]:
        return self.get("/customers") or []

    def account(self, account_id: str) -> dict | None:
        return next((a for a in self.accounts() if a["_id"] == account_id), None)

    def deposits(self, account_id: str) -> list[dict]:
        return self.get(f"/accounts/{account_id}/deposits") or []

    def purchases(self, account_id: str) -> list[dict]:
        return self.get(f"/accounts/{account_id}/purchases") or []

    def withdrawals(self, account_id: str) -> list[dict]:
        return self.get(f"/accounts/{account_id}/withdrawals") or []

    def bills(self, account_id: str) -> list[dict]:
        return self.get(f"/accounts/{account_id}/bills") or []

    def merchants(self) -> list[dict]:
        return self.get("/merchants") or []
