import type { DashboardData } from '@/types';
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
