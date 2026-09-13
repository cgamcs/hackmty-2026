// Client-side stand-in for the FastAPI engine, used only with VITE_DEMO=1.
// The real deterministic Python engine runs on the backend; this mirrors its rules
// so the seeded demo numbers stay internally consistent.

import type { Breach, ForecastPoint, GapKind, ISODate, Ladder, LadderStep, Payable, Receivable, RiskLevel } from '@/types';
import { addDays, dayDiff, plural } from '@/lib/format';

const RIGIDITY_ORDER = { hard: 0, slack: 1 } as const;
/** Default deferral requested from a supplier, never beyond its slack. */
export const SHIFT_DAYS = 5;
/** Credit amount = residual shortfall + margin. */
export const CREDIT_MARGIN = 0.15;

/** Phase 5 — the first obligation the pessimistic balance cannot cover. */
export function detectBreach(forecast: ForecastPoint[], payables: Payable[], today: ISODate): Breach | null {
  const pessimistic = new Map(forecast.map((p) => [p.date, p.pessimistic]));
  const ordered = [...payables].sort(
    (a, b) => a.dueDate.localeCompare(b.dueDate) || RIGIDITY_ORDER[a.rigidity] - RIGIDITY_ORDER[b.rigidity],
  );
  for (const obligation of ordered) {
    const balance = pessimistic.get(obligation.dueDate);
    if (balance !== undefined && balance < obligation.amount) {
      return {
        date: obligation.dueDate,
        obligation,
        balance,
        shortfall: obligation.amount - balance,
        daysUntil: dayDiff(today, obligation.dueDate),
      };
    }
  }
  return null;
}

/** Phase 6 — a dip that recovers is a calendar problem; a sustained shortfall is insolvency. */
export function classifyGap(forecast: ForecastPoint[], breach: Breach | null): GapKind {
  if (!breach) return 'NONE';
  const first = forecast[0];
  const last = forecast[forecast.length - 1];
  const net = last.expected - first.expected;
  const recovers = last.pessimistic > breach.balance;
  return net >= 0 && recovers ? 'TIMING' : 'STRUCTURAL';
}

/** Same grade as financial_engine.risk_level, so demo mode reads like the real product:
 *  structural is CRITICO; a breach within 7 days or worth 20%+ of monthly inflow is ALTO;
 *  any other breach is MEDIO; with no breach, health below 70 is MEDIO. */
export function riskLevel(
  gap: GapKind,
  breach: Breach | null,
  monthlyInflow: number,
  healthScore: number,
): { risk: RiskLevel; residualPct: number } {
  const residualPct = breach ? (monthlyInflow > 0 ? breach.shortfall / monthlyInflow : 1) : 0;
  if (gap === 'STRUCTURAL') return { risk: 'CRITICO', residualPct };
  if (!breach) return { risk: healthScore >= 70 ? 'BAJO' : 'MEDIO', residualPct };
  return { risk: breach.daysUntil <= 7 || residualPct >= 0.2 ? 'ALTO' : 'MEDIO', residualPct };
}

/** Phase 7 — cheapest first, credit last. Each rung is applied only while a gap remains. */
export function buildLadder(
  breach: Breach | null,
  gap: GapKind,
  receivables: Receivable[],
  payables: Payable[],
  buffer: number,
): Ladder {
  if (!breach) {
    return { steps: [], residual: 0, creditAmount: 0, creditDeclined: false, adjustedMin: null };
  }

  // 1 — an open receivable landing after the breach that can be pulled forward.
  const receivable = receivables
    .filter((r) => r.accelerable && r.dueDate > breach.date)
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate))[0];
  const daysEarly = receivable ? dayDiff(breach.date, receivable.dueDate) : 0;

  // 2 — a payable with slack that can move past the breach date.
  const shiftable = payables
    .filter((p) => p.rigidity === 'slack' && p.dueDate <= breach.date)
    .filter((p) => addDays(p.dueDate, Math.min(p.slackDays, SHIFT_DAYS)) > breach.date)
    .sort((a, b) => b.amount - a.amount)[0];
  const shiftDays = shiftable ? Math.min(shiftable.slackDays, SHIFT_DAYS) : 0;

  const candidates: Omit<LadderStep, 'applied'>[] = [
    {
      rung: 'ACCELERATE',
      short: '1 · Cobranza',
      title: receivable ? `Adelantar cobranza ${receivable.folio}` : 'Adelantar cobranza',
      phrase: receivable ? `adelantando ${receivable.folio} ${plural(daysEarly, 'día', 'días')}` : '',
      closes: receivable?.amount ?? 0,
      available: Boolean(receivable),
    },
    {
      rung: 'SHIFT',
      short: '2 · Diferir pagos',
      title: shiftable ? `Diferir ${shiftable.payee} ${shiftDays} d` : 'Diferir pagos',
      phrase: shiftable ? `difiriendo ${shiftable.payee} ${plural(shiftDays, 'día', 'días')}` : '',
      closes: shiftable?.amount ?? 0,
      available: Boolean(shiftable),
    },
    {
      rung: 'BUFFER',
      short: '3 · Buffer',
      title: 'Usar buffer de caja',
      phrase: 'usando el buffer de caja',
      closes: buffer,
      available: buffer > 0,
    },
  ];

  if (gap === 'STRUCTURAL') {
    // Say so: the ladder cannot fix insolvency and credit makes it worse.
    const steps = candidates.map((c) => ({ ...c, applied: false }));
    steps.push({ rung: 'CREDIT', short: '4 · Crédito', title: 'Crédito · no recomendado', phrase: '', closes: 0, available: false, applied: false });
    return { steps, residual: breach.shortfall, creditAmount: 0, creditDeclined: true, adjustedMin: breach.balance };
  }

  let remaining = breach.shortfall;
  let closed = 0;
  const steps: LadderStep[] = candidates.map((c) => {
    const applied = c.available && remaining > 0;
    if (applied) {
      remaining -= c.closes;
      closed += c.closes;
    }
    return { ...c, applied };
  });
  const residual = Math.max(0, remaining);
  const creditAmount = residual > 0 ? Math.ceil((residual * (1 + CREDIT_MARGIN)) / 1000) * 1000 : 0;
  steps.push({
    rung: 'CREDIT',
    short: '4 · Crédito',
    title: residual > 0 ? 'Crédito puente' : 'Crédito · no requerido',
    phrase: 'con crédito puente',
    closes: creditAmount,
    available: residual > 0,
    applied: residual > 0,
  });

  return { steps, residual, creditAmount, creditDeclined: false, adjustedMin: breach.balance + closed };
}
