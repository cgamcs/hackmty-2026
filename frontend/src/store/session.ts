import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type Range = 30 | 60 | 90;

// No account id here: it belongs to the tenant behind the session cookie, so the server
// supplies it (useSetupStatus). A persisted copy survived logout and made the next user
// request the previous tenant's dashboard.
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
    { name: 'puente-session', partialize: (s) => ({ user: s.user }) },
  ),
);
