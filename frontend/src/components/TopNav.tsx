import { useState, useEffect, useRef } from 'react';
import { Link, NavLink, useNavigate } from 'react-router-dom';
import { useDashboard } from '@/api/hooks';
import { logout as apiLogout } from '@/lib/auth';
import { useSession } from '@/store/session';
import { Icon } from './ui';

const NAV = [
  { to: '/dashboard', label: 'Inicio' },
  { to: '/business', label: 'Mi negocio' },
  { to: '/forecast', label: 'Predicción' },
  { to: '/stress', label: 'Stress Lab' },
  { to: '/recovery', label: 'Recovery' },
  { to: '/funding', label: 'Funding' },
  { to: '/settings/cfdi', label: 'CFDI' },
];

export function Brand() {
  return (
    <Link to="/dashboard" className="glass flex h-11 flex-none items-center gap-2.5 rounded-full pl-[16px] pr-[20px] sm:h-12 sm:pl-[18px] sm:pr-[22px]">
      <span className="size-4 rounded-md bg-ember sm:size-5" aria-hidden="true" />
      <span className="text-[17px] font-medium tracking-[-.01em] sm:text-[19px]">Beel</span>
    </Link>
  );
}

export function TopNav() {
  const { data } = useDashboard();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [visible, setVisible] = useState(true);
  const lastScrollY = useRef(0);

  /* close drawer on resize to xl+ */
  useEffect(() => {
    const onResize = () => { if (window.innerWidth >= 1280) setMobileOpen(false); };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  /* scroll-reveal: hide on scroll-down, show on scroll-up */
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      if (y < 60) { setVisible(true); }
      else if (y > lastScrollY.current + 6) { setVisible(false); setMobileOpen(false); }
      else if (y < lastScrollY.current - 4) { setVisible(true); }
      lastScrollY.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const closeMenu = () => setMobileOpen(false);

  return (
    <header
      style={{
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        zIndex: 50,
        transform: visible ? 'translateY(0)' : 'translateY(-110%)',
        transition: 'transform 0.32s cubic-bezier(0.22, 1, 0.36, 1)',
      }}
      className=""
    >
      <div className="mx-auto flex w-full max-w-[1480px] flex-col gap-2 px-3 py-3 sm:px-[22px] lg:px-[30px]">
        {/* main bar */}
        <div className="flex items-center justify-between gap-x-4">
          <Brand />

          {/* desktop pill nav — center, only at xl+ to avoid overflow on laptop */}
          <nav aria-label="Principal" className="hidden flex-1 xl:block">
            <div className="glass flex h-11 w-max items-center gap-[3px] rounded-full px-1.5 xl:h-12">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  className={({ isActive }) =>
                    `flex h-8 items-center whitespace-nowrap rounded-full text-[12.5px] transition-colors duration-200 xl:h-9 xl:text-[13.5px] ${
                      isActive ? 'bg-ember px-4 font-medium text-ghost xl:px-5' : 'px-3.5 text-dim hover:text-ghost xl:px-4'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </div>
          </nav>

          {/* right actions */}
          <div className="flex items-center gap-1.5 sm:gap-2">
            <Link
              to="/settings"
              className="glass hidden h-10 items-center gap-[9px] rounded-full px-[16px] text-[13px] sm:flex sm:h-11 sm:px-[18px] sm:text-[13.5px]"
            >
              <Icon name="gear" size={14} color="#C7D6D5" strokeWidth={1.3} />
              <span className="hidden lg:inline">Ajustes</span>
            </Link>
            <Link
              to="/forecast"
              aria-label={data?.breach ? 'Alertas: incumplimiento proyectado' : 'Alertas'}
              className="glass relative grid size-10 place-items-center rounded-full sm:size-11"
            >
              <Icon name="bell" size={15} color="#C7D6D5" strokeWidth={1.3} />
              {data?.breach && (
                <span className="absolute right-[10px] top-[8px] size-[7px] rounded-full border-[1.5px] border-onyx bg-ember" />
              )}
            </Link>
            <UserMenu initials={data?.business.ownerInitials ?? '··'} />

            {/* hamburger — mobile only */}
            <button
              type="button"
              onClick={() => setMobileOpen((o) => !o)}
              aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
              aria-expanded={mobileOpen}
              aria-controls="mobile-nav"
              className="glass grid size-10 flex-none place-items-center rounded-full xl:hidden"
            >
              <Icon name={mobileOpen ? 'close' : 'menu'} size={16} color="#C7D6D5" strokeWidth={1.4} />
            </button>
          </div>
        </div>

        {/* mobile nav drawer — animated */}
        <nav
          id="mobile-nav"
          aria-label="Principal (móvil)"
          className="card xl:hidden"
          style={{
            overflow: 'hidden',
            maxHeight: mobileOpen ? '420px' : '0px',
            opacity: mobileOpen ? 1 : 0,
            transition: 'max-height 0.32s cubic-bezier(0.22, 1, 0.36, 1), opacity 0.22s ease',
          }}
        >
          <ul className="m-0 flex list-none flex-col p-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={closeMenu}
                  className={({ isActive }) =>
                    `flex h-11 items-center rounded-xl px-4 text-[14px] transition-colors duration-150 ${
                      isActive ? 'bg-ember font-medium text-ghost' : 'text-ash hover:bg-ash/8'
                    }`
                  }
                >
                  {item.label}
                </NavLink>
              </li>
            ))}
            <li className="mt-1 border-t border-ash/10 pt-1">
              <Link
                to="/settings"
                onClick={closeMenu}
                className="flex h-11 items-center gap-2.5 rounded-xl px-4 text-[14px] text-ash transition-colors duration-150 hover:bg-ash/8"
              >
                <Icon name="gear" size={14} color="#C7D6D5" strokeWidth={1.3} />
                Ajustes
              </Link>
            </li>
          </ul>
        </nav>
      </div>
    </header>
  );
}

function UserMenu({ initials }: { initials: string }) {
  const setUser = useSession((s) => s.setUser);
  const setAccount = useSession((s) => s.setAccount);
  const navigate = useNavigate();

  async function signOut() {
    await apiLogout().catch(() => {});   // clear locally even if the call fails
    setUser(null);
    setAccount('');
    navigate('/login', { replace: true });
  }

  return (
    <details className="relative">
      <summary
        aria-label="Menú de usuario"
        className="glass grid size-10 cursor-pointer list-none place-items-center rounded-full text-[12px] font-semibold sm:size-11 sm:text-[13px] [&::-webkit-details-marker]:hidden"
      >
        {initials}
      </summary>
      <div className="card-ink absolute right-0 top-[50px] z-20 w-44 !rounded-2xl p-1.5 sm:top-[52px]">
        <Link to="/settings" className="block rounded-xl px-3 py-2 text-[13px] hover:bg-ash/8">
          Ajustes
        </Link>
        <button type="button" onClick={signOut} className="block w-full rounded-xl px-3 py-2 text-left text-[13px] hover:bg-ash/8">
          Cerrar sesión
        </button>
      </div>
    </details>
  );
}
