import { useGSAP } from '@gsap/react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import gsap from 'gsap';
import { Component, lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { FormDialog, useToast } from '../components/feedback';
import { Icon, MODE_ICON } from '../components/Icon';
import { Badge, Button, ErrorState, Progress, ShipmentStatusBadge, Skeleton } from '../components/ui';
import { get, post } from '../lib/api';
import { dateMed, nf, relTime, TRANSPORT_LABEL } from '../lib/format';
import { useAppearance, useIsManager, useReducedMotion, useSession, useTitle } from '../lib/session';
import { cssToHex, paletteFor } from '../lib/theme';
import type { RealmData, RealmMode, RealmVehicle, TransportMode } from '../lib/types';
import type { CameraRequest, Lighting, Preset } from '../three/realm/RealmScene';

const RealmScene = lazy(() => import('../three/realm/RealmScene'));

class SceneBoundary extends Component<{ children: ReactNode; fallback: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? this.props.fallback : this.props.children; }
}

const PRESET_LABEL: [Preset, string][] = [['overview', 'Overview'], ['harbour', 'Harbour'], ['town', 'Keep'], ['railway', 'Railway'], ['airfield', 'Airfield']];

export default function Realm() {
  useTitle('Realm map');
  const manager = useIsManager();
  const { company } = useSession();
  const { appearance } = useAppearance();
  const toast = useToast();
  const qc = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [params, setParams] = useSearchParams();
  const [lighting, setLighting] = useState<Lighting>(() => (localStorage.getItem('relay-realm-light') as Lighting) || 'live');
  const [paused, setPaused] = useState(reducedMotion);
  const [selected, setSelected] = useState<{ vehicle: RealmVehicle; mode: TransportMode } | null>(null);
  const [camera, setCamera] = useState<CameraRequest | null>(null);
  const [panel, setPanel] = useState<'fleet' | 'milestones'>('fleet');
  const [hud, setHud] = useState(true);
  const [advanceOpen, setAdvanceOpen] = useState(params.get('advance') === '1');
  const [levelUp, setLevelUp] = useState<{ mode: RealmMode; key: number } | null>(null);
  const banner = useRef<HTMLDivElement>(null);
  const nonce = useRef(0);

  const q = useQuery({ queryKey: ['realm'], queryFn: () => get<RealmData>('/api/realm'), refetchInterval: 10_000 });
  const data = q.data;
  const accent = useMemo(() => {
    const p = paletteFor(appearance, company.accentLight);
    return `oklch(0.62 ${Math.max(0.08, p.ac)} ${p.ah})`;
  }, [appearance, company.accentLight]);
  const accentHex = useMemo(() => cssToHex(accent), [accent]);

  useEffect(() => { try { localStorage.setItem('relay-realm-light', lighting); } catch { /* ignore */ } }, [lighting]);

  // Celebrate level-ups between refreshes.
  const prevLevels = useRef<Record<string, number> | null>(null);
  useEffect(() => {
    if (!data) return;
    const now = Object.fromEntries(data.modes.map((m) => [m.mode, m.level]));
    const prev = prevLevels.current;
    prevLevels.current = now;
    if (!prev) return;
    const up = data.modes.find((m) => m.level > (prev[m.mode] ?? m.level));
    // The notification stream already toasts level-ups; the banner is enough here.
    if (up) setLevelUp({ mode: up, key: Date.now() });
  }, [data]);
  useGSAP(() => {
    if (!levelUp || !banner.current) return;
    const tl = gsap.timeline({ onComplete: () => setLevelUp(null) });
    tl.fromTo(banner.current, { y: -30, opacity: 0, scale: 0.92 }, { y: 0, opacity: 1, scale: 1, duration: 0.6, ease: 'back.out(1.8)' })
      .fromTo(banner.current.querySelectorAll('[data-glint]'), { opacity: 0, scale: 0.4 }, { opacity: 1, scale: 1, stagger: 0.08, duration: 0.4, ease: 'power2.out' }, '-=0.2')
      .to(banner.current, { opacity: 0, y: -16, duration: 0.5, delay: 3.2, ease: 'power2.in' });
  }, { dependencies: [levelUp] });

  // Deep link: /realm?focus=<shipment id> selects and flies to that vehicle.
  useEffect(() => {
    const id = Number(params.get('focus'));
    if (!id || !data) return;
    for (const m of data.modes) {
      const v = m.vehicles.find((x) => x.id === id);
      if (v) {
        setSelected({ vehicle: v, mode: m.mode });
        setTimeout(() => setCamera({ kind: 'vehicle', id, nonce: ++nonce.current }), 600);
        break;
      }
    }
    params.delete('focus');
    setParams(params, { replace: true });
  }, [data]);

  const fly = (name: Preset) => setCamera({ kind: 'preset', name, nonce: ++nonce.current });
  const select = (s: { vehicle: RealmVehicle; mode: TransportMode } | null) => {
    setSelected(s);
    if (s) setCamera({ kind: 'vehicle', id: s.vehicle.id, nonce: ++nonce.current });
  };
  const totalActive = data?.modes.reduce((a, m) => a + m.active, 0) ?? 0;
  const summary = data ? `3D map of ${company.name}'s logistics realm: ${data.modes.map((m) => `${m.name} level ${m.level} with ${m.vehicles.length} ${m.tier.vehicle.toLowerCase()}s moving`).join('; ')}.` : 'Loading the realm map';

  return (
    <div className={`realm-page ${hud ? '' : 'hud-hidden'}`}>
      <div className="realm-canvas" role="img" aria-label={summary}>
        {!data ? <div className="realm-loading"><span className="spinner" aria-hidden="true" /> Raising the realm…</div> : (
          <SceneBoundary fallback={<div className="realm-loading">3D isn’t available in this browser. The fleet summary is still listed alongside.</div>}>
            <Suspense fallback={<div className="realm-loading"><span className="spinner" aria-hidden="true" /> Raising the realm…</div>}>
              <RealmScene data={data} accent={accentHex} lighting={lighting} paused={paused} selected={selected?.vehicle.id ?? null} onSelect={select} camera={camera} />
            </Suspense>
          </SceneBoundary>
        )}
      </div>

      <header className="realm-head hud">
        <div>
          <span className="eyebrow">{company.hub}</span>
          <h1>Realm map</h1>
          <p className="muted">{data ? `${nf.format(totalActive)} shipments in motion · ${nf.format(data.town.delivered)} delivered all-time` : 'Loading…'}</p>
        </div>
        <div className="actions">
          <label className="theme-select"><span className="sr-only">Lighting</span><Icon name={lighting === 'night' ? 'moon' : 'sun'} size={15} />
            <select className="select sm" value={lighting} onChange={(e) => setLighting(e.target.value as Lighting)} aria-label="Lighting">
              <option value="live">Live time</option><option value="day">Day</option><option value="dusk">Dusk</option><option value="night">Night</option>
            </select>
          </label>
          <Button size="sm" icon={paused ? 'play' : 'pause'} aria-pressed={paused} onClick={() => setPaused((p) => !p)}>{paused ? 'Resume' : 'Pause'} motion</Button>
          <Button size="sm" icon="eye" aria-pressed={!hud} onClick={() => setHud((h) => !h)}>{hud ? 'Hide panels' : 'Show panels'}</Button>
          {manager && <Button size="sm" variant="gold" icon="forward" onClick={() => setAdvanceOpen(true)}>Fast-forward…</Button>}
        </div>
      </header>

      <nav className="realm-presets hud" aria-label="Camera">
        {PRESET_LABEL.map(([p, label]) => <button key={p} type="button" onClick={() => fly(p)}>{label}</button>)}
      </nav>

      <aside className="realm-modes hud" aria-label="Fleet levels">
        {!data ? <Skeleton h={240} r={12} /> : data.modes.map((m) => {
          const span = m.nextAt ? m.nextAt - m.prevAt : 1;
          const next = m.tiers[m.level];
          return (
            <section key={m.mode} className={`mode-card ${m.mode}`} aria-labelledby={`mode-${m.mode}`}>
              <header>
                <span className={`mode-dot ${m.mode}`} aria-hidden="true" />
                <Icon name={MODE_ICON[m.mode]} size={15} />
                <h2 id={`mode-${m.mode}`}>{m.name}</h2>
                <span className="lvl">Lv {m.level}</span>
              </header>
              <strong className="vehicle">{m.tier.vehicle}</strong>
              <span className="tier-title">{m.tier.title}</span>
              {m.nextAt ? <Progress value={m.xp - m.prevAt} max={span} label={`${m.name} experience`} tone="gold" /> : <Progress value={1} label={`${m.name} at max level`} tone="gold" />}
              <span className="xp num">{m.nextAt ? `${nf.format(m.xp)} / ${nf.format(m.nextAt)} deliveries · next: ${next?.vehicle}` : `${nf.format(m.xp)} deliveries · max level`}</span>
              <span className="active num">{nf.format(m.active)} active · target {m.target}</span>
            </section>
          );
        })}
      </aside>

      <aside className="realm-side hud" aria-label="Details">
        {selected ? (
          <section className="vehicle-card">
            <header>
              <span className={`mode-dot ${selected.mode}`} aria-hidden="true" />
              <Icon name={MODE_ICON[selected.mode]} size={15} />
              <h2>{selected.vehicle.reference}</h2>
              <Button size="sm" variant="ghost" iconOnly icon="x" aria-label="Close vehicle details" onClick={() => setSelected(null)} />
            </header>
            <ShipmentStatusBadge status={selected.vehicle.status} />
            <p className="lane">{selected.vehicle.origin} <Icon name="arrowR" size={13} /> {selected.vehicle.destination}</p>
            <Progress value={selected.vehicle.progress} label="Journey progress" />
            <dl className="kv compact">
              <dt>Customer</dt><dd>{selected.vehicle.customer}</dd>
              <dt>Carrier</dt><dd>{selected.vehicle.carrier}</dd>
              <dt>Progress</dt><dd>{Math.round(selected.vehicle.progress * 100)}%</dd>
              <dt>ETA</dt><dd style={selected.vehicle.status === 'delayed' ? { color: 'var(--bad)' } : undefined}>{relTime(selected.vehicle.eta)}</dd>
            </dl>
            <Link className="btn sm" to={`/shipments/${selected.vehicle.id}`}>Open shipment<Icon name="arrowR" size={13} /></Link>
          </section>
        ) : (
          <>
            <div className="segmented" role="tablist" aria-label="Panel">
              <button type="button" role="tab" aria-selected={panel === 'fleet'} onClick={() => setPanel('fleet')}>Vehicles</button>
              <button type="button" role="tab" aria-selected={panel === 'milestones'} onClick={() => setPanel('milestones')}>Milestones</button>
            </div>
            {!data ? <Skeleton h={200} r={10} /> : panel === 'fleet' ? (
              <div className="fleet-list">
                {data.modes.map((m) => (
                  <div key={m.mode}>
                    <h3><span className={`mode-dot ${m.mode}`} aria-hidden="true" />{TRANSPORT_LABEL[m.mode]}</h3>
                    {!m.vehicles.length ? <p className="subtle">Nothing moving right now.</p> : (
                      <ul>{m.vehicles.map((v) => (
                        <li key={v.id}><button type="button" onClick={() => select({ vehicle: v, mode: m.mode })}>
                          <span className="mono">{v.reference}</span><span className="muted">{v.destination}</span>
                          {v.status === 'delayed' && <Badge tone="warn" icon="triangle">Late</Badge>}
                        </button></li>
                      ))}</ul>
                    )}
                  </div>
                ))}
                <div className="town-stats">
                  <h3><Icon name="castle" size={14} />The town</h3>
                  <p className="subtle">{nf.format(data.town.staff)} staff raise {Math.max(6, Math.min(30, data.town.staff * 2))} houses · {nf.format(data.town.docks)} dock doors moor up to {Math.max(2, Math.min(8, data.town.docks))} ships · {nf.format(data.town.skus)} SKUs fill {Math.max(1, Math.min(8, Math.ceil(data.town.skus / 3)))} warehouses.</p>
                </div>
              </div>
            ) : (
              <ol className="milestones">
                {data.milestones.map((m) => (
                  <li key={m.key} className={m.unlockedAt ? 'done' : ''}>
                    <span className="ms-icon"><Icon name={m.unlockedAt ? 'trophy' : 'lock'} size={14} /></span>
                    <div><strong>{m.title}</strong><span>{m.description}</span>
                      {m.unlockedAt && <time dateTime={m.unlockedAt}>{dateMed.format(new Date(m.unlockedAt))}</time>}</div>
                  </li>
                ))}
              </ol>
            )}
          </>
        )}
      </aside>

      {levelUp && (
        <div ref={banner} className="level-banner" role="status">
          <span data-glint><Icon name="sparkles" size={18} /></span>
          <div><strong>{levelUp.mode.name} reached level {levelUp.mode.level}</strong><span>{levelUp.mode.tier.vehicle} unlocked · {levelUp.mode.tier.title}</span></div>
          <span data-glint><Icon name="sparkles" size={18} /></span>
        </div>
      )}

      {q.error && !data && <div className="realm-error"><ErrorState error={q.error} onRetry={() => q.refetch()} /></div>}

      {manager && (
        <FormDialog open={advanceOpen} onOpenChange={(o) => { setAdvanceOpen(o); if (!o && params.has('advance')) { params.delete('advance'); setParams(params, { replace: true }); } }}
          title="Fast-forward the realm" submitLabel="Advance time" submitIcon="forward" pendingLabel="Advancing…"
          description="Moves every active shipment’s timeline forward, then runs a tracking sync for each one on the runtime. Deliveries earn experience and can level up your fleet."
          onSubmit={async (form) => {
            const hours = Number(new FormData(form).get('hours'));
            const r = await post<{ shipments: number; jobs: number }>('/api/realm/advance', { hours });
            toast(`Advanced ${hours} hours`, `${nf.format(r.jobs)} tracking syncs queued for ${nf.format(r.shipments)} shipments.`, 'info');
            setTimeout(() => { qc.invalidateQueries({ queryKey: ['realm'] }); qc.invalidateQueries({ queryKey: ['shipments'] }); }, 2500);
          }}>
          <fieldset className="field" style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="label" style={{ marginBottom: 8 }}>How far</legend>
            <div className="choice-grid">
              {[[3, 'A morning'], [6, 'Half a shift'], [12, 'A night'], [24, 'A full day']].map(([h, label]) => (
                <label key={h} className="choice"><input type="radio" name="hours" value={h} defaultChecked={h === 12} /><strong>{h} h</strong><span>{label}</span></label>
              ))}
            </div>
          </fieldset>
        </FormDialog>
      )}
    </div>
  );
}
