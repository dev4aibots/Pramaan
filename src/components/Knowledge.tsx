'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Upload, Trash2, FileText, AlertTriangle, ShieldAlert, RefreshCw, X, RotateCcw,
  Cpu, Zap, Lock, Users, User, Info, CheckCircle2, Database,
} from 'lucide-react';
import { Button, Card, Badge, Progress, Select, Input, Label, SectionTitle } from './ui';
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
  { key: 'embed', label: 'Embed · browser' },
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

export function AccessPicker({ me, value, onChange }: { me: any; value: Access; onChange: (a: Access) => void }) {
  const canShare = me.orgKind === 'team' && ['owner', 'admin', 'manager'].includes(me.role);
  const copy = VISIBILITY_COPY[value.visibility];
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <Label>Who can retrieve this</Label>
          <Select
            value={value.visibility}
            disabled={!canShare}
            onChange={(e) => onChange({ ...value, visibility: e.target.value as Access['visibility'] })}
          >
            <option value="private">Only me (private)</option>
            {canShare && <option value="org">Everyone in {me.orgName}</option>}
            {canShare && <option value="roles">Specific roles only</option>}
          </Select>
        </div>
        {value.visibility === 'roles' && canShare && (
          <div>
            <Label>Allowed roles</Label>
            <div className="flex flex-wrap gap-2 pt-1">
              {ROLES.map((r) => (
                <label key={r} className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-white/10 bg-zinc-950/60 px-2.5 py-1.5 text-sm hover:border-indigo-500/50">
                  <input
                    type="checkbox"
                    className="accent-indigo-500"
                    checked={value.allowedRoles.includes(r)}
                    onChange={(e) => onChange({
                      ...value,
                      allowedRoles: e.target.checked ? [...value.allowedRoles, r] : value.allowedRoles.filter((x) => x !== r),
                    })}
                  />
                  {r}
                </label>
              ))}
            </div>
          </div>
        )}
      </div>
      <div className="flex gap-2 rounded-xl border border-white/10 bg-zinc-950/60 p-3 text-xs text-zinc-400">
        <Info size={14} className="mt-0.5 shrink-0 text-indigo-400" />
        <p>
          <span className="font-medium text-zinc-200">{copy.title} — </span>{copy.body}{' '}
          {!canShare && 'Sharing is available in team workspaces for managers and above, so uploads stay private here.'}{' '}
          These rules apply to files you upload now.
        </p>
      </div>
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
      <SectionTitle
        title="Knowledge vault"
        desc="Files are parsed and embedded in your browser — only text chunks and vectors are stored, with access rules attached."
      />

      {/* Browser-embedding capability: never silently unavailable */}
      {embedCap && (
        <div className={`flex gap-3 rounded-2xl border p-4 text-sm ${
          embedCap.kind === 'none' ? 'border-red-500/30 bg-red-500/10' : embedCap.kind === 'webgpu' ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-amber-500/30 bg-amber-500/5'
        }`}>
          {embedCap.kind === 'webgpu'
            ? <Zap size={18} className="mt-0.5 shrink-0 text-emerald-400" />
            : embedCap.kind === 'wasm'
              ? <Cpu size={18} className="mt-0.5 shrink-0 text-amber-400" />
              : <AlertTriangle size={18} className="mt-0.5 shrink-0 text-red-400" />}
          <div className="space-y-1">
            <p className="font-medium text-zinc-100">
              Browser embeddings: {embedCap.kind === 'webgpu' ? 'GPU ready' : embedCap.kind === 'wasm' ? 'CPU mode (WASM)' : 'unavailable'}
            </p>
            <p className="text-xs text-zinc-400">{embedCap.detail}</p>
            {embedCap.kind === 'none' && (
              <p className="text-xs text-zinc-400">
                <span className="font-medium text-red-300">Fallback: </span>
                files can't be indexed into the vault without embeddings. Open this page over HTTPS (or localhost) in a modern browser to enable it.
              </p>
            )}
            {embedCap.kind !== 'none' && (
              <p className="text-xs text-zinc-500">First use downloads a ~23 MB embedding model (bge-small-en-v1.5, 384-d) from Hugging Face and caches it locally.</p>
            )}
          </div>
        </div>
      )}

      <Card className="space-y-4">
        <AccessPicker me={me} value={access} onChange={setAccess} />
        <div>
          <Label>Row-level security column (spreadsheets / JSON, optional)</Label>
          <Input
            placeholder="e.g. student_id — each row becomes visible only to the member with that ID"
            value={subjectCol}
            onChange={(e) => setSubjectCol(e.target.value)}
          />
        </div>
        <label
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); handleFiles(e.dataTransfer.files); }}
          className={`flex cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed p-8 text-center transition sm:p-10 ${
            drag ? 'border-indigo-500 bg-indigo-500/10' : 'border-white/10 hover:border-indigo-500/40 hover:bg-indigo-500/5'
          }`}
        >
          <Upload className="text-indigo-400" />
          <p className="mt-2 text-sm font-medium">Drop files or click to upload</p>
          <p className="mt-1 text-xs text-zinc-500">{SUPPORTED_LABEL}</p>
          <p className="mt-1 text-xs text-zinc-600">Extraction, chunking and embedding happen on your device — raw files are never sent to the server.</p>
          <input
            ref={fileInput}
            type="file"
            multiple
            accept={ACCEPT}
            className="hidden"
            onChange={(e) => { if (e.target.files) handleFiles(e.target.files); e.target.value = ''; }}
          />
        </label>

        {/* Per-file pipeline cards */}
        {queue.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center justify-between text-xs text-zinc-400">
              <span>
                {active > 0 ? `${active} processing` : 'Session uploads'}
                {ready > 0 && ` · ${ready} ready`} {failed > 0 && ` · ${failed} failed`}
              </span>
              <button className="text-indigo-400 hover:text-indigo-300" onClick={clearDone}>Clear finished</button>
            </div>
            {queue.map((j) => {
              const stepIdx = { queued: -1, extract: 0, chunk: 1, embed: 2, upload: 3, ready: 4, failed: 4, cancelled: 4 }[j.stage];
              const failedNow = j.stage === 'failed';
              const cancelledNow = j.stage === 'cancelled';
              const doneNow = j.stage === 'ready';
              const inFlight = ['queued', 'extract', 'chunk', 'embed', 'upload'].includes(j.stage);
              return (
                <div key={j.id} className={`rounded-xl border p-3 ${
                  failedNow ? 'border-red-500/30 bg-red-500/5' : cancelledNow ? 'border-zinc-700 bg-zinc-900/40' : 'border-white/10 bg-zinc-950/60'
                }`}>
                  <div className="flex items-start gap-3">
                    <FileText size={16} className="mt-1 shrink-0 text-zinc-400" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <p className="truncate text-sm font-medium text-zinc-100">{j.name}</p>
                        <div className="flex shrink-0 items-center gap-1">
                          {inFlight && (
                            <button onClick={() => cancel(j.id)} title="Cancel upload" className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-200">
                              <X size={14} />
                            </button>
                          )}
                          {failedNow && (
                            <button onClick={() => retry(j.id)} title="Retry" className="flex items-center gap-1 rounded-lg border border-white/10 px-2 py-1 text-xs text-indigo-300 hover:bg-white/10">
                              <RotateCcw size={12} /> Retry
                            </button>
                          )}
                          {doneNow && <CheckCircle2 size={16} className="text-emerald-400" />}
                          {failedNow && <X size={16} className="text-red-400" />}
                        </div>
                      </div>
                      <p className="text-xs text-zinc-500">{fmtBytes(j.size)}</p>
                      {/* Stage stepper */}
                      <div className="mt-2 flex items-center gap-1 text-[11px]">
                        {STEPS.map((s, i) => (
                          <span key={s.key} className="flex items-center gap-1">
                            {i > 0 && <span className="mx-0.5 text-zinc-700">→</span>}
                            <span className={
                              i < stepIdx ? 'text-emerald-400'
                              : i === stepIdx ? 'font-semibold text-indigo-300'
                              : failedNow || cancelledNow ? 'text-zinc-600'
                              : 'text-zinc-500'
                            }>
                              {i < stepIdx ? '✓ ' : ''}{s.label}
                            </span>
                          </span>
                        ))}
                      </div>
                      <div className="mt-2"><Progress value={j.p} label={j.msg} /></div>
                      {doneNow && (j.quarantined ?? 0) > 0 && (
                        <p className="mt-1.5 flex items-center gap-1 text-xs text-amber-300">
                          <AlertTriangle size={12} /> {j.quarantined} chunk{(j.quarantined ?? 0) > 1 ? 's' : ''} quarantined by the security scan (hidden from search)
                        </p>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </Card>

      {/* Document list */}
      <Card>
        <div className="mb-3 flex items-center justify-between">
          <div className="text-sm font-medium">
            {docs.length} document{docs.length === 1 ? '' : 's'} you can access
          </div>
          <Button variant="ghost" onClick={load} disabled={loading} className="!px-3 !py-1.5 text-xs">
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} /> Refresh
          </Button>
        </div>
        {listError && (
          <div className="mb-3 flex items-center gap-2 rounded-xl border border-red-500/30 bg-red-500/10 p-3 text-sm text-red-300">
            <AlertTriangle size={16} /> {listError}
            <button className="ml-auto text-xs underline" onClick={load}>Try again</button>
          </div>
        )}
        {loading && docs.length === 0 ? (
          <div className="space-y-2 py-4">
            {[0, 1, 2].map((i) => <div key={i} className="h-12 animate-pulse rounded-xl bg-white/5" />)}
          </div>
        ) : docs.length === 0 ? (
          <div className="flex flex-col items-center py-10 text-center">
            <Database size={28} className="text-zinc-600" />
            <p className="mt-3 font-medium text-zinc-200">No documents yet</p>
            <p className="mt-1 max-w-sm text-sm text-zinc-500">
              Drop a file in the upload zone above. It will be extracted, chunked and embedded in your browser,
              then stored with the access rules you chose.
            </p>
          </div>
        ) : (
          <div className="divide-y divide-white/5">
            {docs.map((d) => {
              const q = d.quarantined_chunks ?? 0;
              const n = d.chunk_count ?? 0;
              const allQ = q > 0 && q >= n;
              return (
                <div key={d.id} className="py-3">
                  <div className="flex items-center gap-3 text-sm">
                    <FileText size={16} className="shrink-0 text-zinc-500" />
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium">{d.title}</div>
                      <div className="truncate text-xs text-zinc-500">
                        {d.owner_email} · {new Date(d.created_at).toLocaleString()} · {d.source} · {d.mime}
                        {d.mine && ' · yours'}
                      </div>
                    </div>
                    <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                      <Badge tone={d.visibility === 'private' ? 'zinc' : d.visibility === 'org' ? 'green' : 'indigo'}>
                        {d.visibility === 'private'
                          ? <><Lock size={11} /> private</>
                          : d.visibility === 'org'
                            ? <><Users size={11} /> org</>
                            : <><User size={11} /> roles: {(d.allowed_roles || []).join(', ') || 'none'}</>}
                      </Badge>
                      <Badge tone="zinc">{n} chunk{n === 1 ? '' : 's'}</Badge>
                      {q > 0 && <Badge tone={allQ ? 'red' : 'amber'}><ShieldAlert size={11} /> {q} quarantined</Badge>}
                      {canDelete(d) && (
                        <Button variant="ghost" onClick={() => del(d.id, d.title)} title="Delete document" className="!px-2.5 !py-1.5">
                          <Trash2 size={14} />
                        </Button>
                      )}
                    </div>
                  </div>
                  {q > 0 && (
                    <div className={`mt-2 flex gap-2 rounded-xl border p-2.5 text-xs ${
                      allQ ? 'border-red-500/30 bg-red-500/10 text-red-200' : 'border-amber-500/30 bg-amber-500/10 text-amber-200'
                    }`}>
                      <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                      <p>
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
      </Card>
    </div>
  );
}
