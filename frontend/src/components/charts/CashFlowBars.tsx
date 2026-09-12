import { useState } from 'react';
import { Bar, BarChart, ResponsiveContainer, XAxis } from 'recharts';
import type { DailyFlow } from '@/types';
import { compact, dayOfMonth, shortDate } from '@/lib/format';

/** Inflows in Brick Ember, outflows in Dim Grey (frontend.md chart rules). */
export function CashFlowBars({ data }: { data: DailyFlow[] }) {
  const worst = data.reduce((iMin, d, i) => (d.inflow - d.outflow < data[iMin].inflow - data[iMin].outflow ? i : iMin), 0);
  const [active, setActive] = useState(worst);
  const day = data[active];
  const net = day.inflow - day.outflow;

  return (
    <div className="relative mt-4 flex min-h-[180px] flex-1 flex-col">
      <div className="flex h-[26px] items-center">
        <span
          className="num flex h-[26px] items-center rounded-full bg-ember px-3 text-[11.5px] font-medium transition-[margin]"
          style={{ marginLeft: `max(0px, calc(${((active + 0.5) / data.length) * 100}% - 40px))` }}
          aria-live="polite"
        >
          {compact(net, { signed: true })} · {shortDate(day.date)}
        </span>
      </div>
      <div className="min-h-0 flex-1">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            barGap={3}
            barSize={7}
            margin={{ top: 8, right: 0, bottom: 0, left: 0 }}
            onMouseMove={(state) => {
              if (typeof state?.activeTooltipIndex === 'number') setActive(state.activeTooltipIndex);
            }}
            onMouseLeave={() => setActive(worst)}
          >
            <XAxis
              dataKey="date"
              tickFormatter={dayOfMonth}
              tickLine={false}
              axisLine={{ stroke: 'rgba(199,214,213,0.20)' }}
              interval={0}
              tick={({ x, y, payload, index }) => (
                <text x={x} y={y + 14} textAnchor="middle" fontSize={9.5} fontFamily="IBM Plex Mono" fill={index === active ? '#ECEBF3' : '#6D7275'}>
                  {dayOfMonth(payload.value)}
                </text>
              )}
            />
            <Bar dataKey="inflow" name="Entradas" fill="#C20114" radius={[4, 4, 4, 4]} isAnimationActive={false} />
            <Bar dataKey="outflow" name="Salidas" fill="#6D7275" radius={[4, 4, 4, 4]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
