import { useQuery } from '@tanstack/react-query';
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Field, FormDialog, Modal, useToast } from '../components/feedback';
import { Icon } from '../components/Icon';
import { watchJob } from '../components/jobs';
import { APPT_STATUS, ApptBadge, Button, ErrorState, PageHead, Skeleton } from '../components/ui';
import { ApiError, get, post, qs } from '../lib/api';
import { addDays, atTime, dateLong, fmtMs, fmtTime, hhmm, isoDate, nf, parseISODate, plural, sameDay, startOfDay } from '../lib/format';
import { useInterval, useIsManager, useSession, useTitle } from '../lib/session';
import type { Appointment, Dock, Staff } from '../lib/types';

const DAY_START = 5, DAY_END = 21, SLOT = 30;
const CARRIERS = ['Blue Ridge Haulage', 'Coastline Carriers', 'Summit Transport', 'Delta Line Trucking', 'Ironbridge Logistics', 'Prairie Express', 'Northgate Freight', 'Lakeshore Cartage'];
type DockData = { docks: Dock[]; appointments: Appointment[]; staff: Staff[] };

export default function Docks() {
  useTitle('Dock schedule');
  const manager = useIsManager();
  const { user, company } = useSession();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const day = parseISODate(params.get('date')) ?? startOfDay(new Date());
  const today = startOfDay(new Date());
  const href = (d: Date) => `/docks?date=${isoDate(d)}`;
  const [selected, setSelected] = useState<number | null>(null);
  const [booking, setBooking] = useState<{ dockId: number; time: string } | null>(null);
  const [, tick] = useState(0);
  const scroller = useRef<HTMLDivElement>(null);
  const scrolledFor = useRef('');

  const q = useQuery({
    queryKey: ['docks', isoDate(day)],
    queryFn: () => get<DockData>(`/api/docks${qs({ from: day.toISOString(), to: addDays(day, 1).toISOString() })}`),
    refetchInterval: 15_000,
  });
  useInterval(() => tick((n) => n + 1), 60_000);

  const minsFromStart = (d: Date) => (d.getHours() - DAY_START) * 60 + d.getMinutes() + (sameDay(d, day) ? 0 : d < day ? -1e4 : 1e4);
  useEffect(() => {
    if (!q.data || !scroller.current || scrolledFor.current === isoDate(day)) return;
    scrolledFor.current = isoDate(day);
    scroller.current.scrollTop = sameDay(day, today) ? Math.max(0, (minsFromStart(new Date()) / SLOT) * 30 - 120) : (8 - DAY_START) * 60;
  });

  const data = q.data;
  const inbound = data?.appointments.filter((a) => a.direction === 'inbound') ?? [];
  const pallets = (l: Appointment[]) => l.reduce((s, a) => s + a.pallets, 0);
  const slots = ((DAY_END - DAY_START) * 60) / SLOT;
  const nowM = minsFromStart(new Date());

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={company.hub} title="Dock schedule"
        actions={manager && <Button variant="primary" icon="plus" disabled={!data} onClick={() => setBooking({ dockId: data!.docks[0].id, time: '09:00' })}>New appointment…</Button>}>
        {manager ? 'Book carrier slots per door. New bookings are confirmed with the carrier by a job on the runtime.' : 'Appointments at every door. Ones assigned to you are outlined — check carriers in as they arrive.'}
      </PageHead>
      <section className="card" aria-label="Dock appointments">
        <div className="toolbar">
          <div className="datebar">
            <Link className="btn icon sm" to={href(addDays(day, -1))} aria-label="Previous day"><Icon name="chevL" size={16} /></Link>
            <Link className="btn sm" to={href(today)} aria-current={sameDay(day, today) ? 'date' : undefined}>Today</Link>
            <Link className="btn icon sm" to={href(addDays(day, 1))} aria-label="Next day"><Icon name="chevR" size={16} /></Link>
            <label><span className="sr-only">Go to date</span>
              <input className="input sm" type="date" value={isoDate(day)} style={{ width: 'auto' }}
                onChange={(e) => { const d = parseISODate(e.target.value); if (d) navigate(href(d), { replace: true }); }} />
            </label>
            <h2 className="date-title">{dateLong.format(day)}</h2>
          </div>
          <span className="grow" />
          {data && (
            <div className="legend">
              <span><i className="lg-in" />Inbound · {plural(inbound.length, 'slot')} · {nf.format(pallets(inbound))} pallets</span>
              <span><i className="lg-out" />Outbound · {plural(data.appointments.length - inbound.length, 'slot')} · {nf.format(pallets(data.appointments) - pallets(inbound))} pallets</span>
              {!manager && <span><i className="lg-mine" />Assigned to you</span>}
            </div>
          )}
        </div>
        <div className="dock-scroll" ref={scroller}>
          {q.isLoading ? <div className="card-body"><Skeleton h={400} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : data && (
            <div className="dock-grid" style={{ ['--cols' as string]: data.docks.length }}>
              <div className="dock-corner" />
              {data.docks.map((d) => <div key={d.id} className="dock-col-head">{d.name}<span className="tag">{d.kind}</span></div>)}
              <div className="dock-times" aria-hidden="true">
                {Array.from({ length: DAY_END - DAY_START }, (_, i) => <div key={i}>{i ? hhmm(atTime(day, `${DAY_START + i}:00`)) : ''}</div>)}
              </div>
              {data.docks.map((d) => (
                <div key={d.id} className="dock-col" style={{ height: slots * 30 }} aria-label={d.name} role="group">
                  {manager && Array.from({ length: slots }, (_, i) => {
                    const t = atTime(day, `${DAY_START}:00`);
                    t.setMinutes(i * SLOT);
                    return (
                      <button key={i} type="button" className="slot-btn" style={{ top: i * 30 }} aria-label={`Book ${d.name} at ${fmtTime(t)}`}
                        onClick={() => setBooking({ dockId: d.id, time: hhmm(t) })}>
                        <Icon name="plus" size={12} />Book {hhmm(t)}
                      </button>
                    );
                  })}
                  {data.appointments.filter((a) => a.dockId === d.id).map((a) => {
                    const s = new Date(a.startsAt), e = new Date(a.endsAt);
                    const top = (Math.max(0, minsFromStart(s)) / SLOT) * 30;
                    const bottom = (Math.min(slots * SLOT, minsFromStart(e)) / SLOT) * 30;
                    if (bottom <= 0 || top >= slots * 30) return null;
                    const mine = a.assignedTo === user.id;
                    const h = bottom - top;
                    return (
                      <button key={a.id} type="button" className={`appt ${a.direction === 'inbound' ? 'in' : 'out'} ${a.status} ${mine ? 'mine' : ''}`}
                        style={{ top: top + 1, height: h - 2 }} onClick={() => setSelected(a.id)}
                        aria-label={`${a.carrier}, ${a.reference}, ${fmtTime(s)} to ${fmtTime(e)}, ${APPT_STATUS[a.status][2]}${mine ? ', assigned to you' : ''}`}>
                        <strong>{a.carrier}</strong>
                        <span className="line">{fmtTime(s)}–{fmtTime(e)} · {a.reference}</span>
                        {h > 64 && <span className="line">{a.direction === 'inbound' ? '↓ In' : '↑ Out'} · {plural(a.pallets, 'pallet')}</span>}
                        {h > 82 && <span className="st"><Icon name={APPT_STATUS[a.status][1]} size={11} />{APPT_STATUS[a.status][2]}</span>}
                      </button>
                    );
                  })}
                </div>
              ))}
              {sameDay(day, today) && nowM >= 0 && nowM <= slots * SLOT && <div className="now-line" style={{ top: 41 + (nowM / SLOT) * 30 }} aria-hidden="true" />}
            </div>
          )}
        </div>
      </section>
      {data && <ApptDialog data={data} id={selected} onClose={() => setSelected(null)} reload={() => q.refetch()} />}
      {data && booking && <NewApptDialog data={data} day={day} dockId={booking.dockId} time={booking.time} onClose={() => setBooking(null)} reload={() => q.refetch()} />}
    </div>
  );
}

function ApptDialog({ data, id, onClose, reload }: { data: DockData; id: number | null; onClose: () => void; reload: () => void }) {
  const { user } = useSession();
  const manager = useIsManager();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [error, setError] = useState('');
  const a = data.appointments.find((x) => x.id === id);
  const dock = data.docks.find((d) => d.id === a?.dockId);
  const action = !a ? null
    : a.status === 'requested' && manager ? (['confirm', 'Confirm with carrier', 'Confirming…', 'dock'] as const)
    : a.status === 'confirmed' && (manager || a.assignedTo === user.id) ? (['checkin', 'Check in carrier', 'Checking in…', 'truck'] as const)
    : a.status === 'checked_in' && manager ? (['complete', 'Mark completed', 'Completing…', 'checkCircle'] as const) : null;

  const run = async () => {
    if (!a || !action) return;
    setBusy(true); setError('');
    try {
      if (action[0] === 'complete') {
        await post(`/api/appointments/${a.id}/complete`);
        toast(`${a.carrier} completed`, `${dock?.name} is free.`);
      } else {
        const { jobId } = await post<{ jobId: number }>(`/api/appointments/${a.id}/${action[0]}`);
        setProgress(`Running job #${jobId} on the runtime…`);
        const j = await watchJob(jobId);
        const res = j.result as { skipped?: boolean; reason?: string } | null;
        if (j.status !== 'succeeded') throw new ApiError(j.error || `Job #${jobId} failed.`, 0);
        if (res?.skipped) throw new ApiError(`Nothing to do — ${res.reason}.`, 0);
        toast(action[0] === 'confirm' ? `${a.carrier} confirmed` : `${a.carrier} checked in`, `${dock?.name} · job #${jobId} waited ${fmtMs(j.queueMs)}, ran ${fmtMs(j.durationMs)}`);
      }
      reload();
      onClose();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false); setProgress('');
    }
  };

  return (
    <Modal open={!!a} onOpenChange={(o) => !o && onClose()} title={a?.carrier ?? ''}
      description={a && `${a.reference} · ${dock?.name} · ${dateLong.format(new Date(a.startsAt))}`}
      footer={<>
        <Button onClick={onClose}>Close</Button>
        {action && <Button variant="primary" icon={action[3]} loading={busy} loadingLabel={action[2]} onClick={run}>{action[1]}</Button>}
      </>}>
      {a && <>
        {error && <div className="form-error" role="alert"><Icon name="alert" size={15} /><span>{error}</span></div>}
        <dl className="kv">
          <dt>Status</dt><dd><ApptBadge status={a.status} /></dd>
          <dt>Time</dt><dd>{fmtTime(a.startsAt)} – {fmtTime(a.endsAt)}</dd>
          <dt>Direction</dt><dd>{a.direction === 'inbound' ? 'Inbound (receiving)' : 'Outbound (shipping)'}</dd>
          <dt>Load</dt><dd>{plural(a.pallets, 'pallet')}</dd>
          <dt>Assigned to</dt><dd>{a.assignee ? (a.assignedTo === user.id ? `${a.assignee} (you)` : a.assignee) : 'Unassigned'}</dd>
          {a.checkedInAt && <><dt>Checked in</dt><dd>{fmtTime(a.checkedInAt)}</dd></>}
        </dl>
        <p className="muted" aria-live="polite" style={{ fontSize: 12.5 }}>{progress}</p>
      </>}
    </Modal>
  );
}

function NewApptDialog({ data, day, dockId, time, onClose, reload }: { data: DockData; day: Date; dockId: number; time: string; onClose: () => void; reload: () => void }) {
  const toast = useToast();
  const navigate = useNavigate();
  const employees = data.staff.filter((s) => s.role === 'employee');
  const times: string[] = [];
  for (let m = DAY_START * 60; m < DAY_END * 60; m += 30) times.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="New dock appointment" submitLabel="Request slot" pendingLabel="Requesting…"
      description={<>The slot is saved as requested, then a <span className="mono">dock.confirm</span> job confirms it with the carrier.</>}
      onSubmit={async (form) => {
        const fd = new FormData(form);
        const d2 = parseISODate(String(fd.get('date')));
        if (!d2) throw new ApiError('Choose a date.', 0, 'date');
        const start = atTime(d2, String(fd.get('start')));
        const end = new Date(start.getTime() + Number(fd.get('duration')) * 60000);
        const body = {
          dockId: Number(fd.get('dockId')), carrier: String(fd.get('carrier')).trim(), reference: String(fd.get('reference')).trim(),
          direction: String(fd.get('direction')), pallets: Number(fd.get('pallets')) || 0,
          startsAt: start.toISOString(), endsAt: end.toISOString(), assignedTo: fd.get('assignedTo') ? Number(fd.get('assignedTo')) : null,
        };
        const { jobId } = await post<{ jobId: number }>('/api/appointments', body);
        toast('Slot requested', `Confirming with ${body.carrier} — job #${jobId}.`, 'info');
        if (!sameDay(d2, day)) navigate(`/docks?date=${isoDate(d2)}`);
        reload();
        watchJob(jobId).then((j) => { if (j.status === 'succeeded') toast(`${body.carrier} confirmed`, `Job #${jobId} waited ${fmtMs(j.queueMs)}.`); reload(); }).catch(() => {});
      }}>
      <div className="row-2">
        <Field name="dockId" label="Door">
          <select className="select" defaultValue={dockId}>{data.docks.map((d) => <option key={d.id} value={d.id}>{d.name} · {d.kind}</option>)}</select>
        </Field>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Direction</legend>
          <div className="segmented" style={{ width: '100%' }}>
            <label style={{ flex: 1, justifyContent: 'center' }}><input type="radio" name="direction" value="inbound" defaultChecked />Inbound</label>
            <label style={{ flex: 1, justifyContent: 'center' }}><input type="radio" name="direction" value="outbound" />Outbound</label>
          </div>
        </fieldset>
      </div>
      <Field name="carrier" label="Carrier">
        <input className="input" list="carrier-list" autoComplete="off" maxLength={60} placeholder="e.g. Summit Transport…" autoFocus />
      </Field>
      <datalist id="carrier-list">{CARRIERS.map((c) => <option key={c} value={c} />)}</datalist>
      <div className="row-2">
        <Field name="reference" label="PO / SO reference"><input className="input mono" autoComplete="off" spellCheck={false} autoCapitalize="characters" maxLength={30} placeholder="PO-48211…" /></Field>
        <Field name="pallets" label="Pallets"><input className="input" type="number" inputMode="numeric" min={1} max={60} defaultValue={12} /></Field>
      </div>
      <div className="row-3">
        <Field name="date" label="Date"><input className="input" type="date" defaultValue={isoDate(day)} /></Field>
        <Field name="start" label="Start"><select className="select" defaultValue={time}>{times.map((t) => <option key={t}>{t}</option>)}</select></Field>
        <Field name="duration" label="Duration">
          <select className="select" defaultValue={60}>{[[30, '30 min'], [60, '1 hour'], [90, '1.5 hours'], [120, '2 hours'], [180, '3 hours'], [240, '4 hours']].map(([m, l]) => <option key={m} value={m}>{l}</option>)}</select>
        </Field>
      </div>
      <Field name="assignedTo" label="Assign to" hint="The assignee can check the carrier in from their phone.">
        <select className="select" defaultValue=""><option value="">Unassigned</option>{employees.map((s) => <option key={s.id} value={s.id}>{s.name} · {s.title}</option>)}</select>
      </Field>
    </FormDialog>
  );
}
