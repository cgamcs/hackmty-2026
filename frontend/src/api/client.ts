import type { DashboardData, StressRequest, StressSimulationResponse } from '@/types';
import { buildScenario } from '@/mock/scenario';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

/** True when running without the FastAPI backend (seeded demo scenario). */
export const isDemo = !API_BASE;

/**
 * GET /api/sme/{account_id}. The browser never holds a Nessie key — the backend does.
 * Resolves to `null` when the account has not completed integration (first-run gate).
 */
export async function fetchDashboard(accountId: string): Promise<DashboardData | null> {
  if (isDemo) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return buildScenario();
  }
  const res = await fetch(`${API_BASE}/api/sme/${encodeURIComponent(accountId)}`, { credentials: 'include' });
  if (res.status === 404) return null;
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `No pudimos cargar tu tablero (${res.status}).`);
  }
  return (await res.json()) as DashboardData;
}

/** Run the Python engine for the business linked to the authenticated user. */
export async function simulateStress(request: StressRequest): Promise<StressSimulationResponse> {
  const res = await fetch(`${API_BASE ?? ''}/api/stress`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `No pudimos ejecutar la simulación (${res.status}).`);
  }
  return (await res.json()) as StressSimulationResponse;
}

// ─── Integration (Ajustes) ────────────────────────────────────────────────────
// The browser never holds a Nessie key or a bank credential: it sends an account NUMBER
// and the server resolves it. Filtering an account list client-side would leak every
// other business into the network tab.

export interface SetupStatus {
  steps: { razon_social: boolean; account: boolean; cfdi: boolean; obligations: boolean; synced: boolean };
  complete: boolean;
  razon_social: string | null;
  rfc: string | null;
  account_id: string | null;
  account_last4: string | null;
  counts: { cfdi: number; obligations: number; flows: number; open_receivables: number };
}

export interface ObligationRow {
  id: string;
  payee: string;
  amount: number;
  day_of_month: number;
  kind: 'payroll' | 'tax' | 'rent' | 'supplier' | 'utility' | 'other';
  rigidity: 'hard' | 'slack';
  slack_days: number;
  relationship_cost: number;
  source: 'detected' | 'user';
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${API_BASE ?? ''}${path}`, { credentials: 'include', ...init });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `Error ${res.status}`);
  }
  return (await res.json()) as T;
}

function post<T>(path: string, body?: unknown): Promise<T> {
  return api<T>(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

export const fetchSetupStatus = () => api<SetupStatus>('/api/setup/status');

export const saveProfile = (razonSocial: string) =>
  post<{ razon_social: string }>('/api/profile', { razon_social: razonSocial });

export const connectAccount = (accountNumber: string) =>
  post<{ account_id: string; nickname: string; balance: number; last4: string }>('/api/connect', {
    account_number: accountNumber,
  });

/** Accepts the SAT bulk-download ZIP or individual XML files. */
export async function uploadCfdi(files: FileList | File[]): Promise<{ parsed: number; skipped: number; rfc: string }> {
  const list = Array.from(files);
  let parsed = 0;
  let skipped = 0;
  let rfc = '';
  // One request per file keeps a single malformed XML from failing the whole batch.
  for (const file of list) {
    const form = new FormData();
    form.append('file', file);
    const res = await api<{ parsed: number; skipped: number; rfc: string }>('/api/cfdi/upload', {
      method: 'POST',
      body: form,
    });
    parsed += res.parsed;
    skipped += res.skipped;
    rfc = res.rfc || rfc;
  }
  return { parsed, skipped, rfc };
}

export const fetchObligations = () => api<ObligationRow[]>('/api/obligations');

export const saveObligation = (
  id: string,
  patch: { rigidity: 'hard' | 'slack'; slack_days: number; relationship_cost?: number },
) => post<{ ok: true }>(`/api/obligations/${id}`, patch);

/** Nessie → cash_flows, then reconcile CFDI against movements and learn payment terms. */
export const runSync = () =>
  post<{
    balance: number;
    flows: { deposits: number; purchases: number; withdrawals: number };
    obligations: number;
    matched: number;
    open_receivables: number;
    terms: number;
  }>('/api/sync');
