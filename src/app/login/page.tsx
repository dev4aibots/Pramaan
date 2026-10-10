'use client';
import { Suspense, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { api } from '@/lib/client/api';

type Mode = 'login' | 'signup';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Turn raw API error text into something a human can act on. */
function friendlyError(e: any): string {
  const msg = (e?.message ?? '').toLowerCase();
  if (msg.includes('already registered') || e?.status === 409)
    return 'This email is already registered. Try signing in instead — or use a different email.';
  if (msg.includes('invalid email or password') || e?.status === 401)
    return 'Invalid email or password. Double-check both and try again.';
  if (msg.includes('invalid input') || msg.includes('invalid email'))
    return 'That doesn’t look like a valid email address.';
  if (msg.includes('password'))
    return 'Password must be at least 8 characters.';
  return e?.message || 'Something went wrong. Please try again.';
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const [mode, setMode] = useState<Mode>(params.get('mode') === 'signup' ? 'signup' : 'login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [fieldErr, setFieldErr] = useState<{ email?: string; password?: string }>({});
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [demoBusy, setDemoBusy] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [checking, setChecking] = useState(true);

  // Already signed in? Skip this page entirely.
  useEffect(() => {
    let alive = true;
    api('/api/me')
      .then(() => { if (alive) router.replace('/app'); })
      .catch(() => { if (alive) setChecking(false); });
    return () => { alive = false; };
  }, [router]);

  function switchMode(m: Mode) {
    setMode(m);
    setErr('');
    setFieldErr({});
    const url = m === 'signup' ? '/login?mode=signup' : '/login';
    window.history.replaceState(null, '', url);
  }

  function validate(): boolean {
    const fe: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(f.email.trim())) fe.email = 'Enter a valid email address.';
    if (mode === 'signup' && f.password.length < 8) fe.password = 'Password must be at least 8 characters.';
    if (mode === 'login' && !f.password) fe.password = 'Enter your password.';
    setFieldErr(fe);
    return Object.keys(fe).length === 0;
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr('');
    if (!validate()) return;
    setBusy(true);
    try {
      await api(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', {
        body: mode === 'login'
          ? { email: f.email.trim(), password: f.password }
          : { email: f.email.trim(), password: f.password, name: f.name.trim() },
      });
      router.push('/app');
      router.refresh();
    } catch (e: any) {
      setErr(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }

  async function demoLogin() {
    setErr('');
    setDemoBusy(true);
    try {
      await api('/api/auth/demo', { method: 'POST' });
      router.push('/app');
      router.refresh();
    } catch (e: any) {
      setErr('Demo login failed — please try again.');
    } finally {
      setDemoBusy(false);
    }
  }

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  if (checking) {
    return (
      <main className="grid min-h-screen place-items-center px-4">
        <div className="flex items-center gap-2 text-sm" style={{ color: 'var(--muted)' }}>
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </div>
      </main>
    );
  }

  return (
    <main className="relative grid min-h-screen place-items-center px-4 py-16">
      <div className="w-full" style={{ maxWidth: '384px' }}>
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-1.5 text-sm transition hover:text-white"
          style={{ color: 'var(--muted)' }}
        >
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>

        {/* wordmark */}
        <div className="mb-8 text-center">
          <div
            className="mx-auto grid h-10 w-10 place-items-center rounded-md border text-lg font-semibold"
            style={{ background: 'var(--surface)', borderColor: 'var(--border)', color: 'var(--text)' }}
          >
            प्र
          </div>
          <h1 className="h-tight-2 mt-5 text-2xl font-semibold" style={{ color: 'var(--text)' }}>
            {mode === 'login' ? 'Welcome back' : 'Create your private vault'}
          </h1>
          <p className="mt-2 text-sm" style={{ color: 'var(--muted)' }}>
            {mode === 'login'
              ? 'Sign in to reach your documents and models.'
              : 'One account. One personal vault. Free.'}
          </p>
        </div>

        {/* mode toggle */}
        <div
          className="mb-8 grid grid-cols-2 gap-1 rounded-md border p-1"
          style={{ background: 'var(--surface)', borderColor: 'var(--border)' }}
          role="tablist"
          aria-label="Sign in or create account"
        >
          {(['login', 'signup'] as Mode[]).map((m) => (
            <button
              key={m}
              role="tab"
              aria-selected={mode === m}
              type="button"
              onClick={() => switchMode(m)}
              className="rounded-sm px-3 py-2 text-sm font-medium transition"
              style={
                mode === m
                  ? { background: '#fff', color: '#000' }
                  : { background: 'transparent', color: 'var(--muted)' }
              }
            >
              {m === 'login' ? 'Sign in' : 'Create account'}
            </button>
          ))}
        </div>

        <form onSubmit={submit} className="space-y-5" noValidate>
          {mode === 'signup' && (
            <div>
              <label className="micro-label mb-2 block" htmlFor="name">Name</label>
              <input
                id="name"
                className="input"
                placeholder="Ada Lovelace"
                autoComplete="name"
                value={f.name}
                onChange={set('name')}
                maxLength={100}
              />
            </div>
          )}
          <div>
            <label className="micro-label mb-2 block" htmlFor="email">Email</label>
            <input
              id="email"
              className="input"
              type="email"
              placeholder="you@example.com"
              autoComplete="email"
              autoFocus
              value={f.email}
              onChange={set('email')}
              aria-invalid={!!fieldErr.email}
              aria-describedby={fieldErr.email ? 'email-err' : undefined}
              style={fieldErr.email ? { borderColor: 'var(--red)' } : undefined}
            />
            {fieldErr.email && (
              <p id="email-err" className="mt-1.5 text-xs" style={{ color: 'var(--red)' }}>
                {fieldErr.email}
              </p>
            )}
          </div>
          <div>
            <label className="micro-label mb-2 block" htmlFor="password">Password</label>
            <div className="relative">
              <input
                id="password"
                className="input"
                type={showPw ? 'text' : 'password'}
                placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                value={f.password}
                onChange={set('password')}
                aria-invalid={!!fieldErr.password}
                aria-describedby={fieldErr.password ? 'pw-err' : undefined}
                style={{
                  paddingRight: '44px',
                  ...(fieldErr.password ? { borderColor: 'var(--red)' } : {}),
                }}
              />
              <button
                type="button"
                onClick={() => setShowPw(!showPw)}
                aria-label={showPw ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 transition"
                style={{ color: 'var(--faint)' }}
              >
                {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </button>
            </div>
            {fieldErr.password && (
              <p id="pw-err" className="mt-1.5 text-xs" style={{ color: 'var(--red)' }}>
                {fieldErr.password}
              </p>
            )}
          </div>

          {err && (
            <p role="alert" className="text-xs" style={{ color: 'var(--red)' }}>
              {err}
            </p>
          )}

          <button type="submit" className="btn btn-primary w-full" disabled={busy}>
            {busy && <Loader2 className="h-4 w-4 animate-spin" />}
            {busy
              ? mode === 'login' ? 'Signing in…' : 'Creating your vault…'
              : mode === 'login' ? 'Sign in' : 'Create account'}
          </button>
        </form>

        <div className="mt-4">
          <button
            type="button"
            onClick={demoLogin}
            disabled={demoBusy || busy}
            className="btn w-full"
            style={{ border: '1px solid var(--border)', background: 'var(--surface)', color: 'var(--text)' }}
          >
            {demoBusy && <Loader2 className="h-4 w-4 animate-spin" />}
            {demoBusy ? 'Preparing your demo…' : 'Try the live demo — no signup needed'}
          </button>
          <p className="mt-2 text-center text-xs" style={{ color: 'var(--faint)' }}>
            Instant access with pre-loaded Northbridge University documents
          </p>
        </div>

        <p className="mt-6 text-center text-sm" style={{ color: 'var(--muted)' }}>
          {mode === 'login' ? 'New to PRAMAAN?' : 'Already have an account?'}{' '}
          <button
            type="button"
            className="font-medium underline transition hover:opacity-80"
            style={{ color: 'var(--text)' }}
            onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
          >
            {mode === 'login' ? 'Create an account' : 'Sign in'}
          </button>
        </p>

        <p className="mt-8 text-center font-mono text-[11px]" style={{ color: 'var(--faint)' }}>
          httpOnly cookies · bcrypt-hashed passwords · keys never leave the server
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="grid min-h-screen place-items-center px-4">
        <Loader2 className="h-5 w-5 animate-spin" style={{ color: 'var(--faint)' }} />
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
