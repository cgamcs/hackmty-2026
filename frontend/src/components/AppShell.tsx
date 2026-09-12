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
    <div className="app-bg flex min-h-screen flex-col">
      <TopNav />
      {/* pt offsets the fixed nav (~68px on mobile, ~76px on desktop) */}
      <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col gap-4 px-3 pb-5 pt-[80px] sm:gap-[22px] sm:px-[22px] sm:pb-[26px] sm:pt-[88px] lg:px-[30px] lg:pb-[30px] lg:pt-[90px]">
        <main className="page-enter stagger flex flex-col gap-4 sm:gap-[22px]">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
