// "Timing gap" scenario (CONCEPT.md §8): net positive over 30 days, dips below
// payroll on 6 oct. Forecast values are taken from the Claude Design handoff.

import type { DailyFlow, DashboardData, ForecastPoint, OperatingAccount, Payable, Receivable } from '@/types';
import { addDays } from '@/lib/format';
import { buildLadder, classifyGap, detectBreach, riskLevel } from './engine';

const TODAY = '2026-09-12';

const EXPECTED = [
  412500, 429300, 451800, 430500, 438200, 440100, 435000, 599600, 616600, 578000, 594900, 602400, 586200, 603000, 715800,
  536600, 559300, 576100, 557600, 559500, 576300, 549100, 565900, 588400, 393200, 400800, 588800, 574600, 591300, 682100,
  646700,
];
const PESSIMISTIC = [
  412500, 422500, 436300, 408300, 411700, 411000, 398900, 482900, 492900, 445800, 455600, 459200, 440500, 450500, 508400,
  322200, 336200, 346100, 323400, 323000, 332800, 298800, 308600, 322600, 120485, 124000, 216300, 195300, 205300, 252200,
  208000,
];

const forecast: ForecastPoint[] = EXPECTED.map((expected, i) => ({
  date: addDays(TODAY, i),
  expected,
  pessimistic: PESSIMISTIC[i],
}));

const INFLOW_PCT = [34, 46, 44, 43, 41, 24, 14, 36, 35, 47, 45, 43, 24, 14];
const OUTFLOW_PCT = [9, 16, 22, 29, 14, 72, 27, 12, 19, 25, 10, 54, 23, 30];
const cashflow: DailyFlow[] = INFLOW_PCT.map((pct, i) => ({
  date: addDays(TODAY, i - 13),
  inflow: Math.round((pct * 1360) / 10) * 10,
  outflow: Math.round((OUTFLOW_PCT[i] * 1360 * 1.209) / 10) * 10,
}));

const receivables: Receivable[] = [
  { id: 'r1', folio: 'A-4501', client: 'Grupo Ibarra', amount: 186000, dueDate: '2026-10-08', dsoDays: 4, accelerable: true },
  { id: 'r2', folio: 'A-4482', client: 'Constructora Vega', amount: 148000, dueDate: '2026-09-19', dsoDays: 11, accelerable: false },
  { id: 'r3', folio: 'A-4476', client: 'Ferretera del Golfo', amount: 132400, dueDate: '2026-09-22', dsoDays: 9, accelerable: true },
  { id: 'r4', folio: 'A-4463', client: 'Obras Monclova', amount: 96000, dueDate: '2026-09-14', dsoDays: 18, accelerable: false },
  { id: 'r5', folio: 'A-4390', client: 'Instalaciones Rueda', amount: 74500, dueDate: '2026-09-02', dsoDays: 34, accelerable: false },
  { id: 'r6', folio: 'A-4351', client: 'Talleres Sur', amount: 47400, dueDate: '2026-08-18', dsoDays: 52, accelerable: false },
];

const payables: Payable[] = [
  { id: 'p1', payee: 'Nómina quincena 1 · octubre', reference: 'CFDI tipo N · 18 empleados', kind: 'PAYROLL', amount: 212000, dueDate: '2026-10-06', rigidity: 'hard', slackDays: 0 },
  { id: 'p2', payee: 'SAT · IVA e ISR', reference: 'Calendario fiscal día 17', kind: 'TAXES', amount: 61000, dueDate: '2026-09-17', rigidity: 'hard', slackDays: 0 },
  { id: 'p3', payee: 'Aceros del Norte', reference: 'B-9921 · PPD 30 d', kind: 'SUPPLIER', amount: 86400, dueDate: '2026-10-06', rigidity: 'slack', slackDays: 12 },
  { id: 'p4', payee: 'Herrajes Peña', reference: 'B-9878 · PPD 30 d', kind: 'SUPPLIER', amount: 48600, dueDate: '2026-09-28', rigidity: 'slack', slackDays: 8 },
  { id: 'p5', payee: 'Pinturas Elite', reference: 'B-9844 · PPD 15 d', kind: 'SUPPLIER', amount: 32900, dueDate: '2026-09-24', rigidity: 'slack', slackDays: 5 },
  { id: 'p6', payee: 'Arrendadora Zaragoza', reference: 'Renta del local · fijo', kind: 'RENT', amount: 48000, dueDate: '2026-10-05', rigidity: 'hard', slackDays: 0 },
  { id: 'p7', payee: 'Nómina quincena 2', reference: 'CFDI tipo N · 18 empleados', kind: 'PAYROLL', amount: 196000, dueDate: '2026-09-25', rigidity: 'hard', slackDays: 0 },
];

const account: OperatingAccount = {
  id: '5bc495a1-3d2b-4b15-8dcd-334691933d48',
  nickname: 'Operativa',
  bank: 'Capital One',
  balance: 412500,
  balanceAt: '12 sep 2026, 08:41',
  live: true,
};

export function buildScenario(): DashboardData {
  const income30 = { total: 684210, changePct: 8.4, cash: 401500, cfdi: 282800 };
  const breach = detectBreach(forecast, payables, TODAY);
  const gap = classifyGap(forecast, breach);
  const { risk, residualPct } = riskLevel(gap, breach?.shortfall ?? 0, income30.total);
  const bufferAvailable = 74200;

  return {
    today: TODAY,
    business: { name: 'Ferretería Monterrey Norte', rfc: 'FMN150922J41', owner: 'Mariana Villarreal', ownerInitials: 'MV' },
    account,
    accounts: [account],
    healthScore: 61,
    resilienceScore: 48,
    collection: { collectedPct: 58, receivablePct: 28, overduePct: 14 },
    income30,
    expense30: {
      total: 612940,
      changePct: 3.1,
      lines: [
        { label: 'Nómina · rígido', amount: 408000 },
        { label: 'Proveedores PPD', amount: 146300 },
        { label: 'Fijos y servicios', amount: 58640 },
      ],
    },
    cfdi: {
      receivableTotal: 684300,
      receivableCount: 14,
      payableTotal: 498700,
      payableCount: 22,
      aging: [
        { label: '0–15 d', amount: 396900 },
        { label: '16–30 d', amount: 177900 },
        { label: '31–60 d', amount: 82100 },
        { label: '60+ d', amount: 27400 },
      ],
    },
    cashflow,
    movementsCount: 142,
    movements: [
      { id: 'm1', date: '2026-09-11', description: 'Depósito · ventas de mostrador', amount: 28400, type: 'deposit' },
      { id: 'm2', date: '2026-09-11', description: 'Compra · Aceros del Norte', amount: -41780, type: 'purchase' },
      { id: 'm3', date: '2026-09-10', description: 'Depósito · Constructora Vega', amount: 96000, type: 'deposit', cfdi: 'A-4471' },
      { id: 'm4', date: '2026-09-10', description: 'Retiro · nómina quincenal', amount: -196000, type: 'withdrawal', cfdi: 'N' },
      { id: 'm5', date: '2026-09-09', description: 'Compra · Herrajes Peña', amount: -18240, type: 'purchase' },
      { id: 'm6', date: '2026-09-09', description: 'Depósito · ventas de mostrador', amount: 21950, type: 'deposit' },
      { id: 'm7', date: '2026-09-08', description: 'Compra · Pinturas Elite', amount: -12600, type: 'purchase' },
      { id: 'm8', date: '2026-09-08', description: 'Depósito · Grupo Ibarra', amount: 74300, type: 'deposit', cfdi: 'A-4468' },
    ],
    receivables,
    payables,
    settled: [
      { id: 's1', payee: 'Nómina quincena 1', kind: 'PAYROLL', amount: 196000, date: '2026-09-10' },
      { id: 's2', payee: 'Renta local', kind: 'RENT', amount: 48000, date: '2026-09-05' },
    ],
    forecast,
    bufferAvailable,
    breach,
    gap,
    risk,
    residualPct,
    ladder: buildLadder(breach, gap, receivables, payables, bufferAvailable),
  };
}
