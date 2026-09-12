import { useState, useRef } from 'react';
import type { DashboardData } from '@/types';
import { QueryGate } from '@/components/QueryGate';
import { Icon, Meter } from '@/components/ui';
import { mxn, compact, shortDate } from '@/lib/format';

// ─── Mock import result ───────────────────────────────────────────────

interface ImportResult {
  emitidos: number;
  recibidos: number;
  matchedMovements: number;
  totalMovements: number;
  receivableTotal: number;
  payableTotal: number;
  errors: { folio: string; reason: string }[];
  dsoByClient: { client: string; dso: number; amount: number }[];
}

const MOCK_RESULT: ImportResult = {
  emitidos: 14,
  recibidos: 22,
  matchedMovements: 89,
  totalMovements: 142,
  receivableTotal: 684300,
  payableTotal: 498700,
  errors: [
    { folio: 'A-4210', reason: 'RFC emisor no coincide con el configurado' },
    { folio: 'A-4189', reason: 'XML malformado · complemento de pago ausente' },
  ],
  dsoByClient: [
    { client: 'Grupo Ibarra',        dso: 4,  amount: 186000 },
    { client: 'Ferretera del Golfo', dso: 9,  amount: 132400 },
    { client: 'Constructora Vega',   dso: 11, amount: 148000 },
    { client: 'Obras Monclova',      dso: 18, amount: 96000  },
    { client: 'Instalaciones Rueda', dso: 34, amount: 74500  },
    { client: 'Talleres Sur',        dso: 52, amount: 47400  },
  ],
};

type UploadState = 'idle' | 'processing' | 'done';

// ─── Page ────────────────────────────────────────────────────────────

export default function CfdiConfig() {
  return <QueryGate>{(d) => <CfdiConfigView d={d} />}</QueryGate>;
}

function CfdiConfigView({ d }: { d: DashboardData }) {
  const [uploadState, setUploadState] = useState<UploadState>('idle');
  const [result, setResult] = useState<ImportResult | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [fileNames, setFileNames] = useState<string[]>([]);
  const [bankConnected, setBankConnected] = useState(true);
  const inputRef = useRef<HTMLInputElement>(null);

  function handleFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setFileNames(Array.from(files).map((f) => f.name));
    setUploadState('processing');
    setTimeout(() => { setUploadState('done'); setResult(MOCK_RESULT); }, 1800);
  }

  function reset() {
    setUploadState('idle');
    setResult(null);
    setFileNames([]);
    if (inputRef.current) inputRef.current.value = '';
  }

  const matchPct = result ? (result.matchedMovements / result.totalMovements) * 100 : 0;
  const agingTotal = d.cfdi.aging.reduce((s, b) => s + b.amount, 0) || 1;

  return (
    <>
      <section className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 pt-1 sm:gap-y-5">
        <div className="min-w-0">
          <div className="eyebrow mb-3">Integración · CFDI y banco</div>
          <h1 className="m-0 text-[clamp(28px,5.5vw,52px)] font-normal leading-[1.02] tracking-[-.035em]">
            Sube tus CFDI y conecta tu cuenta
          </h1>
          <p className="m-0 mt-3.5 text-[13.5px] text-dim">
            Arrastra tus XML o el ZIP de descarga masiva del SAT. Tu llave bancaria nunca llega al navegador.
          </p>
        </div>

        {bankConnected && (
          <div className="flex h-[52px] items-center gap-3 rounded-full border border-bajo/40 bg-bajo/12 px-5">
            <span className="size-2 rounded-full bg-bajo" />
            <div className="text-[12.5px]">
              <span className="font-medium text-bajo">Nessie live</span>
              <span className="ml-1.5 text-dim">{d.account.bank} · {d.account.id.slice(0, 8)}</span>
            </div>
          </div>
        )}
      </section>

      <section className="grid gap-4 sm:gap-[18px] xl:grid-cols-[1fr_380px]">

        {/* ─── Upload + results ─── */}
        <div className="flex flex-col gap-4 sm:gap-[18px]">

          {uploadState === 'idle' && (
            <article
              className={`card flex min-h-[240px] cursor-pointer flex-col items-center justify-center gap-4 p-8 transition-colors ${dragOver ? 'border-ember/60 bg-ember/8' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files); }}
              onClick={() => inputRef.current?.click()}
              role="button" tabIndex={0}
              onKeyDown={(e) => e.key === 'Enter' && inputRef.current?.click()}
              aria-label="Zona de carga de CFDI"
            >
              <input ref={inputRef} type="file" accept=".xml,.zip" multiple className="sr-only" onChange={(e) => handleFiles(e.target.files)} />
              <span className={`grid size-14 place-items-center rounded-full ${dragOver ? 'bg-ember/20' : 'bg-dim/20'}`}>
                <UploadIcon dragOver={dragOver} />
              </span>
              <div className="text-center">
                <div className="text-[15px] font-medium">{dragOver ? 'Suelta los archivos aquí' : 'Arrastra tus CFDI aquí'}</div>
                <div className="mt-1.5 text-[12.5px] text-dim">
                  Acepta <span className="font-mono">.xml</span> individuales o un <span className="font-mono">.zip</span> de descarga masiva del SAT
                </div>
              </div>
              <div className="flex items-center gap-3">
                <div className="h-px w-12 bg-ash/20" />
                <span className="text-[11.5px] text-dim">o</span>
                <div className="h-px w-12 bg-ash/20" />
              </div>
              <span className="pointer-events-none h-9 rounded-full border border-ash/20 px-5 text-[12.5px] text-dim">
                Seleccionar archivos
              </span>
            </article>
          )}

          {uploadState === 'processing' && (
            <article className="card flex min-h-[240px] flex-col items-center justify-center gap-4 p-8">
              <div className="size-10 animate-spin rounded-full border-2 border-ember/30 border-t-ember" />
              <div className="text-center">
                <div className="text-[15px] font-medium">Procesando CFDI…</div>
                <div className="mt-1.5 text-[12.5px] text-dim">{fileNames.join(', ')}</div>
              </div>
            </article>
          )}

          {uploadState === 'done' && result && (
            <div className="flex flex-col gap-4 sm:gap-[18px]">
              <article className="card flex flex-col gap-5 p-6">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2.5">
                    <span className="grid size-8 place-items-center rounded-full bg-bajo/16">
                      <Icon name="check" size={13} color="#22C55E" strokeWidth={1.8} />
                    </span>
                    <h2 className="m-0 text-[17px] font-medium">Importación completada</h2>
                  </div>
                  <button type="button" onClick={reset} className="text-[11.5px] text-dim hover:text-ghost">
                    Nueva importación
                  </button>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <StatBox label="CFDI emitidos" value={String(result.emitidos)} sub="sin cobrar" color="#C20114" />
                  <StatBox label="CFDI recibidos" value={String(result.recibidos)} sub="sin pagar" color="#6D7275" />
                  <StatBox label="Por cobrar" value={compact(result.receivableTotal)} sub={`${result.emitidos} facturas`} color="#C20114" />
                  <StatBox label="Por pagar" value={compact(result.payableTotal)} sub={`${result.recibidos} facturas`} color="#6D7275" />
                </div>

                <div className="flex flex-col gap-2 border-t border-ash/10 pt-4">
                  <div className="flex items-center justify-between text-[12.5px]">
                    <div className="eyebrow">Tasa de conciliación con movimientos bancarios</div>
                    <span className="num text-[16px] font-medium text-bajo">{Math.round(matchPct)}%</span>
                  </div>
                  <Meter pct={matchPct} color="#22C55E" height={8} />
                  <div className="flex justify-between text-[11.5px] text-dim">
                    <span>{result.matchedMovements} movimientos conciliados</span>
                    <span>{result.totalMovements - result.matchedMovements} sin CFDI</span>
                  </div>
                </div>
              </article>

              {result.errors.length > 0 && (
                <article className="card-alert flex flex-col gap-3 p-5">
                  <div className="eyebrow">{result.errors.length} CFDI con errores</div>
                  {result.errors.map((e) => (
                    <div key={e.folio} className="flex items-start gap-3 border-t border-ember/16 pt-3">
                      <span className="mt-0.5 grid size-6 flex-none place-items-center rounded-full bg-ember/20">
                        <Icon name="alert" size={10} color="#C20114" strokeWidth={1.5} />
                      </span>
                      <div>
                        <div className="font-mono text-[12px]">{e.folio}</div>
                        <div className="mt-0.5 text-[12px] text-dim">{e.reason}</div>
                      </div>
                    </div>
                  ))}
                </article>
              )}

              <article className="card overflow-hidden">
                <div className="flex items-center justify-between border-b border-ash/10 px-6 py-5">
                  <h2 className="m-0 text-[17px] font-medium">DSO por cliente</h2>
                  <span className="eyebrow">días promedio de pago</span>
                </div>
                <div className="flex flex-col">
                  {result.dsoByClient.map((row, i) => {
                    const maxDso = Math.max(...result.dsoByClient.map((r) => r.dso));
                    const dsoColor = row.dso <= 10 ? '#22C55E' : row.dso <= 25 ? '#F59E0B' : '#EF4444';
                    return (
                      <div key={row.client} className={`flex items-center gap-4 px-6 py-4 ${i < result.dsoByClient.length - 1 ? 'border-b border-ash/8' : ''}`}>
                        <div className="min-w-0 flex-1 text-[13px]">{row.client}</div>
                        <div className="w-[120px] flex-none"><Meter pct={(row.dso / maxDso) * 100} color={dsoColor} height={6} /></div>
                        <div className="num w-14 flex-none text-right text-[13px]" style={{ color: dsoColor }}>{row.dso} d</div>
                        <div className="num w-24 flex-none text-right text-[12.5px] text-dim">{compact(row.amount)}</div>
                      </div>
                    );
                  })}
                </div>
              </article>
            </div>
          )}
        </div>

        {/* ─── Right panel ─── */}
        <div className="flex flex-col gap-4 sm:gap-[18px]">

          <article className="card flex flex-col gap-5 p-6">
            <div className="eyebrow">Cuenta bancaria</div>
            {bankConnected ? (
              <>
                <div className="flex items-center gap-3.5">
                  <span className="grid size-10 flex-none place-items-center rounded-full bg-bajo/14">
                    <Icon name="wallet" size={14} color="#22C55E" strokeWidth={1.5} />
                  </span>
                  <div>
                    <div className="text-[14px] font-medium">{d.account.bank} · {d.account.nickname}</div>
                    <div className="mt-0.5 font-mono text-[11px] text-dim">···· ···· ···· {d.account.id.slice(-4).toUpperCase()}</div>
                  </div>
                </div>
                <div className="flex flex-col gap-2 border-t border-ash/10 pt-4">
                  <BankRow label="Balance actual" value={mxn(d.account.balance)} />
                  <BankRow label="Actualizado" value={d.account.balanceAt} />
                  <BankRow label="Estado" value="Nessie live" color="#22C55E" />
                </div>
                <button type="button" onClick={() => setBankConnected(false)} className="text-left text-[11.5px] text-dim hover:text-alto">
                  Desconectar cuenta
                </button>
              </>
            ) : (
              <div className="flex flex-col gap-4">
                <div className="text-[13px] text-dim">
                  Conecta tu cuenta de Capital One vía Nessie para conciliar movimientos en tiempo real.
                  Tu llave bancaria nunca llega al servidor.
                </div>
                <div className="flex flex-col gap-2">
                  <label className="eyebrow" htmlFor="clabe">CLABE interbancaria</label>
                  <input
                    id="clabe" type="text" placeholder="18 dígitos" maxLength={18}
                    className="w-full rounded-2xl border border-ash/16 bg-dim/10 px-4 py-3 font-mono text-[13px] focus:border-ember/60 focus:outline-none"
                  />
                </div>
                <button type="button" onClick={() => setBankConnected(true)} className="h-10 rounded-full bg-ember px-5 text-[12.5px] font-medium hover:bg-ember/85">
                  Conectar con Nessie
                </button>
                <div className="flex items-center gap-1.5 text-[11px] text-dim">
                  <Icon name="lock" size={10} color="#6D7275" strokeWidth={1.5} />
                  Tu CLABE nunca abandona el navegador
                </div>
              </div>
            )}
          </article>

          <article className="card flex flex-col gap-4 p-6">
            <div className="eyebrow">RFC del negocio</div>
            <div className="flex items-center gap-3">
              <span className="font-mono text-[16px]">{d.business.rfc}</span>
              <span className="tag tag-bajo">Verificado</span>
            </div>
            <div className="text-[12px] text-dim">Los CFDI que no coincidan con este RFC serán marcados como error.</div>
          </article>

          <article className="card-ink flex flex-col gap-4 p-6">
            <div className="eyebrow">Resumen CFDI actual</div>
            <div className="flex gap-8">
              <div>
                <div className="mb-1 text-[11.5px] text-dim">Emitidos sin cobrar</div>
                <div className="num text-[24px]">{mxn(d.cfdi.receivableTotal)}</div>
                <div className="font-mono text-[10.5px] text-dim">{d.cfdi.receivableCount} facturas</div>
              </div>
              <div>
                <div className="mb-1 text-[11.5px] text-dim">Recibidos sin pagar</div>
                <div className="num text-[24px]">{mxn(d.cfdi.payableTotal)}</div>
                <div className="font-mono text-[10.5px] text-dim">{d.cfdi.payableCount} facturas</div>
              </div>
            </div>
            <div className="border-t border-ash/12 pt-3">
              <div className="eyebrow mb-2.5">Antigüedad de cobranza</div>
              {d.cfdi.aging.map((b) => (
                <div key={b.label} className="flex items-center gap-3 py-1.5">
                  <div className="w-12 flex-none font-mono text-[10.5px] text-dim">{b.label}</div>
                  <Meter pct={(b.amount / agingTotal) * 100} color="#C20114" height={6} />
                  <div className="num w-16 flex-none text-right text-[11.5px]">{compact(b.amount)}</div>
                </div>
              ))}
            </div>
            <div className="text-[11px] text-dim">Última actualización: {shortDate(d.today)}</div>
          </article>
        </div>
      </section>
    </>
  );
}

// ─── Sub-components ───────────────────────────────────────────────────

function StatBox({ label, value, sub, color }: { label: string; value: string; sub: string; color: string }) {
  return (
    <div className="rounded-2xl border border-ash/10 bg-dim/8 p-4">
      <div className="eyebrow mb-2">{label}</div>
      <div className="num text-[22px] leading-none" style={{ color }}>{value}</div>
      <div className="mt-1.5 text-[11px] text-dim">{sub}</div>
    </div>
  );
}

function BankRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div className="flex items-center justify-between text-[12.5px]">
      <span className="text-dim">{label}</span>
      <span className="num" style={{ color }}>{value}</span>
    </div>
  );
}

function UploadIcon({ dragOver }: { dragOver: boolean }) {
  return (
    <svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke={dragOver ? '#C20114' : '#6D7275'} strokeWidth="1.5" aria-hidden="true">
      <path d="M11 14V4" /><polyline points="7,8 11,4 15,8" /><path d="M4 16v1a2 2 0 002 2h10a2 2 0 002-2v-1" />
    </svg>
  );
}
