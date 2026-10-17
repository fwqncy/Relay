import { useInfiniteQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Icon, JOB_ICON } from '../components/Icon';
import { JobDialog, NewJobDialog } from '../components/jobs';
import { Button, Empty, ErrorState, JobStatusBadge, PageHead, Skeleton } from '../components/ui';
import { get, qs } from '../lib/api';
import { dateTimeSecFmt, fmtMs, nf, plural, relTime } from '../lib/format';
import { useIsManager, useSession, useTitle } from '../lib/session';
import type { Job } from '../lib/types';

const TABS: [string, string][] = [['', 'All'], ['queued', 'Queued'], ['running', 'Running'], ['succeeded', 'Succeeded'], ['failed', 'Failed']];

export default function Jobs() {
  const manager = useIsManager();
  useTitle(manager ? 'Jobs' : 'My jobs');
  const { allKinds } = useSession();
  const [params, setParams] = useSearchParams();
  const status = TABS.some(([v]) => v === params.get('status')) ? params.get('status')! : '';
  const type = params.get('type') ?? '';
  const q = params.get('q') ?? '';
  const load = params.get('load') === '1';
  const [search, setSearch] = useState(q);
  const [live, setLive] = useState(() => { try { return sessionStorage.getItem('relay-jobs-live') !== '0'; } catch { return true; } });
  const jobParam = Number(params.get('job')) || null;
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');

  const setParam = (k: string, v: string) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v); else next.delete(k);
    next.delete('job');
    setParams(next, { replace: true });
  };
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== q) setParam('q', search.trim()); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const filters = { status, type, q, load: load ? 1 : undefined };
  const query = useInfiniteQuery({
    queryKey: ['jobs', 'list', filters],
    queryFn: ({ pageParam }) => get<{ jobs: Job[]; counts?: Record<string, number> }>(`/api/jobs${qs({ ...filters, before: pageParam || undefined })}`),
    initialPageParam: 0,
    getNextPageParam: (last) => (last.jobs.length === 50 ? last.jobs.at(-1)!.id : undefined),
    refetchInterval: (qq) => (live && (qq.state.data?.pages.length ?? 0) <= 1 ? 3000 : false),
  });
  const jobs = query.data?.pages.flatMap((p) => p.jobs) ?? [];
  const counts = query.data?.pages[0]?.counts;
  const total = counts ? Object.values(counts).reduce((a, b) => a + b, 0) : 0;
  const filtered = !!(status || type || q);
  const linkWith = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); n.delete('job'); const s = n.toString(); return s ? `?${s}` : '?'; };
  const openJob = (id: number) => { const n = new URLSearchParams(params); n.set('job', String(id)); setParams(n, { replace: true }); };

  return (
    <div className="page" data-animate>
      <PageHead eyebrow="Redis stream · relay:jobs" title={manager ? 'Jobs' : 'My jobs'}
        actions={<>
          <a className="btn" href={`/api/export/jobs.csv${qs(filters)}`} download><Icon name="download" size={15} />Export CSV</a>
          <Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Run a job…</Button>
        </>}>
        {manager ? 'Every job your company has run in the last two hours, including tracking syncs and stock picks from the simulation.' : 'Jobs you’ve started, newest first.'}
      </PageHead>

      <section className="card" aria-label="Job list">
        <div className="toolbar">
          <nav className="segmented" aria-label="Filter by status">
            {TABS.map(([v, label]) => (
              <Link key={v} to={linkWith('status', v)} replace aria-current={v === status ? 'page' : undefined}>
                {label} <span className="count">{counts ? nf.format(v ? counts[v] ?? 0 : total) : ''}</span>
              </Link>
            ))}
          </nav>
          <span className="grow" />
          <label className="search"><span className="sr-only">Search jobs</span><Icon name="search" size={15} />
            <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search ID, payload, error…" autoComplete="off" spellCheck={false} />
          </label>
          <label><span className="sr-only">Job type</span>
            <select className="select sm" value={type} onChange={(e) => setParam('type', e.target.value)} style={{ width: 'auto' }}>
              <option value="">All types</option>
              {allKinds.map((k) => <option key={k.type} value={k.type}>{k.type}</option>)}
            </select>
          </label>
          {manager && <label className="check"><input type="checkbox" checked={load} onChange={(e) => setParam('load', e.target.checked ? '1' : '')} />Include load tests</label>}
          <label className="check">
            <input type="checkbox" checked={live} onChange={(e) => { setLive(e.target.checked); try { sessionStorage.setItem('relay-jobs-live', e.target.checked ? '1' : '0'); } catch { /* ignore */ } }} />
            <span className={`live-dot ${live ? '' : 'off'}`} aria-hidden="true" />Live
          </label>
        </div>
        <div className="table-wrap">
          {query.isLoading ? <div className="card-body"><Skeleton h={320} /></div>
            : query.error ? <ErrorState error={query.error} onRetry={() => query.refetch()} />
            : !jobs.length ? (
              <Empty title={filtered ? 'No jobs match these filters' : 'No jobs yet'} action={filtered && <Link className="btn sm" to="/jobs" replace>Clear filters</Link>}>
                {filtered ? 'Try another status or clear the search.' : 'Jobs appear here as soon as they’re queued.'}
              </Empty>
            ) : (
              <table className="data">
                <thead><tr><th>ID</th><th>Type</th><th>Status</th><th className="r">Queue wait</th><th className="r">Run time</th><th>Worker</th>{manager && <th>Submitted by</th>}<th>Enqueued</th></tr></thead>
                <tbody>
                  {jobs.map((j) => (
                    <tr key={j.id} className="clickable" onClick={(e) => { if (!(e.target as HTMLElement).closest('a,button')) openJob(j.id); }}>
                      <td><button type="button" className="rowlink mono linkish" onClick={() => openJob(j.id)}>#{j.id}</button></td>
                      <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Icon name={JOB_ICON[j.type] ?? 'zap'} size={14} /><span className="mono">{j.type}</span></span></td>
                      <td><JobStatusBadge status={j.status} />{j.attempts > 1 && <> <span className="tag" title="Attempts">×{j.attempts}</span></>}</td>
                      <td className="r">{fmtMs(j.queueMs)}</td>
                      <td className="r">{fmtMs(j.durationMs)}</td>
                      <td>{j.worker ? <><span className="mono">{j.worker}</span>{j.stolen && <> <span className="tag accent" title="Reclaimed from a stalled worker">stolen</span></>}</> : <span className="subtle">—</span>}</td>
                      {manager && <td className="trunc">{j.submittedBy || <span className="subtle">{j.runId ? 'Load test' : 'Platform'}</span>}</td>}
                      <td className="muted" title={dateTimeSecFmt.format(new Date(j.enqueuedAt))}>{relTime(j.enqueuedAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
        </div>
        {jobs.length > 0 && (
          <div className="card-foot">
            <span className="num">Showing {plural(jobs.length, 'job')}</span>
            {query.hasNextPage ? <Button size="sm" loading={query.isFetchingNextPage} loadingLabel="Loading…" onClick={() => query.fetchNextPage()}>Load more</Button> : <span className="subtle">End of list</span>}
          </div>
        )}
      </section>
      <JobDialog id={jobParam} onClose={() => setParam('job', '')} />
      <NewJobDialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o && params.has('new')) setParam('new', ''); }} onQueued={() => query.refetch()} />
    </div>
  );
}
