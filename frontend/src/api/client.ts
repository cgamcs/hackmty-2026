import type { DashboardData, Ladder, LadderRung, StressRequest, StressSimulationResponse } from '@/types';
import { buildScenario } from '@/mock/scenario';

// Empty by default: vite.config.ts proxies /api to the backend, so requests stay
// same-origin and the session cookie is plainly first-party — no CORS preflight, no
// SameSite edge cases. Set VITE_API_BASE_URL only to point at a backend elsewhere.
const API_BASE = import.meta.env.VITE_API_BASE_URL ?? '';

/** Seeded demo scenario, with no backend at all. Opt in with VITE_DEMO=1.
 *
 * This used to be inferred from a missing VITE_API_BASE_URL, which meant forgetting to
 * set an env var silently served mock data through the whole app — every page looked
 * populated while nothing was ever saved. Demo mode is now explicit. */
export const isDemo = import.meta.env.VITE_DEMO === '1';

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
  /** Cash outside the operating account the owner can move in; 0 when not declared. */
  cash_buffer: number;
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

/** Savings or another account the owner can move into the operating account. */
export const saveCashBuffer = (amount: number) =>
  post<{ cash_buffer: number }>('/api/buffer', { cash_buffer: amount });

export const connectAccount = (accountNumber: string) =>
  post<{ account_id: string; nickname: string; balance: number; last4: string }>('/api/connect', {
    account_number: accountNumber,
  });

/** Accepts the SAT bulk-download ZIP or individual XML files. Sent as ONE batch: the server
 *  infers the tenant's RFC across all documents, which a lone XML cannot tell it. A malformed
 *  XML is skipped server-side, so it does not fail the batch. */
export function uploadCfdi(files: FileList | File[]) {
  const form = new FormData();
  for (const file of Array.from(files)) form.append('files', file);
  return api<{ parsed: number; skipped: number; rfc: string }>('/api/cfdi/upload', {
    method: 'POST',
    body: form,
  });
}

export const fetchObligations = () => api<ObligationRow[]>('/api/obligations');

export const saveObligation = (
  id: string,
  patch: { rigidity: 'hard' | 'slack'; slack_days: number; relationship_cost?: number },
) => post<{ ok: true }>(`/api/obligations/${id}`, patch);

/** The engine's recovery ladder re-run without the rungs the owner switched off. */
export const fetchRecoveryLadder = (excluded: LadderRung[]) =>
  post<Ladder>('/api/recovery', { excluded });

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
