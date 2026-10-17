import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field, FormDialog, Modal, useConfirm, useToast } from '../components/feedback';
import { Icon } from '../components/Icon';
import { watchJob } from '../components/jobs';
import { Avatar, Badge, Button, ErrorState, PageHead, Skeleton } from '../components/ui';
import { ApiError, del, get, post, qs } from '../lib/api';
import {
  NBSP, addDays, atTime, dateLong, dateShort, fmtTime, hhmm, isoDate, nf1, parseISODate, plural, sameDay, startOfDay, startOfWeek, weekdayShort,
} from '../lib/format';
import { useIsManager, useSession, useTitle } from '../lib/session';
import type { Shift, Staff, TimeOff } from '../lib/types';

type ShiftData = { staff: Staff[]; shifts: Shift[]; timeOff: TimeOff[] };
const hrs = (s: Shift) => (new Date(s.endsAt).getTime() - new Date(s.startsAt).getTime()) / 3.6e6;

export default function Shifts() {
  useTitle('Shifts');
  const manager = useIsManager();
  const { user } = useSession();
  const toast = useToast();
  const [params] = useSearchParams();
  const week = startOfWeek(parseISODate(params.get('week')) ?? new Date());
  const days = Array.from({ length: 7 }, (_, i) => addDays(week, i));
  const today = startOfDay(new Date());
  const href = (d: Date) => `/shifts?week=${isoDate(d)}`;
  const rangeLabel = `${dateShort.format(week)} – ${dateShort.format(addDays(week, 6))}`;
  const [openShift, setOpenShift] = useState<number | null>(null);
  const [adding, setAdding] = useState<{ userId: number; day: Date } | null>(null);
  const [publishing, setPublishing] = useState(false);

  const q = useQuery({
    queryKey: ['shifts', week.toISOString()],
    queryFn: () => get<ShiftData>(`/api/shifts${qs({ from: week.toISOString(), to: addDays(week, 7).toISOString() })}`),
  });
  const data = q.data;
  const staff = [...(data?.staff ?? [])].sort((a, b) => Number(b.id === user.id) - Number(a.id === user.id));
  const drafts = data?.shifts.filter((s) => !s.published) ?? [];
  const mine = data?.shifts.filter((s) => s.userId === user.id) ?? [];
  const cells = (p: Staff, d: Date) => data?.shifts.filter((s) => s.userId === p.id && sameDay(new Date(s.startsAt), d)) ?? [];
  const offOn = (p: Staff, d: Date) => data?.timeOff.find((t) => t.userId === p.id && isoDate(d) >= t.startsOn.slice(0, 10) && isoDate(d) <= t.endsOn.slice(0, 10));

  const publish = async () => {
    setPublishing(true);
    try {
      const r = await post<{ jobs: number; jobIds: number[] }>('/api/shifts/publish', { from: week.toISOString(), to: addDays(week, 7).toISOString() });
      toast(`Publishing ${plural(r.jobs, 'shift')}`, `${plural(r.jobs, 'shift.publish job')} queued. Employees are notified as each one runs.`, 'info');
      await Promise.all(r.jobIds.map((id) => watchJob(id).catch(() => null)));
      await q.refetch();
      toast('Week published', `${plural(r.jobs, 'employee notification')} sent.`);
    } catch (err) {
      toast('Couldn’t publish', (err as Error).message, 'bad');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={`Week of ${rangeLabel}`} title="Shifts"
        actions={!data ? null : manager
          ? (drafts.length ? <Button variant="primary" icon="send" loading={publishing} loadingLabel="Publishing…" onClick={publish}>Publish {plural(drafts.length, 'draft')}</Button>
            : <Badge tone="good" icon="check">Everything published</Badge>)
          : <><Link className="btn" to="/requests?new=1"><Icon name="calendar" size={15} />Request time off…</Link>
            <Badge tone="accent" icon="clock">You’re scheduled for {nf1.format(mine.reduce((a, s) => a + hrs(s), 0))}{NBSP}h</Badge></>}>
        {manager ? 'Plan the team’s week. Drafts stay private until you publish — each one sends a shift.publish job that notifies the employee.' : 'Your published shifts and the rest of the team’s.'}
      </PageHead>
      <section className="card" aria-label="Weekly schedule">
        <div className="toolbar">
          <div className="datebar">
            <Link className="btn icon sm" to={href(addDays(week, -7))} aria-label="Previous week"><Icon name="chevL" size={16} /></Link>
            <Link className="btn sm" to={href(today)}>This week</Link>
            <Link className="btn icon sm" to={href(addDays(week, 7))} aria-label="Next week"><Icon name="chevR" size={16} /></Link>
            <h2 className="date-title">{rangeLabel}</h2>
          </div>
          <span className="grow" />
          <div className="legend">
            <span><i className="lg-shift" />Published</span>
            {manager && <span><i className="lg-draft" />Draft</span>}
            <span><i className="lg-off" />Time off</span>
          </div>
        </div>
        <div className="shift-scroll">
          {q.isLoading ? <div className="card-body"><Skeleton h={420} /></div> : q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : data && (
            <div className="shift-grid">
              <div className="corner day-head"><strong>Team</strong>{plural(staff.length, 'person', 'people')}</div>
              {days.map((d) => <div key={d.toISOString()} className={`day-head ${sameDay(d, today) ? 'today' : ''}`}><span>{weekdayShort.format(d)}</span><strong>{dateShort.format(d)}</strong></div>)}
              {staff.map((p) => {
                const total = data.shifts.filter((s) => s.userId === p.id).reduce((a, s) => a + hrs(s), 0);
                const you = p.id === user.id;
                return (
                  <div key={p.id} style={{ display: 'contents' }}>
                    <div className={`person ${you ? 'you row-you' : ''}`}>
                      <Avatar name={p.name} accent={you} />
                      <div className="who"><strong>{p.name}</strong><span>{p.title}</span></div>
                      <span className="hours" title="Hours this week">{nf1.format(total)}h</span>
                    </div>
                    {days.map((d) => {
                      const off = offOn(p, d);
                      return (
                        <div key={d.toISOString()} className={`cell ${sameDay(d, today) ? 'today' : ''} ${you ? 'row-you' : ''}`}>
                          {off && <span className="pill off"><strong>Time off</strong><span>{off.kind}</span></span>}
                          {cells(p, d).map((s) => (
                            <button key={s.id} type="button" className={`pill ${s.published ? '' : 'draft'}`} onClick={() => setOpenShift(s.id)}
                              aria-label={`${p.name}, ${fmtTime(s.startsAt)} to ${fmtTime(s.endsAt)}, ${s.position}${s.published ? '' : ', draft'}`}>
                              <strong>{fmtTime(s.startsAt)}–{fmtTime(s.endsAt)}</strong><span>{s.position}</span>
                              {!s.published && <em>Draft</em>}
                            </button>
                          ))}
                          {manager && (
                            <button type="button" className="add-shift" onClick={() => setAdding({ userId: p.id, day: d })} aria-label={`Add shift for ${p.name} on ${dateLong.format(d)}`}>
                              <Icon name="plus" size={12} />Add
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>
                );
              })}
              <div className="foot person"><span className="muted">Coverage</span></div>
              {days.map((d) => <div key={d.toISOString()} className="foot">{plural(data.shifts.filter((s) => sameDay(new Date(s.startsAt), d)).length, 'shift')}</div>)}
            </div>
          )}
        </div>
      </section>
      {data && <ShiftDialog data={data} id={openShift} onClose={() => setOpenShift(null)} reload={() => q.refetch()} />}
      {data && adding && <NewShiftDialog data={data} userId={adding.userId} day={adding.day} onClose={() => setAdding(null)} reload={() => q.refetch()} />}
    </div>
  );
}

function ShiftDialog({ data, id, onClose, reload }: { data: ShiftData; id: number | null; onClose: () => void; reload: () => void }) {
  const manager = useIsManager();
  const confirm = useConfirm();
  const toast = useToast();
  const s = data.shifts.find((x) => x.id === id);
  const p = data.staff.find((x) => x.id === s?.userId);
  const remove = async () => {
    if (!s) return;
    onClose();
    const ok = await confirm({
      title: 'Delete this shift?',
      description: `${p?.name}’s ${fmtTime(s.startsAt)}–${fmtTime(s.endsAt)} shift on ${dateLong.format(new Date(s.startsAt))} will be removed${s.published ? '. They’ve already been notified about it' : ''}.`,
      confirmLabel: 'Delete shift',
    });
    if (!ok) return;
    try {
      await del(`/api/shifts/${s.id}`);
      toast('Shift deleted', `${p?.name} · ${dateShort.format(new Date(s.startsAt))}`);
      reload();
    } catch (err) {
      toast('Couldn’t delete shift', (err as Error).message, 'bad');
    }
  };
  return (
    <Modal open={!!s} onOpenChange={(o) => !o && onClose()} title={p?.name ?? ''} description={s && dateLong.format(new Date(s.startsAt))}
      footer={<>{manager && <Button className="left" variant="danger" icon="trash" onClick={remove}>Delete shift…</Button>}<Button onClick={onClose}>Close</Button></>}>
      {s && (
        <dl className="kv">
          <dt>Time</dt><dd>{fmtTime(s.startsAt)} – {fmtTime(s.endsAt)} <span className="muted">({nf1.format(hrs(s))}{NBSP}h)</span></dd>
          <dt>Position</dt><dd>{s.position}</dd>
          <dt>Location</dt><dd>{s.location}</dd>
          <dt>Status</dt><dd>{s.published ? <Badge tone="good" icon="check">Published</Badge> : <Badge tone="warn" icon="clock">Draft</Badge>}</dd>
        </dl>
      )}
    </Modal>
  );
}

function NewShiftDialog({ data, userId, day, onClose, reload }: { data: ShiftData; userId: number; day: Date; onClose: () => void; reload: () => void }) {
  const toast = useToast();
  const positions = [...new Set(data.shifts.map((s) => s.position))];
  const locations = [...new Set(data.shifts.map((s) => s.location))];
  const last = data.shifts.find((s) => s.userId === userId);
  const off = data.timeOff.find((t) => t.userId === userId && isoDate(day) >= t.startsOn.slice(0, 10) && isoDate(day) <= t.endsOn.slice(0, 10));
  return (
    <FormDialog open onOpenChange={(o) => !o && onClose()} title="Add shift" submitLabel="Add draft shift" pendingLabel="Adding…"
      description="New shifts start as drafts. Publish the week to notify the team."
      onSubmit={async (form) => {
        const fd = new FormData(form);
        const d = parseISODate(String(fd.get('date')));
        if (!d) throw new ApiError('Choose a date.', 0, 'date');
        const start = atTime(d, String(fd.get('start')));
        let end = atTime(d, String(fd.get('end')));
        if (end <= start) end = addDays(end, 1);
        await post('/api/shifts', { userId: Number(fd.get('userId')), startsAt: start.toISOString(), endsAt: end.toISOString(), position: String(fd.get('position')).trim(), location: String(fd.get('location')).trim() });
        const who = data.staff.find((s) => s.id === Number(fd.get('userId')));
        toast('Draft shift added', `${who?.name} · ${dateShort.format(d)}, ${hhmm(start)}–${hhmm(end)}`);
        reload();
      }}>
      {off && <div className="banner warn" role="note"><Icon name="triangle" size={15} /><span>This person has approved time off ({off.kind}) on this day.</span></div>}
      <div className="row-2">
        <Field name="userId" label="Team member"><select className="select" defaultValue={userId}>{data.staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></Field>
        <Field name="date" label="Date"><input className="input" type="date" defaultValue={isoDate(day)} /></Field>
      </div>
      <div className="row-2">
        <Field name="start" label="Start"><input className="input" type="time" step={900} defaultValue={last ? hhmm(new Date(last.startsAt)) : '08:00'} autoFocus /></Field>
        <Field name="end" label="End" hint="Ends before the start? It runs past midnight."><input className="input" type="time" step={900} defaultValue={last ? hhmm(new Date(last.endsAt)) : '16:30'} /></Field>
      </div>
      <div className="row-2">
        <Field name="position" label="Position"><input className="input" list="pos-list" maxLength={40} autoComplete="off" defaultValue={last?.position ?? positions[0] ?? ''} /></Field>
        <Field name="location" label="Location"><input className="input" list="loc-list" maxLength={40} autoComplete="off" defaultValue={last?.location ?? locations[0] ?? ''} /></Field>
      </div>
      <datalist id="pos-list">{positions.map((v) => <option key={v} value={v} />)}</datalist>
      <datalist id="loc-list">{locations.map((v) => <option key={v} value={v} />)}</datalist>
    </FormDialog>
  );
}
