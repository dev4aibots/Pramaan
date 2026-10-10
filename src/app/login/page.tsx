'use client';
import { Suspense, useEffect, useState, type ChangeEvent, type FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertCircle, ArrowLeft, Eye, EyeOff, Loader2 } from 'lucide-react';
import { Button, Card, Input, Label } from '@/components/ui';
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

  const set = (k: keyof typeof f) => (e: ChangeEvent<HTMLInputElement>) =>
    setF({ ...f, [k]: e.target.value });

  if (checking) {
    return (
      <main className="grid-bg grid min-h-screen place-items-center px-4">
        <div className="flex items-center gap-2 text-sm text-zinc-400">
          <Loader2 className="h-4 w-4 animate-spin" /> Checking your session…
        </div>
      </main>
    );
  }

  return (
    <main className="grid-bg hero-glow relative grid min-h-screen place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        <Link href="/" className="mb-6 inline-flex items-center gap-1.5 text-sm text-zinc-400 transition hover:text-white">
          <ArrowLeft className="h-4 w-4" /> Back to home
        </Link>
        <Card className="shadow-2xl shadow-black/40">
          <div className="mb-6 text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-xl bg-indigo-600 text-lg font-semibold text-white shadow-lg shadow-indigo-900/40">प्र</div>
            <h1 className="mt-4 text-xl font-semibold tracking-tight">
              {mode === 'login' ? 'Welcome back' : 'Create your private vault'}
            </h1>
            <p className="mt-1 text-sm text-zinc-400">
              {mode === 'login'
                ? 'Sign in to reach your documents and models.'
                : 'One account. One personal vault. Free.'}
            </p>
          </div>

          {/* mode toggle */}
          <div className="mb-6 grid grid-cols-2 gap-1 rounded-xl border border-white/10 bg-zinc-950/60 p-1" role="tablist" aria-label="Sign in or create account">
            {(['login', 'signup'] as Mode[]).map((m) => (
              <button
                key={m}
                role="tab"
                aria-selected={mode === m}
                type="button"
                onClick={() => switchMode(m)}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  mode === m ? 'bg-indigo-600 text-white shadow' : 'text-zinc-400 hover:text-white'
                }`}
              >
                {m === 'login' ? 'Sign in' : 'Create account'}
              </button>
            ))}
          </div>

          <form onSubmit={submit} className="space-y-4" noValidate>
            {mode === 'signup' && (
              <div>
                <Label>Name</Label>
                <Input
                  placeholder="Ada Lovelace"
                  autoComplete="name"
                  value={f.name}
                  onChange={set('name')}
                  maxLength={100}
                />
              </div>
            )}
            <div>
              <Label>Email</Label>
              <Input
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                autoFocus
                value={f.email}
                onChange={set('email')}
                aria-invalid={!!fieldErr.email}
                aria-describedby={fieldErr.email ? 'email-err' : undefined}
                className={fieldErr.email ? 'border-red-500/60 focus:border-red-500' : undefined}
              />
              {fieldErr.email && <p id="email-err" className="mt-1.5 text-xs text-red-400">{fieldErr.email}</p>}
            </div>
            <div>
              <Label>Password</Label>
              <div className="relative">
                <Input
                  type={showPw ? 'text' : 'password'}
                  placeholder={mode === 'signup' ? 'At least 8 characters' : 'Your password'}
                  autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                  value={f.password}
                  onChange={set('password')}
                  aria-invalid={!!fieldErr.password}
                  aria-describedby={fieldErr.password ? 'pw-err' : undefined}
                  className={`pr-11 ${fieldErr.password ? 'border-red-500/60 focus:border-red-500' : ''}`}
                />
                <button
                  type="button"
                  onClick={() => setShowPw(!showPw)}
                  aria-label={showPw ? 'Hide password' : 'Show password'}
                  className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1.5 text-zinc-500 transition hover:text-zinc-200"
                >
                  {showPw ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
              {fieldErr.password && <p id="pw-err" className="mt-1.5 text-xs text-red-400">{fieldErr.password}</p>}
            </div>

            {err && (
              <div role="alert" className="flex items-start gap-2.5 rounded-xl border border-red-500/30 bg-red-500/10 px-3.5 py-3 text-sm text-red-300">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{err}</span>
              </div>
            )}

            <Button type="submit" className="w-full py-2.5" disabled={busy}>
              {busy && <Loader2 className="h-4 w-4 animate-spin" />}
              {busy
                ? mode === 'login' ? 'Signing in…' : 'Creating your vault…'
                : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          <p className="mt-5 text-center text-sm text-zinc-400">
            {mode === 'login' ? 'New to PRAMAAN?' : 'Already have an account?'}{' '}
            <button
              type="button"
              className="font-medium text-indigo-400 transition hover:text-indigo-300 hover:underline"
              onClick={() => switchMode(mode === 'login' ? 'signup' : 'login')}
            >
              {mode === 'login' ? 'Create an account' : 'Sign in'}
            </button>
          </p>
        </Card>
        <p className="mt-6 text-center text-xs text-zinc-600">
          Sessions are httpOnly cookies · passwords hashed with bcrypt · keys never leave the server
        </p>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <main className="grid-bg grid min-h-screen place-items-center px-4">
        <Loader2 className="h-5 w-5 animate-spin text-zinc-500" />
      </main>
    }>
      <LoginForm />
    </Suspense>
  );
}
