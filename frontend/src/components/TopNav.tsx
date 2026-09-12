import { useState } from 'react';
import { Link, NavLink, useLocation, useNavigate } from 'react-router-dom';
import { useDashboard } from '@/api/hooks';
import { supabase } from '@/lib/supabase';
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
    <Link to="/dashboard" className="flex h-11 flex-none items-center gap-2.5 rounded-full border border-ash/20 pl-[16px] pr-[20px] sm:h-12 sm:pl-[18px] sm:pr-[22px]">
      <span className="size-4 rounded-md bg-ember sm:size-5" aria-hidden="true" />
      <span className="text-[17px] font-medium tracking-[-.01em] sm:text-[19px]">Puente</span>
    </Link>
  );
}

export function TopNav() {
  const { pathname } = useLocation();
  const { data } = useDashboard();
  const isHome = pathname === '/dashboard';
  const [mobileOpen, setMobileOpen] = useState(false);

  const closeMenu = () => setMobileOpen(false);

  return (
    <header className="flex flex-col gap-2">
      {/* main bar */}
      <div className="flex items-center justify-between gap-x-4">
        <Brand />

        {/* desktop pill nav — center */}
        <nav aria-label="Principal" className="hidden flex-1 overflow-x-auto md:block">
          <div className="flex h-11 w-max items-center gap-[3px] rounded-full border border-ash/10 bg-dim/14 px-1.5 xl:h-12">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                className={({ isActive }) =>
                  `flex h-8 items-center whitespace-nowrap rounded-full text-[12.5px] transition-colors xl:h-9 xl:text-[13.5px] ${
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
          {isHome ? (
            <>
              <Link
                to="/settings"
                className="hidden h-10 items-center gap-[9px] rounded-full border border-ash/18 px-[16px] text-[13px] hover:bg-ash/6 sm:flex sm:h-11 sm:px-[18px] sm:text-[13.5px]"
              >
                <Icon name="gear" size={14} color="#C7D6D5" strokeWidth={1.3} />
                <span className="hidden lg:inline">Ajustes</span>
              </Link>
              <Link
                to="/forecast"
                aria-label={data?.breach ? 'Alertas: incumplimiento proyectado' : 'Alertas'}
                className="relative grid size-10 place-items-center rounded-full border border-ash/18 hover:bg-ash/6 sm:size-11"
              >
                <Icon name="bell" size={15} color="#C7D6D5" strokeWidth={1.3} />
                {data?.breach && (
                  <span className="absolute right-[10px] top-[8px] size-[7px] rounded-full border-[1.5px] border-onyx bg-ember" />
                )}
              </Link>
            </>
          ) : (
            data && <AccountSelector accounts={data.accounts} />
          )}
          <UserMenu initials={data?.business.ownerInitials ?? '··'} />

          {/* hamburger — mobile only */}
          <button
            type="button"
            onClick={() => setMobileOpen((o) => !o)}
            aria-label={mobileOpen ? 'Cerrar menú' : 'Abrir menú'}
            aria-expanded={mobileOpen}
            aria-controls="mobile-nav"
            className="grid size-10 flex-none place-items-center rounded-full border border-ash/18 hover:bg-ash/6 md:hidden"
          >
            <Icon name={mobileOpen ? 'close' : 'menu'} size={16} color="#C7D6D5" strokeWidth={1.4} />
          </button>
        </div>
      </div>

      {/* mobile nav drawer */}
      {mobileOpen && (
        <nav id="mobile-nav" aria-label="Principal (móvil)" className="card md:hidden">
          <ul className="m-0 flex list-none flex-col p-2">
            {NAV.map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={closeMenu}
                  className={({ isActive }) =>
                    `flex h-11 items-center rounded-xl px-4 text-[14px] transition-colors ${
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
                className="flex h-11 items-center gap-2.5 rounded-xl px-4 text-[14px] text-ash hover:bg-ash/8"
              >
                <Icon name="gear" size={14} color="#C7D6D5" strokeWidth={1.3} />
                Ajustes
              </Link>
            </li>
          </ul>
        </nav>
      )}
    </header>
  );
}

function AccountSelector({ accounts }: { accounts: { id: string; nickname: string; bank: string }[] }) {
  const accountId = useSession((s) => s.accountId);
  const setAccount = useSession((s) => s.setAccount);
  const current = accounts.find((a) => a.id === accountId) ?? accounts[0];

  return (
    <label className="relative hidden h-10 cursor-pointer items-center gap-[9px] rounded-full border border-ash/18 px-[14px] text-[12.5px] hover:bg-ash/6 sm:flex sm:h-11 sm:px-[18px] sm:text-[13.5px]">
      <span className="eyebrow tracking-[.1em]">Cuenta</span>
      <span className="hidden lg:inline">
        {current.nickname} · {current.id.slice(0, 8)}
      </span>
      <Icon name="chevronDown" size={10} color="#6D7275" />
      <select
        aria-label="Cuenta operativa"
        value={current.id}
        onChange={(e) => setAccount(e.target.value)}
        className="absolute inset-0 cursor-pointer opacity-0"
      >
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {a.nickname} · {a.bank} · {a.id.slice(0, 8)}
          </option>
        ))}
      </select>
    </label>
  );
}

function UserMenu({ initials }: { initials: string }) {
  const setUser = useSession((s) => s.setUser);
  const navigate = useNavigate();

  async function signOut() {
    await supabase?.auth.signOut();
    setUser(null);
    navigate('/login', { replace: true });
  }

  return (
    <details className="relative">
      <summary
        aria-label="Menú de usuario"
        className="grid size-10 cursor-pointer list-none place-items-center rounded-full border border-ash/18 bg-dim/30 text-[12px] font-semibold sm:size-11 sm:text-[13px] [&::-webkit-details-marker]:hidden"
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
