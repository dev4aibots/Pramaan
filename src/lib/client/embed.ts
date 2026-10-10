/** In-browser embeddings (Transformers.js + BGE-small, 384-d). Documents never leave the device as raw files. */
export const EMBED_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBED_DIM = 384;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let extractor: any = null;
let loading: Promise<any> | null = null;
export let embedDevice: 'webgpu' | 'wasm' = 'wasm';

export async function loadEmbedder(onProgress?: (pct: number, file?: string) => void) {
  if (extractor) return extractor;
  if (!loading) {
    loading = (async () => {
      const { pipeline, env } = await import('@huggingface/transformers');
      (env as any).allowLocalModels = false;
      const cb = (e: any) => { if (e.status === 'progress' && typeof e.progress === 'number') onProgress?.(e.progress, e.file); };
      if ((navigator as any).gpu) {
        try {
          const p = await pipeline('feature-extraction', EMBED_MODEL, { device: 'webgpu', dtype: 'fp32', progress_callback: cb } as any);
          embedDevice = 'webgpu';
          return p;
        } catch { /* fall back to wasm */ }
      }
      embedDevice = 'wasm';
      return pipeline('feature-extraction', EMBED_MODEL, { device: 'wasm', dtype: 'q8', progress_callback: cb } as any);
    })();
  }
  extractor = await loading;
  onProgress?.(100);
  return extractor;
}

export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  const ex = await loadEmbedder();
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map((t) => (isQuery ? QUERY_PREFIX + t : t));
    const t = await ex(batch, { pooling: 'cls', normalize: true });
    out.push(...(t.tolist() as number[][]).map((v) => v.map((x) => Math.round(x * 1e6) / 1e6)));
  }
  return out;
}

// Smart embed: DEFAULT is server-side NVIDIA NIM (via /api/embed).
// Falls back to in-browser bge-small when the server has no NVIDIA_API_KEY.
// CRITICAL: query and document embeddings MUST use the same provider,
// otherwise vector search compares incompatible embedding spaces.
export async function embedSmart(texts: string[], isQuery = false): Promise<number[][]> {
  try {
    const { api } = await import('./api');
    const r = await api<{ provider: string; vectors: number[][] }>('/api/embed', {
      body: { texts },
    });
    return r.vectors;
  } catch {
    return embed(texts, isQuery);
  }
}
