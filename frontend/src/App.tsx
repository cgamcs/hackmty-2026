import { useEffect } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell, RequireAuth } from '@/components/AppShell';
import { isDemo } from '@/api/client';
import { fetchMe } from '@/lib/auth';
import { useSession } from '@/store/session';
import Inicio from '@/pages/Inicio';
import Login from '@/pages/Login';
import MiNegocio from '@/pages/MiNegocio';
import Prediccion from '@/pages/Prediccion';
import StressLab from '@/pages/StressLab';
import Recovery from '@/pages/Recovery';
import Funding from '@/pages/Funding';
import CfdiConfig from '@/pages/CfdiConfig';
import Ajustes from '@/pages/Ajustes';

/** Rehydrate the store from the session cookie on load.
 *
 * The cookie is httpOnly, so its presence cannot be read from JavaScript — the only way
 * to know whether a session is live is to ask the server.
 */
function useServerSession() {
  const setUser = useSession((s) => s.setUser);
  const setAccount = useSession((s) => s.setAccount);
  useEffect(() => {
    if (isDemo) return;
    let cancelled = false;
    fetchMe()
      .then((me) => {
        if (cancelled) return;
        setUser(me ? { email: me.email } : null);
        setAccount(me?.account_id ?? '');
      })
      .catch(() => {
        if (!cancelled) {
          setUser(null);
          setAccount('');
        }
      });
    return () => { cancelled = true; };
  }, [setAccount, setUser]);
}

export default function App() {
  useServerSession();

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
          <Route path="/recovery" element={<Recovery />} />
          <Route path="/funding" element={<Funding />} />
          <Route path="/settings/cfdi" element={<CfdiConfig />} />
          <Route path="/settings" element={<Ajustes />} />
        </Route>
      </Route>
      <Route path="*" element={<Navigate to="/dashboard" replace />} />
    </Routes>
  );
}
