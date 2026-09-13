"""Vercel entrypoint. Vercel only scans app.py/main.py/... at the root, src/, app/ or api/."""

from backend.main import app as backend_app

# ponytail: explicit assignment so Vercel's static scan finds a top-level `app`; a bare re-export may not be detected.
app = backend_app
