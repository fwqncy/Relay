import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { ApiError, get, minDelay, post } from '../lib/api';
import { dateTimeSecFmt, fmtMs } from '../lib/format';
import { useIsManager, useSession } from '../lib/session';
import type { Job } from '../lib/types';
import { Field, FormDialog, Modal, useToast } from './feedback';
import { Button, JobStatusBadge, Skeleton } from './ui';

/** Poll a job until it finishes. */
export async function watchJob(id: number, timeout = 20000): Promise<Job> {
  const until = Date.now() + timeout;
  let delay = 150;
  while (Date.now() < until) {
    const job = await get<Job>(`/api/jobs/${id}`);
    if (job.status === 'succeeded' || job.status === 'failed') return job;
    await new Promise((r) => setTimeout(r, delay));
    delay = Math.min(delay * 1.5, 800);
  }
  throw new ApiError('The job is still running. Check the Jobs page for its result.', 0);
}

export function useKindLabel() {
  const me = useSession();
  return (type: string) => me.allKinds.find((k) => k.type === type)?.label || type;
}

export function JobDialog({ id, onClose }: { id: number | null; onClose: () => void }) {
  const manager = useIsManager();
  const kindLabel = useKindLabel();
  const toast = useToast();
  const qc = useQueryClient();
  const [retrying, setRetrying] = useState(false);
  const { data: j, error } = useQuery({
    queryKey: ['job', id],
    queryFn: () => get<Job>(`/api/jobs/${id}`),
    enabled: id != null,
    refetchInterval: (q) => (q.state.data && (q.state.data.status === 'queued' || q.state.data.status === 'running') ? 700 : false),
  });
  const retry = async () => {
    setRetrying(true);
    try {
      await minDelay(post(`/api/jobs/${id}/retry`));
      toast(`Job #${id} queued again`, 'It’ll run with a fresh retry budget.');
      await watchJob(id!).catch(() => {});
      qc.invalidateQueries({ queryKey: ['job', id] });
      qc.invalidateQueries({ queryKey: ['jobs'] });
    } catch (err) {
      toast('Retry failed', (err as Error).message, 'bad');
    } finally {
      setRetrying(false);
    }
  };
  return (
    <Modal open={id != null} onOpenChange={(o) => !o && onClose()} title={`Job #${id ?? ''}`} wide
      footer={<>
        {j?.status === 'failed' && manager && <Button className="left" icon="refresh" loading={retrying} loadingLabel="Retrying…" onClick={retry}>Retry job</Button>}
        <Button onClick={onClose}>Close</Button>
      </>}>
      {error ? <div className="form-error">{(error as Error).message}</div> : !j ? <Skeleton h={200} r={10} /> : (
        <div style={{ display: 'grid', gap: 18 }}>
          <dl className="kv">
            <dt>Status</dt><dd><JobStatusBadge status={j.status} /></dd>
            <dt>Type</dt><dd><span className="mono">{j.type}</span> <span className="muted">· {kindLabel(j.type)}</span></dd>
            <dt>Attempts</dt><dd>{j.attempts} of 3</dd>
            <dt>Worker</dt><dd>{j.worker ? <><span className="mono">{j.worker}</span> {j.stolen && <span className="tag accent">stolen</span>}</> : '—'}</dd>
            <dt>Queue wait</dt><dd>{fmtMs(j.queueMs)}</dd>
            <dt>Run time</dt><dd>{fmtMs(j.durationMs)}</dd>
            <dt>Enqueued</dt><dd>{dateTimeSecFmt.format(new Date(j.enqueuedAt))}</dd>
            <dt>Finished</dt><dd>{j.finishedAt ? dateTimeSecFmt.format(new Date(j.finishedAt)) : '—'}</dd>
            <dt>Submitted by</dt><dd>{j.submittedBy || (j.runId ? 'Load test' : 'Platform')}</dd>
            {j.error && <><dt>Last error</dt><dd style={{ color: 'var(--bad)' }}>{j.error}</dd></>}
          </dl>
          <div className="row-2">
            <div><p className="code-label">Payload</p><pre className="json">{JSON.stringify(j.payload, null, 2)}</pre></div>
            <div><p className="code-label">Result</p><pre className="json">{j.result ? JSON.stringify(j.result, null, 2) : j.status === 'failed' ? 'No result — the job failed.' : 'Not finished yet.'}</pre></div>
          </div>
        </div>
      )}
    </Modal>
  );
}

const REF_HINT: Record<string, string> = { 'label.print': 'Tracking number', 'pod.upload': 'Tracking number', 'invoice.sync': 'Invoice number' };

export function NewJobDialog({ open, onOpenChange, defaultType, onQueued }: { open: boolean; onOpenChange: (o: boolean) => void; defaultType?: string; onQueued?: (id: number) => void }) {
  const me = useSession();
  const kinds = me.jobKinds;
  const kindLabel = useKindLabel();
  const toast = useToast();
  const [type, setType] = useState(defaultType || kinds[0]?.type);
  const kind = kinds.find((k) => k.type === (open ? type : defaultType)) ?? kinds[0];
  return (
    <FormDialog open={open} onOpenChange={(o) => { if (o) setType(defaultType || kinds[0]?.type); onOpenChange(o); }}
      title="Run a job" description="The job goes onto Redis Streams and the next free worker picks it up."
      submitLabel="Queue job" pendingLabel="Queuing…" submitIcon="zap"
      onSubmit={async (form) => {
        const fd = new FormData(form);
        const t = String(fd.get('type'));
        const { jobId } = await post<{ jobId: number }>('/api/jobs', { type: t, reference: String(fd.get('reference') || '').trim() });
        toast(`${kindLabel(t)} queued`, `Job #${jobId}. You’ll see the result here when it finishes.`, 'info');
        onQueued?.(jobId);
        watchJob(jobId).then((j) => {
          if (j.status === 'succeeded') toast(`Job #${jobId} succeeded`, `${kindLabel(t)} · waited ${fmtMs(j.queueMs)}, ran ${fmtMs(j.durationMs)}`);
          else toast(`Job #${jobId} failed`, j.error || 'See the job for details.', 'bad');
          onQueued?.(jobId);
        }).catch(() => {});
      }}>
      <Field name="type" label="Job type" hint={kind?.description}>
        <select className="select" value={type} onChange={(e) => setType(e.target.value)}>
          {kinds.map((k) => <option key={k.type} value={k.type}>{k.label}</option>)}
        </select>
      </Field>
      <Field name="reference" label={<>{REF_HINT[type] || 'Route'} <span className="subtle">(optional)</span></>}>
        <input className="input" autoComplete="off" spellCheck={false} maxLength={40} placeholder="Leave blank to generate one…" autoFocus />
      </Field>
    </FormDialog>
  );
}
