import { useGSAP } from '@gsap/react';
import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { Component, lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Icon, MODE_ICON, type IconName } from '../components/Icon';
import { ModeSelect } from '../components/ThemeControls';
import { Ornament } from '../components/ui';
import { useMe, useReducedMotion, useTitle } from '../lib/session';
import { Wordmark } from './brand';

gsap.registerPlugin(ScrollTrigger);
const LandingScene = lazy(() => import('../three/LandingScene'));

const TIERS: { mode: 'sea' | 'road' | 'rail' | 'air'; name: string; steps: string[] }[] = [
  { mode: 'sea', name: 'Sea', steps: ['Sailboat', 'Galleon', 'Steamship', 'Coastal freighter', 'Container ship'] },
  { mode: 'road', name: 'Road', steps: ['Horse cart', 'Delivery van', 'Box truck', 'Semi truck', 'Road train'] },
  { mode: 'rail', name: 'Rail', steps: ['Steam engine', 'Steam freight', 'Diesel freight', 'Intermodal', 'Maglev freight'] },
  { mode: 'air', name: 'Air', steps: ['Hot-air balloon', 'Biplane', 'Prop freighter', 'Cargo jet', 'Heavy-lift jet'] },
];

const FEATURES: [IconName, string, string][] = [
  ['package', 'Shipments & tracking', 'Book across sea, road, rail and air. Every scan arrives as a tracking job with a full timeline.'],
  ['dock', 'Dock scheduling', 'Door-by-door slots, carrier confirmation and one-tap check-in from the yard.'],
  ['calendar', 'Shifts & time off', 'Plan the week, publish drafts and approve leave without leaving the grid.'],
  ['boxes', 'Inventory & reorders', 'Live stock against reorder points. Reorders book the inbound truck for you.'],
  ['chart', 'Analytics', 'On-time rate, volume by mode and a carrier scorecard over any range.'],
  ['bell', 'Notifications', 'Delays, low stock, level-ups and decisions arrive the moment they happen.'],
  ['search', 'Command menu', 'Press ⌘K to search shipments, stock and people, or run any action.'],
  ['scroll', 'Audit log', 'Every booking, adjustment and decision, with who did it and when.'],
  ['palette', 'Your colours', 'Light or dark, moss, burgundy, navy — or any colour on the wheel.'],
];

class SceneBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() { return this.state.failed ? null : this.props.children; }
}

function webglAvailable() {
  try {
    const c = document.createElement('canvas');
    return !!(c.getContext('webgl2') || c.getContext('webgl'));
  } catch {
    return false;
  }
}

export default function Landing() {
  useTitle('Concurrent job runtime');
  const { data: me } = useMe();
  const reduced = useReducedMotion();
  const scroll = useRef(0);
  const root = useRef<HTMLDivElement>(null);
  const [mode, setMode] = useState<'light' | 'dark'>(() => (document.documentElement.dataset.mode === 'light' ? 'light' : 'dark'));
  const [gl] = useState(webglAvailable);

  // Follow the theme mode (it lives on <html data-mode>).
  useEffect(() => {
    const obs = new MutationObserver(() => setMode(document.documentElement.dataset.mode === 'light' ? 'light' : 'dark'));
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-mode'] });
    return () => obs.disconnect();
  }, []);

  useGSAP(() => {
    const mm = gsap.matchMedia();
    mm.add('(prefers-reduced-motion: no-preference)', () => {
      gsap.from('.hero [data-reveal]', { y: 26, opacity: 0, duration: 1.1, ease: 'power3.out', stagger: 0.09, delay: 0.15 });
      gsap.utils.toArray<HTMLElement>('[data-section]').forEach((el) => {
        gsap.from(el.querySelectorAll('[data-rise]'), {
          y: 34, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: 0.07,
          scrollTrigger: { trigger: el, start: 'top 78%' },
        });
      });
      ScrollTrigger.create({ start: 0, end: 'max', onUpdate: (self) => { scroll.current = self.progress; } });
    });
    return () => mm.revert();
  }, { scope: root });

  const cta = me ? { to: '/overview', label: 'Open your workspace' } : { to: '/login', label: 'Sign in' };

  return (
    <div className="landing" ref={root}>
      <a className="skip-link" href="#main">Skip to content</a>
      <div className="landing-canvas" aria-hidden="true">
        <div className="landing-fallback" />
        {gl && (
          <SceneBoundary>
            <Suspense fallback={null}><LandingScene mode={mode} reduced={reduced} scroll={scroll} /></Suspense>
          </SceneBoundary>
        )}
      </div>

      <header className="landing-nav">
        <Link to="/" aria-label="Relay home"><Wordmark size={26} /></Link>
        <nav aria-label="Sections" className="landing-links">
          <a href="#runtime">Runtime</a><a href="#realm">Realm</a><a href="#features">Features</a>
        </nav>
        <div className="actions">
          <ModeSelect />
          <Link className="btn primary" to={cta.to}>{cta.label}</Link>
        </div>
      </header>

      <main id="main" tabIndex={-1}>
        <section className="hero">
          <div className="hero-inner">
            <p className="eyebrow" data-reveal>Concurrent job runtime · Go · Postgres · Redis Streams</p>
            <h1 data-reveal>Relay</h1>
            <p className="hero-lede" data-reveal>A work-stealing scheduler for logistics — and a realm that grows from horse carts to container ships as your network delivers.</p>
            <div className="hero-cta" data-reveal>
              <Link className="btn primary lg" to={cta.to}>{cta.label}<Icon name="arrowR" size={16} /></Link>
              <a className="btn lg glass" href="#runtime">See how it works</a>
            </div>
          </div>
          <a className="scroll-cue" href="#runtime"><span>Scroll</span><Icon name="chevD" size={16} /></a>
        </section>

        <section id="runtime" className="landing-section" data-section>
          <div className="section-head" data-rise>
            <p className="eyebrow">The runtime</p>
            <h2>Built for burst traffic</h2>
            <p>The single-queue worker pool it replaced stalled whenever a dispatch wave hit. Relay gives every worker its own queue and lets idle workers take over stalled work.</p>
          </div>
          <div className="arches">
            {([
              ['zap', 'Work stealing', 'Each worker prefetches into a local deque. When it runs dry it claims jobs idling in a peer’s pending list with XAUTOCLAIM.'],
              ['layers', 'Redis Streams', 'One stream, one consumer group. Delivery, prefetch and recovery after a crash all come from the stream’s pending entries.'],
              ['castle', 'Postgres as truth', 'A conditional claim means a stolen job runs exactly once. Outcomes are flushed and acknowledged in batches.'],
            ] as [IconName, string, string][]).map(([icon, title, body]) => (
              <article key={title} className="arch-card" data-rise>
                <span className="arch-icon"><Icon name={icon} size={20} /></span>
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
          <dl className="stats" data-rise>
            <div><dt>Throughput on a laptop</dt><dd>15.8k<small>jobs/s</small></dd></div>
            <div><dt>p95 under a 12k burst</dt><dd>672<small>ms</small></dd></div>
            <div><dt>Single-queue baseline</dt><dd>1.36<small>s</small></dd></div>
            <div><dt>Workers</dt><dd>8</dd></div>
          </dl>
        </section>

        <section id="realm" className="landing-section" data-section>
          <div className="section-head" data-rise>
            <p className="eyebrow">The realm</p>
            <h2>A map that grows with you</h2>
            <p>Every delivery earns experience for its mode. Level up and your fleet modernises on a living 3D map of your network — and the more you ship, the more vehicles take to the roads, rails, seas and skies.</p>
          </div>
          <div className="tiers">
            {TIERS.map((t) => (
              <article key={t.mode} className="tier-card" data-rise>
                <header><span className={`mode-dot ${t.mode}`} aria-hidden="true" /><Icon name={MODE_ICON[t.mode]} size={16} /><h3>{t.name}</h3></header>
                <ol>{t.steps.map((s, i) => <li key={s}><span className="lvl">Lv {i + 1}</span>{s}</li>)}</ol>
              </article>
            ))}
          </div>
        </section>

        <section id="features" className="landing-section" data-section>
          <div className="section-head" data-rise>
            <p className="eyebrow">The workspace</p>
            <h2>Everything the yard needs</h2>
          </div>
          <div className="feature-grid">
            {FEATURES.map(([icon, title, body]) => (
              <article key={title} className="feature" data-rise>
                <Icon name={icon} size={18} />
                <h3>{title}</h3>
                <p>{body}</p>
              </article>
            ))}
          </div>
        </section>

        <section className="landing-section closing" data-section>
          <div className="closing-card" data-rise>
            <Ornament />
            <h2>Enter the realm</h2>
            <p>Three demo companies, a manager and an employee each. No sign-up needed.</p>
            <Link className="btn primary lg" to={cta.to}>{cta.label}<Icon name="arrowR" size={16} /></Link>
          </div>
        </section>
      </main>
      <footer className="landing-foot">
        <span>Relay · built with Go, Postgres, Redis Streams, React Three Fiber and GSAP</span>
      </footer>
    </div>
  );
}
