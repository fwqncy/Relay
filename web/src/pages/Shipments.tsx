import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Field, FormDialog, useToast } from '../components/feedback';
import { Icon, MODE_ICON } from '../components/Icon';
import { Button, Empty, ErrorState, PageHead, Progress, ShipmentStatusBadge, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { NBSP, dateTimeFmt, fmtWeight, hhmm, isoDate, nf, plural, relTime, TRANSPORT_LABEL } from '../lib/format';
import { useIsManager, useSession, useTitle } from '../lib/session';
import type { Shipment, TransportMode } from '../lib/types';

const STATUS_TABS: [string, string][] = [
  ['active', 'Active'], ['booked', 'Booked'], ['in_transit', 'In transit'], ['delayed', 'Delayed'], ['delivered', 'Delivered'], ['cancelled', 'Cancelled'], ['all', 'All'],
];
const MODES: TransportMode[] = ['sea', 'road', 'rail', 'air'];

export const CARRIERS: Record<TransportMode, string[]> = {
  sea: ['Saltmere Lines', 'Greywater Shipping', 'Northreach Maritime', 'Brinewood Freight'],
  road: ['Blue Ridge Haulage', 'Coastline Carriers', 'Summit Transport', 'Delta Line Trucking', 'Ironbridge Logistics', 'Prairie Express'],
  rail: ['Ironvale Rail', 'Kingsway Freight Rail', 'Ashford Railways'],
  air: ['Skyhold Air Cargo', 'Falconcrest Air', 'Aerie Express'],
};

export default function Shipments() {
  useTitle('Shipments');
  const manager = useIsManager();
  const { company } = useSession();
  const [params, setParams] = useSearchParams();
  const status = STATUS_TABS.some(([v]) => v === params.get('status')) ? params.get('status')! : 'active';
  const mode = MODES.includes(params.get('mode') as TransportMode) ? params.get('mode')! : '';
  const q = params.get('q') ?? '';
  const [search, setSearch] = useState(q);
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');

  const setParam = (k: string, v: string) => {
    const n = new URLSearchParams(params);
    if (v) n.set(k, v); else n.delete(k);
    setParams(n, { replace: true });
  };
  const linkWith = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); const s = n.toString(); return s ? `?${s}` : '?'; };
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== q) setParam('q', search.trim()); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const filters = { status: status === 'all' ? '' : status, mode, q };
  const query = useInfiniteQuery({
    queryKey: ['shipments', filters],
    queryFn: ({ pageParam }) => get<{ shipments: Shipment[]; counts?: Record<string, number> }>(`/api/shipments${qs({ ...filters, before: pageParam || undefined })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.shipments.length === 50 ? last.shipments.at(-1)!.id : undefined),
    refetchInterval: (qq) => ((qq.state.data?.pages.length ?? 0) <= 1 ? 10_000 : false),
  });
  const rows = query.data?.pages.flatMap((p) => p.shipments) ?? [];
  const counts = query.data?.pages[0]?.counts;
  const countFor = (v: string) => {
    if (!counts) return '';
    if (v === 'all') return nf.format(Object.values(counts).reduce((a, b) => a + b, 0));
    if (v === 'active') return nf.format((counts.booked ?? 0) + (counts.in_transit ?? 0) + (counts.delayed ?? 0));
    return nf.format(counts[v] ?? 0);
  };

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={company.hub} title="Shipments"
        actions={<>
          <a className="btn" href={`/api/export/shipments.csv${qs(filters)}`} download><Icon name="download" size={15} />Export CSV</a>
          {manager && <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Book shipment…</Button>}
        </>}>
        Every consignment across sea, road, rail and air. Tracking updates arrive as <span className="mono">tracking.sync</span> jobs on the runtime.
      </PageHead>

      {counts && counts.delayed > 0 && status !== 'delayed' && (
        <Link to={linkWith('status', 'delayed')} replace className="banner warn">
          <Icon name="triangle" size={16} />
          <span><strong>{plural(counts.delayed, 'shipment')} delayed</strong> — the carrier missed the promised ETA.</span>
          <span className="right">Review exceptions <Icon name="arrowR" size={14} /></span>
        </Link>
      )}

      <section className="card" aria-label="Shipment list">
        <div className="toolbar">
          <nav className="segmented" aria-label="Filter by status">
            {STATUS_TABS.map(([v, label]) => (
              <Link key={v} to={linkWith('status', v === 'active' ? '' : v)} replace aria-current={v === status ? 'page' : undefined}>
                {label} <span className="count">{countFor(v)}</span>
              </Link>
            ))}
          </nav>
          <nav className="segmented" aria-label="Filter by mode">
            <Link to={linkWith('mode', '')} replace aria-current={!mode ? 'page' : undefined}>All modes</Link>
            {MODES.map((m) => (
              <Link key={m} to={linkWith('mode', m)} replace aria-current={mode === m ? 'page' : undefined}>
                <Icon name={MODE_ICON[m]} size={14} />{TRANSPORT_LABEL[m]}
              </Link>
            ))}
          </nav>
          <span className="grow" />
          <label className="search"><span className="sr-only">Search shipments</span><Icon name="search" size={15} />
            <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Reference, customer, city…" autoComplete="off" spellCheck={false} />
          </label>
        </div>
        <div className="table-wrap">
          {query.isLoading ? <div className="card-body"><Skeleton h={360} /></div>
            : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
            : !rows.length ? (
              <Empty icon="package" title="No shipments match" action={<Link className="btn sm" to="/shipments" replace>Clear filters</Link>}>Try another status, mode or search.</Empty>
            ) : (
              <table className="data">
                <thead><tr><th>Reference</th><th>Customer</th><th>Lane</th><th>Carrier</th><th>Status</th><th style={{ minWidth: 104 }}>Progress</th><th>ETA</th><th className="r">Weight</th></tr></thead>
                <tbody>
                  {rows.map((s) => {
                    const late = s.status !== 'delivered' && s.status !== 'cancelled' && new Date(s.eta) < new Date();
                    return (
                      <tr key={s.id}>
                        <td>
                          <span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
                            <span className={`mode-dot ${s.mode}`} aria-hidden="true" /><Icon name={MODE_ICON[s.mode]} size={14} label={TRANSPORT_LABEL[s.mode]} />
                            <Link className="rowlink mono" to={`/shipments/${s.id}`}>{s.reference}</Link>
                            {s.priority === 'express' && <span className="tag accent">express</span>}
                          </span>
                        </td>
                        <td className="trunc">{s.itemName ? <><Icon name="refresh" size={12} /> {s.customer}</> : s.customer}</td>
                        <td className="trunc">{s.origin} <span className="subtle">→</span> {s.destination}</td>
                        <td className="trunc muted">{s.carrier}</td>
                        <td><ShipmentStatusBadge status={s.status} /></td>
                        <td>{s.status === 'in_transit' || s.status === 'delayed'
                          ? <div style={{ display: 'grid', gap: 3 }}><Progress value={s.progress} label={`${s.reference} progress`} /><span className="subtle num" style={{ fontSize: 11.5 }}>{Math.round(s.progress * 100)}%</span></div>
                          : <span className="subtle">{s.status === 'delivered' ? (s.onTime ? 'On time' : 'Late') : '—'}</span>}</td>
                        <td title={dateTimeFmt.format(new Date(s.eta))} style={late ? { color: 'var(--bad)' } : undefined} className={late ? '' : 'muted'}>
                          {s.status === 'delivered' && s.deliveredAt ? `Delivered ${relTime(s.deliveredAt)}` : relTime(s.eta)}{late && <span className="sr-only"> (late)</span>}
                        </td>
                        <td className="r">{fmtWeight(s.weightKg)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
        {rows.length > 0 && (
          <div className="card-foot">
            <span className="num">Showing {plural(rows.length, 'shipment')}</span>
            {query.hasNextPage ? <Button size="sm" loading={query.isFetchingNextPage} loadingLabel="Loading…" onClick={() => query.fetchNextPage()}>Load more</Button> : <span className="subtle">End of list</span>}
          </div>
        )}
      </section>
      {manager && <NewShipmentDialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o && params.has('new')) setParam('new', ''); }} />}
    </div>
  );
}

function NewShipmentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { company } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const [mode, setMode] = useState<TransportMode>('road');
  const soon = new Date(Date.now() + 2 * 3600e3);
  soon.setMinutes(Math.ceil(soon.getMinutes() / 15) * 15, 0, 0);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} wide title="Book a shipment" submitLabel="Book shipment" submitIcon="package" pendingLabel="Booking…"
      description={<>A <span className="mono">shipment.book</span> job confirms it with the carrier; tracking then advances it until delivery.</>}
      onSubmit={async (form) => {
        const fd = new FormData(form);
        const departs = new Date(`${fd.get('departsAt')}T${fd.get('departsTime')}`);
        const res = await post<{ shipment: Shipment; jobId: number }>('/api/shipments', {
          mode, customer: String(fd.get('customer')).trim(), origin: String(fd.get('origin')).trim(), destination: String(fd.get('destination')).trim(),
          carrier: String(fd.get('carrier') || ''), weightKg: Number(fd.get('weightKg')) || 0, pieces: Number(fd.get('pieces')) || 0,
          priority: String(fd.get('priority')), departsAt: Number.isNaN(+departs) ? null : departs.toISOString(),
        });
        toast(`${res.shipment.reference} booked`, `${TRANSPORT_LABEL[mode]} · ${res.shipment.origin} → ${res.shipment.destination}`, 'info');
        qc.invalidateQueries({ queryKey: ['shipments'] });
        navigate(`/shipments/${res.shipment.id}`);
      }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Mode</legend>
        <div className="segmented" role="radiogroup" aria-label="Mode" style={{ width: 'fit-content' }}>
          {MODES.map((m) => (
            <label key={m}><input type="radio" name="mode" value={m} checked={mode === m} onChange={() => setMode(m)} /><Icon name={MODE_ICON[m]} size={14} />{TRANSPORT_LABEL[m]}</label>
          ))}
        </div>
      </fieldset>
      <div className="row-2">
        <Field name="customer" label="Customer"><input className="input" autoComplete="organization" maxLength={60} placeholder="e.g. Greenleaf Grocers…" /></Field>
        <Field name="carrier" label="Carrier" hint="Leave on automatic to pick the best rate.">
          <select className="select" defaultValue="" key={mode}>
            <option value="">Automatic</option>
            {CARRIERS[mode].map((c) => <option key={c}>{c}</option>)}
          </select>
        </Field>
      </div>
      <div className="row-2">
        <Field name="origin" label="Origin"><input className="input" autoComplete="off" maxLength={60} defaultValue={company.hub.includes('Savannah') ? 'Savannah, GA' : company.hub.includes('Rotterdam') ? 'Rotterdam, NL' : 'Leeds, UK'} /></Field>
        <Field name="destination" label="Destination"><input className="input" autoComplete="off" maxLength={60} placeholder="City, country…" /></Field>
      </div>
      <div className="row-3">
        <Field name="weightKg" label="Weight (kg)"><input className="input" type="number" inputMode="numeric" min={1} defaultValue={1200} /></Field>
        <Field name="pieces" label="Pieces"><input className="input" type="number" inputMode="numeric" min={1} defaultValue={8} /></Field>
        <Field name="priority" label="Service">
          <select className="select" defaultValue="standard"><option value="standard">Standard</option><option value="express">Express</option></select>
        </Field>
      </div>
      <div className="row-2">
        <Field name="departsAt" label="Departure date"><input className="input" type="date" defaultValue={isoDate(soon)} /></Field>
        <div className="field"><label htmlFor="departs-time">Time</label><input id="departs-time" className="input" type="time" name="departsTime" step={900} defaultValue={hhmm(soon)} /></div>
      </div>
      <p className="hint subtle" style={{ fontSize: 12.5 }}>ETA is quoted from the carrier’s typical {TRANSPORT_LABEL[mode].toLowerCase()} transit time{NBSP}— you’ll see it once the booking is confirmed.</p>
    </FormDialog>
  );
}
