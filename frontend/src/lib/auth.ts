/**
 * Session client. Replaces the Supabase auth that the project no longer uses.
 *
 * The session is an httpOnly cookie set by FastAPI, so no token is ever readable from
 * JavaScript and nothing is stored in localStorage. Every call sends
 * `credentials: 'include'`; that is the whole mechanism.
 */

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

export interface Me {
  tenant_id: string;
  email: string;
  razon_social: string | null;
  rfc: string | null;
  /** False until an account number has been connected — the first-run gate. */
  connected: boolean;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) {
    const detail = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(detail?.detail ?? `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

export function login(email: string, password: string) {
  return post<{ email: string }>('/api/auth/login', { email, password });
}

export function register(email: string, password: string, razonSocial?: string) {
  return post<{ tenant_id: string; email: string }>('/api/auth/register', {
    email,
    password,
    razon_social: razonSocial,
  });
}

export function logout() {
  return post<{ ok: true }>('/api/auth/logout');
}

/** Current session, or null when there is none. Only a real failure throws. */
export async function fetchMe(): Promise<Me | null> {
  const res = await fetch(`${API_BASE}/api/auth/me`, { credentials: 'include' });
  if (res.status === 401) return null;
  if (!res.ok) throw new Error(`No pudimos validar tu sesión (${res.status}).`);
  return (await res.json()) as Me;
}
