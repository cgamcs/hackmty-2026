import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Range = 30 | 60 | 90;

interface SessionState {
  user: { email: string } | null;
  accountId: string;
  range: Range;
  setUser: (user: { email: string } | null) => void;
  setAccount: (accountId: string) => void;
  setRange: (range: Range) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      accountId: '',
      range: 30,
      setUser: (user) => set({ user }),
      setAccount: (accountId) => set({ accountId }),
      setRange: (range) => set({ range }),
    }),
    { name: 'puente-session', partialize: (s) => ({ user: s.user, accountId: s.accountId }) },
  ),
);
