import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  connectAccount,
  fetchDashboard,
  fetchObligations,
  fetchSetupStatus,
  isDemo,
  runSync,
  saveCashBuffer,
  saveObligation,
  saveProfile,
  simulateStress,
  uploadCfdi,
} from './client';
import type { StressRequest } from '@/types';

/** The account id comes from the server, derived from the session cookie. A copy kept in
 *  localStorage outlived logout and pointed the next user at the previous tenant (403). */
export function useDashboard() {
  const setup = useSetupStatus();
  const accountId = setup.data?.account_id ?? '';
  return useQuery({
    queryKey: ['dashboard', accountId],
    queryFn: () => fetchDashboard(accountId),
    // Demo mode has no setup call; otherwise wait for the server to name the account.
    enabled: isDemo || setup.isFetched,
  });
}

export function useStressSimulation(request: StressRequest) {
  return useQuery({
    queryKey: ['stress', request],
    queryFn: () => simulateStress(request),
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
export const useSaveCashBuffer = () => useIntegrationMutation(saveCashBuffer);
export const useConnectAccount = () => useIntegrationMutation(connectAccount);
export const useUploadCfdi = () => useIntegrationMutation(uploadCfdi);
export const useRunSync = () => useIntegrationMutation(runSync);

export const useSaveObligation = () =>
  useIntegrationMutation(
    (args: { id: string; rigidity: 'hard' | 'slack'; slack_days: number }) =>
      saveObligation(args.id, { rigidity: args.rigidity, slack_days: args.slack_days }),
  );
