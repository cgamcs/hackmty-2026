import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Icon } from '@/components/ui';
import { isDemo, type ObligationRow } from '@/api/client';
import {
  useConnectAccount,
  useObligations,
  useRunSync,
  useSaveCashBuffer,
  useSaveObligation,
  useSaveProfile,
  useSetupStatus,
  useUploadCfdi,
} from '@/api/hooks';
import { mxn } from '@/lib/format';

/**
 * Integration settings — the only place data enters the product.
 *
 * Four steps in order, because each depends on the one before: the account gives us a
 * balance, the CFDI give us invoices, the sync reconciles the two, and the obligations it
 * detects are what the tenant then confirms. Running the sync before uploading CFDI
 * leaves nothing to reconcile and every client on the cold-start default.
 */

const KIND_LABEL: Record<ObligationRow['kind'], string> = {
  payroll: 'Nómina',
  tax: 'Impuestos',
  rent: 'Renta',
  supplier: 'Proveedor',
  utility: 'Servicios',
  other: 'Otro',
};

/** Payroll and taxes have a legal payment date. The API and a CHECK constraint refuse
 *  slack on them too — this only keeps the UI from offering what will be rejected. */
const IMMOVABLE: ObligationRow['kind'][] = ['payroll', 'tax'];

function StepBadge({ done, n }: { done: boolean; n: number }) {
  return (
    <span
      className={`grid size-7 flex-none place-items-center rounded-full text-[12px] font-semibold ${
        done ? 'bg-ember text-ghost' : 'bg-dim/24 text-ash'
      }`}
    >
      {done ? <Icon name="check" size={12} color="#ECEBF3" strokeWidth={2} /> : n}
    </span>
  );
}

function Card({
  n,
  done,
  title,
  hint,
  children,
}: {
  n: number;
  done: boolean;
  title: string;
  hint: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card flex flex-col gap-4 p-6 sm:p-7">
      <header className="flex items-start gap-3">
        <StepBadge done={done} n={n} />
        <div>
          <h2 className="m-0 text-[19px] font-medium tracking-[-.02em]">{title}</h2>
          <p className="m-0 mt-1 text-[13px] leading-relaxed text-dim">{hint}</p>
        </div>
      </header>
      {children}
    </section>
  );
}

const inputCls =
  'h-[46px] w-full rounded-xl border border-ash/18 bg-dim/10 px-4 text-[14px] text-ghost outline-none placeholder:text-dim focus:border-ember';

export default function Ajustes() {
  const { data: setup, isPending, error: setupError } = useSetupStatus();
  const { data: obligations } = useObligations();

  const profile = useSaveProfile();
  const connect = useConnectAccount();
  const upload = useUploadCfdi();
  const sync = useRunSync();
  const saveOb = useSaveObligation();
  const cashBuffer = useSaveCashBuffer();

  const [razonSocial, setRazonSocial] = useState('');
  const [accountNumber, setAccountNumber] = useState('');
  const [buffer, setBuffer] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  // Prefill from the server once it answers, without clobbering an in-progress edit.
  useEffect(() => {
    if (setup?.razon_social && !razonSocial) setRazonSocial(setup.razon_social);
  }, [setup?.razon_social]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (setup?.cash_buffer && !buffer) setBuffer(String(setup.cash_buffer));
  }, [setup?.cash_buffer]);   // eslint-disable-line react-hooks/exhaustive-deps

  if (isDemo) {
    return (
      <section className="card flex flex-col items-start gap-4 p-8">
        <div className="eyebrow">Ajustes</div>
        <h1 className="m-0 text-[32px] font-normal tracking-[-.03em]">Modo demo</h1>
        <p className="m-0 max-w-[560px] text-[14.5px] leading-relaxed text-ash">
          Estás viendo el escenario sembrado; nada se guarda. Para conectar un negocio real,
          quita <code className="rounded bg-dim/20 px-1.5 py-0.5 text-[13px]">VITE_DEMO=1</code> y
          vuelve a cargar.
        </p>
      </section>
    );
  }

  const steps = setup?.steps;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <div className="eyebrow">Ajustes · integración</div>
          <h1 className="m-0 mt-1.5 text-[32px] font-normal tracking-[-.03em] sm:text-[38px]">
            Conecta tu negocio
          </h1>
        </div>
        {setup?.complete && (
          <Link
            to="/dashboard"
            className="flex h-11 items-center rounded-full bg-ember px-[22px] text-[13.5px] font-medium hover:bg-ember/85"
          >
            Ver mi tablero
          </Link>
        )}
      </header>

      {isPending && <div className="card h-32 animate-pulse" />}
      {setupError && (
        <div role="alert" className="card p-6 text-[13.5px] text-alto">
          {setupError.message}
        </div>
      )}

      {steps && (
        <div className="grid gap-4 sm:gap-[18px] lg:grid-cols-2">
          {/* 1 — razón social */}
          <Card
            n={1}
            done={steps.razon_social}
            title="Razón social"
            hint="El nombre fiscal de tu negocio. El RFC lo tomamos de tus CFDI, no hace falta escribirlo."
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={razonSocial}
                onChange={(e) => setRazonSocial(e.target.value)}
                placeholder="Comercializadora del Bajío SA de CV"
                className={inputCls}
              />
              <button
                type="button"
                disabled={!razonSocial.trim() || profile.isPending}
                onClick={() => profile.mutate(razonSocial.trim())}
                className="h-[46px] flex-none rounded-xl bg-ember px-5 text-[13.5px] font-medium disabled:opacity-50"
              >
                {profile.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            {setup?.rfc && (
              <div className="text-[12.5px] text-dim">
                RFC detectado en tus CFDI: <span className="text-ash">{setup.rfc}</span>
              </div>
            )}
            {profile.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(profile.error as Error).message}
              </div>
            )}
          </Card>

          {/* 2 — cuenta operativa */}
          <Card
            n={2}
            done={steps.account}
            title="Cuenta operativa"
            hint="Escribe el número de tu cuenta. Nunca te pedimos la llave de tu banco: la conexión se resuelve del lado del servidor."
          >
            <div className="flex flex-col gap-3 sm:flex-row">
              <input
                value={accountNumber}
                onChange={(e) => setAccountNumber(e.target.value.replace(/\D/g, ''))}
                inputMode="numeric"
                autoComplete="off"
                placeholder="3505305311636760"
                className={`${inputCls} tracking-[.08em]`}
              />
              <button
                type="button"
                disabled={accountNumber.length < 8 || connect.isPending}
                onClick={() => connect.mutate(accountNumber)}
                className="h-[46px] flex-none rounded-xl bg-ember px-5 text-[13.5px] font-medium disabled:opacity-50"
              >
                {connect.isPending ? 'Conectando…' : 'Conectar'}
              </button>
            </div>
            {setup?.account_last4 && (
              <div className="flex items-center gap-2 text-[12.5px] text-dim">
                <Icon name="lock" size={13} color="#6D7275" strokeWidth={1.3} />
                Conectada · terminación {setup.account_last4}. Solo guardamos los últimos
                cuatro dígitos.
              </div>
            )}
            {connect.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(connect.error as Error).message}
              </div>
            )}
          </Card>

          {/* 3 — CFDI */}
          <Card
            n={3}
            done={steps.cfdi}
            title="CFDI"
            hint="Arrastra el ZIP de descarga masiva del SAT o tus XML. Con 6–12 meses aprendemos cuánto tarda en pagarte cada cliente."
          >
            <div
              role="button"
              tabIndex={0}
              onClick={() => fileRef.current?.click()}
              onKeyDown={(e) => e.key === 'Enter' && fileRef.current?.click()}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (e.dataTransfer.files.length) upload.mutate(e.dataTransfer.files);
              }}
              className="hatch flex min-h-[104px] cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-ash/25 px-4 py-5 text-center hover:border-ember"
            >
              <input
                ref={fileRef}
                type="file"
                accept=".xml,.zip"
                multiple
                className="sr-only"
                onChange={(e) => e.target.files?.length && upload.mutate(e.target.files)}
              />
              <span className="text-[13.5px] text-ash">
                {upload.isPending ? 'Procesando…' : 'Arrastra aquí o haz clic'}
              </span>
              <span className="text-[12px] text-dim">XML o ZIP · .xml, .zip</span>
            </div>
            {setup && setup.counts.cfdi > 0 && (
              <div className="text-[12.5px] text-dim">
                {setup.counts.cfdi} comprobantes guardados ·{' '}
                <Link to="/settings/cfdi" className="text-ash underline underline-offset-2">
                  ver detalle
                </Link>
              </div>
            )}
            {upload.isSuccess && (
              <div role="status" className="text-[13px] text-ash">
                {upload.data.parsed} procesados
                {upload.data.skipped > 0 && ` · ${upload.data.skipped} ilegibles`}
              </div>
            )}
            {upload.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(upload.error as Error).message}
              </div>
            )}
          </Card>

          {/* 4 — sincronizar */}
          <Card
            n={4}
            done={steps.synced}
            title="Sincronizar"
            hint="Traemos tus movimientos, los cruzamos contra tus CFDI y medimos el plazo real de cada cliente. Corre esto después de subir los CFDI."
          >
            <button
              type="button"
              disabled={!steps.account || sync.isPending}
              onClick={() => sync.mutate(undefined as never)}
              className="h-[46px] rounded-xl bg-ember px-5 text-[13.5px] font-medium disabled:opacity-50"
            >
              {sync.isPending ? 'Sincronizando…' : 'Sincronizar ahora'}
            </button>
            {!steps.account && (
              <div className="text-[12.5px] text-dim">Conecta tu cuenta primero.</div>
            )}
            {sync.isSuccess && (
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 text-[12.5px]">
                <dt className="text-dim">Saldo</dt>
                <dd className="m-0 text-ash">{mxn(sync.data.balance)}</dd>
                <dt className="text-dim">Movimientos</dt>
                <dd className="m-0 text-ash">
                  {sync.data.flows.deposits + sync.data.flows.purchases + sync.data.flows.withdrawals}
                </dd>
                <dt className="text-dim">CFDI conciliados</dt>
                <dd className="m-0 text-ash">{sync.data.matched}</dd>
                <dt className="text-dim">Por cobrar abiertas</dt>
                <dd className="m-0 text-ash">{sync.data.open_receivables}</dd>
                <dt className="text-dim">Plazos aprendidos</dt>
                <dd className="m-0 text-ash">{sync.data.terms}</dd>
              </dl>
            )}
            {sync.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(sync.error as Error).message}
              </div>
            )}
          </Card>

          {/* 5 — fechas y holgura */}
          <section className="card col-span-full flex flex-col gap-4 p-6 sm:p-7">
            <header className="flex items-start gap-3">
              <StepBadge done={steps.obligations} n={5} />
              <div>
                <h2 className="m-0 text-[19px] font-medium tracking-[-.02em]">
                  Fechas de pago y holgura
                </h2>
                <p className="m-0 mt-1 max-w-[680px] text-[13px] leading-relaxed text-dim">
                  Las detectamos de tu banco al sincronizar. Marca cuáles pueden moverse y
                  cuántos días toleran. Si no indicas holgura, asumimos cero: la escalera
                  solo propone mover un pago cuando hay evidencia de que se puede.
                </p>
              </div>
            </header>

            {!obligations?.length ? (
              <div className="text-[13px] text-dim">
                {steps.synced
                  ? 'No encontramos obligaciones recurrentes en tu cuenta.'
                  : 'Sincroniza para detectarlas.'}
              </div>
            ) : (
              <ul className="m-0 flex list-none flex-col gap-2 p-0">
                {obligations.map((ob) => {
                  const locked = IMMOVABLE.includes(ob.kind);
                  return (
                    <li
                      key={ob.id}
                      className="flex flex-wrap items-center gap-3 rounded-xl border border-ash/12 px-4 py-3"
                    >
                      <span className="min-w-[190px] flex-1 text-[14px]">{ob.payee}</span>
                      <span className="tag tag-muted">{KIND_LABEL[ob.kind]}</span>
                      <span className="text-[13px] text-dim">día {ob.day_of_month}</span>
                      <span className="min-w-[110px] text-right text-[14px] tabular-nums">
                        {mxn(ob.amount)}
                      </span>

                      {locked ? (
                        <span className="flex items-center gap-1.5 text-[12.5px] text-dim">
                          <Icon name="lock" size={12} color="#6D7275" strokeWidth={1.4} />
                          Fecha legal · no se mueve
                        </span>
                      ) : (
                        <label className="flex items-center gap-2 text-[12.5px] text-ash">
                          Holgura
                          <input
                            type="number"
                            min={0}
                            max={60}
                            defaultValue={ob.slack_days}
                            onBlur={(e) => {
                              const slack = Math.max(0, Number(e.target.value) || 0);
                              if (slack === ob.slack_days) return;
                              saveOb.mutate({
                                id: ob.id,
                                rigidity: slack > 0 ? 'slack' : 'hard',
                                slack_days: slack,
                              });
                            }}
                            className="h-9 w-[68px] rounded-lg border border-ash/18 bg-dim/10 px-2 text-center text-[13px] text-ghost outline-none focus:border-ember"
                          />
                          días
                        </label>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
            {saveOb.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(saveOb.error as Error).message}
              </div>
            )}
          </section>

          {/* optional — colchón de efectivo */}
          <section className="card col-span-full flex flex-col gap-4 p-6 sm:p-7">
            <header>
              <div className="eyebrow">Opcional</div>
              <h2 className="m-0 mt-1 text-[19px] font-medium tracking-[-.02em]">
                Colchón de efectivo
              </h2>
              <p className="m-0 mt-1 max-w-[680px] text-[13px] leading-relaxed text-dim">
                Dinero que puedes pasar a tu cuenta operativa si hace falta: ahorros u otra
                cuenta. No incluyas el saldo de tu cuenta operativa, ya lo contamos. La escalera
                lo usa antes de sugerir un crédito.
              </p>
            </header>
            <div className="flex flex-col gap-3 sm:max-w-[520px] sm:flex-row">
              <label htmlFor="cash-buffer" className="sr-only">
                Colchón de efectivo en pesos
              </label>
              <input
                id="cash-buffer"
                value={buffer}
                onChange={(e) => setBuffer(e.target.value.replace(/[^\d.]/g, ''))}
                inputMode="decimal"
                autoComplete="off"
                placeholder="0"
                className={`${inputCls} tabular-nums`}
              />
              <button
                type="button"
                disabled={buffer === '' || Number.isNaN(Number(buffer)) || cashBuffer.isPending}
                onClick={() => cashBuffer.mutate(Number(buffer))}
                className="h-[46px] flex-none rounded-xl bg-ember px-5 text-[13.5px] font-medium disabled:opacity-50"
              >
                {cashBuffer.isPending ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
            {cashBuffer.isSuccess && (
              <div role="status" className="text-[13px] text-ash">
                Colchón guardado: {mxn(cashBuffer.data.cash_buffer)}
              </div>
            )}
            {cashBuffer.isError && (
              <div role="alert" className="text-[13px] text-alto">
                {(cashBuffer.error as Error).message}
              </div>
            )}
          </section>
        </div>
      )}
    </>
  );
}
