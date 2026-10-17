import { useQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { ModeLegend, StackedBars } from '../components/charts';
import { Icon } from '../components/Icon';
import { ErrorState, Kpi, ModeChip, PageHead, Skeleton } from '../components/ui';
import { get, qs } from '../lib/api';
import { dateShort, fmtDuration, fmtWeight, nf, pctFmt, plural, TRANSPORT_LABEL } from '../lib/format';
import { useSession, useTitle } from '../lib/session';
import type { Analytics as Data } from '../lib/types';

const pct = (v: number | null) => (v == null ? '—' : `${pctFmt.format(v)}%`);

export default function Analytics() {
  useTitle('Analytics');
  const { company } = useSession();
  const [params] = useSearchParams();
  const days = ['7', '14', '30'].includes(params.get('days') ?? '') ? Number(params.get('days')) : 14;
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
  const q = useQuery({ queryKey: ['analytics', days], queryFn: () => get<Data>(`/api/analytics${qs({ days, tz })}`), refetchInterval: 60_000 });
  const a = q.data;
  const diff = a && a.onTimePct != null && a.prevOnTimePct != null ? a.onTimePct - a.prevOnTimePct : null;

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={company.hub} title="Analytics"
        actions={<>
          <nav className="segmented" aria-label="Date range">
            {[7, 14, 30].map((d) => <Link key={d} to={`?days=${d}`} replace aria-current={d === days ? 'page' : undefined}>{d} days</Link>)}
          </nav>
          <a className="btn" href={`/api/export/shipments.csv${qs({ status: 'delivered' })}`} download><Icon name="download" size={15} />Export deliveries</a>
        </>}>
        How the network performed over the last {days} days. Deliveries are counted on the day they arrived, in your time zone.
      </PageHead>
      {q.error && !a ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <>
        <div className="kpis">
          <Kpi icon="checkCircle" label="Deliveries" value={a ? nf.format(a.delivered) : '—'} delta={a ? `${fmtWeight(a.weightKg)} of freight` : ''} />
          <Kpi icon="clock" label="On-time rate" value={a ? pct(a.onTimePct) : '—'}
            delta={diff == null ? 'vs previous period' : `${diff >= 0 ? '▲' : '▼'} ${pctFmt.format(Math.abs(diff))} pts vs previous ${days} days`}
            deltaTone={diff == null ? undefined : diff >= 0 ? 'good' : 'bad'} />
          <Kpi icon="route" label="In motion" value={a ? nf.format(a.active) : '—'} delta={<Link to="/realm">See them on the map</Link>} />
          <Kpi icon="triangle" label="Delayed now" value={a ? nf.format(a.delayed) : '—'} delta={a?.delayed ? <Link to="/shipments?status=delayed">Review exceptions</Link> : 'No open exceptions'} deltaTone={a?.delayed ? 'bad' : 'good'} />
        </div>

        <section className="card" aria-labelledby="vol-title">
          <div className="card-head">
            <div><h2 id="vol-title">Deliveries per day</h2><p className="sub">Stacked by mode · hover or focus a day for the breakdown</p></div>
            <ModeLegend />
          </div>
          <div className="card-body" style={{ paddingBottom: 12 }}>{a ? <StackedBars data={a.volume} /> : <Skeleton h={220} />}</div>
          {a && (
            <details className="samples">
              <summary className="muted">Show as a table</summary>
              <div className="table-wrap" style={{ maxHeight: 260, marginTop: 8 }}>
                <table className="data">
                  <thead><tr><th>Day</th>{(['sea', 'road', 'rail', 'air'] as const).map((m) => <th key={m} className="r">{TRANSPORT_LABEL[m]}</th>)}<th className="r">Total</th></tr></thead>
                  <tbody>{[...a.volume].reverse().map((v) => {
                    const [y, mo, d] = v.day.slice(0, 10).split('-').map(Number);
                    return (
                      <tr key={v.day}><td>{dateShort.format(new Date(y, mo - 1, d))}</td><td className="r">{v.sea}</td><td className="r">{v.road}</td><td className="r">{v.rail}</td><td className="r">{v.air}</td>
                        <td className="r"><strong>{v.sea + v.road + v.rail + v.air}</strong></td></tr>
                    );
                  })}</tbody>
                </table>
              </div>
            </details>
          )}
        </section>

        <div className="grid-2 even">
          <section className="card" aria-labelledby="modes-title">
            <div className="card-head"><h2 id="modes-title">By mode</h2></div>
            <div className="table-wrap" style={{ paddingTop: 8 }}>
              {!a ? <div className="card-body"><Skeleton h={180} /></div> : (
                <table className="data">
                  <thead><tr><th>Mode</th><th className="r">Delivered</th><th className="r">On time</th><th className="r">Avg transit</th><th className="r">Active</th></tr></thead>
                  <tbody>{a.modes.map((m) => (
                    <tr key={m.mode}><td><ModeChip mode={m.mode} /></td><td className="r">{nf.format(m.delivered)}</td><td className="r">{pct(m.onTimePct)}</td>
                      <td className="r">{fmtDuration(m.avgTransitHours)}</td><td className="r">{nf.format(m.active)}</td></tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </section>
          <section className="card" aria-labelledby="alerts-title">
            <div className="card-head"><h2 id="alerts-title">Needs attention</h2></div>
            <div className="list" style={{ marginTop: 8 }}>
              {!a ? <div className="card-body"><Skeleton h={140} /></div> : <>
                <AttentionRow icon="triangle" n={a.delayed} one="delayed shipment" many="delayed shipments" to="/shipments?status=delayed" />
                <AttentionRow icon="boxes" n={a.lowStock} one="item at or below reorder point" many="items at or below reorder point" to="/inventory?low=1" />
                <AttentionRow icon="inbox" n={a.pendingTimeOff} one="time-off request to decide" many="time-off requests to decide" to="/requests" />
              </>}
            </div>
          </section>
        </div>

        <section className="card" aria-labelledby="carriers-title">
          <div className="card-head"><div><h2 id="carriers-title">Carrier scorecard</h2><p className="sub">On-time share of deliveries in the period</p></div></div>
          <div className="table-wrap" style={{ paddingTop: 8 }}>
            {!a ? <div className="card-body"><Skeleton h={220} /></div> : (
              <table className="data">
                <thead><tr><th>Carrier</th><th>Mode</th><th className="r">Delivered</th><th style={{ minWidth: 200 }}>On time</th><th className="r">Avg transit</th><th className="r">Delayed now</th></tr></thead>
                <tbody>{a.carriers.map((c) => (
                  <tr key={c.carrier}>
                    <td>{c.carrier}</td><td><ModeChip mode={c.mode} /></td><td className="r">{nf.format(c.delivered)}</td>
                    <td><div className="score"><span className="track"><i style={{ width: `${c.onTimePct ?? 0}%` }} /></span><span className="num">{pct(c.onTimePct)}</span></div></td>
                    <td className="r">{fmtDuration(c.avgTransitHours)}</td>
                    <td className="r">{c.delayed ? <span style={{ color: 'var(--bad)' }}>{c.delayed}</span> : 0}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </section>
      </>}
    </div>
  );
}

function AttentionRow({ icon, n, one, many, to }: { icon: 'triangle' | 'boxes' | 'inbox'; n: number; one: string; many: string; to: string }) {
  return (
    <Link to={to} className="list-item attention">
      <span className={`n-icon ${n ? 'bad' : ''}`}><Icon name={n ? icon : 'check'} size={15} /></span>
      <div className="body"><strong className="num">{plural(n, one, many)}</strong><span>{n ? 'Open the list' : 'Nothing to do'}</span></div>
      <Icon name="chevR" size={16} />
    </Link>
  );
}
