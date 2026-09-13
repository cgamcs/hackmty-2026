import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import type { DashboardData, ObligationKind } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { ArrowLink, GapChip, Icon, Meter, SegmentedRange, scoreColor } from '@/components/ui';
import { CashFlowBars } from '@/components/charts/CashFlowBars';
import { compact, mxn, paddedDate, shortDate } from '@/lib/format';
import { useSession, type Range } from '@/store/session';

const RANGES: { value: Range; label: string }[] = [
  { value: 30, label: '30 d' },
  { value: 60, label: '60 d' },
  { value: 90, label: '90 d' },
];

export default function MiNegocio() {
  return <QueryGate>{(d) => <MiNegocioView d={d} />}</QueryGate>;
}

function MiNegocioView({ d }: { d: DashboardData }) {
  const range = useSession((s) => s.range);
  const setRange = useSession((s) => s.setRange);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const net30 = d.income30.total - d.expense30.total;
  const netFlow = d.cashflow.reduce((sum, f) => sum + f.inflow - f.outflow, 0);
  const agingTotal = d.cfdi.aging.reduce((s, b) => s + b.amount, 0) || 1;

  async function runForecast() {
    await queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    navigate('/forecast');
  }

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">{d.business.name}</h1>
          <div className="mt-[18px] flex flex-wrap items-center gap-3.5">
            <span className="font-mono text-[11.5px] text-dim">
              {d.business.rfc} · cuenta {d.account.id.slice(0, 8)} · {d.account.bank}
            </span>
            {d.account.live && (
              <span className="flex h-[30px] items-center gap-[7px] rounded-full bg-bajo/14 px-[13px] text-[11.5px] text-bajo">
                <span className="size-1.5 rounded-full bg-bajo" />
                Nessie live
              </span>
            )}
            <GapChip gap={d.gap} />
          </div>
        </div>
        <div className="flex flex-none items-center gap-3.5">
          <SegmentedRange options={RANGES} value={range} onChange={setRange} disabled={[60, 90]} />
          <button type="button" onClick={runForecast} className="h-11 whitespace-nowrap rounded-full bg-ember px-[22px] text-[13.5px] font-medium hover:bg-ember/85">
            Correr forecast
          </button>
        </div>
      </section>

      <section className="grid gap-4 sm:gap-[18px] md:grid-cols-2 xl:grid-cols-[1.05fr_1.25fr_1fr_1.05fr]">
        {/* balance */}
        <article className="card-raised flex flex-col justify-between p-[26px]">
          <div className="flex items-start justify-between">
            <div className="eyebrow">Balance actual</div>
            <ArrowLink to="/forecast" label="Ver proyección" />
          </div>
          <div className="mt-[18px]">
            <div className="num text-[44px] leading-none tracking-[-.035em]">{mxn(d.account.balance)}</div>
            <div className="mt-[9px] text-[12.5px] text-dim">MXN · {d.account.balanceAt}</div>
          </div>
          <div className="mt-[22px] flex gap-[30px] border-t border-ash/14 pt-[18px]">
            <MiniStat label="Health" value={String(d.healthScore)} color={scoreColor(d.healthScore)} />
            <MiniStat label="Resilience" value={String(d.resilienceScore)} color={scoreColor(d.resilienceScore)} />
            <MiniStat label="Neto 30 d" value={compact(net30, { currency: false, signed: true })} color={net30 >= 0 ? '#22C55E' : '#EF4444'} />
          </div>
        </article>

        {/* cash flow */}
        <article className="card flex min-h-[300px] flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h2 className="m-0 text-[17px] font-medium">Flujo de caja</h2>
              <div className="mt-2.5 flex items-baseline gap-2.5">
                <div className="num text-[34px] leading-none tracking-[-.03em]">{compact(netFlow)}</div>
                <div className="text-[12.5px] leading-[1.3] text-dim">
                  neto
                  <br />
                  {d.cashflow.length} días
                </div>
              </div>
            </div>
            <div className="flex items-center gap-3.5 text-[11.5px] text-dim">
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-ember" />Entradas</span>
              <span className="flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-dim" />Salidas</span>
            </div>
          </div>
          <CashFlowBars data={d.cashflow} />
        </article>

        {/* ingresos / gastos */}
        <article className="card flex flex-col gap-[18px] p-6">
          <div>
            <div className="flex items-center justify-between">
              <div className="eyebrow">Ingresos · 30 d</div>
              <Delta pct={d.income30.changePct} goodWhenUp />
            </div>
            <div className="num mt-2 text-[32px] tracking-[-.03em]">{mxn(d.income30.total)}</div>
            <div className="mt-3 flex h-2 overflow-hidden rounded-full" aria-hidden="true">
              <div className="bg-ember" style={{ width: `${(d.income30.cash / d.income30.total) * 100}%` }} />
              <div className="flex-1 bg-dim/60" />
            </div>
            <div className="mt-[9px] flex justify-between text-[11.5px] text-dim">
              <span>Contado {compact(d.income30.cash)}</span>
              <span>Cobranza CFDI {compact(d.income30.cfdi)}</span>
            </div>
          </div>
          <div className="h-px bg-ash/14" />
          <div>
            <div className="flex items-center justify-between">
              <div className="eyebrow">Gastos · 30 d</div>
              <Delta pct={d.expense30.changePct} />
            </div>
            <div className="num mt-2 text-[32px] tracking-[-.03em]">{mxn(d.expense30.total)}</div>
            <div className="mt-3.5 flex flex-col gap-2">
              {d.expense30.lines.map((l) => (
                <div key={l.label} className="flex justify-between text-[12.5px]">
                  <span className="text-ash">{l.label}</span>
                  <span className="num">{mxn(l.amount)}</span>
                </div>
              ))}
            </div>
          </div>
        </article>

        {/* CFDI */}
        <article className="card flex flex-col p-6">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[17px] font-medium">Resumen CFDI</h2>
            <span className="eyebrow tracking-[.1em]">PPD abiertos</span>
          </div>
          <div className="mt-4 flex gap-7">
            <CfdiTotal label="Emitidos sin cobrar" total={d.cfdi.receivableTotal} count={d.cfdi.receivableCount} />
            <CfdiTotal label="Recibidos sin pagar" total={d.cfdi.payableTotal} count={d.cfdi.payableCount} />
          </div>
          <div className="mt-[18px] flex flex-1 flex-col justify-center gap-[11px] border-t border-ash/14 pt-4">
            <div className="eyebrow !text-[10px] !tracking-[.12em]">Antigüedad de cobranza</div>
            {d.cfdi.aging.map((b, i) => (
              <div key={b.label} className="flex items-center gap-[11px]">
                <div className="w-12 flex-none font-mono text-[10.5px] text-dim">{b.label}</div>
                <Meter pct={(b.amount / agingTotal) * 100} height={8} color={i === 0 ? '#C20114' : i === d.cfdi.aging.length - 1 ? '#EF4444' : 'rgba(109,114,117,0.85)'} />
                <div className="num w-[70px] flex-none text-right text-xs">{compact(b.amount)}</div>
              </div>
            ))}
          </div>
        </article>

        {/* movimientos */}
        <article className="card-quiet flex flex-col px-[26px] py-6 md:col-span-2 xl:col-span-3">
          <div className="flex items-center justify-between">
            <h2 className="m-0 text-[17px] font-medium">Movimientos bancarios</h2>
            <div className="flex items-center gap-2.5">
              <span className="eyebrow tracking-[.1em]">{d.movementsCount} · Nessie</span>
              <button type="button" className="flex h-[30px] items-center rounded-full border border-ash/20 px-3.5 text-xs hover:bg-ash/8">
                Ver todos
              </button>
            </div>
          </div>
          <ul className="m-0 mt-2 grid list-none gap-x-8 p-0 md:grid-cols-2">
            {d.movements.map((m, i) => {
              const inflow = m.amount > 0;
              const lastRow = i >= d.movements.length - 2;
              return (
                <li key={m.id} className={`flex items-center gap-[13px] py-[11px] ${lastRow ? '' : 'border-b border-ash/9'}`}>
                  <span className={`grid size-[30px] flex-none place-items-center rounded-full ${inflow ? 'bg-ember/18' : 'bg-dim/26'}`}>
                    <Icon name={inflow ? 'arrowUp' : 'arrowDown'} size={11} color={inflow ? '#C20114' : '#C7D6D5'} strokeWidth={1.6} />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{m.description}</div>
                    <div className="mt-0.5 font-mono text-[10px] text-dim">
                      {paddedDate(m.date)} · {m.type}
                      {m.cfdi ? ` · CFDI ${m.cfdi}` : ''}
                    </div>
                  </div>
                  <div className={`num text-[13px] ${inflow ? '' : 'text-ash'}`}>{mxn(m.amount, true)}</div>
                </li>
              );
            })}
          </ul>
        </article>

        {/* obligaciones */}
        <article className="card-ink flex flex-col px-6 py-[22px] md:col-span-2 xl:col-span-1">
          <div className="flex items-baseline justify-between">
            <h2 className="m-0 text-[17px] font-medium">Obligaciones</h2>
            <div className="num text-[22px]">
              {d.settled.length}
              <span className="text-dim">/{d.settled.length + d.payables.length}</span>
            </div>
          </div>
          <ul className="m-0 mt-3.5 flex list-none flex-col p-0">
            {d.settled.map((s) => (
              <li key={s.id} className="flex items-center gap-3 py-2.5">
                <KindIcon kind={s.kind} />
                <div className="min-w-0 flex-1">
                  <div className="text-[12.5px] text-dim line-through">{s.payee}</div>
                  <div className="mt-0.5 font-mono text-[10px] text-dim">
                    {paddedDate(s.date)} · {mxn(s.amount)}
                  </div>
                </div>
                <svg width="18" height="18" viewBox="0 0 18 18" fill="none" aria-label="Pagada">
                  <circle cx="9" cy="9" r="8" fill="rgba(34,197,94,0.18)" />
                  <polyline points="5.5,9.2 8,11.5 12.5,6.5" stroke="#22C55E" strokeWidth="1.6" fill="none" />
                </svg>
              </li>
            ))}
            {d.payables
              .filter((p) => p.rigidity === 'hard' || p.dueDate === d.breach?.date)
              .sort((a, b) => a.dueDate.localeCompare(b.dueDate))
              .slice(0, 4)
              .map((p) => {
                const isBreach = d.breach?.obligation.id === p.id;
                return (
                  <li key={p.id} className="flex items-center gap-3 py-2.5">
                    <KindIcon kind={p.kind} alert={p.kind === 'TAXES' || isBreach} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[12.5px]">{p.payee}</div>
                      <div className={`mt-0.5 font-mono text-[10px] ${isBreach ? 'text-alto' : 'text-dim'}`}>
                        {paddedDate(p.dueDate)} · {mxn(p.amount)} · {isBreach ? 'descubierta' : p.rigidity === 'hard' ? 'rígido' : 'con holgura'}
                      </div>
                    </div>
                    <span className="size-[11px] rounded-full border-[1.5px] border-ash/30" aria-label="Pendiente" />
                  </li>
                );
              })}
          </ul>
          {d.breach && (
            <div className="mt-auto pt-3 text-[11.5px] text-dim">
              Próximo riesgo: {shortDate(d.breach.date)} · faltante {mxn(d.breach.shortfall)}
            </div>
          )}
        </article>
      </section>
    </>
  );
}

function MiniStat({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div>
      <div className="eyebrow !text-[10px] !tracking-[.12em]">{label}</div>
      <div className="num mt-[5px] text-[26px]" style={{ color }}>
        {value}
      </div>
    </div>
  );
}

function Delta({ pct, goodWhenUp = false }: { pct: number; goodWhenUp?: boolean }) {
  const good = goodWhenUp ? pct >= 0 : pct <= 0;
  return (
    <div className={`text-[11.5px] ${good ? 'text-bajo' : 'text-alto'}`}>
      {pct >= 0 ? '+' : '−'}
      {Math.abs(pct).toFixed(1)}%
    </div>
  );
}

function CfdiTotal({ label, total, count }: { label: string; total: number; count: number }) {
  return (
    <div>
      <div className="text-[11.5px] text-dim">{label}</div>
      <div className="num mt-[5px] text-[26px]">{mxn(total)}</div>
      <div className="mt-[3px] font-mono text-[10.5px] text-dim">{count} facturas</div>
    </div>
  );
}

function KindIcon({ kind, alert = false }: { kind: ObligationKind; alert?: boolean }) {
  const icon = kind === 'PAYROLL' ? 'calendar' : kind === 'TAXES' ? 'triangle' : kind === 'RENT' ? 'circle' : 'building';
  return (
    <span className={`grid size-[30px] flex-none place-items-center rounded-full ${alert ? 'bg-ember/20' : 'bg-dim/20'}`}>
      <Icon name={icon} size={12} color={alert ? '#C20114' : '#6D7275'} strokeWidth={1.5} />
    </span>
  );
}
