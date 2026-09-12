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
  if (!res.ok) throw new Error(`No pudimos cargar tu tablero (${res.status}).`);
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
