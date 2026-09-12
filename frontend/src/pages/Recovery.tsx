import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { DashboardData, LadderRung, Receivable, Payable } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { Icon, Meter, RISK_STYLE } from '@/components/ui';
import { mxn, compact, shortDate, addDays, dayDiff } from '@/lib/format';
import { SHIFT_DAYS, CREDIT_MARGIN } from '@/mock/engine';

// ─── Page ────────────────────────────────────────────────────────────

export default function Recovery() {
  return <QueryGate>{(d) => <RecoveryView d={d} />}</QueryGate>;
}

type EnabledMap = Record<'ACCELERATE' | 'SHIFT' | 'BUFFER', boolean>;

function RecoveryView({ d }: { d: DashboardData }) {
  const navigate = useNavigate();
  const { breach, ladder, receivables, payables, bufferAvailable } = d;

  const [enabled, setEnabled] = useState<EnabledMap>({
    ACCELERATE: true,
    SHIFT: true,
    BUFFER: true,
  });

  function toggle(rung: keyof EnabledMap) {
    setEnabled((prev) => ({ ...prev, [rung]: !prev[rung] }));
  }

  const accelerable = receivables
    .filter((r) => r.accelerable && breach && r.dueDate > breach.date)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];

  const shiftable = payables
    .filter((p) => breach && p.rigidity === 'slack' && p.dueDate <= breach.date)
    .filter((p) => breach && addDays(p.dueDate, Math.min(p.slackDays, SHIFT_DAYS)) > breach.date)
    .sort((a, b) => b.amount - a.amount)[0];

  const shortfall = breach?.shortfall ?? 0;
  let residual = shortfall;

  const accelerateClosed = enabled.ACCELERATE && accelerable ? Math.min(accelerable.amount, residual) : 0;
  residual = Math.max(0, residual - accelerateClosed);
  const shiftClosed = enabled.SHIFT && shiftable ? Math.min(shiftable.amount, residual) : 0;
  residual = Math.max(0, residual - shiftClosed);
  const bufferClosed = enabled.BUFFER && bufferAvailable > 0 ? Math.min(bufferAvailable, residual) : 0;
  residual = Math.max(0, residual - bufferClosed);

  const creditAmount = residual > 0 ? Math.ceil((residual * (1 + CREDIT_MARGIN)) / 1000) * 1000 : 0;
  const gapClosed = residual === 0;
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
            Adelanta cobranza, difiere pagos con holgura y usa tu buffer. La nómina y el SAT nunca se mueven.
          </p>
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
              <div className="num text-[26px] font-semibold leading-[1.15] text-alto">{compact(breach.shortfall)}</div>
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
              number="1" rung="ACCELERATE" title="Adelantar cobranza"
              enabled={enabled.ACCELERATE} available={Boolean(accelerable)}
              onToggle={() => toggle('ACCELERATE')}
              closes={accelerateClosed} shortfall={shortfall}
              runningResidual={shortfall - accelerateClosed}
            >
              {accelerable
                ? <AccelerateDetail r={accelerable} breach={breach.date} />
                : <div className="text-[12.5px] text-dim">No hay cuentas por cobrar adelantables después de la brecha.</div>
              }
            </RungCard>

            <RungCard
              number="2" rung="SHIFT" title="Diferir pagos a proveedores"
              enabled={enabled.SHIFT} available={Boolean(shiftable)}
              onToggle={() => toggle('SHIFT')}
              closes={shiftClosed} shortfall={shortfall}
              runningResidual={shortfall - accelerateClosed - shiftClosed}
            >
              {shiftable
                ? <ShiftDetail p={shiftable} />
                : <div className="text-[12.5px] text-dim">No hay pagos con holgura suficiente para mover más allá de la brecha.</div>
              }
            </RungCard>

            <RungCard
              number="3" rung="BUFFER" title="Usar buffer de caja"
              enabled={enabled.BUFFER} available={bufferAvailable > 0}
              onToggle={() => toggle('BUFFER')}
              closes={bufferClosed} shortfall={shortfall}
              runningResidual={residual}
            >
              <div className="text-[12.5px] text-dim">
                Buffer disponible: <span className="text-ghost">{mxn(bufferAvailable)}</span> · reserva de operación.
              </div>
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
              <div className="eyebrow mb-4">{gapClosed ? 'Brecha cerrada' : 'Brecha parcialmente cerrada'}</div>
              <div className="flex flex-col gap-3">
                <ClosureRow label="Brecha total" amount={shortfall} color="#6D7275" />
                {accelerateClosed > 0 && <ClosureRow label="1 · Cobranza" amount={-accelerateClosed} color="#22C55E" />}
                {shiftClosed > 0 && <ClosureRow label="2 · Diferir" amount={-shiftClosed} color="#22C55E" />}
                {bufferClosed > 0 && <ClosureRow label="3 · Buffer" amount={-bufferClosed} color="#22C55E" />}
                <div className="my-1 h-px bg-ash/14" />
                <div className="flex items-baseline justify-between">
                  <span className="text-[13px] text-dim">Residual</span>
                  <span className={`num text-[22px] font-semibold ${gapClosed ? 'text-bajo' : 'text-alto'}`}>
                    {gapClosed ? '$0' : mxn(residual)}
                  </span>
                </div>
              </div>

              {gapClosed ? (
                <div className="mt-5 flex items-center gap-2.5 text-[12.5px] text-bajo">
                  <Icon name="check" size={13} color="#22C55E" strokeWidth={1.8} />
                  No se necesita crédito
                </div>
              ) : (
                <div className="mt-5">
                  <div className="mb-2 text-[12px] text-dim">Crédito puente sugerido</div>
                  <div className="num text-[32px] font-semibold text-alto">{mxn(creditAmount)}</div>
                  <div className="mt-1 text-[11.5px] text-dim">residual + {Math.round(CREDIT_MARGIN * 100)}% margen</div>
                  <button
                    type="button"
                    onClick={() => navigate('/funding')}
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
                {Math.min(100, Math.round(((shortfall - residual) / shortfall) * 100))}
                <span className="text-[18px] text-dim">%</span>
              </div>
              <Meter pct={Math.min(100, ((shortfall - residual) / shortfall) * 100)} color={gapClosed ? '#22C55E' : '#C20114'} height={10} />
              <div className="flex flex-col gap-1.5 text-[11.5px] text-dim">
                <div className="flex justify-between">
                  <span>Cubierto</span>
                  <span className="num text-ghost">{compact(shortfall - residual)}</span>
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
                  {mxn(ladder.adjustedMin)}
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
  number, rung, title, enabled, available, onToggle, closes, shortfall, runningResidual, children,
}: {
  number: string; rung: LadderRung; title: string; enabled: boolean; available: boolean;
  onToggle: () => void; closes: number; shortfall: number; runningResidual: number;
  children: React.ReactNode;
}) {
  void rung;
  const applied = enabled && available;
  const coverPct = shortfall > 0 ? (closes / shortfall) * 100 : 0;

  return (
    <article className={`card flex flex-col gap-4 p-6 transition-opacity ${!available ? 'opacity-55' : ''}`}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <span className={`grid size-[26px] flex-none place-items-center rounded-full font-mono text-[11px] font-medium ${applied ? 'bg-bajo/20 text-bajo' : 'bg-dim/20 text-dim'}`}>
            {number}
          </span>
          <h2 className={`m-0 text-[15px] font-medium ${applied ? '' : 'text-dim'}`}>{title}</h2>
        </div>
        {available && (
          <button
            type="button" onClick={onToggle} role="switch" aria-checked={enabled}
            className={`relative h-6 w-11 flex-none rounded-full transition-colors ${enabled ? 'bg-bajo' : 'bg-ash/20'}`}
          >
            <span className={`absolute top-[3px] h-[18px] w-[18px] rounded-full bg-ghost shadow transition-all ${enabled ? 'left-[22px]' : 'left-[3px]'}`} />
          </button>
        )}
      </div>

      {children}

      {available && closes > 0 && (
        <div className="flex flex-col gap-1.5 border-t border-ash/10 pt-4">
          <div className="flex items-center justify-between text-[12px] text-dim">
            <span>Cierra {Math.round(coverPct)}% de la brecha</span>
            <span className={`num font-medium ${applied ? 'text-bajo' : 'text-dim'}`}>{mxn(closes, true)}</span>
          </div>
          <Meter pct={coverPct} color={applied ? '#22C55E' : '#6D7275'} height={6} />
          {applied && runningResidual > 0 && (
            <div className="text-[11.5px] text-dim">Residual tras este peldaño: {mxn(runningResidual)}</div>
          )}
        </div>
      )}
    </article>
  );
}

function AccelerateDetail({ r, breach }: { r: Receivable; breach: string }) {
  const daysEarly = dayDiff(breach, r.dueDate);
  return (
    <div className="flex flex-wrap gap-5 text-[12.5px]">
      <div><div className="eyebrow mb-1">Factura</div><div className="text-ghost">{r.folio} · {r.client}</div></div>
      <div><div className="eyebrow mb-1">Vencimiento original</div><div className="text-ghost">{shortDate(r.dueDate)}</div></div>
      <div><div className="eyebrow mb-1">Adelantar</div><div className="text-ghost">{daysEarly} días</div></div>
      <div><div className="eyebrow mb-1">DSO promedio</div><div className="text-ghost">{r.dsoDays} días · cliente paga antes</div></div>
      <div><div className="eyebrow mb-1">Monto</div><div className="num text-ghost">{mxn(r.amount)}</div></div>
    </div>
  );
}

function ShiftDetail({ p }: { p: Payable }) {
  const days = Math.min(p.slackDays, SHIFT_DAYS);
  return (
    <div className="flex flex-wrap gap-5 text-[12.5px]">
      <div><div className="eyebrow mb-1">Proveedor</div><div className="text-ghost">{p.payee}</div></div>
      <div><div className="eyebrow mb-1">Referencia</div><div className="text-ghost">{p.reference}</div></div>
      <div><div className="eyebrow mb-1">Diferir</div><div className="text-ghost">{days} días</div></div>
      <div><div className="eyebrow mb-1">Holgura disponible</div><div className="text-ghost">{p.slackDays} días máx</div></div>
      <div><div className="eyebrow mb-1">Monto</div><div className="num text-ghost">{mxn(p.amount)}</div></div>
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
