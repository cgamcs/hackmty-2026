import type { ISODate } from '@/types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];
const MINUS = '−';

/** $212,000 · −$41,780 · +$28,400 (with `signed`). */
export function mxn(n: number, signed = false): string {
  const abs = Math.abs(Math.round(n)).toLocaleString('en-US');
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `${sign}$${abs}`;
}

/** $412.5k · −$65.3k · $1.2M */
export function compact(n: number, { currency = true, signed = false } = {}): string {
  const abs = Math.abs(n);
  const body = abs >= 1_000_000 ? `${(abs / 1_000_000).toFixed(1)}M` : abs >= 1000 ? `${(abs / 1000).toFixed(1)}k` : `${Math.round(abs)}`;
  const sign = n < 0 ? MINUS : signed && n > 0 ? '+' : '';
  return `${sign}${currency ? '$' : ''}${body}`;
}

function parts(date: ISODate): [number, number, number] {
  const [y, m, d] = date.split('-').map(Number);
  return [y, m, d];
}

/** "6 oct" */
export function shortDate(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${d} ${MONTHS[m - 1]}`;
}

/** "06 oct" */
export function paddedDate(date: ISODate): string {
  const [, m, d] = parts(date);
  return `${String(d).padStart(2, '0')} ${MONTHS[m - 1]}`;
}

export function dayOfMonth(date: ISODate): string {
  return String(parts(date)[2]).padStart(2, '0');
}

export function dayDiff(from: ISODate, to: ISODate): number {
  const [y1, m1, d1] = parts(from);
  const [y2, m2, d2] = parts(to);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86_400_000);
}

export function addDays(date: ISODate, days: number): ISODate {
  const [y, m, d] = parts(date);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`;
}

export function greeting(hour = new Date().getHours()): string {
  if (hour < 12) return 'Buen día';
  if (hour < 19) return 'Buenas tardes';
  return 'Buenas noches';
}
