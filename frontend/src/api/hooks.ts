import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useSession } from '@/store/session';
import {
  connectAccount,
  fetchDashboard,
  fetchObligations,
  fetchSetupStatus,
  isDemo,
  runSync,
  saveObligation,
  saveProfile,
  simulateStress,
  uploadCfdi,
} from './client';
import type { StressRequest } from '@/types';

export function useDashboard() {
  const accountId = useSession((state) => state.accountId);
  return useQuery({
    queryKey: ['dashboard', accountId],
    queryFn: () => fetchDashboard(accountId),
    enabled: isDemo || Boolean(accountId),
  });
}

export function useStressSimulation(request: StressRequest) {
  const accountId = useSession((state) => state.accountId);
  return useQuery({
    queryKey: ['stress', accountId, request],
    queryFn: () => simulateStress(request),
    enabled: isDemo || Boolean(accountId),
    placeholderData: (previous) => previous,
  });
}

/** What the tenant still has to provide. The server decides, not the UI. */
export function useSetupStatus() {
  return useQuery({
    queryKey: ['setup'],
    queryFn: fetchSetupStatus,
    // Pointless without a backend: demo mode serves the seeded scenario instead.
    enabled: !isDemo,
  });
}

export function useObligations() {
  const { data: setup } = useSetupStatus();
  return useQuery({
    queryKey: ['obligations'],
    queryFn: fetchObligations,
    // Nessie bills are the source, so there is nothing to list until a sync has run.
    enabled: !isDemo && Boolean(setup?.steps.account),
  });
}

/** Every integration write invalidates setup and the dashboard, so the gate re-evaluates
 *  on the server rather than from whatever the UI last believed. */
function useIntegrationMutation<TArgs, TResult>(fn: (args: TArgs) => Promise<TResult>) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['setup'] });
      queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      queryClient.invalidateQueries({ queryKey: ['obligations'] });
    },
  });
}

export const useSaveProfile = () => useIntegrationMutation(saveProfile);
export const useConnectAccount = () => useIntegrationMutation(connectAccount);
export const useUploadCfdi = () => useIntegrationMutation(uploadCfdi);
export const useRunSync = () => useIntegrationMutation(runSync);

export const useSaveObligation = () =>
  useIntegrationMutation(
    (args: { id: string; rigidity: 'hard' | 'slack'; slack_days: number }) =>
      saveObligation(args.id, { rigidity: args.rigidity, slack_days: args.slack_days }),
  );
