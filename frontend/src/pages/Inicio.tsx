import type { DashboardData, Payable, Receivable } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { ArrowLink, Icon, Meter, Tag } from '@/components/ui';
import { HealthGauge } from '@/components/charts/HealthGauge';
import { compact, dayDiff, greeting, mxn, shortDate } from '@/lib/format';

export default function Inicio() {
  return <QueryGate>{(d) => <InicioView d={d} />}</QueryGate>;
}

function InicioView({ d }: { d: DashboardData }) {
  const { breach, ladder } = d;
  const firstName = d.business.owner.split(' ')[0];

  return (
    <>
      {/* headline + oversized numerals */}
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-6 sm:pt-1.5">
        <div className="min-w-0 flex-1 basis-[320px] sm:basis-[520px]">
          <h1 className="m-0 text-[clamp(30px,6vw,56px)] font-normal leading-[1.02] tracking-[-.035em]">
            {greeting()}, {firstName}
          </h1>
          <div className="mt-[22px] flex flex-wrap items-center gap-x-[26px] gap-y-3">
            <Stat label="Cobrado" value={`${d.collection.collectedPct}%`} className="bg-bajo/16 text-bajo" />
            <Stat label="Por cobrar" value={`${d.collection.receivablePct}%`} className="bg-ember text-ghost" />
            <Stat label="Vencido" value={`${d.collection.overduePct}%`} className="bg-critico/20 text-critico" />
            <div className="hatch hidden h-[34px] min-w-[80px] flex-1 sm:block" aria-hidden="true" />
          </div>
        </div>
        <div className="flex min-w-0 max-w-full flex-wrap items-start gap-x-11 gap-y-4">
          <Numeral value={compact(d.account.balance)} icon="wallet" label="Balance hoy" />
          <Numeral value={breach ? String(breach.daysUntil) : '—'} icon="alert" label={breach ? 'Días al breach' : 'Sin breach en 30 d'} />
          <Numeral value={breach ? compact(breach.shortfall) : '$0'} icon="coin" label={breach ? `Faltante ${shortDate(breach.date)}` : 'Sin faltante'} />
        </div>
      </section>

      {/* bento row */}
      <section className="grid gap-4 sm:gap-[18px] sm:grid-cols-2 lg:grid-cols-[1.05fr_1fr_1.25fr]">
        {breach ? (
          <article className="card-alert flex min-h-[220px] flex-col justify-between p-6">
            <div className="flex items-start justify-between gap-4">
              <div>
                <div className="eyebrow !text-ash">Próximo incumplimiento</div>
                <h2 className="m-0 mt-3 text-[19px] font-medium tracking-[-.01em]">{breach.obligation.payee}</h2>
                <div className="mt-1 text-[12.5px] text-dim">
                  {mxn(breach.obligation.amount)} · {rigidityLabel(breach.obligation)}
                </div>
              </div>
              <ArrowLink to="/forecast" label="Ver predicción" solid size={34} />
            </div>
            <div>
              <div className="num text-[46px] leading-none tracking-[-.035em]">{breach.daysUntil} días</div>
              <div className="mt-2 text-[12.5px] text-ash">
                Faltante {mxn(breach.shortfall)} · {breachVerdict(d)}
              </div>
            </div>
          </article>
        ) : (
          <article className="card flex min-h-[220px] flex-col justify-between p-6">
            <div className="eyebrow">Próximos 30 días</div>
            <div>
              <div className="text-[34px] leading-none tracking-[-.03em] text-bajo">Todo cubierto</div>
              <div className="mt-2 text-[12.5px] text-ash">Tu balance pesimista cubre todas las obligaciones del horizonte.</div>
            </div>
          </article>
        )}

        <article className="card flex min-h-[220px] flex-col p-6">
          <div className="flex items-start justify-between">
            <h2 className="m-0 text-base font-medium">Salud del negocio</h2>
            <ArrowLink to="/business" label="Ver mi negocio" />
          </div>
          <HealthGauge score={d.healthScore} resilience={d.resilienceScore} />
        </article>

        <article className="card flex flex-col p-6 sm:col-span-2 lg:col-span-1">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="m-0 text-base font-medium">Escalera de acciones</h2>
              <div className="mt-1 text-[12.5px] text-dim">
                {breach ? `Cuánto cierra cada peldaño del faltante de ${mxn(breach.shortfall)}` : 'Sin faltante que cerrar'}
              </div>
            </div>
            <span className="eyebrow tracking-[.1em]">MXN</span>
          </div>
          {breach && <LadderMeters d={d} />}
          {!breach && <div className="flex flex-1 items-center text-[13px] text-dim">No necesitas mover pagos ni pedir crédito.</div>}
          {ladder.creditDeclined && (
            <div className="mt-3 text-[12px] text-critico">Déficit estructural: el crédito empeora el balance. Reestructura costos primero.</div>
          )}
        </article>
      </section>

      {/* clientes / proveedores */}
      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[1.08fr_1fr]">
        <ReceivablesTable d={d} />
        <PayablesTable d={d} />
      </section>
    </>
  );
}

function Stat({ label, value, className }: { label: string; value: string; className: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="text-[13px] text-dim">{label}</span>
      <span className={`num flex h-[34px] items-center rounded-full px-4 text-[12.5px] font-semibold ${className}`}>{value}</span>
    </div>
  );
}

function Numeral({ value, icon, label }: { value: string; icon: 'wallet' | 'alert' | 'coin'; label: string }) {
  return (
    <div>
      <div className="num text-[clamp(36px,8vw,58px)] leading-none tracking-[-.04em]">{value}</div>
      <div className="mt-2 flex items-center gap-[7px]">
        <Icon name={icon} size={14} color="#6D7275" strokeWidth={1.3} />
        <span className="text-[12.5px] text-dim">{label}</span>
      </div>
    </div>
  );
}

function LadderMeters({ d }: { d: DashboardData }) {
  const steps = d.ladder.steps;
  const total = steps.filter((s) => s.rung !== 'CREDIT').reduce((sum, s) => sum + s.closes, 0) || 1;
  return (
    <ol className="m-0 mt-3.5 flex flex-1 list-none flex-col justify-center gap-3.5 p-0">
      {steps.map((s) => {
        const isCredit = s.rung === 'CREDIT';
        const muted = isCredit ? !s.applied : !s.available;
        const value = isCredit ? (d.ladder.creditDeclined ? 'no recomendado' : s.applied ? mxn(s.closes) : 'no requerido') : s.available ? mxn(s.closes) : '—';
        return (
          <li key={s.rung} className="flex items-center gap-3.5">
            <div className={`w-[92px] flex-none text-[12.5px] sm:w-[118px] ${muted ? 'text-dim' : 'text-ash'}`}>{s.short}</div>
            <Meter pct={isCredit ? (s.applied ? 100 : 0) : (s.closes / total) * 100} color={s.applied ? '#C20114' : 'rgba(109,114,117,0.85)'} />
            <div className={`num w-[82px] flex-none text-right text-[13px] sm:w-[96px] ${muted ? 'text-dim' : ''}`}>{value}</div>
          </li>
        );
      })}
    </ol>
  );
}

function ReceivablesTable({ d }: { d: DashboardData }) {
  const cols = 'grid grid-cols-[1.7fr_.9fr_.9fr_.8fr_1fr] gap-3';
  return (
    <article className="card flex min-w-0 flex-col px-6 py-[22px]">
      <TableHeader title="Clientes por cobrar" subtitle="CFDI emitidos PPD sin depósito conciliado" total={d.cfdi.receivableTotal} count={d.cfdi.receivableCount} />
      <div className="overflow-x-auto">
        <div className="min-w-[560px]" role="table" aria-label="Clientes por cobrar">
          <div role="row" className={`${cols} eyebrow border-b border-ash/16 px-1 pb-2.5 pt-4 !tracking-[.12em]`}>
            <div role="columnheader">Cliente</div>
            <div role="columnheader" className="text-right">Monto</div>
            <div role="columnheader">Vence</div>
            <div role="columnheader" className="text-right">DSO real</div>
            <div role="columnheader" className="text-right">Acción</div>
          </div>
          {d.receivables.map((r, i) => (
            <div role="row" key={r.id} className={`${cols} row-hover items-center px-1 py-[11px] ${i < d.receivables.length - 1 ? 'border-b border-ash/7' : ''}`}>
              <div role="cell">
                <div className="text-[13.5px] font-medium">{r.client}</div>
                <div className="mt-[3px] font-mono text-[10px] text-dim">{r.folio} · PPD</div>
              </div>
              <div role="cell" className="num text-right text-[13.5px]">{mxn(r.amount)}</div>
              <div role="cell" className="font-mono text-[11.5px] text-ash">{shortDate(r.dueDate)}</div>
              <div role="cell" className="num text-right text-[12.5px] text-dim">{r.dsoDays} d</div>
              <div role="cell" className="text-right"><ReceivableTag r={r} today={d.today} /></div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function ReceivableTag({ r, today }: { r: Receivable; today: string }) {
  const overdue = dayDiff(r.dueDate, today);
  if (overdue > 0) return <Tag tone="alto">Vencida {overdue} d</Tag>;
  if (r.accelerable) return <Tag tone="ember">Adelantable</Tag>;
  return <Tag tone="muted">En plazo</Tag>;
}

function PayablesTable({ d }: { d: DashboardData }) {
  const cols = 'grid grid-cols-[1.7fr_.9fr_.8fr_1fr] gap-3';
  const rows = [...d.payables].sort((a, b) => a.dueDate.localeCompare(b.dueDate));
  return (
    <article className="card flex min-w-0 flex-col px-6 py-[22px]">
      <TableHeader title="Proveedores por pagar" subtitle="CFDI recibidos y obligaciones fijas del horizonte" total={d.cfdi.payableTotal} count={d.cfdi.payableCount} />
      <div className="overflow-x-auto">
        <div className="min-w-[480px]" role="table" aria-label="Proveedores por pagar">
          <div role="row" className={`${cols} eyebrow border-b border-ash/16 px-1 pb-2.5 pt-4 !tracking-[.12em]`}>
            <div role="columnheader">Proveedor</div>
            <div role="columnheader" className="text-right">Monto</div>
            <div role="columnheader">Vence</div>
            <div role="columnheader" className="text-right">Rigidez</div>
          </div>
          {rows.map((p, i) => (
            <div role="row" key={p.id} className={`${cols} row-hover items-center px-1 py-[11px] ${i < rows.length - 1 ? 'border-b border-ash/7' : ''}`}>
              <div role="cell">
                <div className="text-[13.5px] font-medium">{p.payee}</div>
                <div className="mt-[3px] font-mono text-[10px] text-dim">{p.reference}</div>
              </div>
              <div role="cell" className="num text-right text-[13.5px]">{mxn(p.amount)}</div>
              <div role="cell" className={`font-mono text-[11.5px] ${d.breach?.obligation.id === p.id ? 'text-alto' : 'text-ash'}`}>{shortDate(p.dueDate)}</div>
              <div role="cell" className="text-right">
                {p.rigidity === 'hard' ? <Tag tone="alto">Rígido</Tag> : <Tag tone="muted">Holgura {p.slackDays} d</Tag>}
              </div>
            </div>
          ))}
        </div>
      </div>
    </article>
  );
}

function TableHeader({ title, subtitle, total, count }: { title: string; subtitle: string; total: number; count: number }) {
  return (
    <div className="flex items-center justify-between gap-4">
      <div>
        <h2 className="m-0 text-lg font-medium">{title}</h2>
        <div className="mt-1 text-[12.5px] text-dim">{subtitle}</div>
      </div>
      <div className="text-right">
        <div className="num text-[22px]">{mxn(total)}</div>
        <div className="eyebrow !tracking-[.12em]">{count} facturas</div>
      </div>
    </div>
  );
}

export function rigidityLabel(p: Payable): string {
  if (p.kind === 'PAYROLL') return 'rígido (LFT)';
  if (p.kind === 'TAXES') return 'rígido (SAT)';
  if (p.rigidity === 'hard') return 'rígido';
  return `holgura ${p.slackDays} d`;
}

/** One-line recommendation that follows the ladder: cheapest first, credit last. */
export function breachVerdict(d: DashboardData): string {
  if (d.gap === 'STRUCTURAL') return 'déficit estructural, no se recomienda crédito';
  const applied = d.ladder.steps.filter((s) => s.applied && s.rung !== 'CREDIT');
  if (d.ladder.residual > 0) return `quedan ${mxn(d.ladder.residual)} tras la escalera`;
  if (applied.length === 1 && applied[0].rung === 'ACCELERATE') return `adelantar ${applied[0].title.split(' ').pop()} lo cierra`;
  return `${applied.map((s) => s.phrase).join(' y ')} lo cierra`;
}
