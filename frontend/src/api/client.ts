import type { DashboardData, StressRequest, StressSimulationResponse } from '@/types';
import { supabase } from '@/lib/supabase';

const API_BASE = import.meta.env.VITE_API_BASE_URL;

async function authHeaders(): Promise<HeadersInit> {
  if (!supabase) return { 'Content-Type': 'application/json' };
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

/** The server derives the business from the authenticated user. */
export async function fetchDashboard(): Promise<DashboardData | null> {
  const res = await fetch(`${API_BASE ?? ''}/api/dashboard`, {
    credentials: 'include',
    headers: await authHeaders(),
  });
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
    headers: await authHeaders(),
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(body?.detail ?? `No pudimos ejecutar la simulación (${res.status}).`);
  }
  return (await res.json()) as StressSimulationResponse;
}
