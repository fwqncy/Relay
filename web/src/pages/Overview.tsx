import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { TimeChart } from '../components/charts';
import { FormDialog, useToast } from '../components/feedback';
import { Icon, JOB_ICON, MODE_ICON } from '../components/Icon';
import { JobDialog, NewJobDialog, useKindLabel, watchJob } from '../components/jobs';
import { ApptBadge, Badge, Button, Empty, ErrorState, JobStatusBadge, Kpi, PageHead, Progress, Skeleton } from '../components/ui';
import { get, post, put, qs } from '../lib/api';
import {
  MODE_LABEL, NBSP, addDays, dateLong, dateTimeFmt, fmtMs, fmtRate, fmtTime, msParts, nf, nf1, plural, relTime, sameDay,
  startOfDay, startOfWeek, timeSecFmt, weekdayShort,
} from '../lib/format';
import { useIsManager, useSession, useStream, useTitle } from '../lib/session';
import type {
  Appointment, Dock, Job, Point, RealmData, RunProgress, RuntimeData, RuntimeMode, Shift, Staff, TimeOff, WorkerStats,
} from '../lib/types';

export default function Overview() {
  return useIsManager() ? <Runtime /> : <MyDay />;
}

/* ───────────── Runtime (managers) ───────────── */

function Runtime() {
  useTitle('Runtime');
  const { company } = useSession();
  const [params, setParams] = useSearchParams();
  const metric = params.get('metric') === 'throughput' ? 'throughput' : 'p95';
  const toast = useToast();
  const qc = useQueryClient();
  const { subscribe } = useStream();
  const [series, setSeries] = useState<Point[]>([]);
  const [workers, setWorkers] = useState<WorkerStats[]>([]);
  const [active, setActive] = useState<RunProgress[]>([]);
  const [mode, setMode] = useState<RuntimeMode | null>(null);
  const [live, setLive] = useState(false);
  const [burstOpen, setBurstOpen] = useState(params.get('burst') === '1');
  const [switching, setSwitching] = useState(false);

  const runtime = useQuery({ queryKey: ['runtime'], queryFn: () => get<RuntimeData>('/api/runtime'), refetchInterval: 15_000 });
  const d = runtime.data;

  // Seed from the snapshot once; the stream appends from then on.
  const seeded = useRef(false);
  useEffect(() => {
    if (!d || seeded.current) return;
    seeded.current = true;
    setSeries(d.history ?? []);
    setWorkers(d.workerStats ?? []);
    setActive(d.activeRuns ?? []);
    setMode(d.mode);
  }, [d]);

  const prevActive = useRef<string>('');
  useEffect(() => subscribe((m) => {
    setLive(true);
    if (m.point) setSeries((s) => (s.at(-1)?.t === m.point!.t ? s : [...s.slice(-299), m.point!]));
    if (m.workers) setWorkers(m.workers);
    setMode((cur) => (cur !== m.mode ? m.mode : cur));
    const runs = m.activeRuns ?? [];
    setActive(runs);
    const key = runs.map((r) => r.id).join();
    if (prevActive.current && key.split(',').filter(Boolean).length < prevActive.current.split(',').filter(Boolean).length) {
      qc.invalidateQueries({ queryKey: ['runtime'] }).then(() => {
        const r = qc.getQueryData<RuntimeData>(['runtime'])?.runs?.[0];
        if (r) toast('Burst finished', `${MODE_LABEL[r.mode]}: p95 ${fmtMs(r.p95)} across ${nf.format(r.jobs)} jobs`);
      });
    }
    prevActive.current = key;
  }), [subscribe, qc, toast]);

  const runs = d?.runs ?? [];
  const ws = runs.find((r) => r.mode === 'work-stealing');
  const sq = runs.find((r) => r.mode === 'single-queue');
  const latest = series.at(-1);
  const markers = useMemo(() => (d?.changes ?? []).slice(1).map((c) => ({ t: new Date(c.at).getTime(), label: `→ ${MODE_LABEL[c.mode]}` })), [d?.changes]);
  const steals = workers.reduce((a, w) => a + w.steals, 0);

  const switchMode = async (next: RuntimeMode) => {
    if (next === mode || switching) return;
    const prev = mode;
    setMode(next);
    setSwitching(true);
    try {
      await put('/api/runtime/mode', { mode: next });
      qc.invalidateQueries({ queryKey: ['runtime'] });
      toast(`Switched to ${MODE_LABEL[next]}`, next === 'single-queue'
        ? 'One poller now reads and claims every job before handing it to the pool.'
        : 'Each worker prefetches its own jobs and steals from stalled peers.', 'info');
    } catch (err) {
      setMode(prev);
      toast('Couldn’t switch mode', (err as Error).message, 'bad');
    } finally {
      setSwitching(false);
    }
  };

  const valueFn = useCallback((p: Point) => (metric === 'p95' ? p.p95 : p.throughput), [metric]);
  const formatFn = useCallback((v: number, axis?: boolean) => metric === 'p95'
    ? (axis ? (v >= 1000 ? `${nf1.format(v / 1000)}s` : `${nf1.format(v)}ms`) : fmtMs(v))
    : (axis ? fmtRate(v) : `${fmtRate(v)} jobs/s`), [metric]);

  if (runtime.error && !d) return <div className="page"><ErrorState error={runtime.error} onRetry={() => runtime.refetch()} /></div>;
  const [pv, pu] = msParts(latest?.p95 ?? null);

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={company.hub} title="Runtime"
        actions={<>
          <div className="segmented" role="group" aria-label="Scheduling mode">
            {(['work-stealing', 'single-queue'] as RuntimeMode[]).map((m) => (
              <button key={m} type="button" aria-pressed={mode === m} onClick={() => switchMode(m)} disabled={switching}>
                <Icon name={m === 'work-stealing' ? 'zap' : 'list'} size={14} />{MODE_LABEL[m]}
              </button>
            ))}
          </div>
          <Button variant="primary" icon="layers" onClick={() => setBurstOpen(true)}>Run burst…</Button>
        </>}>
        Jobs for {company.name} run on a shared pool of work-stealing workers fed by Redis Streams. Latency is measured from enqueue to the moment a worker starts the job.
      </PageHead>

      <div className="kpis">
        <Kpi label={<><span className={`live-dot ${live ? '' : 'off'}`} aria-hidden="true" />p95 queue latency</>}
          value={latest?.p95 == null ? '—' : pv} unit={latest?.p95 == null ? undefined : pu}
          delta={ws && sq && ws.p95 < sq.p95 ? `Burst ${fmtMs(ws.p95)}, from ${fmtMs(sq.p95)} single-queue` : `Last 5 seconds · ${mode ? MODE_LABEL[mode] : '…'}`}
          deltaTone={ws && sq && ws.p95 < sq.p95 ? 'good' : undefined} />
        <Kpi label="Throughput" value={fmtRate(latest?.throughput ?? null)} unit="/s" delta="Jobs finished per second" />
        <Kpi label="Backlog" value={latest ? nf.format(latest.queued) : '—'} delta="Jobs waiting in the stream" />
        <Kpi label="Steals" value={nf.format(steals)} delta="Jobs reclaimed from stalled peers" />
      </div>

      <div className="grid-2 runtime-row">
        <section className="card chart-card" aria-labelledby="chart-title">
          <div>
            <div className="card-head">
              <div><h2 id="chart-title">{metric === 'p95' ? 'p95 queue latency' : 'Throughput'}</h2>
                <p className="sub">Last 5 minutes · dashed lines mark mode changes</p></div>
              <nav className="segmented" aria-label="Chart metric">
                <Link to="?metric=p95" replace aria-current={metric === 'p95' ? 'page' : undefined}>Latency</Link>
                <Link to="?metric=throughput" replace aria-current={metric === 'throughput' ? 'page' : undefined}>Throughput</Link>
              </nav>
            </div>
            <div className="chart-wrap">
              {!d ? <Skeleton h={240} /> : (
                <TimeChart points={series} value={valueFn} format={formatFn} markers={markers}
                  label={metric === 'p95' ? 'p95 queue latency' : 'Throughput'} empty="No jobs finished in this window." />
              )}
            </div>
          </div>
          <details className="samples">
            <summary className="muted">Show recent samples as a table</summary>
            <div className="table-wrap" style={{ maxHeight: 220, marginTop: 8 }}>
              <table className="data">
                <thead><tr><th>Time</th><th className="r">p50</th><th className="r">p95</th><th className="r">Jobs/s</th><th className="r">Backlog</th><th>Mode</th></tr></thead>
                <tbody>{series.slice(-30).reverse().map((p) => (
                  <tr key={p.t}><td className="num">{timeSecFmt.format(new Date(p.t))}</td><td className="r">{fmtMs(p.p50)}</td><td className="r">{fmtMs(p.p95)}</td>
                    <td className="r">{fmtRate(p.throughput)}</td><td className="r">{nf.format(p.queued)}</td><td>{MODE_LABEL[p.mode]}</td></tr>
                ))}</tbody>
              </table>
            </div>
          </details>
        </section>

        <section className="card workers-card" aria-labelledby="workers-title">
          <div className="card-head"><div><h2 id="workers-title">{mode === 'single-queue' ? 'Worker pool (single queue)' : 'Work-stealing workers'}</h2>
            <p className="sub">Share of the last second each worker spent running jobs</p></div></div>
          <div className="card-body">
            <div className="workers">
              {!workers.length ? Array.from({ length: 8 }, (_, i) => <Skeleton key={i} h={14} />) : workers.map((w) => {
                const pct = Math.round(w.utilization * 100);
                return (
                  <div key={w.id} className="worker" title={`${w.id}: ${nf.format(w.processed)} jobs run, ${nf.format(w.steals)} stolen, ${w.local} prefetched`}>
                    <span className="id">{w.id}</span>
                    <span className="bar" role="meter" aria-label={`${w.id} utilisation`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
                      <i style={{ transform: `scaleX(${w.utilization})` }} />
                    </span>
                    <span className="pct">{pct}%</span>
                  </div>
                );
              })}
            </div>
            <div className="worker-meta">
              <span>{nf.format(workers.reduce((a, w) => a + w.processed, 0))} jobs since start</span>
              <span>{nf.format(workers.reduce((a, w) => a + w.local, 0))} prefetched in local deques</span>
            </div>
          </div>
        </section>

        <section className="card runs-card" aria-labelledby="runs-title">
          <div className="card-head"><div><h2 id="runs-title">Burst comparison</h2><p className="sub">p95 queue latency of the latest burst in each mode</p></div></div>
          <div className="card-body">
            {active.map((a) => (
              <div key={a.id} style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12.5 }}>
                  <span style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }}><span className="spinner" aria-hidden="true" style={{ width: 10, height: 10 }} />Burst draining · {MODE_LABEL[a.mode]}</span>
                  <span className="num muted">{nf.format(a.done)} / {nf.format(a.total)}</span>
                </div>
                <Progress value={a.done} max={a.total} label="Burst progress" />
              </div>
            ))}
            {!ws && !sq && !active.length ? (
              <Empty icon="layers" title="No bursts yet" action={<Button size="sm" onClick={() => setBurstOpen(true)}>Run burst…</Button>}>
                Run a burst in each mode to compare p95 latency under the same load.
              </Empty>
            ) : (
              <div className="compare">
                {([['sq', sq, 'Single-queue'], ['ws', ws, 'Work-stealing']] as const).map(([cls, r, name]) => {
                  const max = Math.max(ws?.p95 || 0, sq?.p95 || 0) || 1;
                  return (
                    <div key={cls} className={`compare-row ${cls}`}>
                      <span className="name">{name}</span>
                      <span className="track"><i style={{ width: `${r ? (r.p95 / max) * 100 : 0}%` }} /></span>
                      <span className="val">{r ? fmtMs(r.p95) : '—'}</span>
                    </div>
                  );
                })}
                <p className="compare-note">{ws && sq
                  ? (ws.p95 < sq.p95 ? `Work-stealing p95 is ${nf1.format(sq.p95 / ws.p95)}× lower (${nf.format(ws.jobs)} vs ${nf.format(sq.jobs)} jobs).` : 'Work-stealing isn’t ahead in the latest pair — try a larger burst.')
                  : `Run a burst in ${ws ? 'single-queue' : 'work-stealing'} mode to complete the comparison.`}</p>
              </div>
            )}
          </div>
          {runs.length > 0 && (
            <div className="table-wrap" style={{ borderTop: '1px solid var(--border)' }}>
              <table className="data">
                <thead><tr><th>Mode</th><th className="r">Jobs</th><th className="r">p50</th><th className="r">p95</th><th className="r">p99</th><th className="r">Jobs/s</th><th>When</th></tr></thead>
                <tbody>{runs.map((r) => (
                  <tr key={r.id}>
                    <td><Badge tone={r.mode === 'work-stealing' ? 'accent' : ''}>{MODE_LABEL[r.mode]}</Badge></td>
                    <td className="r">{nf.format(r.jobs)}</td><td className="r">{fmtMs(r.p50)}</td><td className="r"><strong>{fmtMs(r.p95)}</strong></td>
                    <td className="r">{fmtMs(r.p99)}</td><td className="r">{fmtRate(r.throughput)}</td>
                    <td className="muted" title={dateTimeFmt.format(new Date(r.finishedAt))}>{relTime(r.finishedAt)}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </section>

        <div className="mix-slot">
          <section className="card mix-card" aria-labelledby="mix-title">
            <div className="card-head"><div><h2 id="mix-title">Job mix</h2><p className="sub">Operational traffic, last 15 minutes</p></div>
              <Link className="btn sm" to="/jobs">View jobs</Link></div>
            <div className="table-wrap" style={{ paddingTop: 8 }}>
              {!d ? <div className="card-body"><Skeleton h={160} /></div> : !d.types?.length ? <Empty title="No jobs in the last 15 minutes">Operational jobs show up here as they run.</Empty> : (
                <table className="data">
                  <thead><tr><th>Type</th><th className="r">Jobs</th><th className="r">Avg run</th><th className="r">Failed</th><th className="r">Stolen</th></tr></thead>
                  <tbody>{d.types.map((t) => (
                    <tr key={t.type}>
                      <td><span style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}><Icon name={JOB_ICON[t.type] ?? 'zap'} size={14} />
                        <Link className="rowlink mono" to={`/jobs?type=${encodeURIComponent(t.type)}`}>{t.type}</Link></span></td>
                      <td className="r">{nf.format(t.total)}</td><td className="r">{fmtMs(t.avgMs)}</td>
                      <td className="r">{t.failed ? <span style={{ color: 'var(--bad)' }}>{nf.format(t.failed)}</span> : 0}</td><td className="r">{nf.format(t.stolen)}</td>
                    </tr>
                  ))}</tbody>
                </table>
              )}
            </div>
          </section>
        </div>
      </div>

      <BurstDialog open={burstOpen} mode={mode} onOpenChange={(o) => { setBurstOpen(o); if (!o && params.has('burst')) { params.delete('burst'); setParams(params, { replace: true }); } }} />
    </div>
  );
}

function BurstDialog({ open, onOpenChange, mode }: { open: boolean; onOpenChange: (o: boolean) => void; mode: RuntimeMode | null }) {
  const toast = useToast();
  const qc = useQueryClient();
  const sizes: [number, string][] = [[2000, 'Quick check'], [5000, 'Shift change'], [12000, 'Dispatch wave'], [20000, 'Peak season']];
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Run a burst" submitLabel="Start burst" submitIcon="layers" pendingLabel="Queuing…"
      description={<>Enqueues a dispatch wave at once — mostly ETA recomputes and labels, plus driver messages and route optimisations. It runs in the current mode: <strong>{mode ? MODE_LABEL[mode] : '…'}</strong>.</>}
      onSubmit={async (form) => {
        const jobs = Number(new FormData(form).get('jobs'));
        await post('/api/runtime/burst', { jobs });
        toast('Burst started', `${nf.format(jobs)} jobs queued in ${mode ? MODE_LABEL[mode] : ''} mode.`, 'info');
        qc.invalidateQueries({ queryKey: ['runtime'] });
      }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>Burst size</legend>
        <div className="choice-grid">
          {sizes.map(([n, label]) => (
            <label key={n} className="choice">
              <input type="radio" name="jobs" value={n} defaultChecked={n === 12000} />
              <strong>{nf.format(n)}</strong><span>{label}</span>
            </label>
          ))}
        </div>
        <p className="hint">Results join the burst comparison once every job has run.</p>
      </fieldset>
    </FormDialog>
  );
}

/* ───────────── My day (employees) ───────────── */

function MyDay() {
  useTitle('My day');
  const { user, company, jobKinds } = useSession();
  const toast = useToast();
  const kindLabel = useKindLabel();
  const navigate = useNavigate();
  const { last } = useStream();
  const [newJob, setNewJob] = useState<string | null>(null);
  const [openJob, setOpenJob] = useState<number | null>(null);
  const [checking, setChecking] = useState<number | null>(null);
  const now = new Date();
  const hour = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';
  const day0 = startOfDay(now);
  const week0 = startOfWeek(now);

  const shifts = useQuery({
    queryKey: ['shifts', week0.toISOString()],
    queryFn: () => get<{ staff: Staff[]; shifts: Shift[]; timeOff: TimeOff[] }>(`/api/shifts${qs({ from: week0.toISOString(), to: addDays(week0, 7).toISOString() })}`),
  });
  const appts = useQuery({
    queryKey: ['docks', 'mine', day0.toISOString()],
    queryFn: () => get<{ docks: Dock[]; appointments: Appointment[] }>(`/api/docks${qs({ from: day0.toISOString(), to: addDays(day0, 3).toISOString() })}`),
    refetchInterval: 30_000,
  });
  const recent = useQuery({ queryKey: ['jobs', 'recent'], queryFn: () => get<{ jobs: Job[] }>('/api/jobs?limit=6'), refetchInterval: 4000 });
  const myRequests = useQuery({ queryKey: ['requests', 'mine'], queryFn: () => get<{ requests: TimeOff[] }>('/api/requests?mine=1') });
  const realm = useQuery({ queryKey: ['realm'], queryFn: () => get<RealmData>('/api/realm'), refetchInterval: 20_000 });

  const mine = (shifts.data?.shifts ?? []).filter((s) => s.userId === user.id);
  const today = mine.find((s) => sameDay(new Date(s.startsAt), now));
  const next = mine.find((s) => new Date(s.startsAt) > now && !sameDay(new Date(s.startsAt), now));
  const hours = mine.reduce((a, s) => a + (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3.6e6, 0);
  const docks = new Map((appts.data?.docks ?? []).map((x) => [x.id, x.name]));
  const myAppts = (appts.data?.appointments ?? [])
    .filter((a) => a.assignedTo === user.id && (new Date(a.endsAt).getTime() > Date.now() - 3600e3 || a.status === 'checked_in')).slice(0, 6);
  const pendingReq = myRequests.data?.requests.filter((r) => r.status === 'pending') ?? [];

  const checkIn = async (a: Appointment) => {
    setChecking(a.id);
    try {
      const { jobId } = await post<{ jobId: number }>(`/api/appointments/${a.id}/checkin`);
      const j = await watchJob(jobId);
      if (j.status === 'succeeded') toast(`${a.carrier} checked in`, `${docks.get(a.dockId)} · job #${jobId} waited ${fmtMs(j.queueMs)}`);
      else toast('Check-in failed', j.error ?? '', 'bad');
      await Promise.all([appts.refetch(), recent.refetch()]);
    } catch (err) {
      toast('Couldn’t check in', (err as Error).message, 'bad');
    } finally {
      setChecking(null);
    }
  };

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={dateLong.format(now)} title={`${greeting}, ${user.name.split(' ')[0]}`}
        actions={<Badge><span className={`live-dot ${last?.point ? '' : 'off'}`} aria-hidden="true" />{last?.point ? `${MODE_LABEL[last.mode]} · p95 ${fmtMs(last.point.p95)}` : 'Runtime connecting…'}</Badge>}>
        {user.title} at {company.name} · {company.hub}
      </PageHead>
      <div className="grid-2">
        <div className="stack">
          <section className="card" aria-labelledby="shift-title">
            <div className="card-head"><h2 id="shift-title">Today’s shift</h2><Link className="btn sm" to="/shifts">Full schedule</Link></div>
            {!shifts.data ? <div className="card-body"><Skeleton h={56} /></div> : today ? (
              <div className="shift-hero">
                <div><div className="when">{fmtTime(today.startsAt)} – {fmtTime(today.endsAt)}</div><p className="muted">{today.position} · {today.location}</p></div>
                <div style={{ marginLeft: 'auto', display: 'grid', gap: 6, justifyItems: 'end' }}>
                  {new Date(today.startsAt) <= now && new Date(today.endsAt) > now ? <Badge tone="good" icon="play">On shift now</Badge>
                    : new Date(today.endsAt) <= now ? <Badge icon="check">Shift finished</Badge> : <Badge tone="info" icon="clock">Starts {relTime(today.startsAt)}</Badge>}
                  <span className="subtle num" style={{ fontSize: 12.5 }}>{nf1.format(hours)}{NBSP}h scheduled this week</span>
                </div>
              </div>
            ) : (
              <Empty title="You’re not scheduled today">
                {next ? `Next shift: ${dateLong.format(new Date(next.startsAt))}, ${fmtTime(next.startsAt)} – ${fmtTime(next.endsAt)}.` : 'No more published shifts this week.'}
              </Empty>
            )}
          </section>

          <section className="card" aria-labelledby="appts-title">
            <div className="card-head"><div><h2 id="appts-title">Your dock appointments</h2>
              <p className="sub">Assigned to you over the next few days. Checking in runs a job on the runtime.</p></div>
              <Link className="btn sm" to="/docks">Dock schedule</Link></div>
            <div className="list" style={{ marginTop: 8 }}>
              {!appts.data ? <div className="card-body"><Skeleton h={120} /></div> : !myAppts.length ? (
                <Empty icon="dock" title="No upcoming appointments">Nothing is assigned to you for the next few days.</Empty>
              ) : myAppts.map((a) => (
                <div key={a.id} className="list-item">
                  <span className="time-chip">{sameDay(new Date(a.startsAt), now) ? fmtTime(a.startsAt) : `${weekdayShort.format(new Date(a.startsAt))} ${fmtTime(a.startsAt)}`}</span>
                  <div className="body"><strong>{a.carrier} · {a.reference}</strong>
                    <span>{docks.get(a.dockId)} · {a.direction === 'inbound' ? 'Inbound' : 'Outbound'} · {plural(a.pallets, 'pallet')}</span></div>
                  {a.status === 'confirmed'
                    ? <Button size="sm" variant="primary" icon="truck" loading={checking === a.id} loadingLabel="Checking in…" onClick={() => checkIn(a)}>Check in</Button>
                    : <ApptBadge status={a.status} />}
                </div>
              ))}
            </div>
          </section>
        </div>

        <div className="stack">
          <section className="card" aria-labelledby="quick-title">
            <div className="card-head"><h2 id="quick-title">Quick actions</h2></div>
            <div className="quick">
              {jobKinds.filter((k) => k.submit === 'all').map((k) => (
                <button key={k.type} type="button" onClick={() => setNewJob(k.type)}>
                  <span className="ico"><Icon name={JOB_ICON[k.type] ?? 'zap'} size={16} /></span>
                  <span><strong>{k.label}…</strong><span>{k.description}</span></span>
                </button>
              ))}
              <button type="button" onClick={() => navigate('/requests?new=1')}>
                <span className="ico"><Icon name="calendar" size={16} /></span>
                <span><strong>Request time off…</strong><span>{pendingReq.length ? `${plural(pendingReq.length, 'request')} awaiting a decision.` : 'Ask your manager for leave.'}</span></span>
              </button>
              <button type="button" onClick={() => navigate('/realm')}>
                <span className="ico"><Icon name="map" size={16} /></span>
                <span><strong>Visit the realm</strong><span>{realm.data ? `${nf.format(realm.data.modes.reduce((a, m) => a + m.active, 0))} shipments on the move.` : 'See every vehicle on the map.'}</span></span>
              </button>
            </div>
          </section>

          {realm.data && (
            <section className="card" aria-labelledby="realm-mini">
              <div className="card-head"><h2 id="realm-mini">Fleet levels</h2><Link className="btn sm" to="/realm">Open map</Link></div>
              <div className="card-body realm-mini">
                {realm.data.modes.map((m) => (
                  <div key={m.mode} className="realm-mini-row">
                    <span className={`mode-dot ${m.mode}`} aria-hidden="true" />
                    <Icon name={MODE_ICON[m.mode]} size={14} />
                    <span>{m.name} <span className="subtle">· Lv {m.level}</span></span>
                    <span className="muted">{m.tier.vehicle}</span>
                  </div>
                ))}
              </div>
            </section>
          )}

          <section className="card" aria-labelledby="recent-title">
            <div className="card-head"><h2 id="recent-title">Your recent jobs</h2><Link className="btn sm" to="/jobs">View all</Link></div>
            <div className="list" style={{ marginTop: 8 }}>
              {!recent.data ? <div className="card-body"><Skeleton h={120} /></div> : !recent.data.jobs.length ? (
                <Empty title="No jobs yet">Use a quick action to run your first job.</Empty>
              ) : recent.data.jobs.map((j) => (
                <div key={j.id} className="list-item">
                  <span style={{ color: 'var(--text-2)' }}><Icon name={JOB_ICON[j.type] ?? 'zap'} size={16} /></span>
                  <div className="body">
                    <strong><button type="button" className="linkish" onClick={() => setOpenJob(j.id)}>{kindLabel(j.type)}</button></strong>
                    <span className="num">#{j.id} · {relTime(j.enqueuedAt)}{j.durationMs != null ? ` · ran ${fmtMs(j.durationMs)}` : ''}</span>
                  </div>
                  <JobStatusBadge status={j.status} />
                </div>
              ))}
            </div>
          </section>
        </div>
      </div>
      <NewJobDialog open={newJob != null} defaultType={newJob ?? undefined} onOpenChange={(o) => !o && setNewJob(null)} onQueued={() => recent.refetch()} />
      <JobDialog id={openJob} onClose={() => setOpenJob(null)} />
    </div>
  );
}
