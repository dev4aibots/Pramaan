'use client';
import { useState } from 'react';
import { FlaskConical, X } from 'lucide-react';

// Shown inside the workspace when the deployment runs in zero-config demo mode.
// The /app layout renders this only when isDemoMode() is true (server-side gate),
// so this component only handles presentation + session-scoped dismissal.
export default function DemoBanner() {
  const [dismissed, setDismissed] = useState(false);
  if (dismissed) return null;
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-2 border-b border-[rgba(245,165,36,0.35)] bg-[rgba(245,165,36,0.07)] px-4 py-2 text-xs text-[var(--muted)]"
    >
      <FlaskConical className="h-3.5 w-3.5 shrink-0 text-[var(--amber)]" />
      <span>
        <strong className="font-semibold text-[var(--text)]">Demo mode</strong>
        {' '}— you're exploring as the demo visitor · 6 sample documents loaded · uploads reset periodically
      </span>
      <button
        type="button"
        onClick={() => setDismissed(true)}
        aria-label="Dismiss demo banner"
        className="ml-1 grid h-8 w-8 shrink-0 place-items-center rounded-md text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--text)]"
      >
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
