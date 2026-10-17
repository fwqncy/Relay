import * as Popover from '@radix-ui/react-popover';
import * as RDialog from '@radix-ui/react-dialog';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Command } from 'cmdk';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { get, post, qs } from '../lib/api';
import { relTime } from '../lib/format';
import { StreamProvider, useAppearance, useIsManager, useMe, useStream } from '../lib/session';
import { SCHEMES, type SchemeId } from '../lib/theme';
import type { Notification, SearchHit, TimeOff } from '../lib/types';
import { Modal, useToast } from './feedback';
import { Icon, type IconName } from './Icon';
import { ModeSelect, SchemePicker } from './ThemeControls';
import { Avatar, Button } from './ui';

interface NavItem { to: string; label: string; icon: IconName; key: string; manager?: boolean; count?: number; alert?: boolean }

export function AppShell() {
  return (
    <StreamProvider>
      <ShellInner />
    </StreamProvider>
  );
}

function ShellInner() {
  const { data: me } = useMe();
  const manager = useIsManager();
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const [navOpen, setNavOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const toggleRef = useRef<HTMLButtonElement>(null);

  const pending = useQuery({
    queryKey: ['requests', 'pending'],
    queryFn: () => get<{ requests: TimeOff[] }>('/api/requests?status=pending'),
    enabled: manager,
    refetchInterval: 30_000,
  });

  useEffect(() => { setNavOpen(false); }, [location.pathname]);

  const signOut = useCallback(async () => {
    try { await post('/api/logout'); } catch { /* signing out anyway */ }
    qc.setQueryData(['me'], null);
    qc.removeQueries({ predicate: (q) => q.queryKey[0] !== 'me' });
    navigate('/login', { replace: true });
  }, [navigate, qc]);

  // Keyboard shortcuts: ⌘K / Ctrl+K or "/" opens the palette, "?" lists shortcuts, "g x" jumps.
  useEffect(() => {
    let pendingG = 0;
    const routes: Record<string, string> = {
      o: '/overview', m: '/realm', s: '/shipments', d: '/docks', i: '/inventory', h: '/shifts',
      r: '/requests', j: '/jobs', a: '/analytics', l: '/activity', ',': '/settings',
    };
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setPaletteOpen((o) => !o);
        return;
      }
      const t = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName)) return;
      if (document.querySelector('[role="dialog"]')) return;
      if (e.key === '/') { e.preventDefault(); setPaletteOpen(true); return; }
      if (e.key === '?') { e.preventDefault(); setShortcutsOpen(true); return; }
      if (pendingG && Date.now() - pendingG < 1200 && routes[e.key]) {
        pendingG = 0;
        e.preventDefault();
        navigate(routes[e.key]);
        return;
      }
      pendingG = e.key === 'g' ? Date.now() : 0;
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [navigate]);

  if (!me) return null;
  const pendingCount = pending.data?.requests.length ?? 0;
  const groups: { label: string; items: NavItem[] }[] = [
    {
      label: 'Operations',
      items: [
        { to: '/overview', label: manager ? 'Runtime' : 'My day', icon: manager ? 'activity' : 'sun', key: 'o' },
        { to: '/realm', label: 'Realm map', icon: 'map', key: 'm' },
        { to: '/shipments', label: 'Shipments', icon: 'package', key: 's' },
        { to: '/docks', label: 'Dock schedule', icon: 'dock', key: 'd' },
        { to: '/inventory', label: 'Inventory', icon: 'boxes', key: 'i' },
      ],
    },
    {
      label: 'People',
      items: [
        { to: '/shifts', label: 'Shifts', icon: 'calendar', key: 'h' },
        { to: '/requests', label: manager ? 'Requests' : 'Time off', icon: 'inbox', key: 'r', count: manager ? pendingCount : undefined, alert: pendingCount > 0 },
      ],
    },
    {
      label: 'Platform',
      items: [
        { to: '/jobs', label: manager ? 'Jobs' : 'My jobs', icon: 'list', key: 'j' },
        { to: '/analytics', label: 'Analytics', icon: 'chart', key: 'a', manager: true },
        { to: '/activity', label: 'Activity log', icon: 'scroll', key: 'l', manager: true },
      ],
    },
  ];

  const brand = { ['--brand' as string]: me.company.accentLight };
  return (
    <div className={`shell ${navOpen ? 'nav-open' : ''}`}>
      <a className="skip-link" href="#main">Skip to content</a>
      <header className="topbar">
        <Button ref={toggleRef} variant="ghost" iconOnly icon="menu" aria-label={navOpen ? 'Close navigation' : 'Open navigation'}
          aria-expanded={navOpen} aria-controls="sidebar" onClick={() => setNavOpen((o) => !o)} />
        <span className="org-mark" style={brand} aria-hidden="true">{me.company.initials}</span>
        <strong>{me.company.name}</strong>
        <Button variant="ghost" iconOnly icon="search" aria-label="Search" onClick={() => setPaletteOpen(true)} />
        <NotificationsBell />
      </header>

      <nav id="sidebar" className="sidebar" aria-label="Primary">
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 4 }}>
          <Link to="/overview" className="org" style={{ flex: 1, minWidth: 0 }}>
            <span className="org-mark" style={brand} aria-hidden="true">{me.company.initials}</span>
            <span className="org-name"><strong>{me.company.name}</strong><span>{me.company.hub}</span></span>
          </Link>
          <span className="desktop-only"><NotificationsBell /></span>
        </div>
        <button type="button" className="search-trigger" onClick={() => setPaletteOpen(true)}>
          <Icon name="search" size={14} />Search or jump to…<kbd className="key">⌘K</kbd>
        </button>
        {groups.map((g) => (
          <div key={g.label}>
            <div className="nav-label">{g.label}</div>
            <div className="nav">
              {g.items.filter((i) => !i.manager || manager).map((i) => (
                <NavLink key={i.to} to={i.to} aria-keyshortcuts={`g ${i.key}`}>
                  <Icon name={i.icon} size={16} />
                  <span>{i.label}</span>
                  {i.count ? <span className={`count ${i.alert ? 'alert' : ''}`} aria-label={`${i.count} pending`}>{i.count}</span> : null}
                </NavLink>
              ))}
            </div>
          </div>
        ))}
        <div className="sidebar-foot">
          <Link to="/settings" className="me" aria-label={`Settings for ${me.user.name}`}>
            <Avatar name={me.user.name} accent />
            <span className="who"><strong>{me.user.name}</strong><span>{me.user.title} · {manager ? 'Manager' : 'Employee'}</span></span>
            <Icon name="settings" size={15} className="subtle" />
          </Link>
          <div className="foot-row">
            <ModeSelect />
            <SchemePicker />
            <Button size="sm" iconOnly icon="logout" aria-label="Sign out" title="Sign out" onClick={signOut} />
          </div>
        </div>
      </nav>
      {navOpen && <button type="button" className="scrim" aria-label="Close navigation" onClick={() => { setNavOpen(false); toggleRef.current?.focus(); }} />}

      <main id="main" tabIndex={-1}>
        <Outlet />
      </main>

      <CommandPalette open={paletteOpen} onOpenChange={setPaletteOpen} onShortcuts={() => setShortcutsOpen(true)} onSignOut={signOut} />
      <ShortcutsDialog open={shortcutsOpen} onOpenChange={setShortcutsOpen} />
      <NewNotificationToasts />
    </div>
  );
}

/* ───────────── Notifications ───────────── */

const NOTIF_ICON: Record<string, [IconName, string]> = {
  delay: ['triangle', 'bad'], level: ['sparkles', 'gold'], milestone: ['trophy', 'gold'], stock: ['boxes', ''],
  request: ['inbox', ''], info: ['info', ''],
};

function useNotifications() {
  return useQuery({ queryKey: ['notifications'], queryFn: () => get<{ notifications: Notification[]; unread: number }>('/api/notifications') });
}

function NotificationsBell() {
  const { data, refetch } = useNotifications();
  const { last } = useStream();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const unread = last?.unread ?? data?.unread ?? 0;

  const markRead = async (ids: number[]) => {
    await post('/api/notifications/read', { ids }).catch(() => {});
    qc.invalidateQueries({ queryKey: ['notifications'] });
  };

  return (
    <Popover.Root open={open} onOpenChange={(o) => { setOpen(o); if (o) refetch(); }}>
      <Popover.Trigger asChild>
        <Button variant="ghost" iconOnly icon="bell" className="icon-btn-badge" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'}>
          {unread > 0 && <span className="dot" aria-hidden="true">{unread > 99 ? '99+' : unread}</span>}
        </Button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="popover notif-pop" align="start" sideOffset={6} collisionPadding={12}>
          <div className="notif-head">
            <h2 style={{ fontSize: 14 }}>Notifications</h2>
            <Button size="sm" variant="ghost" disabled={!unread} onClick={() => markRead([])}>Mark all read</Button>
          </div>
          <div className="notif-list">
            {!data ? <div className="card-body"><div className="skeleton" style={{ height: 120 }} /></div>
              : data.notifications.length === 0 ? <div className="empty"><strong>All caught up</strong><p>Delays, level-ups and requests show up here.</p></div>
              : data.notifications.map((n) => {
                const [icon, tone] = NOTIF_ICON[n.kind] ?? NOTIF_ICON.info;
                return (
                  <a key={n.id} href={n.link || '#'} className={`notif ${n.readAt ? '' : 'unread'}`}
                    onClick={(e) => {
                      e.preventDefault();
                      if (!n.readAt) markRead([n.id]);
                      setOpen(false);
                      if (n.link) navigate(n.link);
                    }}>
                    <span className={`n-icon ${tone}`}><Icon name={icon} size={15} /></span>
                    <span className="n-body">
                      <strong>{n.title}</strong>
                      {n.body && <span>{n.body}</span>}
                      <time dateTime={n.createdAt} title={new Date(n.createdAt).toLocaleString()}>{relTime(n.createdAt)}</time>
                    </span>
                    {!n.readAt && <span className="sr-only">Unread</span>}
                  </a>
                );
              })}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}

// Toast the newest notification whenever the unread count goes up.
function NewNotificationToasts() {
  const { subscribe } = useStream();
  const qc = useQueryClient();
  const toast = useToast();
  const prev = useRef<number | null>(null);
  useEffect(() => subscribe((m) => {
    if (m.unread == null) return;
    const before = prev.current;
    prev.current = m.unread;
    if (before == null || m.unread <= before) return;
    get<{ notifications: Notification[]; unread: number }>('/api/notifications').then((d) => {
      qc.setQueryData(['notifications'], d);
      // Routine stock events stay in the bell; only things worth interrupting for are toasted.
      const n = d.notifications.find((x) => !x.readAt);
      if (n && ['level', 'milestone', 'delay', 'request'].includes(n.kind)) {
        toast(n.title, n.body, n.kind === 'level' || n.kind === 'milestone' ? 'gold' : n.kind === 'delay' ? 'bad' : 'info');
      }
      if (n?.kind === 'level' || n?.kind === 'milestone') qc.invalidateQueries({ queryKey: ['realm'] });
    }).catch(() => {});
  }), [subscribe, qc, toast]);
  return null;
}

/* ───────────── Command palette ───────────── */

const HIT_ICON: Record<SearchHit['kind'], IconName> = { shipment: 'package', item: 'boxes', person: 'user', appointment: 'dock', job: 'list' };
const HIT_GROUP: Record<SearchHit['kind'], string> = { shipment: 'Shipments', item: 'Inventory', person: 'People', appointment: 'Dock appointments', job: 'Jobs' };

function CommandPalette({ open, onOpenChange, onShortcuts, onSignOut }: { open: boolean; onOpenChange: (o: boolean) => void; onShortcuts: () => void; onSignOut: () => void }) {
  const navigate = useNavigate();
  const manager = useIsManager();
  const { setAppearance } = useAppearance();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  useEffect(() => { const t = setTimeout(() => setDebounced(query.trim()), 180); return () => clearTimeout(t); }, [query]);
  useEffect(() => { if (!open) setQuery(''); }, [open]);
  const search = useQuery({
    queryKey: ['search', debounced],
    queryFn: () => get<{ results: SearchHit[] }>(`/api/search${qs({ q: debounced })}`),
    enabled: open && debounced.length >= 2,
    staleTime: 10_000,
  });
  const run = (fn: () => void) => { onOpenChange(false); fn(); };
  const go = (to: string) => run(() => navigate(to));

  const pages: [string, string, IconName, boolean?][] = [
    ['/overview', manager ? 'Runtime' : 'My day', manager ? 'activity' : 'sun'],
    ['/realm', 'Realm map', 'map'], ['/shipments', 'Shipments', 'package'], ['/docks', 'Dock schedule', 'dock'],
    ['/inventory', 'Inventory', 'boxes'], ['/shifts', 'Shifts', 'calendar'], ['/requests', manager ? 'Requests' : 'Time off', 'inbox'],
    ['/jobs', 'Jobs', 'list'], ['/analytics', 'Analytics', 'chart', true], ['/activity', 'Activity log', 'scroll', true], ['/settings', 'Settings', 'settings'],
  ];
  const grouped = new Map<string, SearchHit[]>();
  for (const h of search.data?.results ?? []) {
    const k = HIT_GROUP[h.kind];
    grouped.set(k, [...(grouped.get(k) ?? []), h]);
  }

  return (
    <RDialog.Root open={open} onOpenChange={onOpenChange}>
      <RDialog.Portal>
        <RDialog.Overlay className="overlay" />
        <RDialog.Content className="dialog cmdk" aria-describedby={undefined}>
          <RDialog.Title className="sr-only">Command menu</RDialog.Title>
          {/* Substring matching: fuzzy matching surfaced odd hits (“sav” → “Navy”). */}
          <Command label="Command menu" loop filter={(value, search) => (value.toLowerCase().includes(search.trim().toLowerCase()) ? 1 : 0)}>
            <div className="cmdk-input-wrap">
              <Icon name="search" size={16} />
              <Command.Input value={query} onValueChange={setQuery} placeholder="Search shipments, stock, people… or type a command" />
            </div>
            <Command.List>
              <Command.Empty>{search.isFetching ? 'Searching…' : 'No matches. Try a shipment reference like SHP-100120.'}</Command.Empty>
              {[...grouped].map(([group, hits]) => (
                <Command.Group key={group} heading={group}>
                  {hits.map((h) => (
                    <Command.Item key={`${h.kind}-${h.id}`} value={`${h.kind} ${h.title} ${h.subtitle} ${query}`} onSelect={() => go(h.link)}>
                      <Icon name={HIT_ICON[h.kind]} size={15} />{h.title}<span className="sub">{h.subtitle}</span>
                    </Command.Item>
                  ))}
                </Command.Group>
              ))}
              <Command.Group heading="Go to">
                {pages.filter(([, , , m]) => !m || manager).map(([to, label, icon]) => (
                  <Command.Item key={to} value={`go ${label}`} onSelect={() => go(to)}><Icon name={icon} size={15} />{label}</Command.Item>
                ))}
              </Command.Group>
              <Command.Group heading="Actions">
                {manager && <Command.Item value="new shipment book" onSelect={() => go('/shipments?new=1')}><Icon name="plus" size={15} />Book a shipment…</Command.Item>}
                {manager && <Command.Item value="run burst load test" onSelect={() => go('/overview?burst=1')}><Icon name="layers" size={15} />Run a burst…</Command.Item>}
                {manager && <Command.Item value="fast forward realm time" onSelect={() => go('/realm?advance=1')}><Icon name="forward" size={15} />Fast-forward the realm…</Command.Item>}
                <Command.Item value="request time off holiday" onSelect={() => go('/requests?new=1')}><Icon name="calendar" size={15} />Request time off…</Command.Item>
                <Command.Item value="run job" onSelect={() => go('/jobs?new=1')}><Icon name="zap" size={15} />Run a job…</Command.Item>
                <Command.Item value="keyboard shortcuts help" onSelect={() => run(onShortcuts)}><Icon name="keyboard" size={15} />Keyboard shortcuts<span className="sub"><kbd className="key">?</kbd></span></Command.Item>
                <Command.Item value="sign out log out" onSelect={() => run(onSignOut)}><Icon name="logout" size={15} />Sign out</Command.Item>
              </Command.Group>
              <Command.Group heading="Appearance">
                {(['light', 'dark', 'system'] as const).map((m) => (
                  <Command.Item key={m} value={`theme mode ${m}`} onSelect={() => run(() => setAppearance({ mode: m }))}>
                    <Icon name={m === 'dark' ? 'moon' : m === 'light' ? 'sun' : 'monitor'} size={15} />Use {m} mode
                  </Command.Item>
                ))}
                {SCHEMES.map((s) => (
                  <Command.Item key={s.id} value={`colour color scheme ${s.name}`} onSelect={() => run(() => s.id === 'custom' ? navigate('/settings#appearance') : setAppearance({ scheme: s.id as SchemeId }))}>
                    <Icon name="palette" size={15} />{s.id === 'custom' ? 'Pick a custom colour…' : `${s.name} colour scheme`}
                  </Command.Item>
                ))}
              </Command.Group>
            </Command.List>
          </Command>
          <div className="cmdk-foot"><span><kbd className="key">↑</kbd> <kbd className="key">↓</kbd> to move</span><span><kbd className="key">↵</kbd> to open</span><span><kbd className="key">esc</kbd> to close</span></div>
        </RDialog.Content>
      </RDialog.Portal>
    </RDialog.Root>
  );
}

/* ───────────── Shortcuts ───────────── */

export const SHORTCUTS: [string, string][] = [
  ['⌘ K', 'Open the command menu'], ['/', 'Search'], ['?', 'Show keyboard shortcuts'],
  ['g o', 'Go to overview'], ['g m', 'Go to the realm map'], ['g s', 'Go to shipments'], ['g d', 'Go to the dock schedule'],
  ['g i', 'Go to inventory'], ['g h', 'Go to shifts'], ['g r', 'Go to requests'], ['g j', 'Go to jobs'],
  ['g a', 'Go to analytics'], ['g l', 'Go to the activity log'], ['g ,', 'Go to settings'],
];

export function ShortcutList() {
  return (
    <dl style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '8px 16px', margin: 0, fontSize: 13 }}>
      {SHORTCUTS.map(([k, d]) => (
        <div key={k} style={{ display: 'contents' }}>
          <dt>{k.split(' ').map((p) => <kbd key={p} className="key" style={{ marginRight: 4 }}>{p}</kbd>)}</dt>
          <dd style={{ margin: 0, color: 'var(--text-2)' }}>{d}</dd>
        </div>
      ))}
    </dl>
  );
}

function ShortcutsDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Keyboard shortcuts" description="Press g, then a letter, to jump between pages.">
      <ShortcutList />
    </Modal>
  );
}
