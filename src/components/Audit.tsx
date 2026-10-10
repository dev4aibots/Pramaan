'use client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ShieldCheck, RefreshCw, Download, Search, ChevronDown, ChevronUp,
  Hash, Link2, Clock, User, X, History,
} from 'lucide-react';
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

function actionPill(act: string): string {
  if (/quarantine|block|remove|delete|deny/.test(act)) return 'pill-red';
  if (/create|signup|join|grant/.test(act)) return 'pill-green';
  if (/chat|retrieve|verify/.test(act)) return 'pill-blue';
  if (/warn|update|key|invite/.test(act)) return 'pill-amber';
  return '';
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
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <div className="micro-label">Cryptographic Audit Trail</div>
          <p className="mt-2 text-[13px] text-[var(--muted)]">
            Immutable, hash-chained log of all security evaluations, retrievals, and data actions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportJson} disabled={!filtered.length} title="Download filtered entries as JSON">
            <Download size={13} /> Export JSON
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setAutoRefresh((v) => !v)} title={autoRefresh ? 'Pause auto-refresh' : 'Auto-refresh every 15s'}>
            <History size={13} className={autoRefresh ? 'text-[var(--blue)]' : ''} />
            Auto-refresh {autoRefresh ? 'on' : 'off'}
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
      </div>

      {/* Hash-chain integrity banner */}
      <div className="card flex items-start gap-3 p-4">
        <ShieldCheck className="mt-0.5 shrink-0" size={20} style={{ color: 'var(--green)' }} />
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="micro-label" style={{ color: 'var(--green)' }}>Tamper-Evident SHA-256 Chain</span>
            <span className="pill pill-green"><span className="dot" /><span className="tnum">{entries.length}</span>&nbsp;sealed events</span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-[var(--muted)]">
            Each event&apos;s hash seals the previous record&apos;s hash (<span className="font-mono">prev_hash</span>), forming an append-only chain per
            workspace. New entries are written under an advisory lock inside a single transaction, so the chain can&apos;t fork or be
            rewritten without invalidating every hash that follows. Tampering with any single record is detectable: its hash — and
            every hash after it — would no longer match.
          </p>
          {lastUpdated && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-[var(--faint)]">
              <Clock size={11} /> Last synced <span className="tnum">{timeAgo(lastUpdated.toISOString())}</span>
              {autoRefresh && <span style={{ color: 'var(--blue)' }}>· auto-refreshing every 15s</span>}
            </p>
          )}
        </div>
      </div>

      {/* Search + action filter chips */}
      <div className="card space-y-3 p-4">
        <div className="relative">
          <Search size={14} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2" style={{ color: 'var(--faint)' }} />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search actions, users, event IDs, or detail fields…"
            className="input"
            style={{ paddingLeft: 36, paddingRight: 36 }}
          />
          {search && (
            <button
              onClick={() => setSearch('')}
              className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded p-1 hover:text-[var(--text)]"
              style={{ color: 'var(--faint)' }}
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
              className={`pill ${activeAction === null ? 'pill-blue' : ''} cursor-pointer hover:border-[var(--border-strong)]`}
            >
              <span className="dot" />
              All · <span className="tnum">{entries.length}</span>
            </button>
            {actionCounts.map(([action, count]) => (
              <button
                key={action}
                onClick={() => setActiveAction(activeAction === action ? null : action)}
                className={`pill ${activeAction === action ? 'pill-blue' : ''} cursor-pointer hover:border-[var(--border-strong)]`}
              >
                <span className="dot" />
                {action} · <span className="tnum">{count}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Result list */}
      <div className="card overflow-hidden">
        {loading && !entries.length ? (
          <div className="flex items-center justify-center gap-2 py-12 text-[13px] text-[var(--muted)]">
            <RefreshCw size={14} className="animate-spin" /> Fetching audit records…
          </div>
        ) : error ? (
          <div className="space-y-3 px-5 py-12 text-center">
            <p className="text-[13px]" style={{ color: 'var(--red)' }}>{error}</p>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => load()}>
              <RefreshCw size={13} /> Try again
            </button>
          </div>
        ) : !filtered.length ? (
          <div className="space-y-2 px-5 py-12 text-center">
            <ShieldCheck size={26} className="mx-auto" style={{ color: 'var(--faint)' }} />
            <p className="text-[13px] font-medium text-[var(--text)]">
              {entries.length === 0 ? 'No audit entries recorded yet.' : 'No events match your filters.'}
            </p>
            <p className="text-xs text-[var(--muted)]">
              {entries.length === 0
                ? 'Actions like chat, document uploads, key changes, and member updates will appear here as hash-chained events.'
                : 'Try clearing the search or choosing a different action type.'}
            </p>
            {hasFilters && (
              <button
                type="button"
                className="btn btn-secondary btn-sm mt-2"
                onClick={() => { setSearch(''); setActiveAction(null); }}
              >
                <X size={13} /> Clear filters
              </button>
            )}
          </div>
        ) : (
          <ul className="divide-y divide-[var(--border)]">
            {filtered.map((e) => {
              const isOpen = expanded.has(e.uid);
              const detailKeys = e.detail ? Object.keys(e.detail).length : 0;
              return (
                <li key={e.uid} className="px-4 py-3.5 sm:px-5">
                  <button
                    onClick={() => toggleExpand(e.uid)}
                    className="flex w-full items-center gap-3 text-left sm:gap-4"
                    aria-expanded={isOpen}
                  >
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className={`pill ${actionPill(e.action)}`}><span className="dot" />{e.action}</span>
                        <span className="flex min-w-0 items-center gap-1 text-xs text-[var(--muted)]">
                          <User size={11} className="shrink-0" style={{ color: 'var(--faint)' }} />
                          <span className="truncate">{e.email || 'System'}</span>
                        </span>
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]" style={{ color: 'var(--faint)' }}>
                        <span className="flex items-center gap-1 truncate" title={`SHA-256 hash: ${e.hash}`}>
                          <Hash size={10} className="shrink-0" />
                          <span className="truncate tnum">Hash {e.hash ? `${e.hash.slice(0, 16)}…` : '—'}</span>
                        </span>
                        <span className="flex items-center gap-1" title={`Event UID: ${e.uid}`}>
                          <Link2 size={10} />
                          <span className="tnum">UID {e.uid.slice(0, 8)}…</span>
                        </span>
                        {detailKeys > 0 && (
                          <span className="tnum">{detailKeys} detail field{detailKeys === 1 ? '' : 's'}</span>
                        )}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <span className="tnum text-xs font-medium text-[var(--text)]">{timeAgo(e.created_at)}</span>
                      <span className="tnum text-[10px]" style={{ color: 'var(--faint)' }}>
                        {new Date(e.created_at).toLocaleString(undefined, {
                          month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
                        })}
                      </span>
                    </div>
                    {isOpen ? (
                      <ChevronUp size={15} className="shrink-0" style={{ color: 'var(--faint)' }} />
                    ) : (
                      <ChevronDown size={15} className="shrink-0" style={{ color: 'var(--faint)' }} />
                    )}
                  </button>

                  {isOpen && (
                    <div className="mt-3 space-y-2 rounded-md border border-[var(--border)] p-3" style={{ background: '#111' }}>
                      <div className="flex items-center justify-between text-[11px]" style={{ color: 'var(--faint)' }}>
                        <span className="micro-label">Event payload</span>
                        <button
                          onClick={() => navigator.clipboard?.writeText(e.uid)}
                          className="hover:text-[var(--text)]"
                          title="Copy event UID"
                        >
                          Copy UID
                        </button>
                      </div>
                      <pre className="max-h-64 overflow-auto whitespace-pre-wrap break-words font-mono text-xs leading-relaxed text-[var(--muted)]">
                        {JSON.stringify(e.detail ?? {}, null, 2)}
                      </pre>
                      <div className="border-t border-[var(--border)] pt-2 font-mono text-[10px] leading-relaxed tnum" style={{ color: 'var(--faint)' }}>
                        <div className="break-all" title={e.uid}><span>uid:&nbsp;</span>{e.uid}</div>
                        <div className="break-all" title={e.hash}><span>hash:</span>{e.hash}</div>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {filtered.length > 0 && (
        <p className="tnum text-center text-xs" style={{ color: 'var(--faint)' }}>
          Showing {filtered.length} of {entries.length} events · newest first
        </p>
      )}
    </div>
  );
}
