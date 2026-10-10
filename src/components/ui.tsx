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
