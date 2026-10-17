import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { get, put, UNAUTHORIZED_EVENT } from './api';
import {
  applyAppearance, onSystemModeChange, readStoredAppearance, type Appearance,
} from './theme';
import type { Me, StreamMessage } from './types';

/* ───────────── Session ───────────── */

export function useMe() {
  return useQuery<Me | null>({
    queryKey: ['me'],
    queryFn: () => get<Me | null>('/api/session'),
    retry: false,
    staleTime: 5 * 60_000,
  });
}

export function useSession(): Me {
  const { data } = useMe();
  if (!data) throw new Error('useSession must be used inside a signed-in route');
  return data;
}

export const useIsManager = () => useMe().data?.user.role === 'manager';

export function useUnauthorized(handler: () => void) {
  useEffect(() => {
    window.addEventListener(UNAUTHORIZED_EVENT, handler);
    return () => window.removeEventListener(UNAUTHORIZED_EVENT, handler);
  }, [handler]);
}

/* ───────────── Appearance ───────────── */

interface AppearanceCtx {
  appearance: Appearance;
  setAppearance: (patch: Partial<Appearance>) => void;
}
const AppearanceContext = createContext<AppearanceCtx>({ appearance: readStoredAppearance(), setAppearance: () => {} });

export function AppearanceProvider({ children }: { children: ReactNode }) {
  const { data: me } = useMe();
  const qc = useQueryClient();
  const [appearance, setState] = useState<Appearance>(readStoredAppearance);
  const companyColor = me?.company.accentLight;
  const saveTimer = useRef<number>(undefined);
  const syncedFor = useRef<number | null>(null);

  // Signed in: the server copy wins once per session.
  useEffect(() => {
    if (me && syncedFor.current !== me.user.id) {
      syncedFor.current = me.user.id;
      setState(me.settings);
    }
    if (!me) syncedFor.current = null;
  }, [me]);

  useEffect(() => { applyAppearance(appearance, companyColor); }, [appearance, companyColor]);
  useEffect(() => onSystemModeChange(() => { if (appearance.mode === 'system') applyAppearance(appearance, companyColor); }), [appearance, companyColor]);

  const setAppearance = useCallback((patch: Partial<Appearance>) => {
    setState((prev) => {
      const next = { ...prev, ...patch };
      if (me) {
        window.clearTimeout(saveTimer.current);
        saveTimer.current = window.setTimeout(() => {
          put('/api/settings', next)
            .then(() => qc.setQueryData<Me | null>(['me'], (m) => (m ? { ...m, settings: next } : m)))
            .catch(() => {});
        }, 400);
      }
      return next;
    });
  }, [me, qc]);

  const value = useMemo(() => ({ appearance, setAppearance }), [appearance, setAppearance]);
  return <AppearanceContext.Provider value={value}>{children}</AppearanceContext.Provider>;
}

export const useAppearance = () => useContext(AppearanceContext);

/* ───────────── Live stream (SSE) ───────────── */

interface StreamCtx {
  last: StreamMessage | null;
  connected: boolean;
  subscribe: (fn: (m: StreamMessage) => void) => () => void;
}
const StreamContext = createContext<StreamCtx>({ last: null, connected: false, subscribe: () => () => {} });

export function StreamProvider({ children }: { children: ReactNode }) {
  const [last, setLast] = useState<StreamMessage | null>(null);
  const [connected, setConnected] = useState(false);
  const subs = useRef(new Set<(m: StreamMessage) => void>());
  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.onmessage = (e) => {
      const m = JSON.parse(e.data) as StreamMessage;
      setConnected(true);
      setLast(m);
      subs.current.forEach((fn) => fn(m));
    };
    es.onerror = () => setConnected(false);
    return () => es.close();
  }, []);
  const subscribe = useCallback((fn: (m: StreamMessage) => void) => {
    subs.current.add(fn);
    return () => { subs.current.delete(fn); };
  }, []);
  const value = useMemo(() => ({ last, connected, subscribe }), [last, connected, subscribe]);
  return <StreamContext.Provider value={value}>{children}</StreamContext.Provider>;
}

export const useStream = () => useContext(StreamContext);

/* ───────────── Small hooks ───────────── */

export function useTitle(title: string) {
  const company = useMe().data?.company.name;
  useEffect(() => {
    document.title = company ? `${title} · ${company} · Relay` : `${title} · Relay`;
  }, [title, company]);
}

export function useReducedMotion() {
  const q = '(prefers-reduced-motion: reduce)';
  const [reduced, setReduced] = useState(() => window.matchMedia(q).matches);
  useEffect(() => {
    const m = window.matchMedia(q);
    const fn = () => setReduced(m.matches);
    m.addEventListener('change', fn);
    return () => m.removeEventListener('change', fn);
  }, []);
  return reduced;
}

export function useInterval(fn: () => void, ms: number | null) {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (ms == null) return;
    const id = window.setInterval(() => { if (!document.hidden) ref.current(); }, ms);
    return () => window.clearInterval(id);
  }, [ms]);
}
