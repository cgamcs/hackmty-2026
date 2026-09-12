import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, RequireAuth } from '@/components/AppShell';
import { supabase } from '@/lib/supabase';
import { useSession } from '@/store/session';
import Inicio from '@/pages/Inicio';
import Login from '@/pages/Login';
import MiNegocio from '@/pages/MiNegocio';
import Pending from '@/pages/Pending';
import Prediccion from '@/pages/Prediccion';
import StressLab from '@/pages/StressLab';

/** Keep the store in sync with the Supabase session when auth is configured. */
function useSupabaseSession() {
  const setUser = useSession((s) => s.setUser);
  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setUser(data.session?.user.email ? { email: data.session.user.email } : null));
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user.email ? { email: session.user.email } : null);
    });
    return () => data.subscription.unsubscribe();
  }, [setUser]);
}

export default function App() {
  useSupabaseSession();

  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<AppShell />}>
          <Route index element={<Navigate to="/dashboard" replace />} />
          <Route path="/dashboard" element={<Inicio />} />
          <Route path="/business" element={<MiNegocio />} />
          <Route path="/forecast" element={<Prediccion />} />
          <Route path="/stress" element={<StressLab />} />
          <Route path="/recovery" element={<Pending view="recovery" />} />
          <Route path="/funding" element={<Pending view="funding" />} />
          <Route path="/settings/cfdi" element={<Pending view="cfdi" />} />
          <Route path="/settings" element={<Pending view="settings" />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
