/**
 * Shared upload file-type policy — single source of truth for client
 * (extract.ts) and server (api/documents POST safety net).
 *
 * Pure module: no browser or Node APIs, safe to import anywhere.
 *
 * Policy:
 *   ALLOW  .txt .pdf .doc .docx .md .csv .html .htm .xls .xlsx
 *   REJECT video/*, audio/*  → media error (exact wording required by the demo bar)
 *   REJECT everything else   → error listing the supported types
 *
 * Note: .doc (legacy binary Word) is listed in the policy but cannot be parsed
 * in the browser (mammoth is DOCX-only, no native deps allowed), so it is
 * rejected with a clear re-save-as-.docx message rather than a generic error.
 */

export const SUPPORTED_TYPES_LABEL = 'TXT, PDF, DOC, DOCX, MD, CSV, HTML, HTM, XLS, XLSX';

/** Extensions the policy allows through the upload pipeline. */
export const ALLOWED_EXTS = new Set([
  'txt', 'pdf', 'docx', 'md', 'csv', 'html', 'htm', 'xls', 'xlsx',
]);

const VIDEO_EXTS = new Set([
  'mp4', 'mov', 'avi', 'mkv', 'webm', 'm4v', '3gp', 'flv', 'wmv', 'mpg', 'mpeg', 'm2ts', 'ts',
]);
const AUDIO_EXTS = new Set([
  'mp3', 'wav', 'ogg', 'oga', 'flac', 'm4a', 'aac', 'wma', 'opus', 'aiff', 'aif', 'mid', 'midi',
]);
const IMAGE_EXTS = new Set([
  'png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff', 'ico', 'heic', 'heif', 'avif',
]);

/** Exact media-rejection message required by the demo bar. */
export const MEDIA_ERROR =
  'Video and audio files are not supported. Please upload a document (TXT, PDF, DOCX, MD, CSV, HTML).';

export const unsupportedError = (name?: string) =>
  `Unsupported file type${name ? ` ("${name}")` : ''}. Please upload a document (${SUPPORTED_TYPES_LABEL}).`;

export const IMAGE_ERROR =
  `Images/OCR are not supported yet — export text, or a PDF with a text layer. Supported types: ${SUPPORTED_TYPES_LABEL}.`;

export const LEGACY_DOC_ERROR =
  `Legacy .doc files cannot be parsed — please re-save the file as .docx and upload again. Supported types: ${SUPPORTED_TYPES_LABEL}.`;

export type RejectKind = 'media' | 'image' | 'legacy-doc' | 'unsupported';

/**
 * Verdict shape (flat, not a discriminated union — the project compiles with
 * strict:false, under which TS does not narrow boolean-literal unions).
 */
export type PolicyVerdict = { ok: boolean; kind: RejectKind | null; error: string | null };

/** Lower-cased extension without the dot; '' when there is none. */
export function extOf(name: string): string {
  const base = (name || '').split(/[\\/]/).pop() || '';
  const i = base.lastIndexOf('.');
  return i > 0 ? base.slice(i + 1).toLowerCase() : '';
}

function normMime(mime: string): string {
  return (mime || '').toLowerCase().split(';')[0].trim();
}

export function classifyUpload(name: string, mime: string): PolicyVerdict {
  const ext = extOf(name);
  const mt = normMime(mime);

  if (mt.startsWith('video/') || mt.startsWith('audio/') || VIDEO_EXTS.has(ext) || AUDIO_EXTS.has(ext)) {
    return { ok: false, kind: 'media', error: MEDIA_ERROR };
  }
  if (ext === 'doc') {
    return { ok: false, kind: 'legacy-doc', error: LEGACY_DOC_ERROR };
  }
  if (mt.startsWith('image/') || IMAGE_EXTS.has(ext)) {
    return { ok: false, kind: 'image', error: IMAGE_ERROR };
  }
  if (ALLOWED_EXTS.has(ext)) return { ok: true, kind: null, error: null };
  // Extensionless pastes with a text MIME are plain text (txt/md family).
  if (!ext && mt.startsWith('text/')) return { ok: true, kind: null, error: null };
  return { ok: false, kind: 'unsupported', error: unsupportedError(name) };
}

/**
 * Binary-content safety net for the server path: chunks arrive as text only,
 * so a NUL byte means someone smuggled binary data past the client extractor.
 */
export function containsBinary(s: string): boolean {
  return s.includes('\u0000');
}

/**
 * Server-side safety net used by POST /api/documents. Returns the 400 error
 * message, or null when the upload meta is acceptable.
 * Note: chunks arrive as text only — this validates the claimed title/mime
 * plus a binary-content scan; it cannot re-parse the original file bytes.
 */
export function uploadGuardError(title: string, mime: string, chunks: string[]): string | null {
  const v = classifyUpload(title, mime);
  if (!v.ok) return v.error ?? 'Unsupported file type.';
  for (const c of chunks) {
    if (containsBinary(c)) {
      return 'Document content appears to be binary data, not text. Please upload a supported document.';
    }
  }
  return null;
}
