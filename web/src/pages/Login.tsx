import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Icon } from '../components/Icon';
import { ModeSelect } from '../components/ThemeControls';
import { Button, Skeleton } from '../components/ui';
import { ApiError, get, post } from '../lib/api';
import { useMe, useTitle } from '../lib/session';
import type { DemoAccount, Me } from '../lib/types';
import { Spires, Wordmark } from './brand';

export default function Login() {
  useTitle('Sign in');
  const { data: me } = useMe();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const qc = useQueryClient();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<{ field?: string; message: string } | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const demos = useQuery({ queryKey: ['demo-accounts'], queryFn: () => get<{ accounts: DemoAccount[]; password: string }>('/api/demo-accounts') });

  const next = params.get('next');
  const dest = next && next.startsWith('/') && !next.startsWith('//') ? next : '/overview';

  useEffect(() => { if (me) navigate(dest, { replace: true }); }, [me, dest, navigate]);
  useEffect(() => { if (window.matchMedia('(pointer: fine)').matches) emailRef.current?.focus(); }, []);

  const signIn = async (em: string, pw: string, who: string) => {
    setError(null);
    if (!em.trim()) { setError({ field: 'email', message: 'Enter your work email.' }); emailRef.current?.focus(); return; }
    if (!pw) { setError({ field: 'password', message: 'Enter your password.' }); passwordRef.current?.focus(); return; }
    setPending(who);
    try {
      await post('/api/login', { email: em.trim(), password: pw });
      const m = await get<Me>('/api/me');
      qc.setQueryData(['me'], m);
      navigate(dest, { replace: true });
    } catch (err) {
      const e = err instanceof ApiError ? err : new ApiError('Something went wrong.', 0);
      setError({ field: e.field, message: e.message });
      if (e.field === 'email') emailRef.current?.focus();
      else passwordRef.current?.focus();
      setPending(null);
    }
  };

  const onSubmit = (e: FormEvent) => { e.preventDefault(); signIn(email, password, 'form'); };

  const byCompany = new Map<string, DemoAccount[]>();
  for (const a of demos.data?.accounts ?? []) byCompany.set(a.company.id, [...(byCompany.get(a.company.id) ?? []), a]);

  return (
    <div className="login">
      <a className="skip-link" href="#main">Skip to content</a>
      <Spires />
      <div className="login-top">
        <Link to="/" className="btn ghost sm"><Icon name="arrowL" size={14} />Home</Link>
        <ModeSelect />
      </div>
      <main id="main" className="login-card" tabIndex={-1}>
        <div className="login-arch">
          <Wordmark />
          <h1>Sign in</h1>
          <p className="muted">Use your work account, or enter as one of the demo staff below.</p>
        </div>
        <form className="login-form" onSubmit={onSubmit} noValidate>
          {error && !error.field && <div className="form-error" role="alert"><Icon name="alert" size={15} /><span>{error.message}</span></div>}
          <div className="field">
            <label htmlFor="email">Work email</label>
            <input ref={emailRef} id="email" className="input" type="email" name="email" autoComplete="username" inputMode="email"
              spellCheck={false} autoCapitalize="off" placeholder="name@company.example" value={email} onChange={(e) => setEmail(e.target.value)}
              aria-invalid={error?.field === 'email' || undefined} aria-describedby={error?.field === 'email' ? 'email-error' : undefined} />
            {error?.field === 'email' && <p className="error" id="email-error"><Icon name="alert" size={14} />{error.message}</p>}
          </div>
          <div className="field">
            <label htmlFor="password">Password</label>
            <input ref={passwordRef} id="password" className="input" type="password" name="password" autoComplete="current-password"
              value={password} onChange={(e) => setPassword(e.target.value)}
              aria-invalid={error?.field === 'password' || undefined} aria-describedby={error?.field === 'password' ? 'password-error' : undefined} />
            {error?.field === 'password' && <p className="error" id="password-error"><Icon name="alert" size={14} />{error.message}</p>}
          </div>
          <Button type="submit" variant="primary" size="lg" loading={pending === 'form'} loadingLabel="Signing in…">Sign in</Button>
        </form>

        <div className="ornament login-divider"><span className="eyebrow">Demo accounts</span></div>

        <div className="demo-list" aria-busy={demos.isLoading}>
          {demos.isLoading && [0, 1, 2].map((i) => <Skeleton key={i} h={112} r={12} />)}
          {demos.error && <div className="form-error"><Icon name="alert" size={15} /><span>{(demos.error as Error).message}</span></div>}
          {[...byCompany.values()].map((people) => {
            const c = people[0].company;
            return (
              <section key={c.id} className="demo-company" style={{ ['--c' as string]: c.accentLight, ['--c-d' as string]: c.accentDark }} aria-label={`${c.name} demo accounts`}>
                <header>
                  <span className="org-mark" style={{ ['--brand' as string]: c.accentLight }} aria-hidden="true">{c.initials}</span>
                  <span className="meta"><strong>{c.name}</strong><span>{c.hub}</span></span>
                </header>
                <div className="demo-roles">
                  {people.map((p) => (
                    <button key={p.email} type="button" className="demo-btn" disabled={!!pending}
                      onClick={() => { setEmail(p.email); setPassword(demos.data!.password); signIn(p.email, demos.data!.password, p.email); }}>
                      <span className="role">
                        {pending === p.email ? <span className="spinner" aria-hidden="true" /> : <Icon name={p.role === 'manager' ? 'castle' : 'user'} size={12} />}
                        {pending === p.email ? 'Signing in…' : p.role === 'manager' ? 'Manager' : 'Employee'}
                      </span>
                      <span className="who">{p.name}</span>
                      <span className="email">{p.email}</span>
                    </button>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
        <p className="login-foot">Every demo account uses the password <code>relay-demo</code>.</p>
      </main>
    </div>
  );
}
