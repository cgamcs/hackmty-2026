import { useState, type FormEvent } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Brand } from '@/components/TopNav';
import { Icon } from '@/components/ui';
import { login as apiLogin, register as apiRegister } from '@/lib/auth';
import { isDemo } from '@/api/client';
import { useSession } from '@/store/session';

type Mode = 'signin' | 'signup';

export default function Login() {
  const user = useSession((s) => s.user);
  const setUser = useSession((s) => s.setUser);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const from = (location.state as { from?: string } | null)?.from ?? '/dashboard';

  const [mode, setMode] = useState<Mode>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  if (user) return <Navigate to={from} replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      if (!isDemo) {
        if (mode === 'signin') await apiLogin(email, password);
        else await apiRegister(email, password);
      }
      // Also covers a session that expired without an explicit logout.
      queryClient.clear();
      setUser({ email });
      navigate(mode === 'signup' ? '/settings/cfdi' : from, { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No pudimos iniciar sesión.');
    } finally {
      setBusy(false);
    }
  }

  const inputCls =
    'mt-[9px] h-[54px] w-full rounded-2xl border border-ash/18 bg-dim/10 px-[18px] text-[14.5px] text-ghost outline-none placeholder:text-dim focus:border-ember';

  return (
    <div className="app-bg flex min-h-screen flex-col">
      <div className="mx-auto flex w-full max-w-[1480px] flex-1 flex-col px-5 py-8 sm:px-11 sm:py-10">
        <header className="flex flex-none flex-wrap items-center justify-between gap-4">
          <Brand />
          <div className="flex items-center gap-3">
            <span className="text-[13px] text-dim">{mode === 'signin' ? '¿Primera vez aquí?' : '¿Ya tienes cuenta?'}</span>
            <button
              type="button"
              onClick={() => setMode(mode === 'signin' ? 'signup' : 'signin')}
              className="flex h-11 items-center whitespace-nowrap rounded-full border border-ash/20 px-5 text-[13.5px] hover:bg-ash/8"
            >
              {mode === 'signin' ? 'Crear cuenta de PyME' : 'Entrar'}
            </button>
          </div>
        </header>

        <div className="grid flex-1 items-center gap-8 py-8 sm:gap-11 sm:py-10 lg:grid-cols-[1.06fr_.94fr]">
          <section className="lg:pr-5">
            <h1 className="m-0 text-[clamp(34px,7vw,62px)] font-normal leading-[1.04] tracking-[-.04em] [text-wrap:pretty]">
              Tu liquidez de
              <br />
              los próximos 30 días
            </h1>
            <p className="m-0 mt-[22px] max-w-[560px] text-base leading-[1.55] text-ash">
              Conectamos tus CFDI con el saldo real de tu cuenta y te decimos si vas a poder cubrir la nómina. Cuando falta dinero, primero buscamos la
              opción más barata. El crédito es el último peldaño.
            </p>

            <ol className="m-0 mt-[38px] flex list-none items-center gap-[22px] p-0" aria-label="Primeros pasos">
              <li className="flex items-center gap-2.5">
                <span className="text-[13px] text-dim">CFDI</span>
                <span className="flex h-[34px] items-center rounded-full bg-ember px-4 text-[12.5px] font-semibold">Paso 1</span>
              </li>
              <li className="flex items-center gap-2.5">
                <span className="text-[13px] text-dim">Banco</span>
                <span className="flex h-[34px] items-center rounded-full bg-dim/24 px-4 text-[12.5px] font-semibold text-ash">Paso 2</span>
              </li>
              <li className="hatch hidden h-[34px] flex-1 sm:block" aria-hidden="true" />
            </ol>

            <div className="mt-[46px] flex flex-wrap gap-x-11 gap-y-6">
              <BigStat value="30" label="días de horizonte" />
              <BigStat value="4" label="peldaños antes del crédito" />
              <BigStat value="0" label="llaves bancarias en tu navegador" />
            </div>
          </section>

          <form onSubmit={submit} className="flex flex-col rounded-[30px] border border-ash/14 bg-dim/16 px-6 py-8 sm:px-10 sm:py-[38px]" noValidate>
            <h2 className="m-0 text-[26px] font-medium tracking-[-.02em]">{mode === 'signin' ? 'Entra a tu panel' : 'Crea tu cuenta'}</h2>
            <div className="mt-2 text-[13px] text-dim">Una cuenta por PyME · sesión del lado del servidor</div>

            <div className="mt-[30px] flex flex-col gap-5">
              <label className="block">
                <span className="eyebrow !text-[10px]">Correo</span>
                <input
                  type="email"
                  required
                  autoComplete="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="mariana@tunegocio.mx"
                  className={inputCls}
                />
              </label>
              <label className="block">
                <span className="eyebrow !text-[10px]">Contraseña</span>
                <input
                  type="password"
                  required
                  autoComplete={mode === 'signin' ? 'current-password' : 'new-password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className={`${inputCls} tracking-[.18em]`}
                />
              </label>
            </div>

            <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
              <label className="flex cursor-pointer items-center gap-2.5">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="peer sr-only" />
                <span className="grid size-[18px] place-items-center rounded-[5px] border border-ash/30 peer-checked:bg-ember peer-focus-visible:outline-2 peer-focus-visible:outline-ember">
                  {remember && <Icon name="check" size={11} color="#ECEBF3" strokeWidth={1.8} />}
                </span>
                <span className="text-[13px] text-ash">Mantener sesión</span>
              </label>
            </div>

            {error && (
              <div role="alert" className="mt-5 rounded-xl bg-alto/12 px-4 py-3 text-[13px] text-alto">
                {error}
              </div>
            )}
            {notice && (
              <div role="status" className="mt-5 rounded-xl bg-ash/8 px-4 py-3 text-[13px] text-ash">
                {notice}
              </div>
            )}

            <button
              type="submit"
              disabled={busy || !email || !password}
              className="mt-[26px] h-[54px] rounded-2xl bg-ember text-[15px] font-medium hover:bg-ember/85 disabled:cursor-not-allowed disabled:opacity-60"
            >
              {busy ? 'Entrando…' : mode === 'signin' ? 'Entrar' : 'Crear cuenta'}
            </button>

            <div className="mt-[30px] flex items-start gap-[11px] border-t border-ash/14 pt-[22px]">
              <span className="mt-px flex-none">
                <Icon name="lock" size={16} color="#6D7275" strokeWidth={1.3} />
              </span>
              <p className="m-0 text-xs leading-normal text-dim">
                Nunca te pedimos la llave de tu banco. La conexión se hace del lado del servidor y solo guardamos una referencia del consentimiento.
              </p>
            </div>
          </form>
        </div>
      </div>
    </div>
  );
}

function BigStat({ value, label }: { value: string; label: string }) {
  return (
    <div>
      <div className="num text-[clamp(36px,6vw,46px)] leading-none tracking-[-.04em]">{value}</div>
      <div className="mt-2 text-[12.5px] text-dim">{label}</div>
    </div>
  );
}
