'use client';
import { useCallback, useEffect, useState } from 'react';
import {
  Database, FolderGit2, Play, CheckCircle2, AlertCircle, RefreshCw, Info,
  KeyRound, Unplug, Loader2, Search, ExternalLink, Clock, ShieldCheck, FlaskConical,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { AccessPicker } from './Knowledge';
import { ingest, type Access } from '@/lib/client/ingest';
import { driveToken, driveList, driveDownload, type DriveFile } from '@/lib/client/drive';
import { extractFile } from '@/lib/client/extract';

const ROLE_RANK: Record<string, number> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };
const canUsePostgres = (role?: string) => (ROLE_RANK[role ?? ''] ?? -1) >= ROLE_RANK.manager;

type Status = { state: 'idle' | 'ready' | 'ok' | 'error'; detail: string };

function statusPill(s: Status) {
  switch (s.state) {
    case 'ok': return <span className="pill pill-green"><span className="dot" /><CheckCircle2 size={11} /> Connected</span>;
    case 'ready': return <span className="pill pill-blue"><span className="dot" /><ShieldCheck size={11} /> Ready</span>;
    case 'error': return <span className="pill pill-red"><span className="dot" /><AlertCircle size={11} /> Error</span>;
    default: return <span className="pill"><span className="dot" /> Not configured</span>;
  }
}

/** Inline error surface with an actionable fix. Never a bare red message. */
function ErrorBox({ error, onDismiss }: { error: { msg: string; fix?: string } | null; onDismiss?: () => void }) {
  if (!error) return null;
  return (
    <div
      className="flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed"
      style={{ borderColor: 'rgba(243,18,96,.35)', background: 'var(--surface)' }}
    >
      <AlertCircle size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--red)' }} />
      <div className="min-w-0 flex-1">
        <div className="font-medium" style={{ color: 'var(--red)' }}>Failed: {error.msg}</div>
        {error.fix && <div className="mt-1 text-[var(--muted)]">Fix: {error.fix}</div>}
      </div>
      {onDismiss && (
        <button onClick={onDismiss} className="shrink-0 rounded p-0.5 text-[var(--muted)] hover:text-[var(--text)]" aria-label="Dismiss">
          ✕
        </button>
      )}
    </div>
  );
}

/** Friendly mapping from raw DB/connector errors to actionable fixes. */
function pgFix(err: any): { msg: string; fix?: string } {
  const m = String(err?.message ?? err ?? 'Unknown error');
  const map: [RegExp, string][] = [
    [/only a single select\/with/i, 'Only one SELECT or WITH statement is allowed — remove trailing semicolons and extra statements.'],
    [/connection string must/i, 'Connection string must start with postgres:// — copy the full URL from your provider (Neon, Supabase, RDS…).'],
    [/requires manager/i, 'The Postgres connector requires a manager role or higher — ask an admin to raise your role.'],
    [/econnrefused/i, 'The database host refused the connection — verify the host and port (usually 5432), and that the server accepts remote connections.'],
    [/enotfound|getaddrinfo/i, 'Hostname could not be resolved — check the spelling and that your DNS can reach it.'],
    [/etimedout|timeout/i, 'Connection timed out — check the port is open and try appending ?sslmode=require to the connection string.'],
    [/password authentication failed|28p01|auth/i, 'Authentication failed — re-check the username and password in the connection string.'],
    [/ssl/i, 'The server requires SSL — append ?sslmode=require (or sslmode=prefer) to the connection string.'],
    [/statement timeout/i, 'The query ran longer than the 15s server limit — add a WHERE clause or LIMIT to shrink it.'],
    [/relation .* does not exist|42p01/i, 'A table in the query was not found — verify the table name, and qualify it with the schema (public.table).'],
    [/permission denied|42501/i, 'The database user lacks SELECT permission — run GRANT SELECT ON the table to that user, or connect as a privileged user.'],
    [/column .* does not exist|42703/i, 'A column name is wrong — run \\d tablename in psql to list exact column names.'],
    [/syntax error/i, 'The SQL has a syntax error — test it in psql or your DB client first, then paste the working query.'],
    [/query returned 0 rows/i, 'The query succeeded but returned no rows — widen the WHERE clause or check you are querying the right table.'],
  ];
  for (const [re, fix] of map) if (re.test(m)) return { msg: m.replace(/^Database error:\s*/i, ''), fix };
  return { msg: m.replace(/^Database error:\s*/i, '') };
}

function driveFix(err: any): { msg: string; fix?: string } {
  const m = String(err?.message ?? err ?? 'Unknown error');
  const low = m.toLowerCase();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  if (/failed to load google sign-in/i.test(m)) return { msg: 'Could not load Google sign-in', fix: 'accounts.google.com is unreachable — check your network, VPN, or an ad-blocker blocking Google scripts, then retry.' };
  if (/popup|popup_blocked|popup closed/i.test(low)) return { msg: 'The Google sign-in popup was blocked or closed', fix: 'Allow popups for this site in your browser address bar, then click “Authorize Google Drive” again.' };
  if (/access_denied/i.test(low)) return { msg: 'Access was denied in the Google consent screen', fix: 'Click “Authorize Google Drive” again and choose “Allow” for read-only Drive access.' };
  if (/invalid_client|origin_mismatch|idpiframe/i.test(low)) return { msg: 'Google rejected this OAuth client', fix: `The client ID is wrong, or ${origin} is not listed under “Authorized JavaScript origins” in Google Cloud Console → APIs & Services → Credentials → OAuth client ID (Web application).` };
  if (/drive list failed|403/i.test(m)) return { msg: 'Google Drive API request was rejected', fix: 'Re-authorize (token may have expired), and confirm the Drive API is enabled for this client in Google Cloud Console.' };
  if (/download failed/i.test(low)) return { msg: m, fix: 'The file may be restricted or too large — check sharing settings in Drive and retry.' };
  if (/no extractable text/i.test(low)) return { msg: m, fix: 'This file type has no readable text (e.g. images without text). Only text-based files can be embedded.' };
  return { msg: m };
}

const fmtTime = (iso: string) => {
  try { return new Date(iso).toLocaleString(); } catch { return iso; }
};
const timeAgo = (iso?: string | null) => {
  if (!iso) return null;
  const s = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return `${Math.floor(s / 86400)}d ago`;
};

type LastSync = { at: string; detail: string } | null;
function useLastSync(orgId: string | undefined, key: string) {
  const [val, setVal] = useState<LastSync>(null);
  useEffect(() => {
    if (!orgId) return;
    try { setVal(JSON.parse(localStorage.getItem(`pramaan-conn-${orgId}-${key}`) || 'null')); } catch { /* ignore */ }
  }, [orgId, key]);
  const save = useCallback((v: LastSync) => {
    setVal(v);
    if (orgId && v) localStorage.setItem(`pramaan-conn-${orgId}-${key}`, JSON.stringify(v));
  }, [orgId, key]);
  return [val, save] as const;
}

function SectionHeader({ title, desc }: { title: string; desc?: string }) {
  return (
    <div>
      <div className="micro-label">{title}</div>
      {desc && <p className="mt-2 max-w-2xl text-[13px] leading-relaxed text-[var(--muted)]">{desc}</p>}
    </div>
  );
}

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <div className="micro-label mb-1.5">{children}</div>;
}

function ProgressBar({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-1.5">
      {label && (
        <div className="flex justify-between gap-2 text-xs text-[var(--muted)]">
          <span className="truncate">{label}</span>
          <span className="tnum">{Math.round(value)}%</span>
        </div>
      )}
      <div className="h-1 overflow-hidden rounded-full" style={{ background: 'var(--border)' }}>
        <div className="h-full rounded-full transition-all" style={{ width: `${Math.min(100, value)}%`, background: 'var(--text)' }} />
      </div>
    </div>
  );
}

export default function Connectors({ me }: { me: any }) {
  const orgId: string | undefined = me?.orgId;

  // ── shared: synced-document counts per connector source ──
  const [syncCounts, setSyncCounts] = useState<Record<string, number>>({});
  const refreshCounts = useCallback(async () => {
    try {
      const r = await api<{ documents: { source: string }[] }>('/api/documents');
      const c: Record<string, number> = {};
      for (const d of r.documents ?? []) c[d.source] = (c[d.source] ?? 0) + 1;
      setSyncCounts(c);
    } catch { /* counts stay empty — never block the UI */ }
  }, []);
  useEffect(() => { refreshCounts(); }, [refreshCounts]);

  return (
    <div className="space-y-5">
      <SectionHeader
        title="Live Data Connectors"
        desc="Pull structured records and documents straight into the permission-aware vector index. Data is fetched read-only; embeddings are always computed on your device."
      />
      <PostgresCard me={me} orgId={orgId} synced={syncCounts['postgres'] ?? 0} onSynced={refreshCounts} />
      <DriveCard me={me} orgId={orgId} synced={syncCounts['google-drive'] ?? 0} onSynced={refreshCounts} />
    </div>
  );
}

/* ══════════════════════════ PostgreSQL ══════════════════════════ */
function PostgresCard({ me, orgId, synced, onSynced }: { me: any; orgId?: string; synced: number; onSynced: () => void }) {
  const [connStr, setConnStr] = useState('');
  const [sqlQuery, setSqlQuery] = useState('SELECT id, name, details, student_id FROM records LIMIT 100;');
  const [subjectCol, setSubjectCol] = useState('student_id');
  const [docTitle, setDocTitle] = useState('PostgreSQL Database Export');
  const [access, setAccess] = useState<Access>({ visibility: 'private', allowedRoles: [] });
  const [status, setStatus] = useState<Status>({ state: 'idle', detail: 'No connection string entered yet.' });
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [error, setError] = useState<{ msg: string; fix?: string } | null>(null);
  const [showSecret, setShowSecret] = useState(false);
  const [lastSync, saveLastSync] = useLastSync(orgId, 'postgres');

  const allowed = canUsePostgres(me?.role);

  async function runQuery(query: string, subjectColumn: string | null) {
    return api<{ rows: { text: string; subject: string | null }[] }>('/api/connectors/postgres', {
      body: { connectionString: connStr.trim(), query, subjectColumn },
    });
  }

  async function testConnection() {
    setError(null);
    setTesting(true);
    const t0 = performance.now();
    try {
      const res = await runQuery('SELECT 1 AS ok', null);
      const ms = Math.round(performance.now() - t0);
      setStatus({ state: 'ok', detail: `Connection succeeded in ${ms} ms (${res.rows.length} probe row).` });
    } catch (err: any) {
      const f = pgFix(err);
      setError(f);
      setStatus({ state: 'error', detail: f.msg });
    } finally {
      setTesting(false);
    }
  }

  async function runImport(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setProgress({ pct: 5, msg: 'Querying database server-side (read-only)…' });
    setImporting(true);
    try {
      const res = await runQuery(sqlQuery.trim(), subjectCol.trim() || null);
      if (!res.rows?.length) throw new Error('Query returned 0 rows');
      setStatus({ state: 'ok', detail: `Connected — fetched ${res.rows.length} rows.` });
      setProgress({ pct: 25, msg: `Fetched ${res.rows.length} rows. Chunking & embedding on device…` });
      const r = await ingest(
        { title: docTitle.trim() || 'PostgreSQL Import', source: 'postgres', mime: 'application/x-database-rows', ...access },
        { rows: res.rows },
        (pct) => setProgress({ pct, msg: `Embedding & syncing chunks (${pct}%)…` }),
      );
      saveLastSync({ at: new Date().toISOString(), detail: `${r.chunks} chunks (${r.quarantined} quarantined)` });
      setProgress({ pct: 100, msg: `Done! Imported ${r.chunks} chunks (${r.quarantined} quarantined).` });
      onSynced();
    } catch (err: any) {
      const f = pgFix(err);
      setError(f);
      setStatus({ state: 'error', detail: f.msg });
      setProgress(null);
    } finally {
      setImporting(false);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <Database size={15} className="text-[var(--muted)]" />
        <span className="text-[14px] font-medium text-[var(--text)]">PostgreSQL Database Connector</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {statusPill(status)}
          <span className="pill"><span className="dot" /><span className="tnum">{synced}</span>&nbsp;synced doc{synced === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Executes a read-only query on your server, then embeds records on your device — raw rows never leave the server except into your index.
      </p>

      {lastSync && (
        <div className="tnum flex items-center gap-1.5 text-xs text-[var(--faint)]">
          <Clock size={12} /> Last import {timeAgo(lastSync.at)} · {lastSync.detail}
        </div>
      )}

      {!allowed && (
        <div className="flex items-start gap-2 rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: 'rgba(245,165,36,.35)', background: 'var(--surface)' }}>
          <Info size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
          <div>
            <span className="font-medium" style={{ color: 'var(--amber)' }}>Not available for your role.</span>
            <span className="text-[var(--muted)]"> The Postgres connector requires a <b>manager</b> role or higher — your role is <b>{me?.role ?? 'unknown'}</b>. Ask an admin to raise your role.</span>
          </div>
        </div>
      )}

      <form onSubmit={runImport} className="space-y-4">
        <div>
          <FieldLabel>Connection String</FieldLabel>
          <div className="relative">
            <input
              type={showSecret ? 'text' : 'password'}
              placeholder="postgres://user:password@host:5432/dbname?sslmode=require"
              required
              disabled={!allowed}
              value={connStr}
              onChange={(e) => { setConnStr(e.target.value); if (e.target.value.trim() && status.state === 'idle') setStatus({ state: 'ready', detail: 'Connection string entered — run a test.' }); }}
              autoComplete="off"
              className="input font-mono text-[13px]"
              style={{ paddingRight: 64 }}
            />
            <button type="button" onClick={() => setShowSecret(!showSecret)} className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-[var(--muted)] hover:text-[var(--text)]">
              {showSecret ? 'Hide' : 'Show'}
            </button>
          </div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--faint)]">
            Never stored by PRAMAAN — it is sent over your own API only for the duration of the query. Use a read-only DB user where possible.
          </p>
        </div>

        <div>
          <FieldLabel>SQL Query (single read-only SELECT)</FieldLabel>
          <textarea rows={3} required disabled={!allowed} value={sqlQuery} onChange={(e) => setSqlQuery(e.target.value)} className="input font-mono text-xs" style={{ height: 'auto', minHeight: 84, padding: '10px 12px' }} />
          <p className="mt-1.5 text-[11px] leading-relaxed text-[var(--faint)]">Only one SELECT/WITH statement, max 5000 rows per run, 15s timeout. Include the isolation column in the SELECT list if you use one.</p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <FieldLabel>Row-Level Isolation Column (optional)</FieldLabel>
            <input placeholder="e.g. student_id, emp_id" disabled={!allowed} value={subjectCol} onChange={(e) => setSubjectCol(e.target.value)} className="input" />
          </div>
          <div>
            <FieldLabel>Saved Document Title</FieldLabel>
            <input value={docTitle} disabled={!allowed} onChange={(e) => setDocTitle(e.target.value)} className="input" />
          </div>
        </div>

        <AccessPicker me={me} value={access} onChange={setAccess} />

        {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}
        {progress && <ProgressBar value={progress.pct} label={progress.msg} />}
        {!progress && status.detail && status.state !== 'idle' && (
          <div className="text-xs text-[var(--muted)]">{status.detail}</div>
        )}

        <div className="flex flex-wrap gap-2">
          <button type="submit" className="btn btn-primary" disabled={!allowed || importing || !connStr.trim()}>
            {importing ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {importing ? 'Importing…' : 'Run Query & Ingest'}
          </button>
          <button type="button" className="btn btn-secondary" onClick={testConnection} disabled={!allowed || testing || importing || !connStr.trim()}>
            {testing ? <Loader2 size={14} className="animate-spin" /> : <FlaskConical size={14} />}
            {testing ? 'Testing…' : 'Test Connection'}
          </button>
        </div>
      </form>
    </div>
  );
}

/* ══════════════════════════ Google Drive ══════════════════════════ */
function DriveCard({ me, orgId, synced, onSynced }: { me: any; orgId?: string; synced: number; onSynced: () => void }) {
  const [clientId, setClientId] = useState(me?.googleClientId || '');
  const envConfigured = Boolean(me?.googleClientId);
  const [token, setToken] = useState('');
  const [files, setFiles] = useState<DriveFile[]>([]);
  const [search, setSearch] = useState('');
  const [busy, setBusy] = useState(false);
  const [listing, setListing] = useState(false);
  const [importingId, setImportingId] = useState<string | null>(null);
  const [importedIds, setImportedIds] = useState<string[]>([]);
  const [progress, setProgress] = useState<{ pct: number; msg: string } | null>(null);
  const [error, setError] = useState<{ msg: string; fix?: string } | null>(null);
  const [access, setAccess] = useState<Access>({ visibility: 'private', allowedRoles: [] });
  const [lastSync, saveLastSync] = useLastSync(orgId, 'drive');

  const [status, setStatus] = useState<Status>(() =>
    me?.googleClientId
      ? { state: 'ready', detail: 'OAuth client ID configured — authorize to connect.' }
      : { state: 'idle', detail: 'OAuth client ID required.' },
  );

  async function authorize() {
    setError(null);
    setBusy(true);
    try {
      const t = await driveToken(clientId.trim());
      setToken(t);
      const list = await driveList(t, search.trim());
      setFiles(list);
      setStatus({ state: 'ok', detail: 'Authorized with Google Drive (read-only scope).' });
    } catch (err: any) {
      const f = driveFix(err);
      setError(f);
      setStatus({ state: 'error', detail: f.msg });
    } finally {
      setBusy(false);
    }
  }

  async function refreshList() {
    if (!token) return;
    setError(null);
    setListing(true);
    try {
      setFiles(await driveList(token, search.trim()));
    } catch (err: any) {
      const f = driveFix(err);
      setError(f);
      if (/rejected|expired|401/i.test(f.msg)) { setToken(''); setStatus({ state: 'ready', detail: 'Session expired — re-authorize.' }); }
    } finally {
      setListing(false);
    }
  }

  function disconnect() {
    setToken('');
    setFiles([]);
    setImportedIds([]);
    setProgress(null);
    setError(null);
    setStatus(clientId.trim()
      ? { state: 'ready', detail: 'Disconnected — authorize to connect again.' }
      : { state: 'idle', detail: 'OAuth client ID required.' });
  }

  async function importFile(file: DriveFile) {
    setError(null);
    setImportingId(file.id);
    setProgress({ pct: 10, msg: `Downloading ${file.name}…` });
    try {
      const downloaded = await driveDownload(token, file);
      setProgress({ pct: 30, msg: `Extracting text from ${file.name}…` });
      const extracted = await extractFile(downloaded);
      setProgress({ pct: 50, msg: 'Embedding chunks on your device…' });
      const r = await ingest(
        { title: file.name, source: 'google-drive', mime: file.mimeType || 'text/plain', ...access },
        extracted,
        (pct) => setProgress({ pct, msg: `Syncing chunks (${pct}%)…` }),
      );
      saveLastSync({ at: new Date().toISOString(), detail: `${file.name} · ${r.chunks} chunks (${r.quarantined} quarantined)` });
      setImportedIds((ids) => [...ids, file.id]);
      setProgress({ pct: 100, msg: `Done! Imported ${r.chunks} chunks from ${file.name}.` });
      onSynced();
    } catch (err: any) {
      const f = driveFix(err);
      setError(f);
      setProgress(null);
    } finally {
      setImportingId(null);
    }
  }

  return (
    <div className="card space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <FolderGit2 size={15} className="text-[var(--muted)]" />
        <span className="text-[14px] font-medium text-[var(--text)]">Google Drive Connector</span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {statusPill(status)}
          <span className="pill"><span className="dot" /><span className="tnum">{synced}</span>&nbsp;synced doc{synced === 1 ? '' : 's'}</span>
        </div>
      </div>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Connect Google Drive with a browser OAuth token (read-only scope). Files are downloaded and embedded in your browser — PRAMAAN’s server never sees them.
      </p>

      {lastSync && (
        <div className="tnum flex items-center gap-1.5 text-xs text-[var(--faint)]">
          <Clock size={12} /> Last import {timeAgo(lastSync.at)} · {lastSync.detail}
        </div>
      )}

      {/* Why-not: OAuth client ID missing */}
      {!clientId.trim() && (
        <div className="space-y-2 rounded-md border p-3 text-xs leading-relaxed" style={{ borderColor: 'rgba(245,165,36,.35)', background: 'var(--surface)' }}>
          <div className="flex items-start gap-2">
            <KeyRound size={15} className="mt-0.5 shrink-0" style={{ color: 'var(--amber)' }} />
            <div className="font-medium" style={{ color: 'var(--amber)' }}>Google OAuth client ID not configured — Drive is unavailable until this is set.</div>
          </div>
          <ol className="list-decimal space-y-1 pl-9 text-[var(--muted)]">
            <li>Open <span className="font-medium text-[var(--text)]">Google Cloud Console → APIs &amp; Services → Credentials</span>.</li>
            <li>Create an <span className="font-medium text-[var(--text)]">OAuth client ID</span> of type <span className="font-medium text-[var(--text)]">Web application</span>.</li>
            <li>Under <span className="font-medium text-[var(--text)]">Authorized JavaScript origins</span>, add exactly: <code className="rounded border border-[var(--border)] bg-black px-1 font-mono text-[11px] text-[var(--text)]">{typeof window !== 'undefined' ? window.location.origin : ''}</code></li>
            <li>Paste the client ID below — or set <code className="rounded border border-[var(--border)] bg-black px-1 font-mono text-[11px] text-[var(--text)]">NEXT_PUBLIC_GOOGLE_CLIENT_ID</code> on the server to prefill it for everyone.</li>
          </ol>
        </div>
      )}

      {!token ? (
        <div className="space-y-3">
          <div>
            <div className="flex items-center justify-between">
              <FieldLabel>Google OAuth Client ID</FieldLabel>
              {envConfigured && <span className="pill pill-green"><span className="dot" />from server env</span>}
            </div>
            <input
              placeholder="YOUR_CLIENT_ID.apps.googleusercontent.com"
              value={clientId}
              onChange={(e) => { setClientId(e.target.value); if (e.target.value.trim() && status.state === 'idle') setStatus({ state: 'ready', detail: 'Client ID entered — authorize to connect.' }); }}
              autoComplete="off"
              className="input font-mono text-[13px]"
            />
          </div>
          {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}
          <button type="button" className="btn btn-primary" onClick={authorize} disabled={busy || !clientId.trim()}>
            {busy ? <Loader2 size={14} className="animate-spin" /> : <KeyRound size={14} />}
            {busy ? 'Connecting…' : 'Authorize Google Drive'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-xs" style={{ color: 'var(--green)' }}>
              <CheckCircle2 size={14} /> Authorized — read-only access
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={disconnect}>
              <Unplug size={13} /> Disconnect
            </button>
          </div>

          <AccessPicker me={me} value={access} onChange={setAccess} />

          <form
            className="flex gap-2"
            onSubmit={(e) => { e.preventDefault(); refreshList(); }}
          >
            <input placeholder="Search Drive files…" value={search} onChange={(e) => setSearch(e.target.value)} className="input" />
            <button type="submit" className="btn btn-secondary" disabled={listing}>
              {listing ? <Loader2 size={14} className="animate-spin" /> : <Search size={14} />}
              {listing ? 'Searching…' : 'Search'}
            </button>
            <button type="button" className="btn btn-secondary" onClick={refreshList} disabled={listing} aria-label="Refresh file list">
              <RefreshCw size={14} className={listing ? 'animate-spin' : ''} />
            </button>
          </form>

          {error && <ErrorBox error={error} onDismiss={() => setError(null)} />}
          {progress && <ProgressBar value={progress.pct} label={progress.msg} />}

          <div className="max-h-72 divide-y divide-[var(--border)] overflow-y-auto rounded-md border border-[var(--border)] p-2" style={{ background: '#111' }}>
            {!files.length ? (
              <div className="p-3 text-xs text-[var(--muted)]">No documents found. Try a different search.</div>
            ) : (
              files.map((f) => {
                const busyFile = importingId === f.id;
                const done = importedIds.includes(f.id);
                return (
                  <div key={f.id} className="flex items-center justify-between gap-2 p-2 text-[13px]">
                    <div className="min-w-0 truncate">
                      <div className="flex items-center gap-1.5 truncate font-medium text-[var(--text)]">
                        <span className="truncate">{f.name}</span>
                        {done && <CheckCircle2 size={13} className="shrink-0" style={{ color: 'var(--green)' }} />}
                      </div>
                      <div className="tnum truncate text-xs" style={{ color: 'var(--faint)' }}>{f.mimeType}{f.modifiedTime ? ` · ${fmtTime(f.modifiedTime)}` : ''}</div>
                    </div>
                    <button
                      type="button"
                      className="btn btn-secondary btn-sm"
                      onClick={() => importFile(f)}
                      disabled={busyFile || importingId !== null}
                    >
                      {busyFile ? <Loader2 size={13} className="animate-spin" /> : done ? <CheckCircle2 size={13} /> : null}
                      {busyFile ? 'Importing…' : done ? 'Imported' : 'Import'}
                    </button>
                  </div>
                );
              })
            )}
          </div>
          <p className="text-[11px] leading-relaxed text-[var(--faint)]">
            Google Docs, Sheets and Slides are auto-converted to text/CSV on download. Need help?{' '}
            <a className="inline-flex items-center gap-0.5 hover:underline" style={{ color: 'var(--blue)' }} href="https://console.cloud.google.com/apis/credentials" target="_blank" rel="noreferrer">
              Google Cloud Console <ExternalLink size={11} />
            </a>
          </p>
        </div>
      )}
    </div>
  );
}
