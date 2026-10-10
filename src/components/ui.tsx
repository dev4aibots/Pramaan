'use client';
import React from 'react';

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

export function Button({ variant = 'primary', className, ...p }: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'ghost' | 'danger' }) {
  return (
    <button
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition disabled:opacity-50 disabled:cursor-not-allowed',
        variant === 'primary' && 'bg-indigo-600 text-white hover:bg-indigo-500 shadow-lg shadow-indigo-900/30',
        variant === 'ghost' && 'border border-white/10 bg-white/5 text-zinc-200 hover:bg-white/10',
        variant === 'danger' && 'bg-red-600/90 text-white hover:bg-red-500',
        className,
      )}
    />
  );
}

export function Card({ className, ...p }: React.HTMLAttributes<HTMLDivElement>) {
  return <div {...p} className={cx('rounded-2xl border border-white/10 bg-zinc-900/60 p-5 backdrop-blur', className)} />;
}

export function Input(p: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input {...p} className={cx('w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-indigo-500', p.className)} />;
}

export function Textarea(p: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea {...p} className={cx('w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm outline-none placeholder:text-zinc-500 focus:border-indigo-500', p.className)} />;
}

export function Select(p: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return <select {...p} className={cx('w-full rounded-xl border border-white/10 bg-zinc-950/70 px-3 py-2 text-sm outline-none focus:border-indigo-500', p.className)} />;
}

export function Badge({ tone = 'zinc', children }: { tone?: 'zinc' | 'green' | 'amber' | 'red' | 'indigo'; children: React.ReactNode }) {
  const t = {
    zinc: 'bg-zinc-800 text-zinc-300', green: 'bg-emerald-500/15 text-emerald-300', amber: 'bg-amber-500/15 text-amber-300',
    red: 'bg-red-500/15 text-red-300', indigo: 'bg-indigo-500/15 text-indigo-300',
  }[tone];
  return <span className={cx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium', t)}>{children}</span>;
}

export function Progress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1">
      {label && <div className="flex justify-between text-xs text-zinc-400"><span className="truncate">{label}</span><span>{Math.round(value)}%</span></div>}
      <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800"><div className="h-full bg-indigo-500 transition-all" style={{ width: `${Math.min(100, value)}%` }} /></div>
    </div>
  );
}

export function SectionTitle({ title, desc }: { title: string; desc?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-lg font-semibold">{title}</h2>
      {desc && <p className="text-sm text-zinc-400">{desc}</p>}
    </div>
  );
}

export function Label({ children }: { children: React.ReactNode }) {
  return <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-400">{children}</label>;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-xl bg-white/5', className)} />;
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
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      {icon && <div className="mb-1 text-zinc-500">{icon}</div>}
      <div className="text-sm font-semibold text-zinc-200">{title}</div>
      {desc && <p className="max-w-sm text-sm text-zinc-500">{desc}</p>}
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
      <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={onClose} aria-hidden />
      <div className="absolute inset-x-0 bottom-0 max-h-[85dvh] overflow-y-auto rounded-t-2xl border-t border-white/10 bg-zinc-950 p-5 pb-[calc(1.25rem+env(safe-area-inset-bottom))] shadow-2xl md:inset-x-auto md:bottom-auto md:right-6 md:top-20 md:max-h-[70vh] md:w-[28rem] md:rounded-2xl md:border">
        <div className="mb-3 flex items-center justify-between gap-3">
          {title ? <div className="text-sm font-semibold text-zinc-100">{title}</div> : <div />}
          <button onClick={onClose} aria-label="Close" className="grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/5 hover:text-zinc-100">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M18 6 6 18M6 6l12 12" /></svg>
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}
