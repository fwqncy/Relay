import { useQueryClient } from '@tanstack/react-query';
import { lazy, Suspense, useCallback, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { ConfirmProvider, ToastProvider } from './components/feedback';
import { AppShell } from './components/Shell';
import { Empty, Skeleton } from './components/ui';
import { AppearanceProvider, useIsManager, useMe, useUnauthorized } from './lib/session';

const Landing = lazy(() => import('./pages/Landing'));
const Login = lazy(() => import('./pages/Login'));
const Overview = lazy(() => import('./pages/Overview'));
const Realm = lazy(() => import('./pages/Realm'));
const Shipments = lazy(() => import('./pages/Shipments'));
const ShipmentDetail = lazy(() => import('./pages/ShipmentDetail'));
const Jobs = lazy(() => import('./pages/Jobs'));
const Docks = lazy(() => import('./pages/Docks'));
const Shifts = lazy(() => import('./pages/Shifts'));
const Requests = lazy(() => import('./pages/Requests'));
const Inventory = lazy(() => import('./pages/Inventory'));
const Analytics = lazy(() => import('./pages/Analytics'));
const Activity = lazy(() => import('./pages/Activity'));
const Settings = lazy(() => import('./pages/Settings'));
const NotFound = lazy(() => import('./pages/NotFound'));

function Boot({ label = 'Loading Relay…' }: { label?: string }) {
  return <div className="boot" role="status"><span className="spinner" aria-hidden="true" /><span>{label}</span></div>;
}

function PageFallback() {
  return (
    <div className="page" aria-busy="true" aria-label="Loading page">
      <Skeleton h={28} w={240} />
      <Skeleton h={140} r={12} />
      <Skeleton h={320} r={12} />
    </div>
  );
}

function Protected() {
  const { data: me, isLoading, error, refetch } = useMe();
  const location = useLocation();
  if (isLoading) return <Boot />;
  if (error) {
    return (
      <div className="boot">
        <Empty icon="alert" title="Can’t reach Relay" action={<button className="btn" onClick={() => refetch()}>Try again</button>}>
          {error instanceof Error ? error.message : 'The server isn’t responding.'}
        </Empty>
      </div>
    );
  }
  if (!me) {
    const next = location.pathname === '/overview' ? '' : `?next=${encodeURIComponent(location.pathname + location.search)}`;
    return <Navigate to={`/login${next}`} replace />;
  }
  return <AppShell />;
}

function ManagerOnly({ children }: { children: ReactNode }) {
  const manager = useIsManager();
  return manager ? <>{children}</> : (
    <div className="page"><div className="card"><Empty icon="lock" title="Managers only">Ask a manager at your company if you need this view.</Empty></div></div>
  );
}

function SessionWatch() {
  const qc = useQueryClient();
  useUnauthorized(useCallback(() => { qc.setQueryData(['me'], null); }, [qc]));
  return null;
}

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AppearanceProvider>
          <SessionWatch />
          <Suspense fallback={<Boot />}>
            <Routes>
              <Route path="/" element={<Landing />} />
              <Route path="/login" element={<Login />} />
              <Route element={<Protected />}>
                <Route path="/overview" element={<Page><Overview /></Page>} />
                <Route path="/realm" element={<Page><Realm /></Page>} />
                <Route path="/shipments" element={<Page><Shipments /></Page>} />
                <Route path="/shipments/:id" element={<Page><ShipmentDetail /></Page>} />
                <Route path="/jobs" element={<Page><Jobs /></Page>} />
                <Route path="/docks" element={<Page><Docks /></Page>} />
                <Route path="/shifts" element={<Page><Shifts /></Page>} />
                <Route path="/requests" element={<Page><Requests /></Page>} />
                <Route path="/inventory" element={<Page><Inventory /></Page>} />
                <Route path="/analytics" element={<Page><ManagerOnly><Analytics /></ManagerOnly></Page>} />
                <Route path="/activity" element={<Page><ManagerOnly><Activity /></ManagerOnly></Page>} />
                <Route path="/settings" element={<Page><Settings /></Page>} />
                <Route path="*" element={<Page><NotFound /></Page>} />
              </Route>
            </Routes>
          </Suspense>
          <div id="announcer" className="sr-only" aria-live="polite" />
        </AppearanceProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Page({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageFallback />}>{children}</Suspense>;
}
