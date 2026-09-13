import { useState, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import type { DashboardData } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { Meter, SegmentedRange } from '@/components/ui';
import { AnimatedNumber } from '@/components/animate';
import { mxn, compact } from '@/lib/format';

// ─── Types & constants ────────────────────────────────────────────────

interface Offer {
  id: string;
  institution: string;
  product: string;
  type: 'banco' | 'fintech';
  maxAmount: number;
  monthlyRate: number;
  approvalDays: number;
}

type Term = 30 | 60 | 90;
type Purpose = 'bridge' | 'working' | 'supplier';

const OFFERS: Offer[] = [
  { id: 'banorte',  institution: 'Banorte',      product: 'Crédito PYME Puente',     type: 'banco',   maxAmount: 800000, monthlyRate: 2.6, approvalDays: 7 },
  { id: 'bbva',     institution: 'BBVA',          product: 'Capital de Trabajo Flex', type: 'banco',   maxAmount: 600000, monthlyRate: 2.8, approvalDays: 5 },
  { id: 'banamex',  institution: 'Citibanamex',   product: 'PyME Express',            type: 'banco',   maxAmount: 500000, monthlyRate: 3.1, approvalDays: 8 },
  { id: 'hsbc',     institution: 'HSBC',          product: 'Crédito Negocio Ágil',   type: 'banco',   maxAmount: 450000, monthlyRate: 3.4, approvalDays: 6 },
  { id: 'clip',     institution: 'Clip',          product: 'Adelanto de Ventas',      type: 'fintech', maxAmount: 300000, monthlyRate: 3.9, approvalDays: 1 },
];

const PURPOSES: { value: Purpose; label: string }[] = [
  { value: 'bridge',   label: 'Puente de tesorería' },
  { value: 'working',  label: 'Capital de trabajo' },
  { value: 'supplier', label: 'Pago a proveedores' },
];

const TERM_OPTIONS: { value: Term; label: string }[] = [
  { value: 30, label: '30 d' },
  { value: 60, label: '60 d' },
  { value: 90, label: '90 d' },
];

function totalCost(amount: number, monthlyRate: number, termDays: number) {
  return amount * (monthlyRate / 100) * (termDays / 30);
}

function annualizedRate(monthlyRate: number) {
  return (Math.pow(1 + monthlyRate / 100, 12) - 1) * 100;
}

// ─── Page ────────────────────────────────────────────────────────────

export default function Funding() {
  return <QueryGate>{(d) => <FundingView d={d} />}</QueryGate>;
}

function FundingView({ d }: { d: DashboardData }) {
  const { ladder } = d;

  // Recovery links here with ?amount=<residual + margin> once its own toggles have
  // settled on a figure — that number reflects the peldaños the tenant actually enabled,
  // which ladder.creditAmount (computed server-side, all rungs on) does not.
  const [searchParams] = useSearchParams();
  const requestedAmount = Number(searchParams.get('amount'));
  const [amount, setAmount] = useState(
    requestedAmount > 0 ? requestedAmount : ladder.creditAmount || 150000,
  );
  const [term, setTerm] = useState<Term>(30);
  const [purpose, setPurpose] = useState<Purpose>('bridge');
  const [selected, setSelected] = useState<string | null>(null);

  const eligible = useMemo(
    () => OFFERS.filter((o) => o.maxAmount >= amount).sort((a, b) => a.monthlyRate - b.monthlyRate),
    [amount],
  );

  const bestId = eligible[0]?.id ?? null;
  const maxRate = Math.max(...eligible.map((o) => o.monthlyRate), 1);

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <div className="eyebrow mb-3">Funding Bridge · último peldaño</div>
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">
            Crédito solo si hace falta
          </h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">
            Si la escalera no cierra el faltante, comparamos ofertas por tasa implícita y armamos tu perfil para bancos.
          </p>
        </div>

        {ladder.creditDeclined && (
          <div className="card-alert flex items-center gap-3 px-5 py-3.5">
            <div className="text-[12.5px] text-alto">
              Déficit estructural · el crédito empeora la posición. Primero reestructura costos.
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:gap-[18px] lg:grid-cols-[300px_1fr]">

        {/* ─── Form ─── */}
        <div className="flex flex-col gap-4 sm:gap-[18px]">
          <article className="card flex flex-col gap-6 p-6">
            <div className="eyebrow">Parámetros del crédito</div>

            <div className="flex flex-col gap-2">
              <label className="eyebrow" htmlFor="credit-amount">Monto solicitado</label>
              <div className="relative">
                <span className="absolute left-4 top-1/2 -translate-y-1/2 text-[15px] text-dim">$</span>
                <input
                  id="credit-amount" type="number" min={10000} max={1000000} step={5000}
                  value={amount}
                  onChange={(e) => { setAmount(Number(e.target.value)); setSelected(null); }}
                  onFocus={(e) => {
                    // Select the whole value on focus so the next keystroke replaces it
                    // instead of inserting before/after whatever was already there — the
                    // browser places the caret from the click on its own mouseup right
                    // after this fires, so the select has to happen one tick later.
                    const el = e.currentTarget;
                    requestAnimationFrame(() => el.select());
                  }}
                  className="w-full rounded-2xl border border-ash/16 bg-dim/10 py-3 pl-8 pr-4 font-mono text-[15px] focus:border-ember/60 focus:outline-none"
                />
              </div>
              {ladder.creditAmount > 0 && (
                <button type="button" onClick={() => setAmount(ladder.creditAmount)} className="text-left text-[11.5px] text-dim hover:text-ember">
                  Usar monto sugerido por la escalera → {mxn(ladder.creditAmount)}
                </button>
              )}
            </div>

            <div className="flex flex-col gap-2">
              <div className="eyebrow">Plazo preferido</div>
              <SegmentedRange options={TERM_OPTIONS} value={term} onChange={(v) => setTerm(v as Term)} activeClass="bg-ember font-medium text-ghost" />
            </div>

            <div className="flex flex-col gap-2">
              <div className="eyebrow">Propósito</div>
              <div className="flex flex-col gap-1.5">
                {PURPOSES.map((p) => (
                  <label
                    key={p.value}
                    className={`flex cursor-pointer items-center gap-2.5 rounded-2xl border px-4 py-3 text-[13px] transition-colors ${
                      purpose === p.value ? 'border-ember/50 bg-ember/10 text-ghost' : 'border-ash/12 text-dim hover:border-ash/20'
                    }`}
                  >
                    <input type="radio" name="purpose" value={p.value} checked={purpose === p.value} onChange={() => setPurpose(p.value)} className="sr-only" />
                    <span className={`size-[14px] flex-none rounded-full border-2 ${purpose === p.value ? 'border-ember bg-ember' : 'border-ash/30'}`} />
                    {p.label}
                  </label>
                ))}
              </div>
            </div>
          </article>

          <article className="card-quiet flex flex-col gap-3 p-5">
            <div className="eyebrow">Perfil empresarial</div>
            <div className="text-[12px] text-dim leading-[1.55]">
              RFC: <span className="text-ghost font-mono">{d.business.rfc}</span><br />
              Ingresos 30 d: <span className="text-ghost">{compact(d.income30.total)}</span><br />
              DSO promedio cartera: <span className="text-ghost">11 días</span><br />
              Empleados: <span className="text-ghost">18</span>
            </div>
            <div className="mt-1 text-[11px] text-dim">Datos tomados de tu CFDI y cuenta Nessie</div>
          </article>
        </div>

        {/* ─── Offers ─── */}
        <div className="flex flex-col gap-4 sm:gap-[18px]">
          <div className="grid grid-cols-3 gap-4 sm:gap-[18px]">
            <article className="card p-5">
              <div className="eyebrow mb-2">Monto</div>
              <div className="num text-[26px] leading-none"><AnimatedNumber value={amount} format={compact} /></div>
            </article>
            <article className="card p-5">
              <div className="eyebrow mb-2">Plazo</div>
              <div className="num text-[26px] leading-none"><AnimatedNumber value={term} format={(v) => `${Math.round(v)} días`} /></div>
            </article>
            <article className="card p-5">
              <div className="eyebrow mb-2">Opciones elegibles</div>
              <div className="num text-[26px] leading-none"><AnimatedNumber value={eligible.length} format={(v) => String(Math.round(v))} /></div>
            </article>
          </div>

          {eligible.length === 0 ? (
            <article className="card flex min-h-[200px] flex-col items-center justify-center gap-3 p-8 text-center">
              <div className="text-[15px] font-medium">Monto superior al límite disponible</div>
              <div className="text-[13px] text-dim">Reduce el monto solicitado o combina con la escalera de liquidez.</div>
            </article>
          ) : (
            <article className="card overflow-hidden">
              <div className="flex items-center justify-between border-b border-ash/10 px-6 py-5">
                <h2 className="m-0 text-[17px] font-medium">Ofertas comparadas</h2>
                <span className="eyebrow tracking-[.1em]">tasa implícita · menor es mejor</span>
              </div>
              <div className="flex flex-col">
                {eligible.map((offer, idx) => {
                  const cost = totalCost(amount, offer.monthlyRate, term);
                  const cat = annualizedRate(offer.monthlyRate);
                  const ratePct = (offer.monthlyRate / maxRate) * 100;
                  const isBest = offer.id === bestId;
                  const isSelected = offer.id === selected;

                  return (
                    <div
                      key={offer.id}
                      className={`flex cursor-pointer flex-col gap-3 px-6 py-5 transition-colors ${
                        isSelected ? 'border-l-2 border-l-ember bg-ember/10' : idx < eligible.length - 1 ? 'border-b border-ash/8 hover:bg-ash/4' : 'hover:bg-ash/4'
                      }`}
                      onClick={() => setSelected(isSelected ? null : offer.id)}
                      role="button" tabIndex={0}
                      onKeyDown={(e) => e.key === 'Enter' && setSelected(isSelected ? null : offer.id)}
                    >
                      <div className="flex items-start justify-between gap-4">
                        <div>
                          <div className="flex items-center gap-2.5">
                            <span className="text-[15px] font-medium">{offer.institution}</span>
                            {isBest && <span className="tag tag-bajo">Mejor tasa</span>}
                            {offer.type === 'fintech' && <span className="tag tag-muted">Fintech</span>}
                          </div>
                          <div className="mt-0.5 text-[12px] text-dim">{offer.product}</div>
                        </div>
                        <div className="flex flex-shrink-0 items-center gap-6">
                          <div className="text-right">
                            <div className="eyebrow mb-0.5">Tasa mensual</div>
                            <div className="num text-[20px] font-semibold"><AnimatedNumber value={offer.monthlyRate} format={(v) => `${v.toFixed(1)}%`} /></div>
                          </div>
                          <div className="text-right">
                            <div className="eyebrow mb-0.5">CAT aprox</div>
                            <div className="num text-[20px] text-dim"><AnimatedNumber value={cat} format={(v) => `${v.toFixed(1)}%`} /></div>
                          </div>
                          <div className="min-w-[90px] text-right">
                            <div className="eyebrow mb-0.5">Costo total</div>
                            <div className={`num text-[20px] ${isBest ? 'text-bajo' : ''}`}><AnimatedNumber value={cost} format={compact} /></div>
                          </div>
                        </div>
                      </div>
                      <div className="flex items-center gap-3">
                        <Meter pct={ratePct} color={isBest ? '#22C55E' : '#EF4444'} height={5} />
                        <span className="flex-shrink-0 text-[11px] text-dim">
                          {offer.approvalDays === 1 ? 'Aprobación el mismo día' : `Aprobación en ${offer.approvalDays} días`}
                        </span>
                      </div>
                      {isSelected && <OfferBreakdown offer={offer} amount={amount} term={term} />}
                    </div>
                  );
                })}
              </div>
            </article>
          )}

          {selected && eligible.find((o) => o.id === selected) && (
            <article className="card-ink flex items-center justify-between gap-4 px-6 py-5">
              <div className="text-[13.5px]">
                Seleccionado: <span className="font-medium">{eligible.find((o) => o.id === selected)?.institution}</span>
              </div>
              <button type="button" className="h-9 rounded-full bg-ember px-5 text-[12.5px] font-medium hover:bg-ember/85">
                Solicitar crédito →
              </button>
            </article>
          )}
        </div>
      </section>
    </>
  );
}

// ─── Offer breakdown ──────────────────────────────────────────────────

function OfferBreakdown({ offer, amount, term }: { offer: Offer; amount: number; term: number }) {
  const cost = totalCost(amount, offer.monthlyRate, term);

  return (
    <div className="mt-2 rounded-2xl border border-ash/10 bg-dim/8 p-4">
      <div className="eyebrow mb-3">Desglose del crédito</div>
      <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-[12.5px]">
        <span className="text-dim">Capital</span><span className="num"><AnimatedNumber value={amount} format={mxn} /></span>
        <span className="text-dim">Plazo</span><span className="num">{term} días</span>
        <span className="text-dim">Tasa diaria</span><span className="num"><AnimatedNumber value={offer.monthlyRate / 30} format={(v) => `${v.toFixed(3)}%`} /></span>
        <span className="text-dim">Costo del crédito</span><span className="num text-alto"><AnimatedNumber value={cost} format={mxn} /></span>
        <span className="text-dim">Pago total al vencimiento</span><span className="num"><AnimatedNumber value={amount + cost} format={mxn} /></span>
        <span className="text-dim">CAT aproximado</span><span className="num"><AnimatedNumber value={annualizedRate(offer.monthlyRate)} format={(v) => `${v.toFixed(1)}% anual`} /></span>
      </div>
      <div className="mt-3 text-[11px] text-dim">
        * Valores indicativos. La tasa definitiva depende del análisis crediticio del banco.
      </div>
    </div>
  );
}
