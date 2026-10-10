'use client';
import React from 'react';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'btn disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'btn-primary',
        variant === 'ghost' && 'btn-secondary',
        variant === 'danger' && 'bg-[var(--red)] text-white border border-[var(--red)] hover:opacity-85',
        className,
      )}
    />
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('card p-5', className)} />;
}

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx('input tnum', p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-2 text-sm outline-none placeholder:text-[var(--faint)] focus:border-[#737373]', p.className)} />;
}

export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx('h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[#737373]', p.className)} />;
}

export function Badge({ tone = 'zinc', children }: { tone?: 'zinc' | 'green' | 'amber' | 'red' | 'indigo'; children: React.ReactNode }) {
  const t = {
    zinc: '', green: 'pill-green', amber: 'pill-amber',
    red: 'pill-red', indigo: 'pill-blue',
  }[tone];
  return <span className={cx('pill', t)}><span className="dot" aria-hidden />{children}</span>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex justify-between">
          <span className="micro-label truncate">{label}</span>
          <span className="micro-label tnum">{Math.round(value)}%</span>
        </div>
      )}
      <div className="h-1 overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full bg-[var(--text)] transition-all" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

export function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <h2 className="h-tight text-lg font-semibold">{title}</h2>
      {desc && <p className="mt-1 text-sm text-[var(--muted)]">{desc}</p>}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="micro-label mb-1.5 block">{children}</label>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-md bg-white/5', className)} />;
}

export function Spinner({ size = 16, className }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden className={cx('animate-spin text-current', className)}>
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeOpacity="0.2" strokeWidth="3" />
      <path d="M22 12a10 10 0 0 0-10-10" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </svg>
  );
}

export function EmptyState({ icon, title, desc, action }: { icon?: React.ReactNode; title: string; desc?: string; action?: React.ReactNode }) {
  return (
    <div className="card flex flex-col items-center justify-center gap-2 border-dashed px-6 py-12 text-center">
      {icon && <div className="mb-1 text-[var(--muted)]">{icon}</div>}
      <div className="h-tight-2 text-sm font-semibold text-[var(--text)]">{title}</div>
      {desc && <p className="max-w-sm text-sm text-[var(--muted)]">{desc}</p>}
      {action && <div className="mt-3">{action}</div>}
    </div>
  );
}

/**
 * Mobile-first bottom sheet. On desktop it appears as a top-right popover,
 * on mobile it slides from the bottom with safe-area padding
 * (per mobile-chat-ux research).
 */
export function BottomSheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: React.ReactNode }) {
  React.useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true">
      <div className="absolute inset-0 bg-black/70" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-md border-t border-[var(--border)] bg-[var(--bg)] p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] md:inset-x-auto md:bottom-auto md:right-6 md:top-20 md:max-h-[70vh] md:w-[28rem] md:rounded-md md:border">
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <div className="h-tight-2 text-sm font-semibold text-[var(--text)]">{title}</div> : <div />}
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
