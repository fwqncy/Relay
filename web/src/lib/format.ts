export const NBSP = ' ';

export const nf = new Intl.NumberFormat();
export const nf1 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const pctFmt = new Intl.NumberFormat(undefined, { maximumFractionDigits: 1 });
export const timeFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit' });
export const timeSecFmt = new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
export const dateLong = new Intl.DateTimeFormat(undefined, { weekday: 'long', day: 'numeric', month: 'long' });
export const dateMed = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
export const dateShort = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short' });
export const weekdayShort = new Intl.DateTimeFormat(undefined, { weekday: 'short' });
export const dateTimeFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
export const dateTimeSecFmt = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto', style: 'short' });

export function fmtMs(ms: number | null | undefined): string {
  if (ms == null || Number.isNaN(ms)) return '—';
  if (ms < 1) return `<1${NBSP}ms`;
  if (ms < 1000) return `${Math.round(ms)}${NBSP}ms`;
  return `${(ms / 1000).toFixed(ms < 10000 ? 2 : 1).replace(/\.?0+$/, '')}${NBSP}s`;
}

export function msParts(ms: number | null | undefined): [string, string] {
  if (ms == null) return ['—', ''];
  if (ms < 1000) return [String(Math.round(ms)), 'ms'];
  return [(ms / 1000).toFixed(2).replace(/\.?0+$/, ''), 's'];
}

export function fmtRate(n: number | null | undefined): string {
  if (n == null) return '—';
  return n >= 1000 ? `${nf1.format(n / 1000)}k` : nf.format(Math.round(n));
}

export function relTime(date: string | number | Date): string {
  const s = (new Date(date).getTime() - Date.now()) / 1000;
  const a = Math.abs(s);
  if (a < 45) return rtf.format(Math.round(s), 'second');
  if (a < 2700) return rtf.format(Math.round(s / 60), 'minute');
  if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  return rtf.format(Math.round(s / 86400), 'day');
}

export function fmtDuration(hours: number | null | undefined): string {
  if (hours == null) return '—';
  if (hours < 1) return `${Math.round(hours * 60)}${NBSP}min`;
  if (hours < 48) return `${nf1.format(hours)}${NBSP}h`;
  return `${nf1.format(hours / 24)}${NBSP}days`;
}

export const fmtTime = (d: string | Date) => timeFmt.format(new Date(d));
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
export const plural = (n: number, one: string, many = `${one}s`) => `${nf.format(n)}${NBSP}${n === 1 ? one : many}`;
export const fmtWeight = (kg: number) => (kg >= 1000 ? `${nf1.format(kg / 1000)}${NBSP}t` : `${nf.format(kg)}${NBSP}kg`);

// ---- dates (local time) ----
export const startOfDay = (d: Date) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
export const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const startOfWeek = (d: Date) => { const x = startOfDay(d); return addDays(x, -((x.getDay() + 6) % 7)); };
export const isoDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export function parseISODate(s: string | null | undefined): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s || '');
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3]);
  return Number.isNaN(+d) ? null : d;
}
export const sameDay = (a: Date, b: Date) => isoDate(a) === isoDate(b);
export const hhmm = (d: Date) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export function atTime(day: Date, time: string): Date {
  const [h, m] = time.split(':').map(Number);
  const d = new Date(day);
  d.setHours(h, m, 0, 0);
  return d;
}

export const MODE_LABEL: Record<string, string> = { 'work-stealing': 'Work-stealing', 'single-queue': 'Single-queue' };
export const TRANSPORT_LABEL = { sea: 'Sea', road: 'Road', rail: 'Rail', air: 'Air' } as const;
