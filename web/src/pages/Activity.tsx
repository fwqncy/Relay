import { useInfiniteQuery } from '@tanstack/react-query';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon, type IconName } from '../components/Icon';
import { Avatar, Button, Empty, ErrorState, PageHead, Skeleton } from '../components/ui';
import { get, qs } from '../lib/api';
import { dateTimeSecFmt, plural, relTime } from '../lib/format';
import { useTitle } from '../lib/session';
import type { AuditEntry } from '../lib/types';

const AREAS: [string, string, IconName][] = [
  ['', 'Everything', 'scroll'], ['shipment', 'Shipments', 'package'], ['appointment', 'Docks', 'dock'], ['shift', 'Shifts', 'calendar'],
  ['request', 'Requests', 'inbox'], ['inventory', 'Inventory', 'boxes'], ['runtime', 'Runtime', 'activity'], ['realm', 'Realm', 'map'], ['auth', 'Sign-ins', 'user'],
];

const VERB: Record<string, string> = {
  'auth.login': 'signed in', 'runtime.mode': 'switched the runtime to', 'runtime.burst': 'ran a burst of', 'job.retry': 'retried job',
  'appointment.create': 'requested a dock slot for', 'appointment.confirm': 'confirmed', 'appointment.checkin': 'checked in',
  'appointment.complete': 'completed appointment', 'shift.create': 'added shift', 'shift.delete': 'deleted shift', 'shift.publish': 'published',
  'shipment.create': 'booked', 'shipment.cancel': 'cancelled', 'request.create': 'requested time off', 'request.approve': 'approved time off for',
  'request.deny': 'denied time off for', 'request.withdraw': 'withdrew request', 'inventory.adjust': 'adjusted stock of',
  'inventory.reorder': 'reordered', 'realm.advance': 'fast-forwarded the realm by',
};

export default function Activity() {
  useTitle('Activity log');
  const [params] = useSearchParams();
  const area = AREAS.some(([v]) => v === params.get('area')) ? params.get('area')! : '';
  const q = useInfiniteQuery({
    queryKey: ['activity', area],
    queryFn: ({ pageParam }) => get<{ entries: AuditEntry[] }>(`/api/activity${qs({ action: area, before: pageParam || undefined })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.entries.length === 50 ? last.entries.at(-1)!.id : undefined),
    refetchInterval: 20_000,
  });
  const rows = q.data?.pages.flatMap((p) => p.entries) ?? [];
  return (
    <div className="page" data-animate>
      <PageHead eyebrow="Audit trail" title="Activity log"
        actions={<a className="btn" href="/api/export/activity.csv" download><Icon name="download" size={15} />Export CSV</a>}>
        Who changed what, and when. Every sign-in, booking, decision and adjustment is recorded.
      </PageHead>
      <section className="card">
        <div className="toolbar">
          <nav className="segmented" aria-label="Filter by area">
            {AREAS.map(([v, label, icon]) => <Link key={label} to={v ? `?area=${v}` : '?'} replace aria-current={v === area ? 'page' : undefined}><Icon name={icon} size={14} />{label}</Link>)}
          </nav>
        </div>
        {q.isLoading ? <div className="card-body"><Skeleton h={320} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} />
          : !rows.length ? <Empty icon="scroll" title="Nothing recorded yet">Actions appear here as people use Relay.</Empty>
          : (
            <ol className="audit">
              {rows.map((e) => (
                <li key={e.id}>
                  <Avatar name={e.actor ?? 'System'} />
                  <p><strong>{e.actor ?? 'System'}</strong> {VERB[e.action] ?? e.action} <strong className="mono-ish">{e.target}</strong>{e.detail && <span className="muted"> · {e.detail}</span>}</p>
                  <time dateTime={e.at} title={dateTimeSecFmt.format(new Date(e.at))}>{relTime(e.at)}</time>
                </li>
              ))}
            </ol>
          )}
        {rows.length > 0 && (
          <div className="card-foot">
            <span>Showing {plural(rows.length, 'entry', 'entries')}</span>
            {q.hasNextPage ? <Button size="sm" loading={q.isFetchingNextPage} loadingLabel="Loading…" onClick={() => q.fetchNextPage()}>Load more</Button> : <span className="subtle">Start of the log</span>}
          </div>
        )}
      </section>
    </div>
  );
}
