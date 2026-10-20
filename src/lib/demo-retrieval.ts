/**
 * Deterministic hybrid retrieval for demo mode (server-side only).
 *
 * Builds the demo chunk pool from the real corpus — the seed documents
 * (getDemoDocs()/getDemoDocChunks() in lib/demo.ts) plus any documents the
 * visitor uploaded this session (chunked ~600 chars, paragraph-aware,
 * mirroring lib/nvidia-rag.ts) — and scores every chunk against the query
 * with a hybrid of:
 *   - cosine similarity over the 384-d trigram hashEmbedding() space, and
 *   - a lexical score (content-token coverage + exact phrase hits).
 *
 * No external calls, no API keys, fully deterministic. Scores returned are
 * the real computed similarities — nothing is hardcoded.
 */
import { getDemoDocs, getDemoDocChunks, hashEmbedding } from './demo';

export type DemoChunk = {
  docId: string;
  title: string;
  idx: number;
  text: string;
};

export type ScoredPassage = DemoChunk & {
  /** Cosine similarity in hashEmbedding space (0..1). */
  cosine: number;
  /** Lexical score: content-token coverage + phrase bonus (0..1). */
  lexical: number;
  /** Hybrid score used for ranking, confidence and thresholds (0..1). */
  score: number;
};

export type DemoRetrieval = {
  passages: ScoredPassage[];
  poolSize: number;
  topScore: number;
};

/** Below this hybrid score the query is treated as having no coverage. */
export const DEMO_NO_MATCH_SCORE = 0.3;

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'of', 'to', 'in', 'on', 'for', 'with', 'by',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'what', 'when', 'where', 'who', 'whom', 'whose', 'why', 'how', 'which',
  'do', 'does', 'did', 'can', 'could', 'should', 'would', 'will',
  'tell', 'me', 'about', 'give', 'show', 'please', 'much', 'many',
  'there', 'their', 'they', 'them', 'from', 'into', 'per', 'at', 'as',
  'use', 'used', 'using', 'uses',
]);

export function tokenize(text: string): string[] {
  return text.toLowerCase().match(/[a-z0-9]+(?:[-'][a-z0-9]+)?/g) || [];
}

export function contentTokens(text: string): string[] {
  return tokenize(text).filter((t) => t.length > 1 && !STOPWORDS.has(t));
}

/** Light stem: strip common suffixes so leads/leading/led-ish forms meet. */
export function stem(tok: string): string {
  const irregular: Record<string, string> = { led: 'lead', leading: 'lead', leads: 'lead' };
  if (irregular[tok]) return irregular[tok];
  return tok
    .replace(/ies$/, 'y')
    .replace(/(ing|ed|es|s)$/, (m) => (tok.length - m.length >= 3 ? '' : m));
}

/** Two tokens match on equality, shared stem, or a >=3-char prefix relation. */
export function tokenMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (stem(a) === stem(b)) return true;
  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 3 && long.startsWith(short)) return true;
  // Shared-prefix relation (owner/owned, price/pricing): >=4 common leading chars.
  if (a.length >= 4 && b.length >= 4) {
    let lcp = 0;
    while (lcp < Math.min(a.length, b.length) && a[lcp] === b[lcp]) lcp++;
    if (lcp >= 4) return true;
  }
  return false;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
}

function hashStr(s: string): string {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Paragraph-aware ~600-char chunking, mirroring lib/nvidia-rag.ts chunkUpload. */
export function chunkUploadText(content: string, size = 600): string[] {
  const out: string[] = [];
  const paras = content.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
  let buf = '';
  const flush = () => {
    if (buf.trim()) out.push(buf.trim());
    buf = '';
  };
  for (const p of paras) {
    if ((buf + '\n\n' + p).length > size && buf) flush();
    buf = buf ? buf + '\n\n' + p : p;
  }
  flush();
  // A single oversized paragraph still gets split so no chunk dwarfs the rest.
  const split: string[] = [];
  for (const c of out.length ? out : [content.slice(0, size)]) {
    if (c.length <= size * 1.5) { split.push(c); continue; }
    let rest = c;
    while (rest.length > size) {
      let cut = rest.lastIndexOf('. ', size);
      if (cut < size * 0.4) cut = rest.lastIndexOf(' ', size);
      if (cut < size * 0.4) cut = size;
      split.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) split.push(rest);
  }
  return split.filter(Boolean);
}

/** The full demo pool: every seed chunk + chunks of every uploaded doc. */
export function buildDemoPool(uploadedDocs?: { title?: string; content?: string }[]): DemoChunk[] {
  const pool: DemoChunk[] = [];
  for (const doc of getDemoDocs()) {
    const chunks = getDemoDocChunks(doc.id) || [];
    for (const c of chunks) {
      pool.push({ docId: doc.id, title: doc.title, idx: c.idx, text: c.content });
    }
  }
  for (const doc of uploadedDocs || []) {
    const content = (doc.content || '').trim();
    if (content.length <= 20) continue;
    const capped = content.slice(0, 6000);
    const docId = `demo-upload:${hashStr((doc.title || 'Uploaded document') + '|' + capped.slice(0, 400))}`;
    chunkUploadText(capped).forEach((text, i) => {
      pool.push({ docId, title: doc.title || 'Uploaded document', idx: i, text });
    });
  }
  return pool;
}

/**
 * Lexical score: IDF-weighted fraction of query content tokens present,
 * plus an exact-phrase bonus. Tokens that appear in many chunks (product
 * names repeated everywhere) weigh less than rare, discriminative ones
 * (cost, profit, a launch code) — otherwise every chunk "matches" equally.
 * df/poolSize are optional; without them all tokens weigh by base weight.
 */
export function lexicalScore(
  query: string,
  text: string,
  df?: Map<string, number>,
  poolSize?: number,
): number {
  const qTokens = [...new Set(contentTokens(query))];
  if (!qTokens.length) return 0;
  const textTokens = tokenize(text);
  const textSet = new Set(textTokens);
  const weightOf = (qt: string) => {
    const base = /[0-9-]/.test(qt) ? 2 : 1;
    if (!df || !poolSize) return base;
    const d = df.get(stem(qt)) || 0;
    return base * (1 + Math.log((poolSize + 1) / (d + 1)));
  };
  let hits = 0;
  for (const qt of qTokens) {
    if (textSet.has(qt) || textTokens.some((tt) => tokenMatch(qt, tt))) hits += weightOf(qt);
  }
  const totalWeight = qTokens.reduce((s, t) => s + weightOf(t), 0);
  let score = hits / totalWeight;
  // Exact-phrase bonus: any query bigram appearing verbatim in the chunk.
  const qWords = tokenize(query);
  const lower = text.toLowerCase();
  let phraseHits = 0;
  for (let i = 0; i + 1 < qWords.length; i++) {
    if (lower.includes(`${qWords[i]} ${qWords[i + 1]}`)) phraseHits++;
  }
  if (phraseHits) score = Math.min(1, score + 0.08 * phraseHits);
  return score;
}

/**
 * Score the whole pool and return the top passages: at most 6 chunks,
 * at most 3 per document, spanning at most 3 distinct documents (so
 * combination questions can fuse sources). Returns null when the best
 * hybrid score is below the no-match threshold.
 */
export function retrieveDemo(
  query: string,
  uploadedDocs?: { title?: string; content?: string }[],
): DemoRetrieval | null {
  const pool = buildDemoPool(uploadedDocs);
  if (!pool.length) return null;
  // Document frequency over stemmed chunk tokens, for IDF weighting.
  const df = new Map<string, number>();
  for (const c of pool) {
    const stems = new Set(tokenize(c.text).map(stem));
    stems.forEach((s) => df.set(s, (df.get(s) || 0) + 1));
  }
  const qvec = hashEmbedding(query);
  const scored: ScoredPassage[] = pool
    .map((c) => {
      const cosine = cosineSim(qvec, hashEmbedding(c.text));
      const lexical = lexicalScore(query, c.text, df, pool.length);
      const score = Math.round((0.5 * cosine + 0.5 * lexical) * 1000) / 1000;
      return { ...c, cosine, lexical, score };
    })
    .sort((a, b) => b.score - a.score || a.idx - b.idx);

  if (!scored.length || scored[0].score < DEMO_NO_MATCH_SCORE) return null;

  // Secondary passages (needed for combination questions) may score well
  // below the top hit — include them down to a modest absolute/relative floor.
  const includeFloor = Math.max(0.18, scored[0].score * 0.4);
  const picked: ScoredPassage[] = [];
  const perDoc = new Map<string, number>();
  const docs = new Set<string>();
  for (const s of scored) {
    if (picked.length >= 6) break;
    if (s.score < includeFloor) break;
    const n = perDoc.get(s.docId) || 0;
    if (n >= 3) continue;
    if (!docs.has(s.docId) && docs.size >= 3) continue;
    picked.push(s);
    perDoc.set(s.docId, n + 1);
    docs.add(s.docId);
  }
  if (!picked.length) return null;
  return { passages: picked, poolSize: pool.length, topScore: picked[0].score };
}
