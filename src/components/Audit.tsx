'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck, RefreshCw, Download, Search, ChevronDown, ChevronUp,
  Hash, Link2, Clock, User, X, History,
} from 'lucide-react';
import { Button, Card, Badge, SectionTitle, Input } from './ui';
import { api } from '@/lib/client/api';

type AuditEntry = {
  uid: string;
  action: string;
  detail: Record<string, any> | null;
  hash: string;
  created_at: string;
  email: string | null;
};

function timeAgo(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  if (Number.isNaN(ms)) return 'unknown time';
  const s = Math.max(0, Math.floor(ms / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

function actionTone(act: string): 'indigo' | 'green' | 'amber' | 'red' | 'zinc' {
  if (/quarantine|block|remove|delete|deny/.test(act)) return 'red';
  if (/create|signup|join|grant/.test(act)) return 'green';
  if (/chat|retrieve|verify/.test(act)) return 'indigo';
  if (/warn|update|key|invite/.test(act)) return 'amber';
  return 'zinc';
}

const REFRESH_MS = 15_000;

export default function Audit() {
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [activeAction, setActiveAction] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError(null);
    try {
      const res = await api<{ entries: AuditEntry[] }>('/api/audit');
      setEntries(Array.isArray(res.entries) ? res.entries : []);
      setLastUpdated(new Date());
    } catch (e: any) {
      setError(e?.message || 'Failed to load audit log');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (timer.current) { clearInterval(timer.current); timer.current = null; }
    if (autoRefresh) timer.current = setInterval(() => load(true), REFRESH_MS);
    return () => { if (timer.current) clearInterval(timer.current); };
  }, [autoRefresh, load]);

  const actionCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const e of entries) m.set(e.action, (m.get(e.action) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [entries]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return entries.filter((e) => {
      if (activeAction && e.action !== activeAction) return false;
      if (!q) return true;
      const hay = [e.action, e.email ?? '', e.uid, JSON.stringify(e.detail ?? {})].join(' ').toLowerCase();
      return hay.includes(q);
    });
  }, [entries, search, activeAction]);

  const toggleExpand = (uid: string) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid); else next.add(uid);
      return next;
    });

  const exportJson = () => {
    const blob = new Blob(
      [JSON.stringify({ exported_at: new Date().toISOString(), count: filtered.length, entries: filtered }, null, 2)],
      { type: 'application/json' },
    );
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `pramaan-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const hasFilters = search.trim() !== '' || activeAction !== null;

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <SectionTitle
          title="Cryptographic Audit Trail"
          desc="Immutable, hash-chained log of all security evaluations, retrievals, and data actions."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="ghost" onClick={exportJson} disabled={!filtered.length} title="Download filtered entries as JSON">
            <Download size={14} /> Export JSON
          </Button>
          <Button variant="ghost" onClick={() => setAutoRefresh((v) => !v)} title={autoRefresh ? 'Pause auto-refresh' : 'Auto-refresh every 15s'}>
            <History size={14} className={autoRefresh ? 'text-indigo-400' : ''} />
            Auto-refresh {autoRefresh ? 'on' : 'off'}
          </Button>
          <Button variant="ghost" onClick={() => load()} disabled={loading}>
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
      </div>

      {/* Hash-chain integrity banner */}
      <Card className="flex items-start gap-3 border-emerald-500/20 bg-emerald-950/10 p-4">
        <ShieldCheck className="mt-0.5 shrink-0 text-emerald-400" size={22} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm font-semibold text-emerald-300">
            <span>Tamper-Evident SHA-256 Chain</span>
            <Badge tone="green">{entries.length} sealed events</Badge>
          </div>
          <p className="mt-1 text-xs leading-relaxed text-zinc-400">
            Each event&apos;s hash seals the previous record&apos;s hash (<span className="font-mono">prev_hash</span>), forming an append-only chain per
            workspace. New entries are written under an advisory lock inside a single transaction, so the chain can&apos;t fork or be
            rewritten without invalidating every hash that follows. Tampering with any single record is detectable: its hash — and
            every hash after it — would no longer match.
          </p>
          {lastUpdated && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-zinc-500">
              <Clock size={11} /> Last synced {timeAgo(lastUpdated.toISOString())}
              {autoRefresh && <span className="text-indigo-400">· auto-refreshing every 15s</span>}
            </p>
          )}
        </div>
      </Card>

      {/* Search + action filter chips */}
      <Card className="space-y-3 p-4">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions, users, event IDs, or detail fields…"
            className="pl-9 pr-9"
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200"
              aria-label="Clear search"
            >
              <X size={14} />
            </button>
          )}
        </div>
        {actionCounts.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            <button
              onClick={() => setActiveAction(null)}
              className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${activeAction === null
                ? 'bg-indigo-600 text-white'
                : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}`}
            >
              All · {entries.length}
            </button>
            {actionCounts.map(([action, count]) => (
              <button
                key={action}
                onClick={() => setActiveAction(activeAction === action ? null : action)}
                className={`rounded-full px-2.5 py-1 text-xs font-medium transition ${activeAction === action
                  ? 'bg-indigo-600 text-white'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'}`}
              >
                {action} · {count}
              </button>
            ))}
          </div>
        )}
      </Card>

      {/* Result list */}
      <Card className="p-0">
        {loading && !entries.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-sm text-zinc-500">
            <RefreshCw size={15} className="animate-spin" /> Fetching audit records…
          </div>
        ) : error ? (
          <div className="space-y-3 px-5 py-12 text-center">
            <p className="text-sm text-red-300">{error}</p>
            <Button variant="ghost" onClick={() => load()}>
              <RefreshCw size={14} /> Try again
            </Button>
          </div>
        ) : !filtered.length ? (
          <div className="space-y-2 px-5 py-12 text-center">
            <ShieldCheck size={28} className="mx-auto text-zinc-600" />
            <p className="text-sm font-medium text-zinc-300">
              {entries.length === 0 ? 'No audit entries recorded yet.' : 'No events match your filters.'}
            </p>
            <p className="text-xs text-zinc-500">
              {entries.length === 0
                ? 'Actions like chat, document uploads, key changes, and member updates will appear here as hash-chained events.'
                : 'Try clearing the search or choosing a different action type.'}
            </p>
            {hasFilters && (
              <Button
                variant="ghost"
                className="mt-2"
                onClick={() => { setSearch(''); setActiveAction(null); }}
              >
                <X size={14} /> Clear filters
              </Button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-white/5">
            {filtered.map((e) => {
              const isOpen = expanded.has(e.uid);
              const detailKeys = e.detail ? Object.keys(e.detail).length : 0;
              return (
                <li key={e.uid} className="px-4 py-3.5 sm:px-5">
                  {/* Mobile: card row | Desktop: row */}
                  <button
                    onClick={() => toggleExpand(e.uid)}
                    className="flex w-full items-center gap-3 rounded-xl p-1 text-left transition hover:bg-white/[0.03] sm:gap-4"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <Badge tone={actionTone(e.action)}>{e.action}</Badge>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-zinc-400">
                          <User size={11} className="shrink-0 text-zinc-600" />
                          <span className="truncate">{e.email || 'System'}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px] text-zinc-500">
                        <span className="flex items-center gap-1 truncate" title={`SHA-256 hash: ${e.hash}`}>
                          <Hash size={10} className="shrink-0 text-zinc-600" />
                          <span className="truncate">Hash {e.hash ? `${e.hash.slice(0, 16)}…` : '—'}</span>
                        </span>
                        <span className="flex items-center gap-1" title={`Event UID: ${e.uid}`}>
                          <Link2 size={10} className="text-zinc-600" />
                          UID {e.uid.slice(0, 8)}…
                        </span>
                        {detailKeys > 0 && (
                          <span className="text-zinc-600">{detailKeys} detail field{detailKeys === 1 ? '' : 's'}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <span className="text-xs font-medium text-zinc-300">{timeAgo(e.created_at)}</span>
                      <span className="text-[10px] text-zinc-500">
                        {new Date(e.created_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {isOpen ? (
                      <ChevronUp size={16} className="shrink-0 text-zinc-500" />
                    ) : (
                      <ChevronDown size={16} className="shrink-0 text-zinc-500" />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-2 rounded-xl border border-white/5 bg-zinc-950/80 p-3">
                      <div className="flex items-center justify-between text-[11px] text-zinc-500">
                        <span className="font-medium uppercase tracking-wide">Event payload</span>
                        <button
                          onClick={() => navigator.clipboard?.writeText(e.uid)}
                          className="hover:text-zinc-200"
                          title="Copy event UID"
                        >
                          Copy UID
                        </button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words text-xs leading-relaxed text-zinc-400">
                        {JSON.stringify(e.detail ?? {}, null, 2)}
                      </pre>
                      <div className="border-t border-white/5 pt-2 font-mono text-[10px] leading-relaxed text-zinc-500">
                        <div className="break-all" title={e.uid}><span className="text-zinc-600">uid:&nbsp;</span>{e.uid}</div>
                        <div className="break-all" title={e.hash}><span className="text-zinc-600">hash:</span>{e.hash}</div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {filtered.length > 0 && (
        <p className="text-center text-xs text-zinc-600">
          Showing {filtered.length} of {entries.length} events · newest first
        </p>
      )}
    </div>
  );
}
