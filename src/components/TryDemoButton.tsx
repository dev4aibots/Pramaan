'use client';
import { useState } from 'react';
import { ArrowRight, FlaskConical } from 'lucide-react';

export default function TryDemoButton({ large = false }: { large?: boolean }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const start = async () => {
    if (busy) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch('/api/demo', { method: 'POST' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(j?.error || 'Demo unavailable');
      window.location.href = '/app';
    } catch (e: any) {
      setError(e?.message || 'Could not start the demo');
      setBusy(false);
    }
  };

  return (
    <span className="inline-flex flex-col items-center gap-2">
      <button
        onClick={start}
        disabled={busy}
        className={large ? 'btn btn-primary' : 'btn btn-secondary btn-sm'}
      >
        {busy ? (
          <>Preparing your demo vault…</>
        ) : (
          <>
            <FlaskConical className="h-4 w-4" />
            Try the live demo
            <ArrowRight className="h-4 w-4" />
          </>
        )}
      </button>
      {error ? <span className="text-xs text-[var(--red)]">{error}</span> : null}
      {!busy && !error ? (
        <span className="text-xs text-[var(--faint)]">No signup — 6 sample documents, ready to query</span>
      ) : null}
    </span>
  );
}
