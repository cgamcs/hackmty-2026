#!/usr/bin/env python3
"""Diagnose the Tiger Cloud connection without printing the password.

Run from the repo root:  python3 backend/check_db.py

Reports the shape of DATABASE_URL, flags characters that need percent-encoding, and
tries the connection two ways — parsed from the URL, and with the password passed as a
keyword. If the keyword attempt succeeds and the URL attempt does not, the password
contains a character the URL parser is splitting on.
"""

from __future__ import annotations

import sys
from pathlib import Path
from urllib.parse import quote, unquote, urlsplit

NEEDS_ENCODING = set("@:/#?%[] ")


def read_env(name: str) -> str | None:
    env = Path(__file__).parent.parent / ".env"
    if not env.is_file():
        return None
    for line in env.read_text().splitlines():
        key, sep, value = line.partition("=")
        if sep and key.strip() == name:
            return value.strip().strip('"').strip("'")
    return None


def main() -> int:
    url = read_env("DATABASE_URL")
    if not url:
        print("DATABASE_URL no está en .env")
        return 1

    parts = urlsplit(url)
    user = parts.username or ""
    raw_password = parts.password or ""
    password = unquote(raw_password)

    print(f"  esquema   {parts.scheme}")
    print(f"  usuario   {user}")
    print(f"  host      {parts.hostname}:{parts.port}")
    print(f"  base      {parts.path.lstrip('/')}")
    print(f"  password  {len(password)} caracteres "
          f"(en la URL se ven {len(raw_password)})")

    if user != "app_api":
        print(f"  !! el usuario es {user!r}; la API debe conectarse como 'app_api' — "
              "RLS no aplica a un superusuario")

    risky = sorted(NEEDS_ENCODING & set(password))
    if risky:
        encoded = quote(password, safe="")
        print(f"  !! la contraseña contiene {risky} — hay que percent-encodearla")
        print(f"     reemplazá la parte de la contraseña por: {encoded}")
    if len(raw_password) == len(password) and risky:
        print("     (está SIN encodear en la URL: ahí está el fallo)")

    try:
        import psycopg
    except ModuleNotFoundError:
        print("  psycopg no instalado; no puedo probar la conexión")
        return 1

    def attempt(label: str, **kwargs) -> bool:
        try:
            with psycopg.connect(connect_timeout=10, **kwargs) as conn:
                with conn.cursor() as cur:
                    cur.execute("select current_user, current_setting('is_superuser')")
                    who, superuser = cur.fetchone()
            print(f"  {label}: OK — conectado como {who}, superusuario={superuser}")
            if superuser == "on":
                print("     !! un superusuario ignora RLS: las políticas no filtran nada")
            return True
        except Exception as exc:
            print(f"  {label}: FALLA — {str(exc).strip().splitlines()[0][:100]}")
            return False

    sep = "&" if "?" in url else "?"
    by_url = attempt("via URL     ", conninfo=url + ("" if "sslmode=" in url
                                                     else f"{sep}sslmode=require"))
    by_kwargs = attempt("via keywords", host=parts.hostname, port=parts.port,
                        user=user, password=password,
                        dbname=parts.path.lstrip("/"), sslmode="require")

    if by_kwargs and not by_url:
        print("\n  Diagnóstico: la contraseña es correcta pero la URL la parte mal. "
              "Percent-encodeá la contraseña en DATABASE_URL.")
    elif not by_kwargs and not by_url:
        print("\n  Diagnóstico: la contraseña no coincide con la del rol. En Tiger:\n"
              "    ALTER ROLE app_api PASSWORD 'la_que_pongas_en_el_env';")
    return 0 if by_url else 1


if __name__ == "__main__":
    sys.exit(main())
