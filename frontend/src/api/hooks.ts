import { useQuery } from '@tanstack/react-query';
import { useSession } from '@/store/session';
import { fetchDashboard } from './client';

export function useDashboard() {
  const accountId = useSession((s) => s.accountId);
  return useQuery({
    queryKey: ['dashboard', accountId],
    queryFn: () => fetchDashboard(accountId),
  });
}
