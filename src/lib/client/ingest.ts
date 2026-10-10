import { api } from './api';
import { embed } from './embed';
import { chunkText } from './chunk';
import type { Extracted } from './extract';

export type Access = { visibility: 'private' | 'org' | 'roles'; allowedRoles: string[] };

// Smart embed: DEFAULT is server-side NVIDIA NIM (via /api/embed).
// Falls back to in-browser embeddings when the server has no NVIDIA_API_KEY.
async function embedSmart(texts: string[], onProgress?: (p: number) => void): Promise<number[][]> {
  try {
    const r = await api<{ provider: string; vectors: number[][] }>('/api/embed', {
      body: { texts },
    });
    onProgress?.(100);
    return r.vectors;
  } catch {
    // Server embedding unavailable (no NVIDIA_API_KEY) — embed in browser
    return embed(texts);
  }
}

export async function ingest(meta: { title: string; source: string; mime: string } & Access, data: Extracted, onProgress?: (p: number) => void) {
  const pieces = data.rows
    ? data.rows.filter((r) => r.text.trim()).map((r) => ({ content: r.text.slice(0, 6000), subjectRef: r.subject }))
    : chunkText(data.text || '').map((c) => ({ content: c, subjectRef: null as string | null }));
  if (!pieces.length) throw new Error('No extractable text found');
  let documentId: string | undefined;
  let quarantined = 0;
  for (let i = 0; i < pieces.length; i += 32) {
    const batch = pieces.slice(i, i + 32);
    const embs = await embedSmart(batch.map((b) => b.content));
    const r = await api<{ documentId: string; quarantined: number }>('/api/documents', {
      body: { ...meta, documentId, chunks: batch.map((b, j) => ({ idx: i + j, content: b.content, subjectRef: b.subjectRef, embedding: embs[j] })) },
    });
    documentId = r.documentId;
    quarantined += r.quarantined;
    onProgress?.(Math.round(((i + batch.length) / pieces.length) * 100));
  }
  return { documentId, chunks: pieces.length, quarantined };
}
