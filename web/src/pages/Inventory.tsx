import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Field, FormDialog, useToast } from '../components/feedback';
import { Icon } from '../components/Icon';
import { watchJob } from '../components/jobs';
import { Badge, Button, Empty, ErrorState, Kpi, PageHead, Skeleton } from '../components/ui';
import { get, post, qs } from '../lib/api';
import { nf, relTime } from '../lib/format';
import { useIsManager, useSession, useTitle } from '../lib/session';
import type { Item } from '../lib/types';

const REASONS = ['Cycle count', 'Damaged in handling', 'Received without ASN', 'Customer return', 'Found during audit', 'Expired'];

export default function Inventory() {
  useTitle('Inventory');
  const manager = useIsManager();
  const { company } = useSession();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const category = params.get('category') ?? '';
  const low = params.get('low') === '1';
  const [search, setSearch] = useState(q);
  const [adjusting, setAdjusting] = useState<Item | null>(null);
  const [reordering, setReordering] = useState<number | null>(null);

  const setParam = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n, { replace: true }); };
  useEffect(() => {
    const t = setTimeout(() => { if (search.trim() !== q) setParam('q', search.trim()); }, 250);
    return () => clearTimeout(t);
  }, [search]);

  const all = useQuery({ queryKey: ['inventory', 'all'], queryFn: () => get<{ items: Item[]; categories: string[] }>('/api/inventory'), refetchInterval: 15_000 });
  const list = useQuery({
    queryKey: ['inventory', { q, category, low }],
    queryFn: () => get<{ items: Item[]; categories: string[] }>(`/api/inventory${qs({ q, category, low: low ? 1 : undefined })}`),
    refetchInterval: 15_000,
  });
  const items = all.data?.items ?? [];
  const lowCount = items.filter((i) => i.available <= i.reorderPoint).length;
  const outCount = items.filter((i) => i.available <= 0).length;
  const inbound = items.reduce((a, i) => a + i.inbound, 0);

  const reorder = async (it: Item) => {
    setReordering(it.id);
    try {
      const { jobId } = await post<{ jobId: number }>(`/api/inventory/${it.id}/reorder`);
      const j = await watchJob(jobId);
      const res = j.result as { shipment?: string; quantity?: number; reason?: string } | null;
      if (j.status !== 'succeeded') throw new Error(j.error ?? 'Reorder failed.');
      toast(res?.shipment ? `Reorder placed for ${it.name}` : 'Nothing to reorder', res?.shipment ? `${nf.format(res.quantity ?? 0)} ${it.unit} inbound on ${res.shipment}.` : res?.reason, res?.shipment ? 'good' : 'info');
      qc.invalidateQueries({ queryKey: ['inventory'] });
    } catch (err) {
      toast('Couldn’t reorder', (err as Error).message, 'bad');
    } finally {
      setReordering(null);
    }
  };

  return (
    <div className="page" data-animate>
      <PageHead eyebrow={company.hub} title="Inventory"
        actions={<a className="btn" href="/api/export/inventory.csv" download><Icon name="download" size={15} />Export CSV</a>}>
        Stock on hand at the hub. Orders pick stock through <span className="mono">inventory.pick</span> jobs; a reorder books an inbound truck that restocks on delivery.
      </PageHead>
      <div className="kpis">
        <Kpi icon="boxes" label="SKUs tracked" value={all.data ? nf.format(items.length) : '—'} delta={`${all.data?.categories.length ?? 0} categories`} />
        <Kpi icon="triangle" label="At or below reorder point" value={all.data ? nf.format(lowCount) : '—'} delta={lowCount ? <Link to="?low=1" replace>Show low stock</Link> : 'All healthy'} deltaTone={lowCount ? 'bad' : 'good'} />
        <Kpi icon="x" label="Stocked out" value={all.data ? nf.format(outCount) : '—'} delta="Auto-reordered by the simulation" />
        <Kpi icon="truck" label="Units inbound" value={all.data ? nf.format(inbound) : '—'} delta="On replenishment shipments" />
      </div>
      <section className="card" aria-label="Stock list">
        <div className="toolbar">
          <label className="search"><span className="sr-only">Search inventory</span><Icon name="search" size={15} />
            <input className="input" type="search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="SKU, name or bin…" autoComplete="off" spellCheck={false} />
          </label>
          <label><span className="sr-only">Category</span>
            <select className="select sm" value={category} onChange={(e) => setParam('category', e.target.value)} style={{ width: 'auto' }}>
              <option value="">All categories</option>
              {(all.data?.categories ?? []).map((c) => <option key={c}>{c}</option>)}
            </select>
          </label>
          <label className="check"><input type="checkbox" checked={low} onChange={(e) => setParam('low', e.target.checked ? '1' : '')} />Low stock only</label>
        </div>
        <div className="table-wrap">
          {list.isLoading ? <div className="card-body"><Skeleton h={360} /></div> : list.error ? <ErrorState error={list.error} onRetry={() => list.refetch()} />
            : !list.data?.items.length ? <Empty icon="boxes" title="No items match" action={<Link className="btn sm" to="/inventory" replace>Clear filters</Link>}>Try a different search or category.</Empty>
            : (
              <table className="data">
                <thead><tr><th>SKU</th><th>Item</th><th>Bin</th><th className="r">On hand</th><th className="r">Reserved</th><th style={{ minWidth: 160 }}>Available</th><th className="r">Inbound</th><th>Updated</th><th><span className="sr-only">Actions</span></th></tr></thead>
                <tbody>
                  {list.data.items.map((it) => {
                    const lowItem = it.available <= it.reorderPoint;
                    const scale = Math.max(it.reorderPoint * 2.5, it.available, 1);
                    return (
                      <tr key={it.id}>
                        <td className="mono">{it.sku}</td>
                        <td><div style={{ display: 'grid' }}><span>{it.name}</span><span className="subtle" style={{ fontSize: 12 }}>{it.category}</span></div></td>
                        <td className="mono muted">{it.location}</td>
                        <td className="r">{nf.format(it.onHand)}</td>
                        <td className="r muted">{nf.format(it.reserved)}</td>
                        <td>
                          <div className={`stock ${lowItem ? 'low' : ''}`} title={`Reorder point ${nf.format(it.reorderPoint)}`}>
                            <span className="stock-bar" aria-hidden="true"><i style={{ width: `${(Math.max(0, it.available) / scale) * 100}%` }} /><b style={{ left: `${(it.reorderPoint / scale) * 100}%` }} /></span>
                            <span className="num">{nf.format(it.available)} {it.unit}</span>
                            {lowItem && <Badge tone={it.available <= 0 ? 'bad' : 'warn'} icon="triangle">{it.available <= 0 ? 'Out' : 'Low'}</Badge>}
                          </div>
                        </td>
                        <td className="r">{it.inbound ? <span style={{ color: 'var(--accent-text)' }}>+{nf.format(it.inbound)}</span> : <span className="subtle">—</span>}</td>
                        <td className="muted">{relTime(it.updatedAt)}</td>
                        <td>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <Button size="sm" onClick={() => setAdjusting(it)}>Adjust…</Button>
                            {manager && (it.inbound > 0
                              ? <Button size="sm" variant="ghost" disabled title="A replenishment is already on the way">On the way</Button>
                              : <Button size="sm" variant={lowItem ? 'primary' : 'default'} icon="refresh" loading={reordering === it.id} loadingLabel="Ordering…" onClick={() => reorder(it)}>Reorder</Button>)}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
        </div>
      </section>

      <FormDialog open={!!adjusting} onOpenChange={(o) => !o && setAdjusting(null)} title={`Adjust ${adjusting?.name ?? ''}`} submitLabel="Save adjustment" pendingLabel="Saving…"
        description={adjusting ? `${adjusting.sku} · ${nf.format(adjusting.onHand)} ${adjusting.unit} on hand. Adjustments are written to the activity log.` : ''}
        onSubmit={async (form) => {
          const fd = new FormData(form);
          const sign = fd.get('direction') === 'remove' ? -1 : 1;
          const it = await post<Item>(`/api/inventory/${adjusting!.id}/adjust`, { delta: sign * (Number(fd.get('delta')) || 0), reason: String(fd.get('reason')).trim() });
          toast('Stock adjusted', `${it.name}: ${nf.format(it.onHand)} ${it.unit} on hand.`);
          qc.invalidateQueries({ queryKey: ['inventory'] });
        }}>
        <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
          <legend className="label" style={{ marginBottom: 6 }}>Change</legend>
          <div className="segmented" style={{ width: 'fit-content' }}>
            <label><input type="radio" name="direction" value="add" defaultChecked /><Icon name="plus" size={14} />Add</label>
            <label><input type="radio" name="direction" value="remove" /><Icon name="minus" size={14} />Remove</label>
          </div>
        </fieldset>
        <div className="row-2">
          <Field name="delta" label={`Quantity (${adjusting?.unit ?? ''})`}><input className="input" type="number" inputMode="numeric" min={1} defaultValue={1} autoFocus /></Field>
          <Field name="reason" label="Reason"><input className="input" list="reason-list" maxLength={80} autoComplete="off" defaultValue={REASONS[0]} /></Field>
        </div>
        <datalist id="reason-list">{REASONS.map((r) => <option key={r} value={r} />)}</datalist>
      </FormDialog>
    </div>
  );
}
