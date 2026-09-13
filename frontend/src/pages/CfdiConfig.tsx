import { Link } from 'react-router-dom';
import { QueryGate } from '@/components/QueryGate';
import { Icon, Meter } from '@/components/ui';
import { AnimatedNumber } from '@/components/animate';
import { mxn, shortDate } from '@/lib/format';
import type { DashboardData } from '@/types';

/**
 * CFDI — read only.
 *
 * Uploading lives in Ajustes, so this view never mutates anything. What it shows is the
 * reconciliation result: which invoices matched a bank movement, which are still owed to
 * us, and the payment term measured for each client.
 *
 * Every figure comes from the dashboard payload the engine already produced. Recomputing
 * any of it here would let this page disagree with the forecast that drives the
 * recommendations.
 */

function Stat({ label, value, format, hint }: { label: string; value: number; format: (v: number) => string; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow !text-[10px]">{label}</span>
      <span className="text-[22px] tabular-nums tracking-[-.02em]"><AnimatedNumber value={value} format={format} /></span>
      {hint && <span className="text-[12px] text-dim">{hint}</span>}
    </div>
  );
}

function Body({ data }: { data: DashboardData }) {
  const { cfdi, receivables, payables, settled } = data;
  const suppliers = payables.filter((p) => p.kind === 'SUPPLIER');
  const overdue = receivables.filter((r) => new Date(r.dueDate) < new Date(data.today));

  // One row per client, with the learned term. dsoDays of 0 means no settled history yet,
  // so the cold-start default applies — worth showing as "sin historial" rather than "0".
  const byClient = Object.values(
    receivables.reduce<Record<string, { client: string; amount: number; dso: number; count: number }>>(
      (acc, r) => {
        const row = acc[r.client] ?? { client: r.client, amount: 0, dso: r.dsoDays, count: 0 };
        row.amount += r.amount;
        row.count += 1;
        row.dso = Math.max(row.dso, r.dsoDays);
        acc[r.client] = row;
        return acc;
      },
      {},
    ),
  ).sort((a, b) => b.amount - a.amount);

  const agingMax = Math.max(...cfdi.aging.map((b) => b.amount), 1);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">CFDI · conciliación</div>
          <h1 className="m-0 mt-1.5 text-[32px] font-normal tracking-[-.03em] sm:text-[38px]">
            Tus comprobantes
          </h1>
        </div>
        <Link
          to="/settings"
          className="glass flex h-11 items-center gap-2 rounded-full px-[18px] text-[13.5px]"
        >
          <Icon name="gear" size={14} color="#C7D6D5" strokeWidth={1.3} />
          Subir más CFDI
        </Link>
      </header>

      <section className="card grid grid-cols-2 gap-6 p-6 sm:grid-cols-4 sm:p-7">
        <Stat
          label="Por cobrar"
          value={cfdi.receivableTotal}
          format={mxn}
          hint={`${cfdi.receivableCount} facturas PPD abiertas`}
        />
        <Stat
          label="Por pagar"
          value={cfdi.payableTotal}
          format={mxn}
          hint={`${cfdi.payableCount} de proveedor`}
        />
        <Stat
          label="Vencidas"
          value={overdue.reduce((s, r) => s + r.amount, 0)}
          format={mxn}
          hint={`${overdue.length} pasaron su fecha`}
        />
        <Stat
          label="Conciliadas"
          value={settled.length}
          format={(v) => String(Math.round(v))}
          hint="con movimiento en el banco"
        />
      </section>

      <div className="grid gap-4 sm:gap-[18px] lg:grid-cols-[1.15fr_.85fr]">
        {/* por cobrar */}
        <section className="card flex flex-col gap-4 p-6 sm:p-7">
          <h2 className="m-0 text-[17px] font-medium tracking-[-.015em]">
            Por cobrar · {cfdi.receivableCount}
          </h2>
          {!receivables.length ? (
            <p className="m-0 text-[13px] text-dim">
              No hay facturas PPD abiertas. Solo las PPD son cuentas por cobrar: una PUE ya
              está pagada.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {receivables.map((r) => {
                const late = new Date(r.dueDate) < new Date(data.today);
                return (
                  <li
                    key={r.id}
                    className="flex flex-wrap items-center gap-3 rounded-xl border border-ash/12 px-4 py-3"
                  >
                    <span className="font-mono text-[12.5px] text-dim">{r.folio}</span>
                    <span className="min-w-[150px] flex-1 text-[14px]">{r.client}</span>
                    <span className="text-[13px] tabular-nums text-ash">
                      {shortDate(r.dueDate)}
                    </span>
                    {late && <span className="tag tag-alto">vencida</span>}
                    {r.accelerable && <span className="tag tag-muted">adelantable</span>}
                    <span className="min-w-[104px] text-right text-[14px] tabular-nums">
                      {mxn(r.amount)}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </section>

        <div className="flex flex-col gap-4 sm:gap-[18px]">
          {/* antigüedad */}
          <section className="card flex flex-col gap-4 p-6 sm:p-7">
            <h2 className="m-0 text-[17px] font-medium tracking-[-.015em]">Antigüedad</h2>
            <div className="flex flex-col gap-3">
              {cfdi.aging.map((b) => (
                <div key={b.label} className="flex flex-col gap-1.5">
                  <div className="flex items-baseline justify-between text-[13px]">
                    <span className="text-ash">{b.label}</span>
                    <span className="tabular-nums text-dim">{mxn(b.amount)}</span>
                  </div>
                  <Meter pct={(b.amount / agingMax) * 100} color="#C2410C" height={8} />
                </div>
              ))}
            </div>
          </section>

          {/* plazos aprendidos */}
          <section className="card flex flex-col gap-3 p-6 sm:p-7">
            <h2 className="m-0 text-[17px] font-medium tracking-[-.015em]">
              Plazo real por cliente
            </h2>
            <p className="m-0 text-[12.5px] leading-relaxed text-dim">
              Medido cruzando cada factura cobrada contra su depósito. No es un supuesto.
            </p>
            {!byClient.length ? (
              <p className="m-0 text-[13px] text-dim">Aún sin clientes con saldo abierto.</p>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {byClient.map((c) => (
                  <li key={c.client} className="flex items-center gap-3">
                    <span className="flex-1 truncate text-[13.5px]">{c.client}</span>
                    <span className="text-[13px] tabular-nums text-ash">
                      {c.dso > 0 ? `${c.dso} días` : 'sin historial'}
                    </span>
                    <span className="min-w-[92px] text-right text-[13px] tabular-nums text-dim">
                      {mxn(c.amount)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      </div>

      {/* por pagar y liquidadas */}
      <div className="grid gap-4 sm:gap-[18px] lg:grid-cols-2">
        <section className="card flex flex-col gap-4 p-6 sm:p-7">
          <h2 className="m-0 text-[17px] font-medium tracking-[-.015em]">
            Por pagar a proveedores · {suppliers.length}
          </h2>
          {!suppliers.length ? (
            <p className="m-0 text-[13px] text-dim">Sin facturas de proveedor abiertas.</p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {suppliers.slice(0, 12).map((p) => (
                <li key={p.id} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-[13.5px]">{p.payee}</span>
                  <span className="text-[13px] tabular-nums text-dim">
                    {shortDate(p.dueDate)}
                  </span>
                  <span className="min-w-[100px] text-right text-[13.5px] tabular-nums">
                    {mxn(p.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="card flex flex-col gap-4 p-6 sm:p-7">
          <h2 className="m-0 text-[17px] font-medium tracking-[-.015em]">
            Ya liquidadas · {settled.length}
          </h2>
          {!settled.length ? (
            <p className="m-0 text-[13px] text-dim">
              Nada conciliado todavía. Sincroniza desde Ajustes.
            </p>
          ) : (
            <ul className="m-0 flex list-none flex-col gap-2 p-0">
              {settled.slice(0, 12).map((s) => (
                <li key={s.id} className="flex items-center gap-3">
                  <span className="flex-1 truncate text-[13.5px]">{s.payee}</span>
                  <span className="text-[13px] tabular-nums text-dim">{shortDate(s.date)}</span>
                  <span className="min-w-[100px] text-right text-[13.5px] tabular-nums">
                    {mxn(s.amount)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </>
  );
}

export default function CfdiConfig() {
  return <QueryGate>{(data) => <Body data={data} />}</QueryGate>;
}
