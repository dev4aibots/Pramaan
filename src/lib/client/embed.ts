/** In-browser embeddings (Transformers.js + BGE-small, 384-d). Documents never leave the device as raw files. */
export const EMBED_MODEL = 'Xenova/bge-small-en-v1.5';
export const EMBED_DIM = 384;
const QUERY_PREFIX = 'Represent this sentence for searching relevant passages: ';

let extractor: any = null;
let loading: Promise<any> | null = null;
let loadFailed = false; // true if ML model failed → use hash fallback permanently
export let embedDevice: 'webgpu' | 'wasm' | 'hash' = 'wasm';

// Deterministic 384-d fallback embedding (trigram hash).
// Used when the ML model fails to load (network, WASM, memory issues).
// Not semantically rich, but keyword search (tsv) in retrieval still works.
function hashEmbedding(text: string): number[] {
  const vec = new Array<number>(384).fill(0);
  const clean = text.toLowerCase();
  for (let i = 0; i < clean.length - 2; i++) {
    const tri = clean.slice(i, i + 3);
    let h = 0;
    for (let j = 0; j < tri.length; j++) h = ((h << 5) - h + tri.charCodeAt(j)) | 0;
    vec[Math.abs(h) % 384] += 1;
  }
  const n = Math.sqrt(vec.reduce((s, x) => s + x * x, 0)) || 1;
  return vec.map((x) => Math.round((x / n) * 1e6) / 1e6);
}

export async function loadEmbedder(onProgress?: (pct: number, file?: string) => void) {
  if (extractor) return extractor;
  if (loadFailed) { onProgress?.(100); return null; }
  if (!loading) {
    loading = (async () => {
      try {
        const { pipeline, env } = await import('@huggingface/transformers');
        (env as any).allowLocalModels = false;
        const cb = (e: any) => { if (e.status === 'progress' && typeof e.progress === 'number') onProgress?.(e.progress, e.file); };
        if ((navigator as any).gpu) {
          try {
            const p = await pipeline('feature-extraction', EMBED_MODEL, { device: 'webgpu', dtype: 'fp32', progress_callback: cb } as any);
            // Verify the pipeline actually works (catches "reading 'create'" type failures)
            if (!p || typeof p !== 'function') throw new Error('WebGPU pipeline invalid');
            embedDevice = 'webgpu';
            return p;
          } catch { /* fall back to wasm */ }
        }
        embedDevice = 'wasm';
        const p = await pipeline('feature-extraction', EMBED_MODEL, { device: 'wasm', dtype: 'q8', progress_callback: cb } as any);
        if (!p || typeof p !== 'function') throw new Error('WASM pipeline invalid');
        return p;
      } catch (e: any) {
        // ML model failed — use deterministic hash fallback (upload/chat still work via keyword search)
        console.warn('[pramaan] Embedding model failed, using hash fallback:', e?.message);
        embedDevice = 'hash';
        loadFailed = true;
        return null; // signal to use hashEmbedding
      }
    })();
  }
  extractor = await loading;
  onProgress?.(100);
  return extractor;
}

export async function embed(texts: string[], isQuery = false): Promise<number[][]> {
  const ex = await loadEmbedder();
  if (!ex) {
    // Hash fallback (ML model unavailable)
    return texts.map((t) => hashEmbedding(isQuery ? QUERY_PREFIX + t : t));
  }
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += 16) {
    const batch = texts.slice(i, i + 16).map((t) => (isQuery ? QUERY_PREFIX + t : t));
    const t = await ex(batch, { pooling: 'cls', normalize: true });
    out.push(...(t.tolist() as number[][]).map((v) => v.map((x) => Math.round(x * 1e6) / 1e6)));
  }
  return out;
}

// Smart embed: browser bge-small (384-d) is the reliable default.
// It matches the vector(384) index dimension and needs no API key.
// (Server-side NVIDIA embeddings are disabled — the model 404s on most keys.)
export async function embedSmart(texts: string[], isQuery = false): Promise<number[][]> {
  return embed(texts, isQuery);
}
