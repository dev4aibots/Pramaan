'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, FileText, AlertTriangle, ShieldAlert, RefreshCw, X, RotateCcw,
  Lock, Users, User, Info, Database,
} from 'lucide-react';
import { api } from '@/lib/client/api';
import { extractFile } from '@/lib/client/extract';
import { chunkText } from '@/lib/client/chunk';
import { loadEmbedder, embed } from '@/lib/client/embed';
import type { Access } from '@/lib/client/ingest';

const ROLES = ['admin', 'manager', 'member', 'viewer'];
const ACCEPT = '.pdf,.docx,.xlsx,.xls,.csv,.tsv,.ods,.json,.html,.htm,.txt,.md';
const SUPPORTED_LABEL = 'PDF, DOCX, XLSX/XLS, CSV/TSV, ODS, JSON, HTML, TXT, MD + code files';
const EMBED_BATCH = 16; // matches embed() internal batching
const UPLOAD_BATCH = 32; // under the 64-chunk server limit

type Stage = 'queued' | 'extract' | 'chunk' | 'embed' | 'upload' | 'ready' | 'failed' | 'cancelled';
type Job = {
  id: number; file: File; name: string; size: number;
  stage: Stage; p: number; msg: string; chunks?: number; quarantined?: number;
};

const STEPS: { key: Stage; label: string }[] = [
  { key: 'extract', label: 'Extract' },
  { key: 'chunk', label: 'Chunk' },
  { key: 'embed', label: 'Embed' },
  { key: 'upload', label: 'Upload' },
];

const fmtBytes = (n: number) =>
  n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

type EmbedCap = { kind: 'webgpu' | 'wasm' | 'none'; detail: string };
function detectEmbedCap(): EmbedCap {
  if (!window.isSecureContext)
    return { kind: 'none', detail: 'This page is not in a secure context. Transformers.js needs HTTPS or localhost to run — embedding cannot start.' };
  if ((navigator as any).gpu)
    return { kind: 'webgpu', detail: 'WebGPU detected — chunks will be embedded on your GPU. Your files never leave this device.' };
  if (typeof WebAssembly !== 'undefined')
    return { kind: 'wasm', detail: 'No WebGPU in this browser — chunks will be embedded on your CPU via WebAssembly. Slower than GPU, works everywhere.' };
  return { kind: 'none', detail: 'WebAssembly is unavailable in this browser, so embeddings cannot run here.' };
}

const VISIBILITY_COPY: Record<string, { title: string; body: string }> = {
  private: {
    title: 'Only me',
    body: 'Only you can retrieve answers from this document. Workspace owners/admins can see it listed but cannot read its contents.',
  },
  org: {
    title: 'Everyone in the workspace',
    body: 'Every member of this workspace can retrieve answers from this document. Owners/admins can also manage it.',
  },
  roles: {
    title: 'Specific roles only',
    body: 'Only members with the ticked roles can retrieve from this document. Owners/admins can always see everything shared.',
  },
};

const selectClass = 'h-10 w-full rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 text-sm text-[var(--text)] outline-none focus:border-[#737373] disabled:opacity-50 disabled:cursor-not-allowed';

export function AccessPicker({ me, value, onChange }: { me: any; value: Access; onChange: (a: Access) => void }) {
  const canShare = me.orgKind === 'team' && ['owner', 'admin', 'manager'].includes(me.role);
  const copy = VISIBILITY_COPY[value.visibility];
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <span className="micro-label mb-2 block">Who can retrieve this</span>
          <select
            value={value.visibility}
            disabled={!canShare}
            onChange={(e) => onChange({ ...value, visibility: e.target.value as Access['visibility'] })}
            className={selectClass}
          >
            <option value="private">Only me (private)</option>
            {canShare && <option value="org">Everyone in {me.orgName}</option>}
            {canShare && <option value="roles">Specific roles only</option>}
          </select>
        </div>
        {value.visibility === 'roles' && canShare && (
          <div>
            <span className="micro-label mb-2 block">Allowed roles</span>
            <div className="flex flex-wrap gap-2 pt-1">
              {ROLES.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--surface)] px-3 py-1.5 text-sm text-[var(--text)] hover:border-[var(--border-strong)]">
                  <input
                    type="checkbox"
                    className="accent-white"
                    checked={value.allowedRoles.includes(r)}
                    onChange={(e) => onChange({
                      ...value,
                      allowedRoles: e.target.checked ? [...value.allowedRoles, r] : value.allowedRoles.filter((x) => x !== r),
                    })}
                  />
                  <span className="font-mono text-xs">{r}</span>
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="card flex gap-2.5 p-3">
        <Info size={14} className="mt-0.5 shrink-0 text-[var(--muted)]" />
        <p className="text-xs leading-relaxed text-[var(--muted)]">
          <span className="font-medium text-[var(--text)]">{copy.title} — </span>{copy.body}{' '}
          {!canShare && 'Sharing is available in team workspaces for managers and above, so uploads stay private here.'}{' '}
          These rules apply to files you upload now.
        </p>
      </div>
    </div>
  );
}

function StatusPill({ stage }: { stage: Stage }) {
  if (stage === 'ready') return <span className="pill pill-green"><span className="dot" />Ready</span>;
  if (stage === 'failed') return <span className="pill pill-red"><span className="dot" />Failed</span>;
  if (stage === 'cancelled') return <span className="pill"><span className="dot" />Cancelled</span>;
  return <span className="pill"><span className="dot" />{stage === 'queued' ? 'Queued' : 'Processing'}</span>;
}

function ThinBar({ value }: { value: number }) {
  return (
    <div className="h-[3px] overflow-hidden rounded-full bg-[var(--border)]">
      <div className="h-full bg-white transition-all" style={{ width: `${Math.min(100, value)}%` }} />
    </div>
  );
}

export default function Knowledge({ me }: { me: any }) {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [listError, setListError] = useState('');
  const [access, setAccess] = useState<Access>({ visibility: 'private', allowedRoles: [] });
  const [subjectCol, setSubjectCol] = useState('');
  const [queue, setQueue] = useState<Job[]>([]);
  const [drag, setDrag] = useState(false);
  const [embedCap, setEmbedCap] = useState<EmbedCap | null>(null);
  const jobSeq = useRef(0);
  const cancelFlags = useRef(new Map<number, { cancelled: boolean }>());
  const fileInput = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setListError('');
    try {
      const r = await api<{ documents: any[] }>('/api/documents');
      setDocs(r.documents);
    } catch (e: any) {
      setListError(e.message || 'Could not load documents');
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load, me.orgId]);
  useEffect(() => { setEmbedCap(detectEmbedCap()); }, []);

  const patch = (id: number, p: Partial<Job>) =>
    setQueue((q) => q.map((x) => (x.id === id ? { ...x, ...p } : x)));

  async function runJob(job: Job) {
    const flag = cancelFlags.current.get(job.id)!;
    const die = () => { if (flag.cancelled) throw new Error('__cancelled__'); };
    try {
      patch(job.id, { stage: 'extract', p: 2, msg: 'extracting text locally…' });
      if (job.file.type.startsWith('image/'))
        throw new Error('Images/OCR are not supported yet — export text, or a PDF with a text layer.');
      const data = await extractFile(job.file, subjectCol.trim() || undefined);
      die();

      patch(job.id, { stage: 'chunk', p: 10, msg: 'splitting into chunks…' });
      const pieces = data.rows
        ? data.rows.filter((r) => r.text.trim()).map((r) => ({ content: r.text.slice(0, 6000), subjectRef: r.subject }))
        : chunkText(data.text || '').map((c) => ({ content: c, subjectRef: null as string | null }));
      if (!pieces.length) throw new Error('No extractable text found in this file.');
      die();

      patch(job.id, { stage: 'embed', p: 12, msg: 'loading embedding model (one-time download, cached in your browser)…' });
      await loadEmbedder((pct, file) =>
        patch(job.id, { stage: 'embed', p: 12 + Math.round(pct * 0.28), msg: file ? `downloading embedding model · ${file}…` : 'loading embedding model…' }));
      die();

      const embeddings: number[][] = [];
      for (let i = 0; i < pieces.length; i += EMBED_BATCH) {
        die();
        const e = await embed(pieces.slice(i, i + EMBED_BATCH).map((x) => x.content));
        embeddings.push(...e);
        const done = Math.min(i + EMBED_BATCH, pieces.length);
        patch(job.id, {
          stage: 'embed', p: 40 + Math.round((done / pieces.length) * 35),
          msg: `embedding chunk ${done}/${pieces.length} in your browser…`,
        });
      }

      patch(job.id, { stage: 'upload', p: 76, msg: 'sending text + vectors (raw files never leave your device)…' });
      let documentId: string | undefined;
      let quarantined = 0;
      for (let i = 0; i < pieces.length; i += UPLOAD_BATCH) {
        die();
        const batch = pieces.slice(i, i + UPLOAD_BATCH);
        const r = await api<{ documentId: string; quarantined: number }>('/api/documents', {
          body: {
            title: job.name, source: 'upload', mime: job.file.type || 'text/plain',
            visibility: access.visibility, allowedRoles: access.allowedRoles,
            documentId,
            chunks: batch.map((b, j) => ({
              idx: i + j, content: b.content, subjectRef: b.subjectRef, embedding: embeddings[i + j],
            })),
          },
        });
        documentId = r.documentId;
        quarantined += r.quarantined;
        const done = Math.min(i + UPLOAD_BATCH, pieces.length);
        patch(job.id, {
          stage: 'upload', p: 76 + Math.round((done / pieces.length) * 22),
          msg: `storing batch ${Math.ceil(done / UPLOAD_BATCH)} of ${Math.ceil(pieces.length / UPLOAD_BATCH)}…`,
        });
      }

      patch(job.id, {
        stage: 'ready', p: 100, chunks: pieces.length, quarantined,
        msg: `${pieces.length} chunks indexed${quarantined ? ` · ${quarantined} quarantined by the security scan` : ''}`,
      });
    } catch (e: any) {
      if (e?.message === '__cancelled__') patch(job.id, { stage: 'cancelled', p: 100, msg: 'cancelled — nothing from this file was stored' });
      else patch(job.id, { stage: 'failed', p: 100, msg: e?.message || 'upload failed' });
    }
    load();
  }

  async function handleFiles(files: FileList | File[]) {
    const list = Array.from(files).filter((f) => f.size > 0);
    if (!list.length) return;
    const jobs: Job[] = list.map((f) => {
      const id = ++jobSeq.current;
      cancelFlags.current.set(id, { cancelled: false });
      return { id, file: f, name: f.name, size: f.size, stage: 'queued' as Stage, p: 0, msg: 'queued' };
    });
    setQueue((q) => [...q, ...jobs]);
    for (const j of jobs) {
      // eslint-disable-next-line no-await-in-loop
      await runJob(j);
    }
  }

  const retry = (id: number) => {
    const j = queue.find((x) => x.id === id);
    if (!j) return;
    cancelFlags.current.set(id, { cancelled: false });
    patch(id, { stage: 'queued', p: 0, msg: 'queued', chunks: undefined, quarantined: undefined });
    runJob({ ...j, stage: 'queued', p: 0, msg: 'queued' });
  };
  const cancel = (id: number) => cancelFlags.current.get(id) && (cancelFlags.current.get(id)!.cancelled = true);
  const clearDone = () => setQueue((q) => q.filter((x) => ['queued', 'extract', 'chunk', 'embed', 'upload'].includes(x.stage)));

  async function del(id: string, title: string) {
    if (!confirm(`Delete "${title}" and all its embeddings permanently? This cannot be undone.`)) return;
    await api(`/api/documents?id=${encodeURIComponent(id)}`, { method: 'DELETE' });
    load();
  }

  const canDelete = (d: any) => d.mine || ['owner', 'admin'].includes(me.role);
  const ready = queue.filter((x) => x.stage === 'ready').length;
  const failed = queue.filter((x) => x.stage === 'failed').length;
  const active = queue.filter((x) => ['queued', 'extract', 'chunk', 'embed', 'upload'].includes(x.stage)).length;

  return (
    <div className="space-y-6">
      <div>
        <p className="micro-label">Knowledge</p>
        <h2 className="h-tight mt-1 text-lg font-semibold text-[var(--text)]">Knowledge vault</h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Files are parsed and embedded in your browser — only text chunks and vectors are stored, with access rules attached.
        </p>
      </div>

      {/* Browser-embedding capability: never silently unavailable */}
      {embedCap && (
        <div className="card flex gap-3 p-4">
          {embedCap.kind === 'webgpu' && <span className="pill pill-green shrink-0"><span className="dot" />GPU ready</span>}
          {embedCap.kind === 'wasm' && <span className="pill pill-amber shrink-0"><span className="dot" />CPU mode</span>}
          {embedCap.kind === 'none' && <span className="pill pill-red shrink-0"><span className="dot" />Unavailable</span>}
          <div className="min-w-0">
            <p className="font-mono text-xs font-normal uppercase tracking-wider text-[var(--text)]">Browser embeddings</p>
            <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">{embedCap.detail}</p>
            {embedCap.kind === 'none' && (
              <p className="mt-1 text-xs leading-relaxed text-[var(--muted)]">
                Files can&apos;t be indexed into the vault without embeddings. Open this page over HTTPS (or localhost) in a modern browser to enable it.
              </p>
            )}
            {embedCap.kind !== 'none' && (
              <p className="mt-1 font-mono text-[11px] text-[var(--faint)]">first use downloads a ~23 MB embedding model (bge-small-en-v1.5, 384-d), cached locally</p>
            )}
          </div>
        </div>
      )}

      <div className="card p-5">
        <p className="micro-label mb-4">Access &amp; upload</p>
        <div className="space-y-5">
          <AccessPicker me={me} value={access} onChange={setAccess} />
          <div>
            <span className="micro-label mb-2 block">Row-level security column <span className="normal-case text-[var(--faint)]">(spreadsheets / JSON, optional)</span></span>
            <input
              className="input font-mono"
              placeholder="e.g. student_id — each row becomes visible only to the member with that ID"
              value={subjectCol}
              onChange={(e) => setSubjectCol(e.target.value)}
            />
          </div>
          <label
            onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
            onDragLeave={() => setDrag(false)}
            onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
            className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border border-dashed p-8 text-center transition-colors sm:p-10 ${
              drag ? 'border-white bg-white/[0.03]' : 'border-[var(--border-strong)] hover:border-[#737373]'
            }`}
          >
            <Upload size={20} className="text-[var(--muted)]" />
            <p className="mt-3 text-sm font-medium text-[var(--text)]">Drop files or click to upload</p>
            <p className="mt-1.5 font-mono text-[11px] text-[var(--muted)]">{SUPPORTED_LABEL}</p>
            <p className="mt-1.5 max-w-md text-xs text-[var(--faint)]">Extraction, chunking and embedding happen on your device — raw files are never sent to the server.</p>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept={ACCEPT}
              className="hidden"
              onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
            />
          </label>

          {/* Per-file pipeline rows */}
          {queue.length > 0 && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <p className="font-mono text-[11px] uppercase tracking-wider text-[var(--muted)]">
                  {active > 0 ? `${active} processing` : 'Session uploads'}
                  {ready > 0 && ` · ${ready} ready`} {failed > 0 && ` · ${failed} failed`}
                </p>
                <button className="text-xs text-[var(--muted)] hover:text-[var(--text)]" onClick={clearDone}>Clear finished</button>
              </div>
              <div className="card divide-y divide-[var(--border)]">
                {queue.map((j) => {
                  const stepIdx = { queued: -1, extract: 0, chunk: 1, embed: 2, upload: 3, ready: 4, failed: 4, cancelled: 4 }[j.stage];
                  const failedNow = j.stage === 'failed';
                  const cancelledNow = j.stage === 'cancelled';
                  const doneNow = j.stage === 'ready';
                  const inFlight = ['queued', 'extract', 'chunk', 'embed', 'upload'].includes(j.stage);
                  return (
                    <div key={j.id} className="p-3.5">
                      <div className="flex items-start gap-3">
                        <FileText size={15} className="mt-0.5 shrink-0 text-[var(--muted)]" />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate font-mono text-[13px] text-[var(--text)]">{j.name}</p>
                            <div className="flex shrink-0 items-center gap-1.5">
                              {inFlight && (
                                <button onClick={() => cancel(j.id)} title="Cancel upload" className="grid h-7 w-7 place-items-center rounded-md text-[var(--muted)] hover:bg-white/5 hover:text-[var(--text)]">
                                  <X size={14} />
                                </button>
                              )}
                              {failedNow && (
                                <button onClick={() => retry(j.id)} className="btn btn-sm btn-secondary">
                                  <RotateCcw size={12} /> Retry
                                </button>
                              )}
                              <StatusPill stage={j.stage} />
                            </div>
                          </div>
                          <p className="mt-0.5 font-mono text-[11px] text-[var(--faint)]">{fmtBytes(j.size)}</p>
                          {/* Stage stepper */}
                          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
                            {STEPS.map((s, i) => {
                              const done = i < stepIdx;
                              const current = i === stepIdx;
                              return (
                                <span key={s.key} className="flex items-center gap-1.5">
                                  {i > 0 && <span className="mr-0.5 font-mono text-[10px] text-[var(--faint)]">→</span>}
                                  <span
                                    className={`pill${done ? ' pill-green' : ''}`}
                                    style={current && !failedNow && !cancelledNow ? { color: 'var(--text)', borderColor: 'var(--border-strong)' } : undefined}
                                  >
                                    <span className="dot" />
                                    {s.label}
                                  </span>
                                </span>
                              );
                            })}
                          </div>
                          <div className="mt-2.5 space-y-1.5">
                            <div className="flex justify-between font-mono text-[11px] text-[var(--muted)]">
                              <span className="truncate">{j.msg}</span>
                              <span className="tnum ml-2 shrink-0">{Math.round(j.p)}%</span>
                            </div>
                            <ThinBar value={j.p} />
                          </div>
                          {doneNow && (j.quarantined ?? 0) > 0 && (
                            <div className="card mt-2.5 flex items-center gap-2 p-2.5" style={{ borderColor: 'rgba(245, 165, 36, 0.35)' }}>
                              <AlertTriangle size={13} className="shrink-0 text-[var(--amber)]" />
                              <p className="font-mono text-[11px] text-[var(--amber)]">
                                {j.quarantined} chunk{(j.quarantined ?? 0) > 1 ? 's' : ''} quarantined — hidden from search
                              </p>
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Document list */}
      <div className="card p-5">
        <div className="mb-3 flex items-center justify-between">
          <p className="micro-label">
            Documents <span className="tnum ml-1 text-[var(--text)]">{docs.length}</span>
          </p>
          <button className="btn btn-sm btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
        </div>
        {listError && (
          <div className="card mb-3 flex items-center gap-2.5 p-3" style={{ borderColor: 'rgba(243, 18, 96, 0.35)' }}>
            <span className="pill pill-red"><span className="dot" />Error</span>
            <p className="text-sm text-[var(--text)]">{listError}</p>
            <button className="ml-auto shrink-0 text-xs text-[var(--muted)] underline hover:text-[var(--text)]" onClick={load}>Try again</button>
          </div>
        )}
        {loading && docs.length === 0 ? (
          <div className="space-y-px py-2">
            {[0, 1, 2].map((i) => <div key={i} className="h-14 animate-pulse rounded-md bg-white/[0.03]" />)}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center rounded-lg border border-dashed border-[var(--border-strong)] px-6 py-12 text-center">
            <Database size={24} className="text-[var(--faint)]" />
            <p className="micro-label mt-4">No documents yet</p>
            <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
              Drop a file in the upload zone above. It will be extracted, chunked and embedded in your browser,
              then stored with the access rules you chose.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
            {docs.map((d) => {
              const q = d.quarantined_chunks ?? 0;
              const n = d.chunk_count ?? 0;
              const allQ = q > 0 && q >= n;
              return (
                <div key={d.id} className="py-3">
                  <div className="flex items-center gap-3">
                    <FileText size={15} className="shrink-0 text-[var(--muted)]" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-mono text-[13px] text-[var(--text)]">{d.title}</div>
                      <div className="mt-0.5 truncate font-mono text-[11px] text-[var(--faint)]">
                        {d.owner_email} · {new Date(d.created_at).toLocaleString()} · {d.source} · {d.mime}
                        {d.mine && ' · yours'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <span className={`pill${d.visibility === 'org' ? ' pill-green' : d.visibility === 'roles' ? ' pill-blue' : ''}`}>
                        {d.visibility === 'private'
                          ? <><Lock size={10} /> private</>
                          : d.visibility === 'org'
                            ? <><Users size={10} /> org</>
                            : <><User size={10} /> roles: {(d.allowed_roles || []).join(', ') || 'none'}</>}
                      </span>
                      <span className="pill tnum">{n} chunk{n === 1 ? '' : 's'}</span>
                      {q > 0 && (
                        <span className={`pill${allQ ? ' pill-red' : ' pill-amber'}`}>
                          <ShieldAlert size={10} /> {q} quarantined
                        </span>
                      )}
                      {canDelete(d) && (
                        <button onClick={() => del(d.id, d.title)} title="Delete document" className="grid h-8 w-8 place-items-center rounded-md text-[var(--muted)] hover:bg-white/5 hover:text-[var(--red)]">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                  {q > 0 && (
                    <div className="card mt-2.5 flex gap-2.5 p-3" style={{ borderColor: allQ ? 'rgba(243, 18, 96, 0.35)' : 'rgba(245, 165, 36, 0.35)' }}>
                      <span className={`pill shrink-0${allQ ? ' pill-red' : ' pill-amber'}`}>
                        <ShieldAlert size={10} /> Quarantined
                      </span>
                      <p className="text-xs leading-relaxed text-[var(--muted)]">
                        {allQ
                          ? `All ${q} chunk${q === 1 ? '' : 's'} were quarantined by the prompt-injection scan — nothing from this document is searchable.`
                          : `${q} of ${n} chunks were quarantined by the prompt-injection scan and are hidden from search. The rest of the document is still searchable.`}{' '}
                        Quarantined chunks stay stored so admins can review them.
                      </p>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
