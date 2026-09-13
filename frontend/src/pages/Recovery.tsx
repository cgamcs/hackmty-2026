import { useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { DashboardData, LadderAction, LadderRung, LadderStep, Payable, Receivable } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { Icon, Meter, RISK_STYLE } from '@/components/ui';
import { AnimatedNumber } from '@/components/animate';
import { mxn, compact, shortDate, dayDiff } from '@/lib/format';
import { isDemo } from '@/api/client';
import { useRecoveryLadder } from '@/api/hooks';
import { buildLadder } from '@/mock/engine';

// ─── Page ────────────────────────────────────────────────────────────

export default function Recovery() {
  return <QueryGate>{(d) => <RecoveryView d={d} />}</QueryGate>;
}

type OperationalRung = Exclude<LadderRung, 'CREDIT'>;
type RungState = 'applied' | 'excluded' | 'notNeeded' | 'unavailable';

const OPERATIONAL: OperationalRung[] = ['ACCELERATE', 'SHIFT', 'BUFFER'];

const DECLINED_TEXT = 'No aplica: el déficit es estructural y la escalera no puede cerrarlo.';

/**
 * The engine's recovery plan, not arithmetic redone here. With every rung on, the dashboard
 * already carries it. Switching a rung off re-runs the engine on the server: the engine stops
 * at the first rung that clears the breach, so what the later rungs would do is only known by
 * projecting again without the excluded ones.
 */
function RecoveryView({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const { breach, receivables, payables, bufferAvailable } = d;
  const [excluded, setExcluded] = useState<OperationalRung[]>([]);
  const server = useRecoveryLadder(excluded);

  const ladder =
    excluded.length === 0
      ? d.ladder
      : isDemo
        ? buildLadder(breach, d.gap, receivables, payables, bufferAvailable, excluded)
        : (server.data ?? d.ladder);
  const recalculating = excluded.length > 0 && !isDemo && server.isFetching;

  function toggle(rung: OperationalRung) {
    // Kept in ladder order so the same selection always reuses the same cached answer.
    setExcluded((prev) => OPERATIONAL.filter((r) => (r === rung ? !prev.includes(r) : prev.includes(r))));
  }

  const stepOf = (rung: LadderRung): LadderStep | undefined => ladder.steps.find((s) => s.rung === rung);

  function stateOf(rung: OperationalRung): RungState {
    if (excluded.includes(rung)) return 'excluded';
    if (stepOf(rung)?.applied) return 'applied';
    const earlier = OPERATIONAL.slice(0, OPERATIONAL.indexOf(rung));
    return earlier.some((r) => stepOf(r)?.resolves) ? 'notNeeded' : 'unavailable';
  }

  const shortfall = breach?.shortfall ?? 0;
  const residual = ladder.residual;
  const declined = ladder.creditDeclined;
  const gapClosed = residual <= 0 && !declined;
  const covered = declined ? 0 : Math.max(0, shortfall - residual);
  const coveredPct = shortfall > 0 ? Math.min(100, (covered / shortfall) * 100) : 0;
  const creditAmount = ladder.creditAmount;

  // Split what the engine covered across the rungs in the order it applied them. A rung used
  // for a later shortfall (rent after payroll) covers none of the first one.
  const inPlanOrder = [...OPERATIONAL].sort((a, b) => (stepOf(a)?.order ?? 99) - (stepOf(b)?.order ?? 99));
  let left = covered;
  const coverage = {} as Record<OperationalRung, number>;
  for (const rung of inPlanOrder) {
    const step = stepOf(rung);
    coverage[rung] = step?.applied ? Math.min(step.closes, left) : 0;
    left -= coverage[rung];
  }
  const residualAfter = (rung: OperationalRung) =>
    shortfall - inPlanOrder.slice(0, inPlanOrder.indexOf(rung) + 1).reduce((sum, r) => sum + coverage[r], 0);

  const riskStyle = RISK_STYLE[d.risk];
  const hardObs = payables.filter((p) => p.rigidity === 'hard').sort((a, b) => a.dueDate.localeCompare(b.dueDate));

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <div className="eyebrow mb-3">Recovery Path · escalera de liquidez</div>
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">
            Cierra la brecha sin deuda
          </h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">
            Adelanta cobranza, difiere pagos con holgura y usa tu colchón. La nómina y el SAT nunca se mueven.
          </p>
          {recalculating && (
            <p role="status" className="m-0 mt-2 text-[12.5px] text-dim">Recalculando la escalera con tus datos…</p>
          )}
          {server.isError && excluded.length > 0 && (
            <p role="alert" className="m-0 mt-2 text-[12.5px] text-alto">
              No pudimos recalcular la escalera: {server.error.message}
            </p>
          )}
        </div>

        {breach && (
          <div
            className="flex h-[72px] items-center gap-3.5 rounded-full border px-6"
            style={{ background: riskStyle.bg, borderColor: riskStyle.border }}
          >
            <div>
              <div className="eyebrow !text-[10px]">Brecha detectada</div>
              <div className="num text-[26px] font-semibold leading-[1.15]" style={{ color: riskStyle.color }}>
                {shortDate(breach.date)}
              </div>
            </div>
            <div className="h-10 w-px bg-ash/16" />
            <div>
              <div className="eyebrow !text-[10px]">Faltante</div>
              <div className="num text-[26px] font-semibold leading-[1.15] text-alto"><AnimatedNumber value={breach.shortfall} format={compact} /></div>
            </div>
          </div>
        )}
      </section>

      {!breach ? (
        <NoBreach onSimulate={() => navigate('/stress')} />
      ) : (
        <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[1fr_340px]">
          <div className="flex flex-col gap-4 sm:gap-[18px]">

            <RungCard
              number="1" title="Adelantar cobranza" state={stateOf('ACCELERATE')}
              onToggle={() => toggle('ACCELERATE')}
              closes={coverage.ACCELERATE} moves={stepOf('ACCELERATE')?.closes ?? 0} shortfall={shortfall}
              runningResidual={residualAfter('ACCELERATE')}
              emptyText={declined ? DECLINED_TEXT : 'No hay facturas de clientes que paguen a tiempo para cobrar antes de la brecha.'}
            >
              {stepOf('ACCELERATE')?.actions.map((action) => (
                <AccelerateDetail
                  key={action.targetId}
                  action={action}
                  receivable={receivables.find((r) => r.id === action.targetId)}
                />
              ))}
            </RungCard>

            <RungCard
              number="2" title="Diferir pagos a proveedores" state={stateOf('SHIFT')}
              onToggle={() => toggle('SHIFT')}
              closes={coverage.SHIFT} moves={stepOf('SHIFT')?.closes ?? 0} shortfall={shortfall}
              runningResidual={residualAfter('SHIFT')}
              emptyText={declined ? DECLINED_TEXT : 'No hay pagos con holgura confirmada antes de la brecha. Confírmala en Ajustes.'}
            >
              {stepOf('SHIFT')?.actions.map((action) => (
                <ShiftDetail
                  key={action.targetId}
                  action={action}
                  payable={payables.find((p) => action.targetId.startsWith(p.id))}
                />
              ))}
            </RungCard>

            <RungCard
              number="3" title="Usar colchón de efectivo" state={stateOf('BUFFER')}
              onToggle={() => toggle('BUFFER')}
              closes={coverage.BUFFER} moves={stepOf('BUFFER')?.closes ?? 0} shortfall={shortfall}
              runningResidual={residualAfter('BUFFER')}
              emptyText={
                declined ? DECLINED_TEXT : (
                  <>
                    No tienes colchón guardado.{' '}
                    <Link to="/settings" className="text-ash underline underline-offset-2">Agrégalo en Ajustes</Link>.
                  </>
                )
              }
            >
              {stepOf('BUFFER')?.actions.map((action) => (
                <div key="buffer" className="text-[12.5px] text-dim">
                  Transfiere <span className="num text-ghost">{mxn(action.amount)}</span> de tu colchón de{' '}
                  <span className="num text-ghost">{mxn(bufferAvailable)}</span>.
                </div>
              ))}
            </RungCard>

            <article className="card-quiet flex flex-col gap-4 px-6 py-5">
              <div className="flex items-center gap-2.5">
                <span className="grid size-8 flex-none place-items-center rounded-full bg-dim/20">
                  <Icon name="lock" size={11} color="#6D7275" strokeWidth={1.5} />
                </span>
                <div>
                  <div className="text-[13.5px] font-medium">Obligaciones rígidas · no se mueven</div>
                  <div className="text-[11.5px] text-dim">Nómina, SAT y renta son plazos legales o contractuales fijos.</div>
                </div>
              </div>
              <div className="flex flex-col gap-2">
                {hardObs.map((p) => (
                  <div key={p.id} className="flex items-center gap-3 border-t border-ash/8 py-1.5">
                    <div className="min-w-0 flex-1 text-[12.5px] text-dim">{p.payee}</div>
                    <div className="font-mono text-[11px] text-dim">{shortDate(p.dueDate)}</div>
                    <div className="num text-[12.5px]">{mxn(p.amount)}</div>
                  </div>
                ))}
              </div>
            </article>
          </div>

          <div className="flex flex-col gap-4 sm:gap-[18px]">
            <article className={gapClosed ? 'card flex flex-col p-6' : 'card-alert flex flex-col p-6'}>
              <div className="eyebrow mb-4">
                {declined ? 'Déficit estructural' : gapClosed ? 'Brecha cerrada' : 'Brecha parcialmente cerrada'}
              </div>
              <div className="flex flex-col gap-3">
                <ClosureRow label="Brecha total" amount={shortfall} color="#6D7275" />
                {coverage.ACCELERATE > 0 && <ClosureRow label="1 · Cobranza" amount={-coverage.ACCELERATE} color="#22C55E" />}
                {coverage.SHIFT > 0 && <ClosureRow label="2 · Diferir" amount={-coverage.SHIFT} color="#22C55E" />}
                {coverage.BUFFER > 0 && <ClosureRow label="3 · Colchón" amount={-coverage.BUFFER} color="#22C55E" />}
                <div className="my-1 h-px bg-ash/14" />
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-dim">Residual</span>
                  <span className={`num text-[22px] font-semibold ${gapClosed ? 'text-bajo' : 'text-alto'}`}>
                    {gapClosed ? '$0' : <AnimatedNumber value={residual} format={mxn} />}
                  </span>
                </div>
              </div>

              {declined ? (
                <div className="mt-5 text-[12.5px] leading-relaxed text-alto">
                  Crédito no recomendado: tus egresos superan a tus ingresos de forma sostenida y un préstamo agregaría pagos al problema.
                </div>
              ) : gapClosed ? (
                <div className="mt-5 flex items-center gap-2.5 text-[12.5px] text-bajo">
                  <Icon name="check" size={13} color="#22C55E" strokeWidth={1.8} />
                  No se necesita crédito
                </div>
              ) : (
                <div className="mt-5">
                  <div className="mb-2 text-[12px] text-dim">Crédito puente sugerido</div>
                  <div className="num text-[32px] font-semibold text-alto"><AnimatedNumber value={creditAmount} format={mxn} /></div>
                  <div className="mt-1 text-[11.5px] text-dim">faltante residual + margen de seguridad</div>
                  <button
                    type="button"
                    onClick={() => navigate(`/funding?amount=${creditAmount}`)}
                    className="mt-4 h-9 w-full rounded-full bg-ember px-[18px] text-[12.5px] font-medium hover:bg-ember/85"
                  >
                    Comparar ofertas en Funding →
                  </button>
                </div>
              )}
            </article>

            <article className="card flex flex-col gap-4 p-6">
              <div className="eyebrow">Cobertura de la brecha</div>
              <div className="num text-[36px] leading-none tracking-[-.03em]">
                <AnimatedNumber value={Math.round(coveredPct)} format={(v) => String(Math.round(v))} />
                <span className="text-[18px] text-dim">%</span>
              </div>
              <Meter pct={coveredPct} color={gapClosed ? '#22C55E' : '#C20114'} height={10} />
              <div className="flex flex-col gap-1.5 text-[11.5px] text-dim">
                <div className="flex justify-between">
                  <span>Cubierto</span>
                  <span className="num text-ghost">{compact(covered)}</span>
                </div>
                <div className="flex justify-between">
                  <span>Pendiente</span>
                  <span className="num text-ghost">{compact(residual)}</span>
                </div>
              </div>
            </article>

            {ladder.adjustedMin !== null && (
              <article className="card-ink flex flex-col gap-2 p-6">
                <div className="eyebrow mb-1">Mínimo ajustado</div>
                <div className={`num text-[32px] ${gapClosed ? 'text-bajo' : 'text-alto'}`}>
                  <AnimatedNumber value={ladder.adjustedMin} format={mxn} />
                </div>
                <div className="text-[11.5px] text-dim">
                  balance pesimista después de aplicar los peldaños activos
                </div>
              </article>
            )}
          </div>
        </section>
      )}
    </>
  );
}

// ─── Rung card ────────────────────────────────────────────────────────

function RungCard({
  number, title, state, onToggle, closes, moves, shortfall, runningResidual, emptyText, children,
}: {
  number: string; title: string; state: RungState; onToggle: () => void;
  /** Part of the first shortfall this rung covers. */
  closes: number;
  /** Everything this rung moves, including cash for shortfalls later in the month. */
  moves: number;
  shortfall: number; runningResidual: number;
  emptyText: ReactNode; children: ReactNode;
}) {
  const applied = state === 'applied';
  const switchable = applied || state === 'excluded';
  const coverPct = shortfall > 0 ? (closes / shortfall) * 100 : 0;
  const status: Record<Exclude<RungState, 'applied'>, ReactNode> = {
    excluded: 'Desactivado por ti. La escalera se recalculó sin este peldaño.',
    notNeeded: 'No hizo falta: un peldaño más barato ya cierra la brecha.',
    unavailable: emptyText,
  };

  return (
    <article className={`card flex flex-col gap-4 p-6 transition-opacity ${applied ? '' : 'opacity-70'}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid size-[26px] flex-none place-items-center rounded-full font-mono text-[11px] font-medium ${applied ? 'bg-bajo/20 text-bajo' : 'bg-dim/20 text-dim'}`}>
            {number}
          </span>
          <h2 className={`m-0 text-[15px] font-medium ${applied ? '' : 'text-dim'}`}>{title}</h2>
        </div>
        {switchable && (
          <button
            type="button" onClick={onToggle} role="switch" aria-checked={applied}
            aria-label={`${applied ? 'Desactivar' : 'Activar'} ${title.toLowerCase()}`}
            className={`relative h-6 w-11 flex-none rounded-full transition-colors ${applied ? 'bg-bajo' : 'bg-ash/20'}`}
          >
            <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-ghost shadow transition-all ${applied ? 'left-[22px]' : 'left-[3px]'}`} />
          </button>
        )}
      </div>

      {applied ? (
        <div className="flex flex-col gap-3">{children}</div>
      ) : (
        <div className="text-[12.5px] text-dim">{status[state as Exclude<RungState, 'applied'>]}</div>
      )}

      {applied && closes <= 0 && moves > 0 && (
        <div className="border-t border-ash/10 pt-4 text-[12px] text-dim">
          Cubre un faltante posterior dentro de los 30 días · mueve{' '}
          <span className="num font-medium text-bajo">{mxn(moves)}</span>
        </div>
      )}

      {applied && closes > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-ash/10 pt-4">
          <div className="flex items-center justify-between text-[12px] text-dim">
            <span>Cierra {Math.round(coverPct)}% de la brecha</span>
            <span className="num font-medium text-bajo">{mxn(closes, true)}</span>
          </div>
          <Meter pct={coverPct} color="#22C55E" height={6} />
          {runningResidual > 0 && (
            <div className="text-[11.5px] text-dim">Residual tras este peldaño: {mxn(runningResidual)}</div>
          )}
        </div>
      )}
    </article>
  );
}

function AccelerateDetail({ action, receivable }: { action: LadderAction; receivable?: Receivable }) {
  return (
    <div className="flex flex-wrap gap-5 text-[12.5px]">
      <div><div className="eyebrow mb-1">Factura</div><div className="text-ghost">{receivable ? `${receivable.folio} · ${receivable.client}` : 'Factura por cobrar'}</div></div>
      {receivable && <div><div className="eyebrow mb-1">Vencimiento original</div><div className="text-ghost">{shortDate(receivable.dueDate)}</div></div>}
      {action.newDate && <div><div className="eyebrow mb-1">Cobrar el</div><div className="text-ghost">{shortDate(action.newDate)}</div></div>}
      {receivable && action.newDate && <div><div className="eyebrow mb-1">Adelantar</div><div className="text-ghost">{dayDiff(action.newDate, receivable.dueDate)} días</div></div>}
      <div><div className="eyebrow mb-1">Entra</div><div className="num text-ghost">{mxn(action.amount)}</div></div>
    </div>
  );
}

function ShiftDetail({ action, payable }: { action: LadderAction; payable?: Payable }) {
  // A moved payment arrives as "<obligation id>:<original due date>".
  const original = action.targetId.split(':')[1] ?? payable?.dueDate;
  return (
    <div className="flex flex-wrap gap-5 text-[12.5px]">
      <div><div className="eyebrow mb-1">Proveedor</div><div className="text-ghost">{payable?.payee ?? 'Pago con holgura'}</div></div>
      {original && action.newDate && (
        <div>
          <div className="eyebrow mb-1">Diferir</div>
          <div className="text-ghost">{shortDate(original)} → {shortDate(action.newDate)} · {dayDiff(original, action.newDate)} días</div>
        </div>
      )}
      {payable && <div><div className="eyebrow mb-1">Holgura confirmada</div><div className="text-ghost">{payable.slackDays} días máx</div></div>}
      <div><div className="eyebrow mb-1">Monto</div><div className="num text-ghost">{mxn(action.amount)}</div></div>
    </div>
  );
}

function ClosureRow({ label, amount, color }: { label: string; amount: number; color: string }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span style={{ color }}>{label}</span>
      <span className="num" style={{ color }}>{amount < 0 ? `−${mxn(Math.abs(amount))}` : mxn(amount)}</span>
    </div>
  );
}

function NoBreach({ onSimulate }: { onSimulate: () => void }) {
  return (
    <article className="card flex min-h-[320px] flex-col items-center justify-center gap-5 p-10 text-center">
      <span className="grid size-14 place-items-center rounded-full bg-bajo/16">
        <Icon name="check" size={20} color="#22C55E" strokeWidth={1.6} />
      </span>
      <div>
        <div className="text-[22px] font-medium text-bajo">Sin brecha en 30 días</div>
        <div className="mt-2 max-w-[480px] text-[13.5px] text-dim">
          Tu balance pesimista cubre todas las obligaciones. No necesitas activar ningún peldaño de la escalera.
        </div>
      </div>
      <button
        type="button" onClick={onSimulate}
        className="h-10 rounded-full border border-ash/20 px-5 text-[12.5px] text-dim hover:text-ghost hover:bg-ash/8"
      >
        Simular escenarios adversos en Stress Lab
      </button>
    </article>
  );
}
