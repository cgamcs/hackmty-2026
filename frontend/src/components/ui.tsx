import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import type { GapKind, RiskLevel } from '@/types';

type IconName =
  | 'arrowUpRight' | 'gear' | 'bell' | 'wallet' | 'alert' | 'coin' | 'chevronDown' | 'arrowUp'
  | 'arrowDown' | 'check' | 'lock' | 'calendar' | 'circle' | 'triangle' | 'building' | 'minus'
  | 'menu' | 'close';

const ICONS: Record<IconName, { vb: number; body: ReactNode }> = {
  arrowUpRight: { vb: 14, body: <><line x1="3" y1="11" x2="11" y2="3" /><polyline points="5,3 11,3 11,9" /></> },
  gear: { vb: 16, body: <><circle cx="8" cy="8" r="2.6" /><line x1="8" y1="1.6" x2="8" y2="3.5" /><line x1="8" y1="12.5" x2="8" y2="14.4" /><line x1="1.6" y1="8" x2="3.5" y2="8" /><line x1="12.5" y1="8" x2="14.4" y2="8" /></> },
  bell: { vb: 16, body: <><path d="M4 6.5a4 4 0 018 0c0 3 1.2 4 1.2 4H2.8S4 9.5 4 6.5z" /><path d="M6.6 13a1.6 1.6 0 002.8 0" /></> },
  wallet: { vb: 16, body: <><rect x="2" y="5" width="12" height="9" rx="1.5" /><path d="M6 5V3.5A1.5 1.5 0 017.5 2h1A1.5 1.5 0 0110 3.5V5" /></> },
  alert: { vb: 16, body: <><path d="M8 2l6 11H2L8 2z" /><line x1="8" y1="6.5" x2="8" y2="9.5" /></> },
  coin: { vb: 16, body: <><circle cx="8" cy="8" r="6" /><line x1="8" y1="4.5" x2="8" y2="11.5" /></> },
  chevronDown: { vb: 10, body: <polyline points="2,3.8 5,6.8 8,3.8" /> },
  arrowUp: { vb: 11, body: <><line x1="5.5" y1="9" x2="5.5" y2="2" /><polyline points="2.5,5 5.5,2 8.5,5" /></> },
  arrowDown: { vb: 11, body: <><line x1="5.5" y1="2" x2="5.5" y2="9" /><polyline points="2.5,6 5.5,9 8.5,6" /></> },
  check: { vb: 12, body: <polyline points="2.5,6.2 5,8.6 9.5,3.4" /> },
  lock: { vb: 16, body: <><rect x="3" y="7" width="10" height="7" rx="1.5" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></> },
  calendar: { vb: 14, body: <><rect x="2" y="3" width="10" height="9" rx="1.5" /><line x1="2" y1="6" x2="12" y2="6" /></> },
  circle: { vb: 14, body: <circle cx="7" cy="7" r="5" /> },
  triangle: { vb: 14, body: <path d="M7 2l5 9H2l5-9z" /> },
  building: { vb: 14, body: <path d="M3 11V5l4-2 4 2v6" /> },
  minus: { vb: 12, body: <line x1="3" y1="6" x2="9" y2="6" /> },
  menu:  { vb: 16, body: <><line x1="2" y1="4.5" x2="14" y2="4.5" /><line x1="2" y1="8" x2="14" y2="8" /><line x1="2" y1="11.5" x2="14" y2="11.5" /></> },
  close: { vb: 16, body: <><line x1="3" y1="3" x2="13" y2="13" /><line x1="13" y1="3" x2="3" y2="13" /></> },
};

export function Icon({ name, size = 14, color = 'currentColor', strokeWidth = 1.4 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  const { vb, body } = ICONS[name];
  return (
    <svg width={size} height={size} viewBox={`0 0 ${vb} ${vb}`} fill="none" stroke={color} strokeWidth={strokeWidth} aria-hidden="true">
      {body}
    </svg>
  );
}

export function ArrowLink({ to, label, solid = false, size = 30 }: { to: string; label: string; solid?: boolean; size?: number }) {
  return (
    <Link
      to={to}
      aria-label={label}
      title={label}
      style={{ width: size, height: size }}
      className={`grid flex-none place-items-center rounded-full transition-colors ${
        solid ? 'bg-ember hover:bg-ember/80' : 'border border-ash/20 hover:bg-ash/10'
      }`}
    >
      <Icon name="arrowUpRight" size={solid ? 13 : 12} color={solid ? '#ECEBF3' : '#C7D6D5'} strokeWidth={solid ? 1.6 : 1.4} />
    </Link>
  );
}

export type Tone = 'ember' | 'muted' | 'alto' | 'medio' | 'bajo';

export function Tag({ tone, children }: { tone: Tone; children: ReactNode }) {
  return <span className={`tag tag-${tone}`}>{children}</span>;
}

export const RISK_STYLE: Record<RiskLevel, { color: string; bg: string; border: string; label: string }> = {
  BAJO: { color: '#22C55E', bg: 'rgba(34,197,94,0.12)', border: 'rgba(34,197,94,0.40)', label: 'BAJO' },
  MEDIO: { color: '#F59E0B', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.40)', label: 'MEDIO' },
  ALTO: { color: '#EF4444', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.40)', label: 'ALTO' },
  CRITICO: { color: '#DC2626', bg: 'rgba(220,38,38,0.16)', border: 'rgba(220,38,38,0.55)', label: 'CRÍTICO' },
};

export function GapChip({ gap }: { gap: GapKind }) {
  const map = {
    NONE: { cls: 'bg-bajo/14 text-bajo', label: 'SIN BRECHA' },
    TIMING: { cls: 'bg-medio/16 text-medio', label: 'TIMING GAP' },
    STRUCTURAL: { cls: 'bg-critico/20 text-critico', label: 'DÉFICIT ESTRUCTURAL' },
  }[gap];
  return (
    <span className={`flex h-[30px] items-center rounded-full px-[13px] font-mono text-[10.5px] tracking-[.08em] ${map.cls}`}>{map.label}</span>
  );
}

export function scoreColor(score: number): string {
  if (score >= 70) return '#22C55E';
  if (score >= 50) return '#F59E0B';
  return '#EF4444';
}

/** Thin horizontal meter used by the ladder and aging buckets. */
export function Meter({ pct, color, height = 10 }: { pct: number; color: string; height?: number }) {
  return (
    <div className="flex-1 rounded-full bg-ash/10" style={{ height }}>
      {pct > 0 && <div className="h-full rounded-full" style={{ width: `${Math.min(100, Math.max(2, pct))}%`, background: color }} />}
    </div>
  );
}

export function SegmentedRange<T extends string | number>({
  options,
  value,
  onChange,
  disabled = [],
  compact = false,
  activeClass = 'bg-ash/12 font-medium text-ghost',
}: {
  options: { value: T; label: string }[];
  value: T;
  onChange: (v: T) => void;
  disabled?: T[];
  compact?: boolean;
  activeClass?: string;
}) {
  return (
    <div role="radiogroup" className={`flex items-center gap-1 rounded-full border border-ash/10 bg-dim/14 px-[5px] ${compact ? 'h-9' : 'h-[42px]'}`}>
      {options.map((o) => {
        const active = o.value === value;
        const off = disabled.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            disabled={off}
            title={off ? 'El motor proyecta un horizonte de 30 días' : undefined}
            onClick={() => onChange(o.value)}
            className={`flex items-center rounded-full ${compact ? 'h-7 px-3.5 text-xs' : 'h-8 px-[15px] text-[12.5px]'} ${
              active ? activeClass : 'text-dim hover:text-ghost disabled:cursor-not-allowed disabled:hover:text-dim'
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
