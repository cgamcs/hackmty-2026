// Domain types mirroring the FastAPI contract documented in README.md.
// CFDI = obligation layer, Nessie = settlement layer.

export type ISODate = string;

/** Phase 6 — the single most important piece of intelligence. */
export type GapKind = 'NONE' | 'TIMING' | 'STRUCTURAL';

export type RiskLevel = 'BAJO' | 'MEDIO' | 'ALTO' | 'CRITICO';

/** Payroll and taxes are hard obligations; a supplier PPD may have proven slack. */
export type Rigidity = 'hard' | 'slack';

export type ObligationKind = 'PAYROLL' | 'TAXES' | 'SUPPLIER' | 'RENT';

export interface Business {
  name: string;
  rfc: string;
  owner: string;
  ownerInitials: string;
}

export interface OperatingAccount {
  id: string;
  nickname: string;
  bank: string;
  /** Real Nessie `account.balance`. */
  balance: number;
  balanceAt: string;
  live: boolean;
}

/** Open receivable: CFDI emitido, MetodoPago="PPD", no matching deposit. */
export interface Receivable {
  id: string;
  folio: string;
  client: string;
  amount: number;
  dueDate: ISODate;
  /** Real DSO learned from CFDI ↔ deposit matching. */
  dsoDays: number;
  /** Client historically pays early when asked. */
  accelerable: boolean;
}

/** Open payable or fixed obligation (CFDI recibido PPD, nómina, SAT, Nessie bill). */
export interface Payable {
  id: string;
  payee: string;
  reference: string;
  kind: ObligationKind;
  amount: number;
  dueDate: ISODate;
  rigidity: Rigidity;
  /** Days it can move without breaking a legal date (0 for hard). */
  slackDays: number;
}

/** Obligation already settled this cycle (Nessie withdrawal/bill matched). */
export interface SettledObligation {
  id: string;
  payee: string;
  kind: ObligationKind;
  amount: number;
  date: ISODate;
}

export interface ForecastPoint {
  date: ISODate;
  expected: number;
  /** p20 inflow, discounted collection probability. */
  pessimistic: number;
}

/** Phase 5 — "an obligation cannot be covered", first failure wins. */
export interface Breach {
  date: ISODate;
  obligation: Payable;
  /** Pessimistic balance on the breach date. */
  balance: number;
  shortfall: number;
  daysUntil: number;
}

export type LadderRung = 'ACCELERATE' | 'SHIFT' | 'BUFFER' | 'CREDIT';

export interface LadderStep {
  rung: LadderRung;
  /** "1 · Cobranza" */
  short: string;
  /** "Adelantar cobranza A-4501" */
  title: string;
  /** Sentence fragment: "adelantando A-4501 2 días" */
  phrase: string;
  closes: number;
  available: boolean;
  /** Needed to close the gap, cheapest first. */
  applied: boolean;
  /** This rung's last action cleared the breach, so the rungs after it were not needed. */
  resolves: boolean;
  /** Position of this rung's first action in the engine's plan; null when it was not used. */
  order: number | null;
  /** What the rung does, one entry per invoice collected or payment moved. */
  actions: LadderAction[];
}

export interface LadderAction {
  /** Receivable id, or "<obligation id>:<due date>" for a moved payment; empty for the buffer. */
  targetId: string;
  newDate: ISODate | null;
  amount: number;
}

export interface Ladder {
  steps: LadderStep[];
  /** Gap left after rungs 1–3. */
  residual: number;
  /** Credit amount = residual + safety margin (0 when not needed). */
  creditAmount: number;
  /** STRUCTURAL DEFICIT: lending into it harms the business. */
  creditDeclined: boolean;
  adjustedMin: number | null;
}

export interface Movement {
  id: string;
  date: ISODate;
  description: string;
  amount: number;
  type: 'deposit' | 'purchase' | 'withdrawal';
  cfdi?: string;
}

export interface DailyFlow {
  date: ISODate;
  inflow: number;
  outflow: number;
}

export interface AgingBucket {
  label: string;
  amount: number;
}

export interface DashboardData {
  today: ISODate;
  business: Business;
  account: OperatingAccount;
  accounts: OperatingAccount[];
  healthScore: number;
  resilienceScore: number;
  collection: { collectedPct: number; receivablePct: number; overduePct: number };
  income30: { total: number; changePct: number; cash: number; cfdi: number };
  expense30: { total: number; changePct: number; lines: { label: string; amount: number }[] };
  cfdi: {
    receivableTotal: number;
    receivableCount: number;
    payableTotal: number;
    payableCount: number;
    aging: AgingBucket[];
  };
  cashflow: DailyFlow[];
  movementsCount: number;
  movements: Movement[];
  receivables: Receivable[];
  payables: Payable[];
  settled: SettledObligation[];
  forecast: ForecastPoint[];
  bufferAvailable: number;
  // Engine output
  breach: Breach | null;
  gap: GapKind;
  risk: RiskLevel;
  residualPct: number;
  ladder: Ladder;
}

export interface StressRequest {
  income_change_pct: number;
  variable_expense_change_pct: number;
  receivable_delay_days: number;
  available_cash_buffer: number | null;
}

export interface EngineForecastPoint {
  date: ISODate;
  expected_inflow: number;
  pessimistic_inflow: number;
  variable_outflow: number;
  obligation_outflow: number;
  expected_balance: number;
  pessimistic_balance: number;
}

export interface EngineBreach {
  date: ISODate;
  shortfall: number;
  obligation_id: string;
  obligation: string;
  amount: number;
}

export interface EngineRecommendation {
  rank: number;
  action: string;
  title: string;
  description: string;
  cash_impact: number;
  estimated_cost: number;
  resolves_breach: boolean;
  parameters: Record<string, string | number | boolean>;
}

export interface EngineAnalysis {
  points: EngineForecastPoint[];
  breach: EngineBreach | null;
  gap_type: 'none' | 'timing' | 'structural';
  health_score: number;
  resilience_score: number;
  recommendations: EngineRecommendation[];
  financing_decision: {
    status: 'not_needed' | 'covered_by_recovery_plan' | 'recommended' | 'not_recommended_structural';
    should_suggest: boolean;
    reason: string;
    residual_shortfall: number;
    suggested_amount: number;
    term_days: number;
  };
  diagnostics: {
    as_of: ISODate;
    horizon_days: number;
    expected_ending_balance: number;
    pessimistic_ending_balance: number;
    minimum_pessimistic_balance: number;
    scenario: string;
  };
  risk_level: RiskLevel;
}

export interface StressSimulationResponse {
  business: { slug: string; name: string; rfc: string; owner: string };
  account: { nickname: string; balance: number; live: boolean };
  available_cash_buffer: number;
  baseline: EngineAnalysis;
  result: EngineAnalysis;
}
