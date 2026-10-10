'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Card, Input, Label } from '@/components/ui';
import { api } from '@/lib/client/api';

export default function Login() {
  const router = useRouter();
  const [mode, setMode] = useState<'login' | 'signup'>('login');
  const [f, setF] = useState({ name: '', email: '', password: '' });
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (new URLSearchParams(location.search).get('mode') === 'signup') setMode('signup'); }, []);

  async function submit(e: React.FormEvent) {
    e.preventDefault(); setErr(''); setBusy(true);
    try {
      await api(mode === 'login' ? '/api/auth/login' : '/api/auth/signup', { body: f });
      router.push('/app');
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  }

  return (
    <main className="grid-bg grid min-h-screen place-items-center px-4">
      <Card className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto grid h-10 w-10 place-items-center rounded-xl bg-indigo-600 font-semibold">प्र</div>
          <h1 className="mt-3 text-xl font-semibold">{mode === 'login' ? 'Welcome back' : 'Create your private vault'}</h1>
        </div>
        <form onSubmit={submit} className="space-y-3">
          {mode === 'signup' && (<div><Label>Name</Label><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></div>)}
          <div><Label>Email</Label><Input type="email" required value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
          <div><Label>Password</Label><Input type="password" required minLength={8} value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} /></div>
          {err && <p className="text-sm text-red-400">{err}</p>}
          <Button className="w-full" disabled={busy}>{busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}</Button>
        </form>
        <p className="mt-4 text-center text-sm text-zinc-400">
          {mode === 'login' ? 'New here?' : 'Have an account?'}{' '}
          <button className="text-indigo-400 hover:underline" onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}>{mode === 'login' ? 'Create account' : 'Sign in'}</button>
        </p>
      </Card>
    </main>
  );
}
