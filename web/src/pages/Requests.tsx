import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field, FormDialog, useConfirm, useToast } from '../components/feedback';
import { Icon } from '../components/Icon';
import { Avatar, Badge, Button, Empty, ErrorState, PageHead, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { addDays, dateMed, dateShort, isoDate, parseISODate, plural, relTime, startOfDay } from '../lib/format';
import { useIsManager, useSession, useTitle } from '../lib/session';
import type { TimeOff } from '../lib/types';

const KIND = { vacation: ['Vacation', 'sun'], sick: ['Sick leave', 'leaf'], personal: ['Personal', 'user'] } as const;
const STATUS: Record<TimeOff['status'], ['good' | 'warn' | 'bad' | '', string]> = {
  pending: ['warn', 'Pending'], approved: ['good', 'Approved'], denied: ['bad', 'Denied'], withdrawn: ['', 'Withdrawn'],
};
const TABS: [string, string][] = [['pending', 'Pending'], ['approved', 'Approved'], ['denied', 'Denied'], ['', 'All']];

function range(r: TimeOff) {
  const a = parseISODate(r.startsOn)!, b = parseISODate(r.endsOn)!;
  return r.days === 1 ? dateMed.format(a) : `${dateShort.format(a)} – ${dateMed.format(b)}`;
}

export default function Requests() {
  const manager = useIsManager();
  useTitle(manager ? 'Requests' : 'Time off');
  const { user } = useSession();
  const toast = useToast();
  const confirm = useConfirm();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = manager ? (TABS.some(([v]) => v === params.get('status')) ? params.get('status')! : params.has('status') ? '' : 'pending') : '';
  const [newOpen, setNewOpen] = useState(params.get('new') === '1');
  const [denying, setDenying] = useState<TimeOff | null>(null);
  const [acting, setActing] = useState<number | null>(null);

  const list = useQuery({ queryKey: ['requests', 'list', status], queryFn: () => get<{ requests: TimeOff[] }>(`/api/requests${qs({ status })}`) });
  const upcoming = useQuery({ queryKey: ['requests', 'approved'], queryFn: () => get<{ requests: TimeOff[] }>('/api/requests?status=approved') });
  const refresh = () => qc.invalidateQueries({ queryKey: ['requests'] });

  const approve = async (r: TimeOff) => {
    setActing(r.id);
    try {
      await post(`/api/requests/${r.id}/decide`, { decision: 'approved', note: '' });
      toast(`Approved ${r.name}’s ${KIND[r.kind][0].toLowerCase()}`, `${range(r)} · they’ve been notified.`);
      refresh();
    } catch (err) {
      toast('Couldn’t approve', (err as Error).message, 'bad');
    } finally {
      setActing(null);
    }
  };
  const withdraw = async (r: TimeOff) => {
    if (!(await confirm({ title: 'Withdraw this request?', description: `${KIND[r.kind][0]} · ${range(r)}. You can submit a new one later.`, confirmLabel: 'Withdraw request' }))) return;
    try {
      await post(`/api/requests/${r.id}/withdraw`);
      toast('Request withdrawn');
      refresh();
    } catch (err) {
      toast('Couldn’t withdraw', (err as Error).message, 'bad');
    }
  };

  const today = isoDate(startOfDay(new Date()));
  const soon = isoDate(addDays(new Date(), 21));
  const away = (upcoming.data?.requests ?? []).filter((r) => r.endsOn.slice(0, 10) >= today && r.startsOn.slice(0, 10) <= soon)
    .sort((a, b) => a.startsOn.localeCompare(b.startsOn));
  const rows = list.data?.requests ?? [];

  return (
    <div className="page" data-animate>
      <PageHead eyebrow="People" title={manager ? 'Requests' : 'Time off'}
        actions={<Button variant="primary" icon="plus" onClick={() => setNewOpen(true)}>Request time off…</Button>}>
        {manager ? 'Approve or deny time off. Decisions notify the employee and show on the shift grid.' : 'Ask for leave and follow its status. Approved days appear on the shift grid.'}
      </PageHead>
      <div className="grid-2">
        <section className="card" aria-label="Requests">
          {manager && (
            <div className="toolbar">
              <nav className="segmented" aria-label="Filter by status">
                {TABS.map(([v, label]) => (
                  <Link key={label} to={`?status=${v}`} replace aria-current={v === status ? 'page' : undefined}>{label}</Link>
                ))}
              </nav>
            </div>
          )}
          {list.isLoading ? <div className="card-body"><Skeleton h={260} /></div> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
            : !rows.length ? <Empty icon="inbox" title={status === 'pending' ? 'No pending requests' : 'No requests here'}>{status === 'pending' ? 'You’re all caught up.' : 'Requests show up here once submitted.'}</Empty>
            : (
              <ul className="req-list">
                {rows.map((r) => {
                  const [tone, label] = STATUS[r.status];
                  return (
                    <li key={r.id} className="req">
                      <Avatar name={r.name} accent={r.userId === user.id} />
                      <div className="req-body">
                        <div className="req-top">
                          <strong>{r.userId === user.id ? `${r.name} (you)` : r.name}</strong>
                          <Badge icon={KIND[r.kind][1]}>{KIND[r.kind][0]}</Badge>
                          <Badge tone={tone}>{label}</Badge>
                        </div>
                        <span className="num">{range(r)} · {plural(r.days, 'day')}</span>
                        {r.reason && <span className="muted">“{r.reason}”</span>}
                        {r.decidedBy && <span className="subtle">{label} by {r.decidedBy} {r.decidedAt && relTime(r.decidedAt)}{r.note ? ` — “${r.note}”` : ''}</span>}
                        {!r.decidedBy && <span className="subtle">Requested {relTime(r.createdAt)}</span>}
                      </div>
                      <div className="req-actions">
                        {manager && r.status === 'pending' && r.userId !== user.id && <>
                          <Button size="sm" onClick={() => setDenying(r)}>Deny…</Button>
                          <Button size="sm" variant="primary" icon="check" loading={acting === r.id} loadingLabel="Approving…" onClick={() => approve(r)}>Approve</Button>
                        </>}
                        {r.userId === user.id && r.status === 'pending' && <Button size="sm" variant="ghost" onClick={() => withdraw(r)}>Withdraw…</Button>}
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
        </section>
        <section className="card" aria-labelledby="away-title">
          <div className="card-head"><div><h2 id="away-title">Who’s away</h2><p className="sub">Approved time off in the next three weeks</p></div></div>
          <div className="list" style={{ marginTop: 8 }}>
            {!upcoming.data ? <div className="card-body"><Skeleton h={120} /></div> : !away.length ? <Empty icon="users" title="Everyone’s in">No approved time off coming up.</Empty>
              : away.map((r) => (
                <div key={r.id} className="list-item">
                  <Avatar name={r.name} />
                  <div className="body"><strong>{r.name}</strong><span>{range(r)} · {KIND[r.kind][0]}</span></div>
                  {r.startsOn.slice(0, 10) <= today ? <Badge tone="info" icon="clock">Away now</Badge> : <span className="subtle">{relTime(parseISODate(r.startsOn)!)}</span>}
                </div>
              ))}
          </div>
        </section>
      </div>

      <NewRequestDialog open={newOpen} onOpenChange={(o) => { setNewOpen(o); if (!o && params.has('new')) { params.delete('new'); setParams(params, { replace: true }); } }} onDone={refresh} />
      <FormDialog open={!!denying} onOpenChange={(o) => !o && setDenying(null)} title={`Deny ${denying?.name ?? ''}’s request?`}
        description={denying ? `${KIND[denying.kind][0]} · ${range(denying)}. They’ll see your note.` : ''} submitLabel="Deny request" pendingLabel="Denying…" danger
        onSubmit={async (form) => {
          await post(`/api/requests/${denying!.id}/decide`, { decision: 'denied', note: String(new FormData(form).get('note')).trim() });
          toast('Request denied', `${denying!.name} has been notified.`);
          refresh();
        }}>
        <Field name="note" label={<>Note <span className="subtle">(optional)</span></>} hint="Suggest another date if you can.">
          <textarea className="textarea" maxLength={200} placeholder="Peak week — could the following weekend work?…" autoFocus />
        </Field>
      </FormDialog>
    </div>
  );
}

function NewRequestDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const toast = useToast();
  const start = addDays(new Date(), 7);
  return (
    <FormDialog open={open} onOpenChange={onOpenChange} title="Request time off" submitLabel="Send request" submitIcon="send" pendingLabel="Sending…"
      description="Your manager gets a notification and can approve or deny it."
      onSubmit={async (form) => {
        const fd = new FormData(form);
        await post('/api/requests', { kind: fd.get('kind'), startsOn: fd.get('startsOn'), endsOn: fd.get('endsOn'), reason: String(fd.get('reason')).trim() });
        toast('Request sent', 'You’ll be notified when it’s decided.');
        onDone();
      }}>
      <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 6 }}>Type</legend>
        <div className="segmented" style={{ width: 'fit-content' }}>
          {(Object.keys(KIND) as (keyof typeof KIND)[]).map((k) => (
            <label key={k}><input type="radio" name="kind" value={k} defaultChecked={k === 'vacation'} /><Icon name={KIND[k][1]} size={14} />{KIND[k][0]}</label>
          ))}
        </div>
      </fieldset>
      <div className="row-2">
        <Field name="startsOn" label="First day"><input className="input" type="date" defaultValue={isoDate(start)} /></Field>
        <Field name="endsOn" label="Last day"><input className="input" type="date" defaultValue={isoDate(addDays(start, 2))} /></Field>
      </div>
      <Field name="reason" label={<>Reason <span className="subtle">(optional)</span></>}>
        <textarea className="textarea" maxLength={200} placeholder="Family wedding…" />
      </Field>
    </FormDialog>
  );
}
