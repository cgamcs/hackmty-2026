import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/store/session';
import { fetchDashboard } from './client';
import { simulateStress } from './client';
import type { StressRequest } from '@/types';

export function useDashboard() {
  const accountId = useSession((s) => s.accountId);
  return useQuery({
    queryKey: ['dashboard', accountId],
    queryFn: () => fetchDashboard(accountId),
  });
}

export function useStressSimulation(request: StressRequest) {
  return useQuery({
    queryKey: ['stress', request],
    queryFn: () => simulateStress(request),
    placeholderData: (previous) => previous,
  });
}
