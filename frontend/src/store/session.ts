import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Range = 30 | 60 | 90;

interface SessionState {
  user: { email: string } | null;
  range: Range;
  setUser: (user: { email: string } | null) => void;
  setRange: (range: Range) => void;
}

export const useSession = create<SessionState>()(
  persist(
    (set) => ({
      user: null,
      range: 30,
      setUser: (user) => set({ user }),
      setRange: (range) => set({ range }),
    }),
    { name: 'puente-session', partialize: (state) => ({ user: state.user }) },
  ),
);
