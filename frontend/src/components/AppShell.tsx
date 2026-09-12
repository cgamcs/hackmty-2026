import { Navigate, Outlet, useLocation } from 'react-router-dom';
import { useSession } from '@/store/session';
import { TopNav } from './TopNav';

export function RequireAuth() {
  const user = useSession((s) => s.user);
  const location = useLocation();
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  return <Outlet />;
}

export function AppShell() {
  return (
    <div className="min-h-screen px-2 py-3 sm:px-5 sm:py-6 lg:px-8 lg:py-8">
      <div className="shell mx-auto flex max-w-[1480px] flex-col gap-4 px-3 pb-5 pt-4 sm:gap-[22px] sm:px-[22px] sm:pb-[26px] sm:pt-[22px] lg:px-[30px] lg:pb-[30px] lg:pt-[26px]">
        <TopNav />
        <main className="flex flex-col gap-4 sm:gap-[22px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
