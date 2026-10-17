import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useConfirm, useToast } from '../components/feedback';
import { Icon, MODE_ICON, type IconName } from '../components/Icon';
import { watchJob } from '../components/jobs';
import { Badge, Button, ErrorState, ModeChip, ShipmentStatusBadge, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { dateTimeFmt, fmtDuration, fmtWeight, nf, relTime, TRANSPORT_LABEL } from '../lib/format';
import { useIsManager, useTitle } from '../lib/session';
import type { Shipment, ShipmentEvent } from '../lib/types';

const EVENT: Record<string, [IconName, string]> = {
  booked: ['clock', 'Booked'],
  confirmed: ['check', 'Booking confirmed'],
  departed: ['arrowR', 'Departed'],
  checkpoint: ['compass', 'Checkpoint scan'],
  customs: ['flag', 'Customs cleared'],
  delayed: ['triangle', 'Delayed'],
  delivered: ['checkCircle', 'Delivered'],
  cancelled: ['x', 'Cancelled'],
};

export default function ShipmentDetail() {
  const { id } = useParams();
  const manager = useIsManager();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [syncing, setSyncing] = useState(false);
  const q = useQuery({
    queryKey: ['shipment', id],
    queryFn: () => get<{ shipment: Shipment; events: ShipmentEvent[] }>(`/api/shipments/${id}`),
    refetchInterval: 15_000,
  });
  useTitle(q.data?.shipment.reference ?? 'Shipment');
  if (q.error) return <div className="page"><BackLink /><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>;
  if (!q.data) return <div className="page"><BackLink /><Skeleton h={40} w={260} /><Skeleton h={180} r={12} /><Skeleton h={300} r={12} /></div>;
  const { shipment: s, events } = q.data;
  const moving = s.status === 'in_transit' || s.status === 'delayed';
  const transit = s.deliveredAt && s.departedAt ? (new Date(s.deliveredAt).getTime() - new Date(s.departedAt).getTime()) / 3.6e6 : null;

  const refresh = async () => {
    setSyncing(true);
    try {
      const { jobId } = await post<{ jobId: number }>(`/api/shipments/${s.id}/sync`);
      await watchJob(jobId);
      await q.refetch();
      toast('Tracking refreshed', `${s.reference} · job #${jobId}`);
    } catch (err) {
      toast('Couldn’t refresh tracking', (err as Error).message, 'bad');
    } finally {
      setSyncing(false);
    }
  };
  const cancel = async () => {
    if (!(await confirm({ title: `Cancel ${s.reference}?`, description: `The booking with ${s.carrier} will be cancelled. This can’t be undone.`, confirmLabel: 'Cancel shipment' }))) return;
    try {
      await post(`/api/shipments/${s.id}/cancel`);
      toast(`${s.reference} cancelled`);
      q.refetch();
      qc.invalidateQueries({ queryKey: ['shipments'] });
    } catch (err) {
      toast('Couldn’t cancel', (err as Error).message, 'bad');
    }
  };

  return (
    <div className="page" data-animate>
      <BackLink />
      <header className="page-head">
        <div className="titles">
          <span className="eyebrow">{TRANSPORT_LABEL[s.mode]} shipment · {s.priority}</span>
          <h1 className="mono-title">{s.reference}</h1>
          <p style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <ShipmentStatusBadge status={s.status} />
            {s.onTime != null && <Badge tone={s.onTime ? 'good' : 'warn'} icon={s.onTime ? 'check' : 'clock'}>{s.onTime ? 'On time' : 'Arrived late'}</Badge>}
            <span className="muted">{s.customer}</span>
          </p>
        </div>
        <div className="actions">
          {moving && <Link className="btn" to={`/realm?focus=${s.id}`}><Icon name="map" size={15} />Find on map</Link>}
          {s.status !== 'delivered' && s.status !== 'cancelled' && <Button icon="refresh" loading={syncing} loadingLabel="Refreshing…" onClick={refresh}>Refresh tracking</Button>}
          {manager && s.status === 'booked' && <Button variant="danger" icon="x" onClick={cancel}>Cancel…</Button>}
        </div>
      </header>

      <section className="card route-card" aria-label="Route">
        <div className="route-ends">
          <div><span className="eyebrow">From</span><strong>{s.origin}</strong><span className="muted">{s.departedAt ? `Departed ${dateTimeFmt.format(new Date(s.departedAt))}` : `Departs ${dateTimeFmt.format(new Date(s.departsAt))}`}</span></div>
          <div style={{ textAlign: 'right' }}><span className="eyebrow">To</span><strong>{s.destination}</strong>
            <span className="muted">{s.deliveredAt ? `Delivered ${dateTimeFmt.format(new Date(s.deliveredAt))}` : `ETA ${dateTimeFmt.format(new Date(s.eta))}`}</span></div>
        </div>
        <div className="route-track" role="progressbar" aria-label="Journey progress" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(s.progress * 100)}>
          <i style={{ width: `${s.progress * 100}%` }} />
          <span className={`route-vehicle ${s.status}`} style={{ left: `${s.progress * 100}%` }}><Icon name={MODE_ICON[s.mode]} size={16} /></span>
        </div>
        <div className="route-meta">
          <span>{Math.round(s.progress * 100)}% of the journey</span>
          {s.status === 'delivered' ? <span>Transit {fmtDuration(transit)}</span> : <span style={s.status === 'delayed' ? { color: 'var(--bad)' } : undefined}>ETA {relTime(s.eta)}</span>}
        </div>
      </section>

      <div className="grid-2">
        <section className="card" aria-labelledby="timeline-title">
          <div className="card-head"><h2 id="timeline-title">Tracking</h2><span className="sub">{nf.format(events.length)} events</span></div>
          <ol className="timeline">
            {[...events].reverse().map((e, i) => {
              const [icon, label] = EVENT[e.kind] ?? ['info', e.kind];
              return (
                <li key={i} className={`tl-${e.kind}`}>
                  <span className="tl-icon"><Icon name={icon} size={14} /></span>
                  <div><strong>{label}</strong><span className="muted">{e.location}{e.note ? ` · ${e.note}` : ''}</span></div>
                  <time dateTime={e.at} title={dateTimeFmt.format(new Date(e.at))}>{relTime(e.at)}</time>
                </li>
              );
            })}
          </ol>
        </section>
        <section className="card" aria-labelledby="details-title">
          <div className="card-head"><h2 id="details-title">Details</h2></div>
          <div className="card-body">
            <dl className="kv">
              <dt>Mode</dt><dd><ModeChip mode={s.mode} /></dd>
              <dt>Carrier</dt><dd>{s.carrier}</dd>
              <dt>Customer</dt><dd>{s.customer}</dd>
              <dt>Weight</dt><dd>{fmtWeight(s.weightKg)}</dd>
              <dt>Pieces</dt><dd>{nf.format(s.pieces)}</dd>
              <dt>Service</dt><dd style={{ textTransform: 'capitalize' }}>{s.priority}</dd>
              <dt>Booked</dt><dd>{dateTimeFmt.format(new Date(s.bookedAt))}</dd>
              <dt>Promised ETA</dt><dd>{dateTimeFmt.format(new Date(s.eta))}</dd>
              {s.itemName && <><dt>Replenishes</dt><dd><Link to={`/inventory?q=${encodeURIComponent(s.itemName)}`}>{s.itemName}</Link> · {nf.format(s.quantity ?? 0)} units</dd></>}
            </dl>
          </div>
        </section>
      </div>
    </div>
  );
}

function BackLink() {
  return <Link to="/shipments" className="back-link"><Icon name="arrowL" size={14} />Shipments</Link>;
}
