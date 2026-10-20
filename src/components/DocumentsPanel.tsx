'use client';
import { useEffect, useState } from 'react';
import { FileText, ChevronDown, Loader2, X, Database } from 'lucide-react';
import { api } from '@/lib/client/api';
import { loadDemoUploads, demoUploadAsDoc } from '@/lib/client/demo-uploads';

export type Doc = {
  id: string; title: string; source: string; mime: string; visibility: string;
  chunk_count: number; quarantined_chunks: number; created_at: string; mine: boolean;
  byte_size?: number | string | null;
  /** Demo uploads are not stored server-side; their preview text is local. */
  localPreview?: string;
};

export const PREVIEW_CHARS = 500;

/** Short uppercase badge label for a MIME type, e.g. "PDF", "DOCX", "TXT". */
export function mimeShort(mime: string): string {
  const m = (mime || '').toLowerCase().split(';')[0].trim();
  const known: Record<string, string> = {
    'application/pdf': 'PDF',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    'application/msword': 'DOC',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'XLSX',
    'application/vnd.ms-excel': 'XLS',
    'text/plain': 'TXT',
    'text/markdown': 'MD',
    'text/csv': 'CSV',
    'application/json': 'JSON',
    'text/html': 'HTML',
  };
  if (known[m]) return known[m];
  const sub = m.includes('/') ? m.split('/')[1] : m;
  const clean = sub.replace(/^(x-|vnd\.)/, '').replace(/[^a-z0-9+]/g, '').toUpperCase();
  return clean.slice(0, 6) || 'FILE';
}

/** Human-readable byte size, e.g. 204800 -> "200 KB". */
export function formatBytes(n: number | string | null | undefined): string {
  const b = Number(n) || 0;
  if (b < 1024) return `${b} B`;
  const units = ['KB', 'MB', 'GB'];
  let v = b / 1024;
  let u = 0;
  while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[u]}`;
}

export function formatDocDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
  } catch { return iso; }
}

/** First ~PREVIEW_CHARS chars of a chunk, with an ellipsis when truncated. */
export function previewText(content: string, max: number = PREVIEW_CHARS): string {
  const t = (content || '').trim();
  return t.length > max ? `${t.slice(0, max)}…` : t;
}

function MimeBadge({ mime }: { mime: string }) {
  return (
    <span className="inline-flex items-center rounded border border-[var(--border)] bg-[var(--surface-2)] px-1.5 py-px font-mono text-[10px] font-semibold uppercase tracking-wide text-[var(--muted)]">
      {mimeShort(mime)}
    </span>
  );
}

function DocRow({ doc }: { doc: Doc }) {
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const toggle = async () => {
    const next = !open;
    setOpen(next);
    if (next && preview === null && !loading) {
      // Demo uploads have no server-side chunks to fetch — preview locally.
      if (doc.localPreview !== undefined) {
        setPreview(previewText(doc.localPreview));
        return;
      }
      setLoading(true);
      setError('');
      try {
        const r = await api<{ chunks: { idx: number; content: string }[] }>(
          `/api/documents/chunks?documentId=${encodeURIComponent(doc.id)}`
        );
        const first = r.chunks?.[0]?.content ?? '';
        setPreview(previewText(first));
      } catch (e: any) {
        setError('Couldn\u2019t load the preview. Tap the title to try again.');
      } finally {
        setLoading(false);
      }
    }
  };

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)]">
      <button
        onClick={toggle} aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition hover:bg-white/[0.02] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373]"
      >
        <FileText size={16} className="shrink-0 text-[var(--muted)]" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="block truncate text-sm font-medium text-[var(--text)]" title={doc.title}>{doc.title}</span>
            <MimeBadge mime={doc.mime} />
          </span>
          <span className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-[var(--faint)]">
            <span>{formatBytes(doc.byte_size)}</span>
            <span>{doc.chunk_count} chunk{doc.chunk_count === 1 ? '' : 's'}</span>
            <span>{formatDocDate(doc.created_at)}</span>
            <span className="uppercase">{doc.source}</span>
            {doc.quarantined_chunks > 0 && <span className="text-[var(--amber)]">{doc.quarantined_chunks} quarantined</span>}
          </span>
        </span>
        <ChevronDown size={14} className={`shrink-0 text-[var(--faint)] transition-transform ${open ? 'rotate-180' : ''}`} aria-hidden />
      </button>
      {open && (
        <div className="border-t border-[var(--border)] px-4 py-3">
          {loading && (
            <div className="flex items-center gap-2 py-2 text-xs text-[var(--muted)]">
              <Loader2 size={13} className="animate-spin" /> Loading preview…
            </div>
          )}
          {error && <p className="py-2 text-xs text-[var(--red)]">{error}</p>}
          {preview !== null && !loading && !error && (
            <div>
              <span className="mb-1.5 block font-mono text-[10px] uppercase tracking-wide text-[var(--faint)]">
                Content preview · first {PREVIEW_CHARS} chars
              </span>
              {preview ? (
                <p className="rounded bg-[var(--bg)] p-2.5 text-xs leading-relaxed text-[var(--muted)]">{preview}</p>
              ) : (
                <p className="py-1 text-xs text-[var(--faint)]">This document has no readable text to preview.</p>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Presentational list — exported so it can be rendered in tests without
 * a browser or a live API. `docs === null` with no error = loading.
 */
export function DocumentsList({ docs, error }: { docs: Doc[] | null; error: string }) {
  if (docs === null && !error) {
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-[var(--muted)]">
        <Loader2 size={15} className="animate-spin" /> Loading documents…
      </div>
    );
  }
  if (error) {
    return <p className="py-10 text-center text-sm text-[var(--red)]">{error}</p>;
  }
  if (docs!.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 py-10 text-center">
        <FileText size={22} className="text-[var(--faint)]" aria-hidden />
        <p className="text-sm text-[var(--muted)]">No documents yet. Upload one to get started.</p>
      </div>
    );
  }
  return <div className="space-y-2">{docs!.map((d) => <DocRow key={d.id} doc={d} />)}</div>;
}

// Panel listing every document the current user can see, with expandable previews.
// Lets visitors verify exactly what the RAG searches over. Works in demo mode:
// the demo visitor holds a real session, so GET /api/documents just works.
export default function DocumentsPanel({ onClose }: { onClose: () => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const r = await api<{ documents: Doc[] }>('/api/documents');
        if (!cancelled) {
          // Merge session-stored demo uploads (not persisted server-side, so
          // GET only returns the seed documents).
          const serverIds = new Set(r.documents.map((d) => d.id));
          const stored: Doc[] = loadDemoUploads()
            .filter((u) => !serverIds.has(u.id))
            .map((u) => ({ ...demoUploadAsDoc(u, ''), localPreview: u.content }));
          setDocs([...r.documents, ...stored]);
        }
      } catch (e: any) {
        if (!cancelled) setError('Couldn\u2019t load your documents. Check your connection and try again.');
      }
    })();
    return () => { cancelled = true; };
  }, []);

  const totalChunks = docs?.reduce((s, d) => s + (d.chunk_count || 0), 0) ?? 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose} role="dialog" aria-modal="true" aria-label="Documents in your knowledge base">
      <div
        className="flex max-h-[85dvh] w-full max-w-2xl flex-col rounded-xl border border-[var(--border)] bg-[var(--bg)]"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-5 py-4">
          <Database size={16} className="text-[var(--muted)]" aria-hidden />
          <h2 className="text-sm font-semibold text-[var(--text)]">Knowledge base</h2>
          {docs && (
            <span className="pill">
              <span className="dot" aria-hidden />
              {docs.length} document{docs.length === 1 ? '' : 's'} · {totalChunks} chunks
            </span>
          )}
          <button
            onClick={onClose} aria-label="Close documents panel"
            className="ml-auto grid h-10 w-10 place-items-center rounded-md text-[var(--muted)] transition hover:bg-white/[0.06] hover:text-[var(--text)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#737373]"
          >
            <X size={16} />
          </button>
        </div>
        <div className="flex-1 space-y-2 overflow-y-auto p-4">
          <DocumentsList docs={docs} error={error} />
        </div>
        <p className="border-t border-[var(--border)] px-5 py-3 text-[11px] leading-relaxed text-[var(--faint)]">
          Answers are retrieved only from these documents — and only the parts your role may see.
        </p>
      </div>
    </div>
  );
}
