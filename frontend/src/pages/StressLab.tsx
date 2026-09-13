import { useMemo, useState } from 'react';
import { useStressSimulation } from '@/api/hooks';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { GapChip, Icon, RISK_STYLE } from '@/components/ui';
import { compact, dayDiff, mxn, shortDate } from '@/lib/format';
import type { Breach, ForecastPoint, GapKind, StressRequest } from '@/types';

interface StressParams {
  incomePct: number;
  expensePct: number;
  dsoDays: number;
  buffer: number | null;
}

const PRESETS: { label: string; params: StressParams }[] = [
  { label: 'Normal', params: { incomePct: 0, expensePct: 0, dsoDays: 0, buffer: null } },
  { label: 'Mes flojo', params: { incomePct: -20, expensePct: 0, dsoDays: 0, buffer: null } },
  { label: 'Choque de costos', params: { incomePct: 0, expensePct: 25, dsoDays: 0, buffer: null } },
  { label: 'Retraso cobranza', params: { incomePct: 0, expensePct: 0, dsoDays: 15, buffer: null } },
];

const GAP_MAP: Record<'none' | 'timing' | 'structural', GapKind> = {
  none: 'NONE',
  timing: 'TIMING',
  structural: 'STRUCTURAL',
};

export default function StressLab() {
  const [params, setParams] = useState<StressParams>(PRESETS[0].params);
  const [activePreset, setActivePreset] = useState(0);
  const request = useMemo<StressRequest>(() => ({
    income_change_pct: params.incomePct,
    variable_expense_change_pct: params.expensePct,
    receivable_delay_days: params.dsoDays,
    available_cash_buffer: params.buffer,
  }), [params]);
  const simulation = useStressSimulation(request);

  function applyPreset(index: number) {
    setActivePreset(index);
    setParams(PRESETS[index].params);
  }

  function updateParam<K extends keyof StressParams>(key: K, value: StressParams[K]) {
    setActivePreset(-1);
    setParams((previous) => ({ ...previous, [key]: value }));
  }

  if (simulation.isPending) return <LoadingState />;
  if (simulation.isError || !simulation.data) {
    return <ErrorState message={simulation.error?.message} retry={() => simulation.refetch()} />;
  }

  const { baseline, result, business } = simulation.data;
  const forecast: ForecastPoint[] = result.points.map((point) => ({
    date: point.date,
    expected: point.expected_balance,
    pessimistic: point.pessimistic_balance,
  }));
  const breach: Breach | null = result.breach ? {
    date: result.breach.date,
    obligation: {
      id: result.breach.obligation_id,
      payee: result.breach.obligation,
      reference: result.breach.obligation_id,
      kind: 'SUPPLIER',
      amount: result.breach.amount,
      dueDate: result.breach.date,
      rigidity: 'hard',
      slackDays: 0,
    },
    balance: result.breach.amount - result.breach.shortfall,
    shortfall: result.breach.shortfall,
    daysUntil: dayDiff(result.diagnostics.as_of, result.breach.date),
  } : null;
  const baseRisk = RISK_STYLE[baseline.risk_level];
  const stressRisk = RISK_STYLE[result.risk_level];
  const gap = GAP_MAP[result.gap_type];
  const buffer = params.buffer ?? simulation.data.available_cash_buffer;

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <div className="eyebrow mb-3">Stress Lab · {business.name}</div>
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">Pon a prueba tu flujo</h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">Cada cambio vuelve a ejecutar el motor con los datos actuales de Nessie y tus CFDI.</p>
        </div>
        <div className="flex items-center gap-5">
          <RiskSummary label="Riesgo base" risk={baseRisk.label} color={baseRisk.color} />
          <div className="text-lg text-dim">→</div>
          <div className="flex h-[72px] items-center gap-3.5 rounded-full border px-6" style={{ background: stressRisk.bg, borderColor: stressRisk.border }} role="status">
            <div>
              <div className="eyebrow !text-[10px]">Bajo estrés {simulation.isFetching ? '· calculando…' : ''}</div>
              <div className={`text-[26px] font-semibold leading-[1.15] tracking-[.06em] ${result.risk_level === 'CRITICO' ? 'crit-pulse' : ''}`} style={{ color: stressRisk.color }}>{stressRisk.label}</div>
            </div>
            <div className="h-10 w-px bg-ash/16" />
            <GapChip gap={gap} />
          </div>
        </div>
      </section>

      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[360px_1fr]">
        <article className="card flex flex-col gap-6 p-7">
          <div>
            <div className="eyebrow mb-3">Escenarios rápidos</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((preset, index) => (
                <button key={preset.label} type="button" onClick={() => applyPreset(index)} className={`h-8 rounded-full px-[14px] text-[12px] transition-colors ${activePreset === index ? 'bg-ember text-ghost' : 'border border-ash/20 text-dim hover:bg-ash/8 hover:text-ghost'}`}>{preset.label}</button>
              ))}
            </div>
          </div>
          <div className="h-px bg-ash/14" />
          <SliderRow label="Variación de ingresos" value={params.incomePct} min={-40} max={20} step={5} format={signedPercent} positiveIsGood onChange={(value) => updateParam('incomePct', value)} />
          <SliderRow label="Variación de gastos" value={params.expensePct} min={-20} max={40} step={5} format={signedPercent} positiveIsGood={false} onChange={(value) => updateParam('expensePct', value)} />
          <SliderRow label="Retraso en cobranza" value={params.dsoDays} min={0} max={30} step={5} format={(value) => `+${value} días`} positiveIsGood={false} onChange={(value) => updateParam('dsoDays', value)} />
          <SliderRow label="Buffer de caja" value={buffer} min={0} max={Math.max(50_000, simulation.data.available_cash_buffer * 2)} step={5000} format={(value) => compact(value)} positiveIsGood onChange={(value) => updateParam('buffer', value)} />
          {activePreset !== 0 && <button type="button" onClick={() => applyPreset(0)} className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-ghost"><Icon name="close" size={10} color="currentColor" strokeWidth={1.5} /> Restaurar valores base</button>}
        </article>

        <div className="flex flex-col gap-4 sm:gap-[18px]">
          <div className="grid grid-cols-2 gap-4 sm:gap-[18px] xl:grid-cols-4">
            <KpiCard eyebrow="Health Score" value={`${result.health_score}/100`} sub={`base ${baseline.health_score}`} color="#ECEBF3" />
            <KpiCard eyebrow="Resilience Score" value={`${result.resilience_score}/100`} sub={`base ${baseline.resilience_score}`} color="#ECEBF3" />
            <KpiCard eyebrow="Días al incumplimiento" value={breach ? String(breach.daysUntil) : '—'} sub={breach ? shortDate(breach.date) : 'sin brecha'} color={breach ? '#EF4444' : '#22C55E'} />
            <KpiCard eyebrow="Peor saldo pesimista" value={compact(result.diagnostics.minimum_pessimistic_balance)} sub="en los próximos 30 días" color={breach ? '#EF4444' : '#22C55E'} />
          </div>

          <article className="card flex h-[clamp(260px,35vw,410px)] flex-col px-4 pb-[22px] pt-[26px] sm:px-[30px]">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <h2 className="m-0 text-[17px] font-medium">Balance proyectado bajo estrés</h2>
                {simulation.isFetching && (
                  <span className="flex items-center gap-1.5 rounded-full bg-ember/12 px-2.5 py-1 text-[10.5px] font-medium text-ember">
                    <span className="size-1.5 animate-pulse rounded-full bg-ember" />
                    Calculando…
                  </span>
                )}
              </div>
              <div className="flex items-center gap-[18px] text-[11.5px] text-dim"><span className="flex items-center gap-[7px]"><span className="h-[2.5px] w-4 rounded-sm bg-ember" />Esperado</span><span className="flex items-center gap-[7px]"><span className="h-[2.5px] w-4 rounded-sm bg-alto" />Pesimista p20</span></div>
            </div>
            <div className={`min-h-0 flex-1 transition-opacity duration-200 ${simulation.isFetching ? 'opacity-40' : 'opacity-100'}`}><ForecastChart data={forecast} breach={breach} /></div>
          </article>

          {breach ? (
            <article className="card-alert flex flex-col gap-4 p-6">
              <div className="eyebrow">Primera obligación descubierta</div>
              <div className="text-[20px] font-medium">{breach.obligation.payee}</div>
              <div className="flex flex-wrap gap-6"><StatPair label="Monto" value={mxn(breach.obligation.amount)} /><StatPair label="Vence" value={shortDate(breach.date)} /><StatPair label="Balance disponible" value={mxn(breach.balance)} /><StatPair label="Faltante" value={mxn(breach.shortfall)} color="#EF4444" /></div>
            </article>
          ) : <HealthyState />}
        </div>
      </section>

      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-2">
        <article className="card p-6">
          <div className="eyebrow mb-4">Recovery Plan</div>
          {result.recommendations.length ? <ol className="m-0 flex list-none flex-col gap-4 p-0">{result.recommendations.map((item) => <li key={`${item.rank}-${item.action}`} className="border-b border-ash/12 pb-4 last:border-0 last:pb-0"><div className="text-[14px] font-medium">{item.rank}. {item.title}</div><p className="m-0 mt-1 text-[12.5px] leading-relaxed text-dim">{item.description}</p><div className="mt-2 text-[11.5px] text-ash">Impacto {mxn(item.cash_impact)} · costo {mxn(item.estimated_cost)}</div></li>)}</ol> : <p className="m-0 text-[13px] text-dim">No se requieren acciones correctivas.</p>}
        </article>
        <article className="card p-6">
          <div className="eyebrow mb-4">Decisión de financiamiento</div>
          <div className="text-[22px] font-medium">{result.financing_decision.should_suggest ? 'Crédito puente recomendado' : 'No sugerir crédito'}</div>
          <p className="mt-3 text-[13px] leading-relaxed text-dim">{result.financing_decision.reason}</p>
          <div className="mt-6 flex flex-wrap gap-8"><StatPair label="Faltante residual" value={mxn(result.financing_decision.residual_shortfall)} /><StatPair label="Monto sugerido" value={mxn(result.financing_decision.suggested_amount)} color={result.financing_decision.should_suggest ? '#C20114' : undefined} /><StatPair label="Plazo" value={`${result.financing_decision.term_days} días`} /></div>
        </article>
      </section>
    </>
  );
}

function signedPercent(value: number) { return `${value >= 0 ? '+' : ''}${value}%`; }

function LoadingState() {
  return <div aria-busy="true" className="grid gap-[18px] lg:grid-cols-3"><span className="sr-only">Ejecutando motor financiero…</span>{[0, 1, 2].map((item) => <div key={item} className="card h-[268px] animate-pulse" />)}</div>;
}

function ErrorState({ message, retry }: { message?: string; retry: () => void }) {
  return <div role="alert" className="card flex flex-col items-start gap-4 p-8"><div className="text-lg font-medium">No pudimos ejecutar el Stress Lab</div><p className="m-0 text-[13.5px] text-dim">{message ?? 'Verifica que FastAPI esté ejecutándose.'}</p><button type="button" onClick={retry} className="h-11 rounded-full bg-ember px-[22px] text-[13.5px] font-medium">Reintentar</button></div>;
}

function HealthyState() {
  return <article className="card flex items-center gap-4 px-6 py-5"><span className="grid size-9 flex-none place-items-center rounded-full bg-bajo/16"><Icon name="check" size={14} color="#22C55E" strokeWidth={1.8} /></span><div><div className="text-[14px] font-medium text-bajo">Sin incumplimiento bajo este escenario</div><div className="mt-0.5 text-[12.5px] text-dim">El balance pesimista cubre todas las obligaciones del horizonte.</div></div></article>;
}

function RiskSummary({ label, risk, color }: { label: string; risk: string; color: string }) {
  return <div className="text-right"><div className="eyebrow mb-1.5 !text-[10px] !tracking-[.12em]">{label}</div><div className="text-[15px] font-semibold tracking-[.06em]" style={{ color }}>{risk}</div></div>;
}

function SliderRow({ label, value, min, max, step, format, positiveIsGood, onChange }: { label: string; value: number; min: number; max: number; step: number; format: (value: number) => string; positiveIsGood: boolean; onChange: (value: number) => void }) {
  const color = value > 0 ? (positiveIsGood ? '#22C55E' : '#EF4444') : value < 0 ? (positiveIsGood ? '#EF4444' : '#22C55E') : '#ECEBF3';
  return <div className="flex flex-col gap-2"><div className="flex items-center justify-between"><div className="eyebrow">{label}</div><div className="num text-[16px] font-medium" style={{ color }}>{format(value)}</div></div><input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} className="w-full cursor-pointer" style={{ accentColor: '#C20114' }} /><div className="flex justify-between font-mono text-[10px] text-dim/60"><span>{format(min)}</span><span>{format(max)}</span></div></div>;
}

function KpiCard({ eyebrow, value, sub, color }: { eyebrow: string; value: string; sub: string; color: string }) {
  return <article className="card flex flex-col p-5"><div className="eyebrow mb-3">{eyebrow}</div><div className="num text-[28px] leading-none tracking-[-.03em]" style={{ color }}>{value}</div><div className="mt-2 truncate text-[11.5px] text-dim">{sub}</div></article>;
}

function StatPair({ label, value, color }: { label: string; value: string; color?: string }) {
  return <div><div className="eyebrow mb-1">{label}</div><div className="num text-[18px]" style={{ color }}>{value}</div></div>;
}
