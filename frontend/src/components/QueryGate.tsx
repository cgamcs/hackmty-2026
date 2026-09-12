import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useDashboard } from '@/api/hooks';
import type { DashboardData } from '@/types';

/** Loading, error and first-run empty states shared by every data view. */
export function QueryGate({ children }: { children: (data: DashboardData) => ReactNode }) {
  const { data, isPending, isError, error, refetch } = useDashboard();

  if (isPending) {
    return (
      <div aria-busy="true" className="grid gap-[18px] lg:grid-cols-3">
        <span className="sr-only">Cargando tu tablero…</span>
        {[0, 1, 2].map((i) => (
          <div key={i} className="card h-[268px] animate-pulse" />
        ))}
      </div>
    );
  }

  if (isError) {
    return (
      <div role="alert" className="card flex flex-col items-start gap-4 p-8">
        <div className="text-lg font-medium">No pudimos cargar tus datos</div>
        <p className="text-[13.5px] text-dim">{error.message} Tu información está a salvo; intenta de nuevo en un momento.</p>
        <button type="button" onClick={() => refetch()} className="h-11 rounded-full bg-ember px-[22px] text-[13.5px] font-medium">
          Reintentar
        </button>
      </div>
    );
  }

  if (!data) {
    // First-run gate (CONCEPT §6): nothing to show until CFDI + bank are connected.
    return (
      <div className="card flex flex-col items-start gap-5 p-10">
        <div className="eyebrow">Primer paso</div>
        <h2 className="m-0 text-[34px] font-normal tracking-[-.03em]">Conecta tu negocio</h2>
        <p className="max-w-[560px] text-[15px] leading-relaxed text-ash">
          Sube tus CFDI y conecta tu cuenta operativa. Con eso proyectamos tus próximos 30 días y te avisamos si la nómina está en riesgo.
        </p>
        <Link to="/settings/cfdi" className="flex h-11 items-center rounded-full bg-ember px-[22px] text-[13.5px] font-medium">
          Subir CFDI y conectar banco
        </Link>
      </div>
    );
  }

  return <>{children(data)}</>;
}
