import { useState, useMemo } from 'react';
import type { DashboardData, ForecastPoint, Breach, GapKind, RiskLevel } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { GapChip, Icon, RISK_STYLE } from '@/components/ui';
import { ForecastChart } from '@/components/charts/ForecastChart';
import { mxn, compact, shortDate } from '@/lib/format';
import { detectBreach, classifyGap, riskLevel } from '@/mock/engine';

// ─── Types ───────────────────────────────────────────────────────────

interface StressParams {
  incomePct: number;
  expensePct: number;
  dsoDays: number;
  bufferMod: number;
}

interface StressResult {
  forecast: ForecastPoint[];
  breach: Breach | null;
  gap: GapKind;
  risk: RiskLevel;
  buffer: number;
}

// ─── Presets ─────────────────────────────────────────────────────────

const PRESETS: { label: string; params: StressParams }[] = [
  { label: 'Normal',            params: { incomePct: 0,   expensePct: 0,  dsoDays: 0,  bufferMod: 0 } },
  { label: 'Mes flojo',         params: { incomePct: -20, expensePct: 0,  dsoDays: 0,  bufferMod: 0 } },
  { label: 'Choque de costos',  params: { incomePct: 0,   expensePct: 25, dsoDays: 0,  bufferMod: 0 } },
  { label: 'Retraso cobranza',  params: { incomePct: 0,   expensePct: 0,  dsoDays: 15, bufferMod: 0 } },
];

// ─── Engine ──────────────────────────────────────────────────────────

function applyStress(d: DashboardData, p: StressParams): StressResult {
  const incomeMultiplier = 1 + p.incomePct / 100;
  const dailyExpenseExtra = (d.expense30.total * (p.expensePct / 100)) / 30;

  const forecast: ForecastPoint[] = d.forecast.map((pt) => ({
    ...pt,
    expected: Math.max(0, pt.expected * incomeMultiplier - dailyExpenseExtra),
    pessimistic: Math.max(0, pt.pessimistic * incomeMultiplier - dailyExpenseExtra),
  }));

  const buffer = Math.max(0, d.bufferAvailable + p.bufferMod);
  const breach = detectBreach(forecast, d.payables, d.today);
  const gap = classifyGap(forecast, breach);
  const { risk } = riskLevel(gap, breach?.shortfall ?? 0, d.income30.total * incomeMultiplier);

  return { forecast, breach, gap, risk, buffer };
}

// ─── Page ────────────────────────────────────────────────────────────

export default function StressLab() {
  return <QueryGate>{(d) => <StressLabView d={d} />}</QueryGate>;
}

function StressLabView({ d }: { d: DashboardData }) {
  const [params, setParams] = useState<StressParams>(PRESETS[0].params);
  const [activePreset, setActivePreset] = useState(0);

  function applyPreset(i: number) {
    setActivePreset(i);
    setParams(PRESETS[i].params);
  }

  function updateParam<K extends keyof StressParams>(key: K, value: StressParams[K]) {
    setActivePreset(-1);
    setParams((prev) => ({ ...prev, [key]: value }));
  }

  const result = useMemo(() => applyStress(d, params), [d, params]);
  const baseRisk = RISK_STYLE[d.risk];
  const stressRisk = RISK_STYLE[result.risk];
  const payrollFloor = Math.min(...d.payables.filter((p) => p.kind === 'PAYROLL').map((p) => p.amount));
  const minPessimistic = Math.min(...result.forecast.map((p) => p.pessimistic));
  const isNormal = activePreset === 0;

  return (
    <>
      {/* Header */}
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <div className="eyebrow mb-3">Stress Lab · simulación</div>
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">
            Pon a prueba tu flujo
          </h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">
            Ajusta ingresos, gastos y retrasos para ver cuánto aguanta tu negocio antes de no cubrir una obligación.
          </p>
        </div>

        <div className="flex items-center gap-5">
          <div className="text-right">
            <div className="eyebrow !text-[10px] !tracking-[.12em] mb-1.5">Riesgo base</div>
            <div className="text-[15px] font-semibold tracking-[.06em]" style={{ color: baseRisk.color }}>
              {baseRisk.label}
            </div>
          </div>
          <div className="text-dim text-lg">→</div>
          <div
            className="flex h-[72px] items-center gap-3.5 rounded-full border px-6"
            style={{ background: stressRisk.bg, borderColor: stressRisk.border }}
            role="status"
          >
            <div>
              <div className="eyebrow !text-[10px]">Bajo estrés</div>
              <div
                className={`text-[26px] font-semibold leading-[1.15] tracking-[.06em] ${result.risk === 'CRITICO' ? 'crit-pulse' : ''}`}
                style={{ color: stressRisk.color }}
              >
                {stressRisk.label}
              </div>
            </div>
            <div className="h-10 w-px bg-ash/16" />
            <GapChip gap={result.gap} />
          </div>
        </div>
      </section>

      {/* Main grid */}
      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[360px_1fr]">

        {/* ─── Controls ─── */}
        <article className="card flex flex-col gap-6 p-7">
          <div>
            <div className="eyebrow mb-3">Escenarios rápidos</div>
            <div className="flex flex-wrap gap-2">
              {PRESETS.map((p, i) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => applyPreset(i)}
                  className={`h-8 rounded-full px-[14px] text-[12px] transition-colors ${
                    activePreset === i
                      ? 'bg-ember text-ghost'
                      : 'border border-ash/20 text-dim hover:text-ghost hover:bg-ash/8'
                  }`}
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          <div className="h-px bg-ash/14" />

          <SliderRow
            label="Variación de ingresos"
            value={params.incomePct}
            min={-40} max={20} step={5}
            format={(v) => `${v >= 0 ? '+' : ''}${v}%`}
            positiveIsGood
            onChange={(v) => updateParam('incomePct', v)}
          />
          <SliderRow
            label="Variación de gastos"
            value={params.expensePct}
            min={-20} max={40} step={5}
            format={(v) => `${v >= 0 ? '+' : ''}${v}%`}
            positiveIsGood={false}
            onChange={(v) => updateParam('expensePct', v)}
          />
          <SliderRow
            label="Retraso en cobranza"
            value={params.dsoDays}
            min={0} max={30} step={5}
            format={(v) => `+${v} días`}
            positiveIsGood={false}
            onChange={(v) => updateParam('dsoDays', v)}
          />
          <SliderRow
            label="Buffer de caja"
            value={d.bufferAvailable + params.bufferMod}
            min={0} max={(d.bufferAvailable || 50000) * 2} step={5000}
            format={(v) => compact(v)}
            positiveIsGood
            onChange={(v) => updateParam('bufferMod', v - d.bufferAvailable)}
          />

          {!isNormal && (
            <button
              type="button"
              onClick={() => applyPreset(0)}
              className="flex items-center gap-1.5 text-[11.5px] text-dim hover:text-ghost"
            >
              <Icon name="close" size={10} color="currentColor" strokeWidth={1.5} />
              Restaurar valores base
            </button>
          )}
        </article>

        {/* ─── Results ─── */}
        <div className="flex flex-col gap-4 sm:gap-[18px]">

          {/* KPIs */}
          <div className="grid grid-cols-3 gap-4 sm:gap-[18px]">
            <KpiCard
              eyebrow="Días al incumplimiento"
              value={result.breach ? String(result.breach.daysUntil) : '—'}
              sub={result.breach ? shortDate(result.breach.date) : 'sin brecha'}
              color={result.breach ? '#EF4444' : '#22C55E'}
            />
            <KpiCard
              eyebrow="Mínimo pesimista"
              value={compact(minPessimistic)}
              sub="balance proyectado"
              color={result.breach ? '#EF4444' : '#22C55E'}
            />
            <KpiCard
              eyebrow="Faltante máximo"
              value={result.breach ? compact(result.breach.shortfall) : '—'}
              sub={result.breach ? result.breach.obligation.payee : 'sin brecha'}
              color={result.breach ? '#EF4444' : '#6D7275'}
            />
          </div>

          {/* Chart */}
          <article
            className="card flex flex-col px-4 pb-[22px] pt-[26px] sm:px-[30px]"
            style={{ height: 'clamp(240px, 35vw, 400px)' }}
          >
            <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
              <h2 className="m-0 text-[17px] font-medium">Balance proyectado bajo estrés</h2>
              <div className="flex items-center gap-[18px] text-[11.5px] text-dim">
                <span className="flex items-center gap-[7px]">
                  <span className="h-[2.5px] w-4 rounded-sm bg-ember" />Esperado
                </span>
                <span className="flex items-center gap-[7px]">
                  <span className="h-[2.5px] w-4 rounded-sm bg-alto" />Pesimista p20
                </span>
              </div>
            </div>
            <div className="min-h-0 flex-1">
              <ForecastChart data={result.forecast} breach={result.breach} payrollFloor={payrollFloor} />
            </div>
          </article>

          {/* Breach alert */}
          {result.breach ? (
            <article className="card-alert flex flex-col gap-4 p-6">
              <div className="eyebrow">Obligación descubierta bajo este escenario</div>
              <div className="text-[20px] font-medium">{result.breach.obligation.payee}</div>
              <div className="flex flex-wrap gap-6">
                <StatPair label="Monto" value={mxn(result.breach.obligation.amount)} />
                <StatPair label="Vence" value={shortDate(result.breach.date)} />
                <StatPair label="Balance disponible" value={mxn(result.breach.balance)} />
                <StatPair label="Faltante" value={mxn(result.breach.shortfall)} color="#EF4444" />
              </div>
            </article>
          ) : (
            <article className="card flex items-center gap-4 px-6 py-5">
              <span className="grid size-9 flex-none place-items-center rounded-full bg-bajo/16">
                <Icon name="check" size={14} color="#22C55E" strokeWidth={1.8} />
              </span>
              <div>
                <div className="text-[14px] font-medium text-bajo">Sin incumplimiento bajo este escenario</div>
                <div className="text-[12.5px] text-dim mt-0.5">
                  El balance pesimista cubre todas las obligaciones en el horizonte de 30 días.
                </div>
              </div>
            </article>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function SliderRow({
  label, value, min, max, step, format, positiveIsGood, onChange,
}: {
  label: string; value: number; min: number; max: number; step: number;
  format: (v: number) => string; positiveIsGood: boolean;
  onChange: (v: number) => void;
}) {
  const isPositive = value > 0;
  const isNegative = value < 0;
  const color = isPositive
    ? positiveIsGood ? '#22C55E' : '#EF4444'
    : isNegative
    ? positiveIsGood ? '#EF4444' : '#22C55E'
    : '#ECEBF3';

  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <div className="eyebrow">{label}</div>
        <div className="num text-[16px] font-medium" style={{ color }}>{format(value)}</div>
      </div>
      <input
        type="range"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full cursor-pointer"
        style={{ accentColor: '#C20114' }}
      />
      <div className="flex justify-between font-mono text-[10px] text-dim/60">
        <span>{format(min)}</span>
        <span>{format(max)}</span>
      </div>
    </div>
  );
}

function KpiCard({ eyebrow, value, sub, color }: { eyebrow: string; value: string; sub: string; color: string }) {
  return (
    <article className="card flex flex-col p-5">
      <div className="eyebrow mb-3">{eyebrow}</div>
      <div className="num text-[28px] leading-none tracking-[-.03em]" style={{ color }}>{value}</div>
      <div className="mt-2 text-[11.5px] text-dim truncate">{sub}</div>
    </article>
  );
}

function StatPair({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div className="eyebrow mb-1">{label}</div>
      <div className="num text-[18px]" style={{ color }}>{value}</div>
    </div>
  );
}
