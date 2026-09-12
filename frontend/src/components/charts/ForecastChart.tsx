import {
  Area,
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import type { Breach, ForecastPoint } from '@/types';
import { dayDiff, mxn, shortDate } from '@/lib/format';

const MONO = 'IBM Plex Mono';
const GRID = 'rgba(199,214,213,0.2)';

interface Props {
  data: ForecastPoint[];
  breach: Breach | null;
  payrollFloor: number;
}

/** Dual-band 30-day projection: expected vs pessimistic p20. A single line is not actionable. */
export function ForecastChart({ data, breach, payrollFloor }: Props) {
  const rows = data.map((p) => ({ ...p, band: [p.pessimistic, p.expected] as [number, number] }));
  const minPoint = data.reduce((m, p) => (p.pessimistic < m.pessimistic ? p : m), data[0]);
  const marker = breach ? { date: breach.date, value: breach.balance } : { date: minPoint.date, value: minPoint.pessimistic };
  // Regular ticks every 5 days, but the breach date always gets its own label.
  const regular = data.filter((_, i) => i % 5 === 0 || i === data.length - 1).map((p) => p.date);
  const ticks = breach
    ? [...regular.filter((t) => Math.abs(dayDiff(t, breach.date)) > 2), breach.date].sort()
    : regular;

  return (
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={rows} margin={{ top: 12, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid vertical={false} stroke={GRID} />
        <XAxis
          dataKey="date"
          ticks={ticks}
          tickFormatter={shortDate}
          tickLine={false}
          axisLine={{ stroke: 'rgba(199,214,213,0.35)' }}
          tick={{ fill: '#6D7275', fontSize: 10, fontFamily: MONO }}
          dy={8}
        />
        <YAxis
          domain={[50000, 750000]}
          ticks={[50000, 225000, 400000, 575000, 750000]}
          tickFormatter={(v: number) => `${v / 1000}k`}
          tickLine={false}
          axisLine={false}
          width={52}
          tick={{ fill: '#6D7275', fontSize: 10, fontFamily: MONO }}
        />
        <Tooltip content={<ForecastTooltip />} cursor={{ stroke: 'rgba(199,214,213,0.35)', strokeDasharray: '3 3' }} />
        <Area dataKey="band" type="linear" stroke="none" fill="#EF4444" fillOpacity={0.15} isAnimationActive={false} activeDot={false} />
        <ReferenceLine
          y={payrollFloor}
          stroke="rgba(199,214,213,0.5)"
          strokeWidth={1.2}
          strokeDasharray="7 6"
          label={{ value: `PISO DE NÓMINA ${mxn(payrollFloor)}`, position: 'insideTopLeft', fill: '#C7D6D5', fontSize: 9.5, fontFamily: MONO, dy: -16 }}
        />
        <Line dataKey="pessimistic" type="linear" stroke="#EF4444" strokeOpacity={0.75} strokeWidth={1.6} strokeDasharray="5 4" dot={false} isAnimationActive={false} />
        <Line dataKey="expected" type="linear" stroke="#C20114" strokeWidth={2.5} dot={false} isAnimationActive={false} />
        {breach && <ReferenceLine x={breach.date} stroke="#EF4444" strokeOpacity={0.55} strokeWidth={1.2} strokeDasharray="5 5" />}
        <ReferenceDot
          x={marker.date}
          y={marker.value}
          r={6.5}
          fill="#EF4444"
          stroke="#0C120C"
          strokeWidth={4}
          label={<MinLabel date={marker.date} value={marker.value} breach={Boolean(breach)} />}
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}

function MinLabel({ viewBox, date, value, breach }: { viewBox?: { x?: number; y?: number; cx?: number; cy?: number }; date: string; value: number; breach: boolean }) {
  const x = viewBox?.cx ?? viewBox?.x ?? 0;
  const y = viewBox?.cy ?? viewBox?.y ?? 0;
  const w = 168;
  const h = 64;
  return (
    <g transform={`translate(${x - w / 2}, ${y - h - 18})`}>
      <rect width={w} height={h} rx={14} fill="#0C120C" stroke="rgba(239,68,68,0.5)" />
      <text x={w / 2} y={19} textAnchor="middle" fontFamily={MONO} fontSize={9.5} letterSpacing="0.12em" fill="#6D7275">
        MÍNIMO PESIMISTA
      </text>
      <text x={w / 2} y={39} textAnchor="middle" fontSize={17} fontWeight={500} fill="#ECEBF3">
        {mxn(value)}
      </text>
      <text x={w / 2} y={55} textAnchor="middle" fontSize={11} fill="#C7D6D5">
        {shortDate(date)}
        {breach ? ' · nómina descubierta' : ''}
      </text>
    </g>
  );
}

function ForecastTooltip({ active, payload }: { active?: boolean; payload?: { payload: ForecastPoint }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="card-ink !rounded-xl px-3 py-2 text-xs shadow-lg">
      <div className="eyebrow mb-1">{shortDate(p.date)}</div>
      <div className="num flex justify-between gap-6"><span className="text-dim">Esperado</span>{mxn(p.expected)}</div>
      <div className="num flex justify-between gap-6"><span className="text-dim">Pesimista p20</span><span className="text-alto">{mxn(p.pessimistic)}</span></div>
    </div>
  );
}
