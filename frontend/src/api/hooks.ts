import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/store/session';
import { fetchDashboard } from './client';
import { simulateStress } from './client';
import type { StressRequest } from '@/types';

export function useDashboard() {
  const email = useSession((state) => state.user?.email);
  return useQuery({
    queryKey: ['dashboard', email],
    queryFn: fetchDashboard,
  });
}

export function useStressSimulation(request: StressRequest) {
  const email = useSession((state) => state.user?.email);
  return useQuery({
    queryKey: ['stress', email, request],
    queryFn: () => simulateStress(request),
    placeholderData: (previous) => previous,
  });
}
