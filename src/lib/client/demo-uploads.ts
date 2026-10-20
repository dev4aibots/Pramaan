'use client';

/**
 * Session-scoped store for demo-mode uploads.
 *
 * By design, demo uploads are NOT persisted server-side: POST /api/documents
 * returns a synthetic `demo-upload-*` id without touching the DB, and
 * GET /api/documents serves only the 6 seed documents (see
 * src/app/api/documents/route.ts and src/lib/demo.ts). Demo chat answers from
 * the `uploadedDocs` field the client sends with each /api/chat request.
 *
 * Previously the only copy of an uploaded file's text lived in Chat's
 * useState. Chat unmounts whenever the visitor switches tabs (Ask →
 * Knowledge → Ask) and is destroyed by any page reload, so the upload was
 * silently lost: later questions fell back to the seed documents even though
 * the UI had confirmed the file was "successfully uploaded and indexed", and
 * the Knowledge list (GET-based) never showed the file at all.
 *
 * Keeping uploads in sessionStorage (per browser session, matching the demo
 * banner's "uploads reset periodically") lets them survive tab switches and
 * reloads, and lets Knowledge / the documents panel list them alongside the
 * seed documents.
 */

export type DemoUpload = {
  /** Stable synthetic document id (`demo-upload-<hash>`), same shape the API returns. */
  id: string;
  title: string;
  mime: string;
  content: string;
  chunks: number;
  uploadedAt: string;
};

const KEY = 'pramaan-demo-uploads';
const MAX_CONTENT = 5000; // mirrors the cap Chat always applied to uploadedDocs

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export function loadDemoUploads(): DemoUpload[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.sessionStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (u): u is DemoUpload =>
        !!u && typeof u.title === 'string' && typeof u.content === 'string' && typeof u.id === 'string',
    );
  } catch {
    return [];
  }
}

function save(list: DemoUpload[]) {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(list));
  } catch {
    // Storage full / blocked (private mode): uploads stay usable in-memory
    // for the current Chat session, they just won't survive navigation.
  }
}

/** Add (or replace, by title) an upload and return the full stored list. */
export function addDemoUpload(u: { title: string; mime?: string; content: string; chunks: number }): DemoUpload[] {
  const entry: DemoUpload = {
    id: `demo-upload-${hashStr(u.title)}`,
    title: u.title,
    mime: u.mime || 'text/plain',
    content: u.content.slice(0, MAX_CONTENT),
    chunks: u.chunks,
    uploadedAt: new Date().toISOString(),
  };
  const list = [...loadDemoUploads().filter((x) => x.title !== u.title), entry];
  save(list);
  return list;
}

export function removeDemoUpload(id: string): DemoUpload[] {
  const list = loadDemoUploads().filter((x) => x.id !== id);
  save(list);
  return list;
}

/** Shape a stored upload like a row from GET /api/documents. */
export function demoUploadAsDoc(u: DemoUpload, ownerEmail: string) {
  return {
    id: u.id,
    title: u.title,
    source: 'upload',
    mime: u.mime,
    visibility: 'private',
    allowed_roles: [] as string[],
    chunk_count: u.chunks,
    quarantined_chunks: 0,
    created_at: u.uploadedAt,
    mine: true,
    owner_email: ownerEmail,
    byte_size: u.content.length,
  };
}
