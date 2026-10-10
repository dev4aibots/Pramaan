import { HttpError } from './http';

// Unified embedding interface. DEFAULT provider is NVIDIA NIM.
// - 'nvidia': server-side via NVIDIA NIM (nvidia/nv-embed-v2, 4096-d). Requires NVIDIA_API_KEY.
// - 'browser': in-browser via Transformers.js (bge-small-en-v1.5, 384-d). No key needed; documents never leave the device.
//
// The chunks table stores vector(384). NV-Embed-v2 is trained with Matryoshka
// Representation Learning, so its embeddings are explicitly designed to be
// truncated — we take the first 384 dimensions, which preserves ranking quality
// for retrieval while keeping one consistent index dimension.

export const NVIDIA_EMBED_MODEL = 'nvidia/nv-embed-v1';
export const NVIDIA_EMBED_URL = 'https://integrate.api.nvidia.com/v1/embeddings';
const TARGET_DIM = 384;

export type EmbedProvider = 'nvidia' | 'browser';

export function getEmbedProvider(): EmbedProvider {
  return process.env.NVIDIA_API_KEY ? 'nvidia' : 'browser';
}

export async function embedNvidia(texts: string[]): Promise<number[][]> {
  const key = process.env.NVIDIA_API_KEY;
  if (!key) throw new HttpError(400, 'NVIDIA embedding is not configured — set NVIDIA_API_KEY or add a key in Settings → Models');
  const ctrl = AbortSignal.timeout(55_000);
  const res = await fetch(NVIDIA_EMBED_URL, {
    method: 'POST',
    signal: ctrl,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${key}` },
    body: JSON.stringify({ model: NVIDIA_EMBED_MODEL, input: texts, encoding_format: 'float' }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `NVIDIA embedding error: ${j?.detail ?? j?.message ?? res.status}`);
  const data: any[] = j.data ?? [];
  if (!data.length) throw new HttpError(502, 'NVIDIA embedding returned no vectors');
  return data.map((d: any) => {
    const v: number[] = d.embedding ?? [];
    // Truncate MRL-trained 4096-d vector to the 384-d index dimension
    const t = v.slice(0, TARGET_DIM);
    // L2-normalize after truncation for correct cosine similarity
    const n = Math.sqrt(t.reduce((s, x) => s + x * x, 0)) || 1;
    return t.map((x) => Math.round((x / n) * 1e6) / 1e6);
  });
}

// Server-side embed: NVIDIA NIM by default, clear error when not configured
// (the client then falls back to browser embeddings).
export async function embedTexts(texts: string[]): Promise<{ provider: EmbedProvider; vectors: number[][] }> {
  const provider = getEmbedProvider();
  if (provider === 'nvidia') {
    return { provider, vectors: await embedNvidia(texts) };
  }
  throw new HttpError(400, 'Server embedding not configured — the app will embed in your browser instead');
}
