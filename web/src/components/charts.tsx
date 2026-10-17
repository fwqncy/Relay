import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react';
import { NBSP, dateShort, fmtRate, nf, timeSecFmt, weekdayShort, TRANSPORT_LABEL } from '../lib/format';
import type { Point, TransportMode } from '../lib/types';
import { announce } from './feedback';

export function niceMax(v: number) {
  const p = 10 ** Math.floor(Math.log10(v));
  const n = v / p;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 4 ? 4 : n <= 8 ? 8 : 10) * p;
}

interface TimeChartProps {
  points: Point[];
  value: (p: Point) => number | null;
  format: (v: number, axis?: boolean) => string;
  label: string;
  markers?: { t: number; label: string }[];
  windowMs?: number;
  empty?: string;
}

/** Single-series line/area over a fixed window with a crosshair tooltip,
 *  keyboard scrubbing and dashed event markers. */
export function TimeChart({ points, value, format, label, markers = [], windowMs = 300_000, empty = 'Waiting for data…' }: TimeChartProps) {
  const ref = useRef<HTMLDivElement>(null);
  const [hover, setHover] = useState<number | null>(null);
  const t1 = points.at(-1)?.t ?? Date.now();
  const t0 = t1 - windowMs;

  const geo = useMemo(() => {
    const pts = points.filter((p) => p.t >= t0);
    const vals = pts.map(value).filter((v): v is number => v != null);
    const maxV = Math.max(0, ...vals);
    const yMax = niceMax(maxV * 1.15 || 1);
    const X = (t: number) => ((t - t0) / (t1 - t0)) * 1000;
    const Y = (v: number) => 100 - (v / yMax) * 100;
    let line = '', area = '';
    let seg: Point[] = [];
    const flush = () => {
      if (!seg.length) return;
      line += seg.map((p, i) => `${i ? 'L' : 'M'}${X(p.t).toFixed(2)},${Y(value(p)!).toFixed(2)}`).join('');
      area += `M${X(seg[0].t).toFixed(2)},100${seg.map((p) => `L${X(p.t).toFixed(2)},${Y(value(p)!).toFixed(2)}`).join('')}L${X(seg.at(-1)!.t).toFixed(2)},100Z`;
      seg = [];
    };
    // A sample without a value breaks the line rather than dropping to zero.
    for (const p of pts) { if (value(p) == null) flush(); else seg.push(p); }
    flush();
    const withVal = pts.filter((p) => value(p) != null);
    return { pts, withVal, maxV, yMax, line, area, X, Y };
  }, [points, value, t0, t1]);

  const mins = Math.round(windowMs / 60000);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * geo.yMax);
  const shown = markers.filter((m) => m.t > t0 && m.t <= t1).map((m) => ({ ...m, left: geo.X(m.t) / 10 }));
  const latest = geo.withVal.at(-1);
  const hp = hover == null ? null : geo.withVal.find((p) => p.t === hover) ?? null;

  const onPointer = (e: PointerEvent<HTMLDivElement>) => {
    const r = ref.current!.getBoundingClientRect();
    const t = t0 + Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)) * (t1 - t0);
    let best: Point | null = null, d = Infinity;
    for (const p of geo.withVal) { const dd = Math.abs(p.t - t); if (dd < d) { d = dd; best = p; } }
    setHover(best?.t ?? null);
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Escape'].includes(e.key) || !geo.withVal.length) return;
    e.preventDefault();
    if (e.key === 'Escape') return setHover(null);
    const list = geo.withVal;
    let i = hover == null ? list.length - 1 : list.findIndex((p) => p.t === hover);
    if (e.key === 'ArrowLeft') i = Math.max(0, i - 1);
    if (e.key === 'ArrowRight') i = Math.min(list.length - 1, i + 1);
    if (e.key === 'Home') i = 0;
    if (e.key === 'End') i = list.length - 1;
    setHover(list[i].t);
    announce(`${timeSecFmt.format(new Date(list[i].t))}: ${format(value(list[i])!)}`);
  };

  let tipLeft = 0;
  if (hp && ref.current) {
    const w = ref.current.clientWidth;
    const px = (geo.X(hp.t) / 1000) * w;
    tipLeft = px + 170 > w ? Math.max(0, px - 162) : px + 12;
  }

  return (
    <div
      ref={ref}
      className={`chart ${hp ? 'hovering' : ''}`}
      tabIndex={0}
      role="img"
      aria-label={`${label} over the last ${mins} minutes. ${latest ? `Latest ${format(value(latest)!)}, peak ${format(geo.maxV)}.` : 'No data yet.'} Use the arrow keys to read individual samples.`}
      onPointerMove={onPointer}
      onPointerLeave={() => setHover(null)}
      onBlur={() => setHover(null)}
      onKeyDown={onKey}
    >
      <svg className="plot" viewBox="0 0 1000 100" preserveAspectRatio="none" aria-hidden="true">
        <g className="grid">{ticks.map((v) => <line key={v} x1="0" x2="1000" y1={geo.Y(v)} y2={geo.Y(v)} />)}</g>
        <path className="area" d={geo.area} />
        <path className="line" d={geo.line} />
      </svg>
      <div className="y-labels" aria-hidden="true">{ticks.map((v) => <span key={v} style={{ top: `${geo.Y(v)}%` }}>{format(v, true)}</span>)}</div>
      <div className="x-labels" aria-hidden="true">
        {Array.from({ length: mins + 1 }, (_, i) => <span key={i} style={{ left: `${(i / mins) * 100}%` }}>{mins - i ? `−${mins - i}${NBSP}min` : 'now'}</span>)}
      </div>
      <div aria-hidden="true">
        {shown.map((m, i) => (
          <div key={m.t} className={`marker ${m.left > 70 ? 'flip' : ''}`} style={{ left: `${m.left}%` }}>
            {!(shown[i + 1] && shown[i + 1].left - m.left < 16) && <span>{m.label}</span>}
          </div>
        ))}
      </div>
      {hp && (
        <>
          <div className="cursor" aria-hidden="true" style={{ left: `${geo.X(hp.t) / 10}%` }} />
          <div className="dot" aria-hidden="true" style={{ left: `${geo.X(hp.t) / 10}%`, top: `${geo.Y(value(hp)!)}%` }} />
          <div className="chart-tip" aria-hidden="true" style={{ left: tipLeft }}>
            <b>{format(value(hp)!)}</b>
            <span>{timeSecFmt.format(new Date(hp.t))}</span>
            <span>{hp.mode === 'single-queue' ? 'Single-queue' : 'Work-stealing'} · {fmtRate(hp.throughput)}/s</span>
          </div>
        </>
      )}
      {!geo.withVal.length && <div className="chart-empty">{empty}</div>}
    </div>
  );
}

const MODES: TransportMode[] = ['sea', 'road', 'rail', 'air'];

/** Stacked daily volume by transport mode. Each column is a focusable
 *  group whose label carries every value, so colour is never the only cue. */
export function StackedBars({ data }: { data: { day: string; sea: number; road: number; rail: number; air: number }[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const totals = data.map((d) => d.sea + d.road + d.rail + d.air);
  const yMax = niceMax(Math.max(1, ...totals) * 1.1);
  const ticks = [0, 0.5, 1].map((f) => Math.round(f * yMax));
  const every = data.length > 16 ? 5 : data.length > 8 ? 2 : 1;
  const dayOf = (s: string) => { const [y, m, d] = s.slice(0, 10).split('-').map(Number); return new Date(y, m - 1, d); };
  return (
    <div style={{ position: 'relative' }}>
      <div className="bars" role="list" aria-label="Deliveries per day by mode">
        <div className="bars-grid" aria-hidden="true">
          {ticks.map((t) => <div key={t} style={{ bottom: `${(t / yMax) * 100}%` }}><span>{nf.format(t)}</span></div>)}
        </div>
        {data.map((d, i) => {
          const day = dayOf(d.day);
          const label = `${dateShort.format(day)}: ${nf.format(totals[i])} deliveries — ${MODES.map((m) => `${TRANSPORT_LABEL[m]} ${d[m]}`).join(', ')}`;
          return (
            <div key={d.day} className="col" role="listitem" tabIndex={0} aria-label={label}
              onPointerEnter={() => setHover(i)} onPointerLeave={() => setHover(null)} onFocus={() => setHover(i)} onBlur={() => setHover(null)}>
              {MODES.map((m) => d[m] > 0 && <div key={m} className={`seg ${m}`} style={{ height: `${(d[m] / yMax) * 100}%` }} />)}
              {hover === i && (
                <div className="chart-tip" style={{ bottom: 'calc(100% + 6px)', top: 'auto', left: i > data.length * 0.6 ? 'auto' : 0, right: i > data.length * 0.6 ? 0 : 'auto' }} aria-hidden="true">
                  <b>{nf.format(totals[i])} deliveries</b>
                  <span>{weekdayShort.format(day)} {dateShort.format(day)}</span>
                  {MODES.map((m) => <span key={m} style={{ display: 'flex', gap: 6, alignItems: 'center' }}><i className={`mode-dot ${m}`} />{TRANSPORT_LABEL[m]} · {d[m]}</span>)}
                </div>
              )}
            </div>
          );
        })}
      </div>
      <div className="bars-x" aria-hidden="true">
        {data.map((d, i) => <span key={d.day}>{i % every === 0 || i === data.length - 1 ? dateShort.format(dayOf(d.day)) : ''}</span>)}
      </div>
    </div>
  );
}

export function ModeLegend() {
  return (
    <div className="legend" aria-label="Legend">
      {MODES.map((m) => <span key={m}><i className={`mode-dot ${m}`} style={{ width: 12, height: 12 }} />{TRANSPORT_LABEL[m]}</span>)}
    </div>
  );
}
