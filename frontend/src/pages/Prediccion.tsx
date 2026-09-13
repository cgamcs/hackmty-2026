import { useNavigate } from 'react-router-dom';
import type { DashboardData } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { ArrowLink, Icon, RISK_STYLE, SegmentedRange } from '@/components/ui';
import { AnimatedNumber } from '@/components/animate';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { mxn, shortDate } from '@/lib/format';

export default function Prediccion() {
  return <QueryGate>{(d) => <PrediccionView d={d} />}</QueryGate>;
}

interface HorizonEvent {
  id: string;
  date: string;
  label: string;
  amount: number;
  type: 'RÍGIDO' | 'HOLGURA' | 'PPD' | 'BREACH';
  balance: number;
}

function buildEvents(d: DashboardData): HorizonEvent[] {
  const pessimistic = new Map(d.forecast.map((p) => [p.date, p.pessimistic]));
  const start = d.forecast[0].date;
  const end = d.forecast[d.forecast.length - 1].date;
  const inHorizon = (date: string) => date >= start && date <= end;

  const events: HorizonEvent[] = [
    ...d.payables.filter((p) => inHorizon(p.dueDate)).map((p) => ({
      id: p.id,
      date: p.dueDate,
      label: p.payee,
      amount: -p.amount,
      type: d.breach?.obligation.id === p.id ? ('BREACH' as const) : p.rigidity === 'hard' ? ('RÍGIDO' as const) : ('HOLGURA' as const),
      balance: pessimistic.get(p.dueDate) ?? 0,
    })),
    ...d.receivables.filter((r) => inHorizon(r.dueDate)).map((r) => ({
      id: r.id,
      date: r.dueDate,
      label: `Cobranza ${r.client} · ${r.folio}`,
      amount: r.amount,
      type: 'PPD' as const,
      balance: pessimistic.get(r.dueDate) ?? 0,
    })),
  ];
  return events.sort((a, b) => a.date.localeCompare(b.date) || (a.type === 'BREACH' ? -1 : b.type === 'BREACH' ? 1 : 0));
}

function PrediccionView({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const risk = RISK_STYLE[d.risk];
  const events = buildEvents(d);
  const payrollFloor = Math.min(...d.payables.filter((p) => p.kind === 'PAYROLL').map((p) => p.amount));
  const start = d.forecast[0].date;
  const end = d.forecast[d.forecast.length - 1].date;
  const cols = 'grid grid-cols-[78px_1.6fr_1fr_.9fr_1fr] gap-3.5';

  const gapNote =
    d.gap === 'NONE'
      ? 'Sin brecha en el horizonte'
      : d.gap === 'STRUCTURAL'
        ? 'DÉFICIT ESTRUCTURAL · las salidas superan las entradas'
        : `TIMING GAP · faltante ${Math.round(d.residualPct * 100)}% del ingreso mensual`;

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">Predicción a 30 días</h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">
            Curva esperada contra banda pesimista p20 · obligaciones exactas de Nessie bills + CFDI · {shortDate(start)} — {shortDate(end)}{' '}
            {end.slice(0, 4)}
          </p>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-center gap-4">
          <div className="text-right">
            <div className="num text-[42px] leading-none tracking-[-.035em]">
              {d.breach ? <AnimatedNumber value={d.breach.daysUntil} format={(v) => String(Math.round(v))} /> : '—'}
            </div>
            <div className="mt-1.5 text-xs text-dim">días al incumplimiento</div>
          </div>
          <div className="h-[52px] w-px bg-ash/16" />
          <div
            className="flex h-[72px] items-center gap-3.5 rounded-full border px-6"
            style={{ background: risk.bg, borderColor: risk.border }}
            role="status"
            aria-label={`Nivel de riesgo ${risk.label}`}
          >
            <div>
              <div className="eyebrow !text-[10px]">Nivel de riesgo</div>
              <div className={`text-[26px] font-semibold leading-[1.15] tracking-[.06em] ${d.risk === 'CRITICO' ? 'crit-pulse' : ''}`} style={{ color: risk.color }}>
                {risk.label}
              </div>
            </div>
            <div className="h-10 w-px bg-ash/16" />
            <div className="max-w-[160px] text-xs leading-[1.35] text-ash">{gapNote}</div>
          </div>
        </div>
      </section>

      {/* hero chart */}
      <section className="card flex flex-col px-4 pb-[22px] pt-[26px] sm:px-[30px]" style={{ height: 'clamp(260px, 40vw, 460px)' }}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="m-0 text-[19px] font-medium">Balance proyectado</h2>
            <div className="mt-2.5 flex items-baseline gap-3">
              <div className="num text-[40px] leading-none tracking-[-.035em]">
                <AnimatedNumber value={d.breach?.balance ?? Math.min(...d.forecast.map((p) => p.pessimistic))} format={mxn} />
              </div>
              <div className="text-[13px] text-dim">mínimo pesimista{d.breach ? ` · ${shortDate(d.breach.date)}` : ''}</div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-5">
            <div className="flex flex-wrap items-center gap-[18px] text-[11.5px] text-dim">
              <span className="flex items-center gap-[7px]"><span className="h-[2.5px] w-4 rounded-sm bg-ember" />Esperado</span>
              <span className="flex items-center gap-[7px]"><span className="h-[2.5px] w-4 rounded-sm bg-alto" />Pesimista p20</span>
              <span className="flex items-center gap-[7px]"><span className="w-4 border-t-[1.5px] border-dashed border-ash/55" />Piso de nómina</span>
            </div>
            <SegmentedRange
              compact
              options={[{ value: 30, label: '30 d' }, { value: 60, label: '60 d' }, { value: 90, label: '90 d' }]}
              value={30}
              onChange={() => undefined}
              disabled={[60, 90]}
              activeClass="bg-ember font-medium text-ghost"
            />
          </div>
        </div>
        <div className="mt-5 min-h-0 flex-1">
          <ForecastChart data={d.forecast} breach={d.breach} payrollFloor={payrollFloor} />
        </div>
      </section>

      {/* bottom row */}
      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[1.75fr_1fr]">
        <article className="card flex min-w-0 flex-col px-6 py-[22px]">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[17px] font-medium">Eventos del horizonte</h2>
            <div className="flex items-center gap-2.5">
              <span className="flex items-center gap-[7px] text-[11.5px] text-dim">
                <span className="size-2 rounded-[2px] bg-ember/55" />
                Provoca la caída
              </span>
              <span className="eyebrow tracking-[.1em]">{events.length} eventos</span>
            </div>
          </div>
          <div className="overflow-x-auto">
            <div className="min-w-[620px]" role="table" aria-label="Eventos del horizonte">
              <div role="row" className={`${cols} eyebrow border-b border-ash/16 px-1 pb-2.5 pt-3.5 !text-[10px] !tracking-[.12em]`}>
                <div role="columnheader">Fecha</div>
                <div role="columnheader">Concepto</div>
                <div role="columnheader" className="text-right">Monto</div>
                <div role="columnheader">Tipo</div>
                <div role="columnheader" className="text-right">Balance p20</div>
              </div>
              {events.map((e) =>
                e.type === 'BREACH' ? (
                  <div role="row" key={e.id} className={`${cols} -mx-2.5 my-0.5 items-center rounded-[14px] border border-ember/32 bg-ember/12 px-3.5 py-2.5`}>
                    <div role="cell" className="font-mono text-[11.5px]">{shortDate(e.date)}</div>
                    <div role="cell" className="text-[13px] font-semibold">{e.label}</div>
                    <div role="cell" className="num text-right text-[13px] font-semibold">{mxn(e.amount)}</div>
                    <div role="cell" className="font-mono text-[10px] tracking-[.06em] text-alto">BREACH</div>
                    <div role="cell" className="num text-right text-[13px] font-semibold text-alto">{mxn(e.balance)}</div>
                  </div>
                ) : (
                  <div role="row" key={e.id} className={`${cols} row-hover items-center border-b border-ash/7 px-1 py-[9px] last:border-b-0`}>
                    <div role="cell" className="font-mono text-[11.5px] text-ash">{shortDate(e.date)}</div>
                    <div role="cell" className="text-[13px]">{e.label}</div>
                    <div role="cell" className={`num text-right text-[13px] ${e.amount > 0 ? 'text-bajo' : ''}`}>{mxn(e.amount, true)}</div>
                    <div role="cell" className="font-mono text-[10px] tracking-[.06em] text-dim">{e.type}</div>
                    <div role="cell" className="num text-right text-[13px]">{mxn(e.balance)}</div>
                  </div>
                ),
              )}
            </div>
          </div>
        </article>

        <CreditCard d={d} onSimulate={() => navigate('/recovery')} />
      </section>
    </>
  );
}

function CreditCard({ d, onSimulate }: { d: DashboardData; onSimulate: () => void }) {
  const { breach, ladder } = d;
  const applied = ladder.steps.filter((s) => s.applied && s.rung !== 'CREDIT');

  let message: string;
  if (!breach) message = 'No hay brecha en 30 días. No necesitas financiamiento.';
  else if (ladder.creditDeclined) message = 'Déficit estructural: pedir crédito empeora el balance del horizonte. Primero reestructura costos.';
  else if (ladder.residual > 0) message = `Tras los peldaños 1–3 quedan ${mxn(ladder.residual)}. Compara ofertas de crédito puente en Funding.`;
  else message = `La brecha del ${shortDate(breach.date)} se cierra ${applied.map((s) => s.phrase).join(' y ')}. El crédito queda como último peldaño.`;

  return (
    <article className="card-ink flex flex-col p-6">
      <div className="flex items-center justify-between">
        <h2 className="m-0 text-[17px] font-medium">¿Necesita crédito?</h2>
        <ArrowLink to={ladder.residual > 0 ? '/funding' : '/recovery'} label="Abrir escalera" solid />
      </div>
      <p className="m-0 mt-3 text-[13px] leading-normal text-ash">{message}</p>
      {breach && (
        <div className="mt-4 flex flex-1 flex-col justify-end gap-[11px]">
          {ladder.steps.map((s) => {
            const isCredit = s.rung === 'CREDIT';
            if (!isCredit && !s.available) return null;
            return (
              <div key={s.rung} className="flex items-center gap-[11px]">
                <span className={`grid size-[22px] flex-none place-items-center rounded-full ${s.applied ? 'bg-bajo/18' : 'bg-dim/22'}`}>
                  <Icon name={s.applied ? 'check' : 'minus'} size={11} color={s.applied ? '#22C55E' : '#6D7275'} strokeWidth={1.8} />
                </span>
                <div className={`flex-1 text-[12.5px] ${s.applied ? '' : 'text-dim'}`}>
                  {s.title}
                  {!s.applied && !isCredit ? ' · disponible' : ''}
                </div>
                <div className={`num text-[12.5px] ${s.applied ? '' : 'text-dim'}`}>{isCredit ? mxn(s.closes) : mxn(s.closes, true)}</div>
              </div>
            );
          })}
          <div className="mt-1.5 flex items-end justify-between border-t border-ash/13 pt-3.5">
            <div>
              <div className="eyebrow !text-[10px] !tracking-[.12em]">Mínimo ajustado</div>
              <div className={`num mt-1 text-[28px] ${ladder.creditDeclined ? 'text-critico' : 'text-bajo'}`}><AnimatedNumber value={ladder.adjustedMin ?? 0} format={mxn} /></div>
            </div>
            <button type="button" onClick={onSimulate} className="h-9 rounded-full bg-ember px-[18px] text-[12.5px] font-medium hover:bg-ember/85">
              Simular
            </button>
          </div>
        </div>
      )}
    </article>
  );
}
