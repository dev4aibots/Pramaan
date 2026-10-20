/**
 * Deterministic natural-language composer for demo mode.
 *
 * Takes the query + top retrieved passages (lib/demo-retrieval.ts) and
 * composes a fluent, question-shaped answer from the facts in those
 * passages — never from anywhere else. Every content claim traces to a
 * selected source sentence; proper nouns, names, numbers, dates and
 * short fact spans stay exact, while the sentence FRAME is rebuilt:
 * lead-ins, passive->active flips, possessive<->of transforms, clause
 * trimming/reordering, conjunct swaps and a synonym/glue map.
 *
 * ECHO GUARD (hard AND gate): an answer is returned ONLY when its word-
 * level longest common run against EVERY source passage is <= 8 words
 * AND the run/answer ratio is <= 0.5. If the frame transforms cannot get
 * a copied sentence under both thresholds, the composer falls back to
 * assembling the answer from extracted fact slots (template frames), and
 * if that still fails it returns null — a copied frame is never emitted.
 *
 * Returns null when no sentence in the passages is relevant enough —
 * the caller then serves the honest no-coverage answer.
 */
import { anchorTokensOf, contentTokens, stem, tokenMatch, tokenize } from './demo-retrieval';

export type ComposePassage = {
  docId: string;
  title: string;
  idx: number;
  text: string;
  score: number;
};

export type ComposedSource = {
  sid: string;
  title: string;
  text: string;
  documentId: string;
  score: number;
};

export type EchoMetric = { maxRun: number; ratio: number };

export type ComposedAnswer = {
  answer: string;
  sources: ComposedSource[];
  echo: EchoMetric;
  passagesUsed: number;
};

// ---------------------------------------------------------------------------
// text utilities
// ---------------------------------------------------------------------------

const ABBREV = /\b(Rs|Dr|Mr|Mrs|Ms|St|Pvt|Ltd|Inc|No|vs|e\.g|i\.e|U\.S)$/;

export function splitSentences(text: string): string[] {
  const flat = text.replace(/\s*\n+\s*/g, ' ').replace(/\s+/g, ' ').trim();
  if (!flat) return [];
  const raw = flat.split(/(?<=[.!?])\s+(?=[A-Z0-9"“'(])/);
  const out: string[] = [];
  for (const part of raw) {
    const prev = out[out.length - 1];
    if (prev && (ABBREV.test(prev.replace(/[.!?]$/, '')) || /(^|\s)[A-Z]$/.test(prev.replace(/[.!?]$/, '')))) {
      out[out.length - 1] = `${prev} ${part}`;
    } else {
      out.push(part);
    }
  }
  return out.map((s) => s.trim()).filter((s) => s.length > 2);
}

function words(text: string): string[] {
  return text.toLowerCase().replace(/[^\p{L}\p{N}\s'-]/gu, ' ').split(/\s+/).filter(Boolean);
}

/** Longest common contiguous word run between two texts (word-level LCS). */
export function longestCommonRun(a: string, b: string): number {
  const aw = words(a);
  const bw = words(b);
  if (!aw.length || !bw.length) return 0;
  let best = 0;
  const prev = new Array(bw.length + 1).fill(0);
  const cur = new Array(bw.length + 1).fill(0);
  for (let i = 1; i <= aw.length; i++) {
    for (let j = 1; j <= bw.length; j++) {
      cur[j] = aw[i - 1] === bw[j - 1] ? prev[j - 1] + 1 : 0;
      if (cur[j] > best) best = cur[j];
    }
    for (let j = 0; j < cur.length; j++) prev[j] = cur[j];
    cur.fill(0);
  }
  return best;
}

export function echoMetric(answer: string, passages: ComposePassage[]): EchoMetric {
  const clean = answer.replace(/\[S\d+\]/g, ' ');
  const aw = words(clean).length || 1;
  let maxRun = 0;
  for (const p of passages) maxRun = Math.max(maxRun, longestCommonRun(clean, p.text));
  return { maxRun, ratio: Math.round((maxRun / aw) * 1000) / 1000 };
}

// ---------------------------------------------------------------------------
// query analysis
// ---------------------------------------------------------------------------

type QType = 'who' | 'when' | 'where' | 'howmuch' | 'what' | 'why' | 'list' | 'summarise' | 'general' | 'yesno';

type QueryInfo = {
  type: QType;
  multi: boolean;
  tokens: string[];
  entity: string | null;
  roleNoun: string | null;
  verbCue: string | null;
  objectPhrase: string | null;
  /** Distinctive entity-anchor tokens (ZEBRA-9 style), if any. */
  anchors: string[];
  /** Time reference named in the query ("Q3 2026"), if any. */
  period: string | null;
};

const ROLE_NOUNS = ['owner', 'lead', 'leader', 'manager', 'head', 'ceo', 'cfo', 'founder', 'director', 'author', 'officer'];
const VERB_CUES: Record<string, string> = {
  leads: 'leads', lead: 'leads', owns: 'owns', own: 'owns', heads: 'heads', head: 'heads',
  manages: 'manages', manage: 'manages', runs: 'runs', run: 'runs', directs: 'directs',
};

function extractEntity(query: string): string | null {
  const cleaned = query.replace(/^(what|who|when|where|why|how|did|does|do|is|are|was|were|has|have|had|can|could|will|would|tell me about|describe|give me|list)\b[^A-Za-z0-9]*/i, '');
  const matches = cleaned.match(/[A-Z][A-Za-z0-9_-]*(?:\s+(?:[A-Z][A-Za-z0-9_-]*|of|the|Pro|v\d+(?:\.\d+)?))*/g) || [];
  const scored = matches
    .map((m) => m.trim())
    // Time references (Q3, 2026, month names) are never the entity.
    .filter((m) => m.length > 1 && !/^(The|A|An|In|On|For)$/.test(m) && !/^(Q[1-4]|\d{4}|January|February|March|April|May|June|July|August|September|October|November|December)$/i.test(m))
    .sort((a, b) => (/[0-9]/.test(b) ? 1 : 0) - (/[0-9]/.test(a) ? 1 : 0) || b.length - a.length);
  return scored[0] || null;
}

export function analyzeQuery(query: string): QueryInfo {
  const q = query.trim();
  const ql = q.toLowerCase();
  const tokens = [...new Set(contentTokens(q))];
  let type: QType = 'general';
  if (/^(tell me about|describe|explain|summar|overview|give me an overview)/i.test(q) || /\babout\b.*\?$/.test(ql) && /^tell/i.test(q)) type = 'summarise';
  else if (/^who\b/i.test(q)) type = 'who';
  else if (/^when\b/i.test(q)) type = 'when';
  else if (/^where\b/i.test(q)) type = 'where';
  else if (/^how (much|many)\b/i.test(q)) type = 'howmuch';
  else if (/^why\b/i.test(q)) type = 'why';
  else if (/^(list|name all|what are all)\b/i.test(q)) type = 'list';
  else if (/^what\b/i.test(q)) type = 'what';
  if (/\b(pricing|price|cost|plans?)\b/i.test(ql) && /\b(how much|what|list|pricing)\b/i.test(ql)) type = type === 'who' || type === 'when' ? type : 'howmuch';
  if (/tell me about/i.test(ql)) type = 'summarise';
  // Yes/no questions (Did/Does/Is/Are/Was/Were/Has/Can …?) get a verdict
  // composed from the sentence bearing the queried predicate.
  if (/^(did|does|do|is|are|was|were|has|have|had|can|could|will|would)\b/i.test(q) && type !== 'summarise') type = 'yesno';

  const periodMatch = q.match(/\bQ[1-4]\s+\d{4}\b/i) || q.match(/\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/i);
  const period = periodMatch ? periodMatch[0].replace(/\s+/, ' ') : null;

  const role = ROLE_NOUNS.find((r) => new RegExp(`\\b${r}\\b`, 'i').test(ql)) || null;
  const verbKey = Object.keys(VERB_CUES).find((v) => new RegExp(`\\b${v}\\b`, 'i').test(ql)) || null;
  const verbCue = verbKey ? VERB_CUES[verbKey] : null;

  let objectPhrase: string | null = null;
  const om = q.match(/\b(?:of|for)\s+(.+?)[?.!]*$/i);
  if (om && (role || type === 'who')) objectPhrase = om[1].trim();
  if (!objectPhrase && verbCue) {
    const vm = q.match(new RegExp(`\\b${verbKey}\\s+(?:the\\s+)?(.+?)[?.!]*$`, 'i'));
    if (vm) objectPhrase = vm[1].trim();
  }
  if (objectPhrase) {
    // In multi-part questions keep only the first conjunct's object.
    objectPhrase = objectPhrase.split(/\s*,\s*(?:and\s+)?|\s+and\s+/)[0].trim();
    if (objectPhrase.length > 48) objectPhrase = null;
  }

  const whCount = (ql.match(/\b(who|what|when|where|how much|how many)\b/g) || []).length;
  const multi = /\band\b/i.test(ql) && (whCount >= 2 || (whCount >= 1 && /\b(code|price|cost|date|deadline)\b/i.test(ql)));

  return { type, multi, tokens, entity: extractEntity(q), roleNoun: role, verbCue, objectPhrase, anchors: anchorTokensOf(q), period };
}

// ---------------------------------------------------------------------------
// sentence scoring & selection
// ---------------------------------------------------------------------------

const NOT_PEOPLE = new Set([
  'cloudsync pro', 'novatech solutions', 'product launch', 'launch plan', 'team plan',
  'starter plan', 'pro plan', 'q3 2026', 'customer support', 'employee handbook',
]);

export function extractPerson(text: string): string | null {
  const re = /([A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2})/g;
  let best: { name: string; score: number } | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    const name = m[1];
    const lower = name.toLowerCase();
    if (NOT_PEOPLE.has(lower)) continue;
    if (/^(January|February|March|April|May|June|July|August|September|October|November|December)\b/.test(name)) continue;
    if (/\b(Plan|Report|Study|Manual|Handbook|Policy|Pro|Solutions|Launch|Team|Support)\b/.test(name) && !/^[A-Z][a-z]+\s[A-Z][a-z]+$/.test(name)) continue;
    const before = text.slice(Math.max(0, m.index - 24), m.index).toLowerCase();
    const after = text.slice(m.index + name.length, m.index + name.length + 30).toLowerCase();
    let score = 0;
    if (/\bby\s+(?:[a-z]+\s+){0,2}$/.test(before)) score += 2;
    if (/\b(ceo|cfo|dr\.?|mr\.?|ms\.?|manager|lead|head|director|officer)\s*$/.test(before)) score += 2;
    if (/^\s+(credited|leads|owns|heads|manages|is|was|will|projects|received)/.test(after)) score += 1;
    if (score > 0 && (!best || score > best.score)) best = { name, score };
  }
  return best?.name || null;
}

const DATE_RE = /\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s+\d{4}\b/;
const MONEY_RE = /(\$|Rs\.?|USD|€|£)\s?[\d][\d,.]*\s?(M|K|million|billion|lakh|crore)?\b|\b\d+(?:\.\d+)?\s?(days|hours|weeks|months|%|percent|GB|TB)\b/;
/** Price-ish facts only (a duration like "4 hours" is not a price). */
const PRICE_RE = /(\$|Rs\.?|USD|€|£)\s?[\d]|\b\d+(?:\.\d+)?\s?(days|GB|TB|%|percent)\b|\bfree\b/i;

type SentenceCand = {
  text: string;
  passage: ComposePassage;
  passageRank: number;
  sentIdx: number;
  coverage: number;
  covered: Set<string>;
  coveredWeight: number;
  score: number;
  /** Query tokens this sentence covers that are DISCRIMINATIVE (upper-half IDF weight, present in the candidate set). */
  discCovered: Set<string>;
  discWeight: number;
  /** The discriminative token set for the query (shared reference). */
  discTokens: Set<string>;
};

function sentenceCandidates(passages: ComposePassage[], info: QueryInfo): SentenceCand[] {
  // First pass: collect every sentence so token weights can use sentence-level
  // IDF — product names repeated in every chunk must not swamp the one
  // discriminative token (cost, profit, code) the question actually hinges on.
  const raw: { text: string; passage: ComposePassage; passageRank: number; sentIdx: number; toks: string[] }[] = [];
  passages.forEach((p, passageRank) => {
    splitSentences(p.text).forEach((text, sentIdx) => {
      raw.push({ text, passage: p, passageRank, sentIdx, toks: tokenize(text) });
    });
  });
  const df = new Map<string, number>();
  for (const r of raw) {
    const stems = new Set(r.toks.map(stem));
    stems.forEach((s) => df.set(s, (df.get(s) || 0) + 1));
  }
  const qWeights = new Map<string, number>();
  for (const t of info.tokens) {
    const base = /[0-9-]/.test(t) ? 2 : 1;
    const d = df.get(stem(t)) || 0;
    qWeights.set(t, base * (1 + Math.log((raw.length + 1) / (d + 1))));
  }
  const totalWeight = [...qWeights.values()].reduce((s, x) => s + x, 0) || 1;
  // Discriminative tokens: query tokens that actually occur in the
  // candidate sentences (tokenMatch-level DF >= 1) and sit in the upper
  // half of query-token weights. Selection discipline is enforced on
  // these — generic tokens (the company name, "year") that appear in
  // half the corpus can never justify adding another sentence.
  const matchDf = new Map<string, number>();
  for (const t of info.tokens) {
    let n = 0;
    for (const r of raw) if (r.toks.some((tt) => tokenMatch(t, tt))) n++;
    matchDf.set(t, n);
  }
  const present = info.tokens.filter((t) => (matchDf.get(t) || 0) > 0);
  // Pure-IDF weights for the discriminative set (no digit base bonus —
  // otherwise time tokens like Q3/2026 swamp the actual predicate noun).
  // Entity-name tokens are anchoring context, never discriminative: the
  // company name appears across the corpus and must not justify pulling
  // in an off-target sentence that merely mentions it.
  const entityToks = new Set(info.entity ? tokenize(info.entity) : []);
  const facet = present.filter((t) => !entityToks.has(t));
  const idfW = new Map(facet.map((t) => [t, 1 + Math.log((raw.length + 1) / ((matchDf.get(t) || 0) + 1))]));
  const sortedIdf = [...idfW.values()].sort((a, b) => b - a);
  const discThreshold = sortedIdf.length ? sortedIdf[Math.ceil(sortedIdf.length / 2) - 1] : 0;
  const discTokens = new Set(facet.filter((t) => (idfW.get(t) || 0) >= discThreshold));
  const cands: SentenceCand[] = [];
  for (const r of raw) {
    const covered = new Set<string>();
    let w = 0;
    for (const [qt, qw] of qWeights) {
      if (r.toks.some((tt) => tokenMatch(qt, tt))) { covered.add(qt); w += qw; }
    }
    const coverage = w / totalWeight;
    let score = coverage;
    if (info.type === 'who' && extractPerson(r.text)) score += 0.22;
    if (info.type === 'when' && DATE_RE.test(r.text)) score += 0.22;
    if (info.type === 'howmuch' && PRICE_RE.test(r.text)) score += 0.22;
    // Summary questions: sentences of the top passage share its context
    // (pronouns like "the project" resolve there), so they stay usable.
    if (info.type === 'summarise' && r.passageRank === 0) score += 0.25;
    if (info.entity && r.text.toLowerCase().includes(info.entity.toLowerCase().split(' ')[0])) score += 0.05;
    const discCovered = new Set([...covered].filter((t) => discTokens.has(t)));
    const discWeight = [...discCovered].reduce((s, t) => s + (idfW.get(t) || 0), 0);
    cands.push({ text: r.text, passage: r.passage, passageRank: r.passageRank, sentIdx: r.sentIdx, coverage, covered, coveredWeight: w, score, discCovered, discWeight, discTokens });
  }
  return cands;
}

/** Strict token coverage: exact token or shared stem (no prefix spillover,
 *  so "Pro" in "CloudSync Pro" can never impersonate the token "profit"). */
function strictCovers(text: string, tok: string): boolean {
  return tokenize(text).some((tt) => tt === tok || stem(tt) === stem(tok));
}

const MONTH_TOKENS = new Set(['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december']);

/** Greedy set-cover selection: maximise query coverage, then informativeness. */
function selectSentences(cands: SentenceCand[], info: QueryInfo, capOverride?: number): SentenceCand[] {
  const isSummary = info.type === 'summarise';
  let cap = isSummary ? 3 : info.type === 'list' || info.type === 'howmuch' ? 4 : info.multi ? 3 : 2;
  // A focused who/when question needs exactly one fact unless it is multi-part.
  if ((info.type === 'who' || info.type === 'when') && !info.multi) cap = 1;
  // A yes/no question is answered by the single predicate-bearing sentence.
  if (info.type === 'yesno') cap = 1;
  if (capOverride) cap = capOverride;
  let usable = cands.filter((c) => c.coverage > 0 || (isSummary && c.score >= 0.2));
  // Who-questions: only sentences that actually name a person can answer them.
  if (info.type === 'who' && !info.multi) {
    const withPerson = usable.filter((c) => extractPerson(c.text));
    if (withPerson.length) usable = withPerson;
  }
  // Yes/no questions: only sentences that bear the queried predicate under
  // strict matching (the entity name and the time reference do not count).
  if (info.type === 'yesno' && usable.length) {
    const presentAll = new Set<string>();
    usable.forEach((c) => c.covered.forEach((t) => presentAll.add(t)));
    const entityToks = new Set(info.entity ? tokenize(info.entity) : []);
    const predicate = [...presentAll].filter(
      (t) => !entityToks.has(t) && !info.anchors.includes(t) && !/^q\d$/i.test(t) && !/^\d{4}$/.test(t) && !MONTH_TOKENS.has(t),
    );
    if (predicate.length) {
      usable = usable.filter((c) => predicate.some((p) => strictCovers(c.text, p)));
    }
  }
  if (!usable.length) return [];
  const entityKey = info.entity ? info.entity.toLowerCase().split(' ')[0] : null;
  const picked: SentenceCand[] = [];
  const coveredAll = new Set<string>();
  const coveredDisc = new Set<string>();
  const remaining = [...usable].sort((a, b) => b.score - a.score);
  const discSet = usable[0].discTokens;
  const hasDisc = !isSummary && discSet.size > 0;
  while (picked.length < cap && remaining.length) {
    let bestIdx = -1;
    let bestGain = 0;
    remaining.forEach((c, i) => {
      const newTokens = [...c.covered].filter((t) => !coveredAll.has(t));
      // Approximate weight of the newly covered tokens (uniform share).
      const newW = newTokens.length
        ? c.coveredWeight * (newTokens.length / Math.max(1, c.covered.size))
        : 0;
      const newDisc = [...c.discCovered].filter((t) => !coveredDisc.has(t));
      const newDiscW = newDisc.length
        ? c.discWeight * (newDisc.length / Math.max(1, c.discCovered.size))
        : 0;
      // Selection discipline: after the first pick, a non-summary answer
      // may only grow by a sentence that covers a still-uncovered
      // DISCRIMINATIVE query token. Sentences that merely repeat generic
      // tokens (company name, "employees", "year") are off-target filler.
      if (picked.length && hasDisc && newDisc.length === 0) return;
      // Facts from the document that actually contains the query entity win
      // over same-shaped facts about other documents (Priya Nair vs Sharma).
      const entityBonus = entityKey && c.passage.text.toLowerCase().includes(entityKey) ? 2.5 : 0;
      const gain = isSummary
        ? c.score - picked.reduce((mx, p) => Math.max(mx, overlapRatio(c.text, p.text)), 0) * 0.5
        : newDiscW * 2 + newW + c.coverage + entityBonus;
      if (gain > bestGain) { bestGain = gain; bestIdx = i; }
    });
    if (bestIdx < 0) break;
    const [c] = remaining.splice(bestIdx, 1);
    if (picked.length && !isSummary && !hasDisc) {
      const newTokens = [...c.covered].filter((t) => !coveredAll.has(t)).length;
      if (newTokens === 0) break;
    }
    // Avoid near-duplicate sentences.
    if (picked.some((p) => overlapRatio(c.text, p.text) > 0.7)) continue;
    picked.push(c);
    c.covered.forEach((t) => coveredAll.add(t));
    c.discCovered.forEach((t) => coveredDisc.add(t));
  }
  // Order: question order (first covered token position), summary keeps reading order.
  if (isSummary) {
    picked.sort((a, b) => a.passageRank - b.passageRank || a.sentIdx - b.sentIdx);
  } else {
    const qOrder = tokenize(info.tokens.join(' ')); // placeholder, real order below
    void qOrder;
    picked.sort((a, b) => firstCoveredPos(a, info) - firstCoveredPos(b, info) || a.passageRank - b.passageRank || a.sentIdx - b.sentIdx);
  }
  return picked;
}

function firstCoveredPos(c: SentenceCand, info: QueryInfo): number {
  // Position of the earliest covered token within the original token list order.
  const order = info.tokens;
  let pos = Number.MAX_SAFE_INTEGER;
  c.covered.forEach((t) => {
    const i = order.indexOf(t);
    if (i >= 0 && i < pos) pos = i;
  });
  return pos;
}

function overlapRatio(a: string, b: string): number {
  const as = new Set(words(a));
  const bs = new Set(words(b));
  if (!as.size || !bs.size) return 0;
  let inter = 0;
  as.forEach((w) => { if (bs.has(w)) inter++; });
  return inter / Math.min(as.size, bs.size);
}

// ---------------------------------------------------------------------------
// fact rendering — sentence-frame rebuilding
// ---------------------------------------------------------------------------

const SYNONYMS_L1: [RegExp, string][] = [
  [/\bper calendar year\b/gi, 'per year'],
  [/\bis headquartered in\b/gi, 'is based in'],
  [/\bprovides\b/gi, 'offers'],
  [/\bprovided\b/gi, 'offered'],
  [/\binitiative\b/gi, 'project'],
  [/\bmodernise\b/gi, 'upgrade'],
  [/\bmodernize\b/gi, 'upgrade'],
  [/\butilise\b/gi, 'use'],
  [/\butilize\b/gi, 'use'],
  [/\bapproximately\b/gi, 'about'],
];
const SYNONYMS_L2: [RegExp, string][] = [
  [/\bis scheduled for\b/gi, 'is set for'],
  [/\bare scheduled for\b/gi, 'are set for'],
  [/\boffers\b/gi, 'provides'],
  [/\bincludes\b/gi, 'comes with'],
  [/\binclude\b/gi, 'come with'],
  [/\bcurrently\b/gi, 'now'],
  [/\bassistance\b/gi, 'help'],
];

function applySynonyms(text: string, level: number): string {
  if (level < 1) return text;
  let out = text;
  for (const [re, rep] of SYNONYMS_L1) out = out.replace(re, rep);
  if (level >= 2) for (const [re, rep] of SYNONYMS_L2) out = out.replace(re, rep);
  return out;
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}
function lowerFirst(s: string): string {
  // A leading determiner always lowers mid-sentence ("host The X" -> "host the X").
  if (/^(The|A|An)\s/.test(s)) return s.charAt(0).toLowerCase() + s.slice(1);
  // Lowercase a leading common word; keep proper nouns / acronyms intact.
  if (/^[A-Z][a-z]/.test(s) && !/^[A-Z][a-z]+\s[A-Z]/.test(s)) return s.charAt(0).toLowerCase() + s.slice(1);
  return s;
}

/** Location fronting: "The X meeting will be held in Jaipur on <date>"
 *  -> "Jaipur will host the X meeting" (frame rebuilt, date clause dropped
 *  when the question only asks where). */
function heldInFrame(text: string): string {
  const m = text.match(/^(.+?)\s+will be held in\s+([A-Z][A-Za-z]*(?:\s+[A-Z][A-Za-z]*)*)\s*(?:on\s+.+)?$/);
  if (!m) return text;
  return `${m[2].trim()} will host ${lowerFirst(m[1].trim())}`;
}

const DATE_RE2 = /\b\d{1,2}\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}\b/;

function stripLabel(text: string): string {
  const m = text.match(/^([A-Z][\w &/'-.]{2,50}):\s+(.+)$/s);
  if (m && !/\b(is|are|was|were|has|have)\b/.test(m[1])) return m[2];
  return text;
}

const PASSIVE_MAP: Record<string, [string, string]> = {
  // verb -> [present, past]
  led: ['leads', 'led'], owned: ['owns', 'owned'], headed: ['heads', 'headed'],
  managed: ['manages', 'managed'], directed: ['directs', 'directed'],
  founded: ['founds', 'founded'], authored: ['authors', 'authored'],
  written: ['writes', 'wrote'], ledby: ['leads', 'led'],
};

function passiveToActive(text: string): string {
  const m = text.match(/^(.+?)\s+(is|was|are|were)\s+(led|owned|headed|managed|directed|founded|authored|written)\s+by\s+([^,;.]+)(.*)$/i);
  if (!m) return text;
  const [, subj, aux, verb, byPart, rest] = m;
  const name = extractPerson(byPart) || byPart.trim();
  const active = PASSIVE_MAP[verb.toLowerCase()][aux.toLowerCase() === 'was' || aux.toLowerCase() === 'were' ? 1 : 0];
  const obj = subj.trim();
  const objRendered = /^[A-Z]/.test(obj) || /^(the|a|an)\s/i.test(obj) ? lowerFirst(obj) : obj;
  return `${name} ${active} ${objRendered}${rest || ''}`;
}

function possessiveOf(text: string): string {
  const m = text.match(/^the\s+(.+?)\s+(?:for|of)\s+([A-Z][\w\s.'-]*?)\s+is\s+(.+)$/i);
  if (!m) return text;
  const [, noun, owner, rest] = m;
  return `${owner.trim()}'s ${noun.trim()} is ${rest.trim()}`;
}

function definitionPossessive(text: string): string {
  const m = text.match(/^(.+?)\s+is\s+an?\s+(.+?)\s+by\s+([A-Z][\w.& ]+?)$/);
  if (!m) return text;
  return `${m[1]} is ${m[3].trim()}'s ${m[2].trim()}`;
}

function everyPlural(text: string): string {
  let out = text.replace(/\bevery full-time employee receives\b/gi, 'Full-time employees receive');
  out = out.replace(/\bevery full-time employee\b/gi, 'all full-time employees');
  out = out.replace(/\bevery employee receives\b/gi, 'Employees receive');
  return out;
}

/** Swap "A and B" conjuncts when both sides carry numbers (breaks copied runs). */
function conjunctSwap(text: string): string {
  const m = text.match(/^(.*?)(receives|receive|gets|has|includes|offers|provides)\s+(.+?)\s+and\s+(.+?)\s+(per year|per month|annually|per calendar year)(.*)$/i);
  if (m && /\d/.test(m[3]) && /\d/.test(m[4])) {
    return `${m[1]}${m[2]} ${m[4]} and ${m[3]} ${m[5]}${m[6] || ''}`;
  }
  return text;
}

/**
 * Trim a sentence to the clauses that carry the answer: subordinate
 * trailing clauses ("…, and it must be entered by the duty officer…")
 * are dropped unless they hit a query token or carry a fact pattern.
 * List-type questions keep their clauses (they enumerate the answer).
 */
function trimClauses(text: string, info: QueryInfo): string {
  if (info.type === 'list') return text;
  const clauses = text.split(/(?<=[,;])\s+|\s+—\s+/).filter(Boolean);
  if (clauses.length < 2) return text;
  const kept: string[] = [];
  clauses.forEach((cl, i) => {
    if (i === 0) { kept.push(cl); return; }
    // Bare date fragments ("2026 in Bengaluru") continue the prior clause —
    // keep them only when that clause was kept, else they dangle.
    if (/^\d{4}\b/.test(cl.trim())) {
      if (kept.length === i) kept.push(cl);
      return;
    }
    const toks = tokenize(cl);
    const hits = info.tokens.some((qt) => toks.some((tt) => tokenMatch(qt, tt)));
    if (hits || MONEY_RE.test(cl) || DATE_RE.test(cl) || DATE_RE2.test(cl) || !!extractPerson(cl)) kept.push(cl);
  });
  if (!kept.length || kept.length === clauses.length) return text;
  return kept.map((cl) => cl.replace(/[.,;]+$/, '').trim()).join(', ');
}

function shortTitle(title: string): string {
  return title.replace(/\.(pdf|docx|txt|md)$/i, '').trim();
}

/** Financial-report frames: rebuild revenue/profit sentences around the figures. */
function financialFrames(text: string): string {
  let out = text;
  out = out.replace(
    /\btotal revenue (?:reached|was|hit|grew to)\s+(\$[\d.]+[MK]?),?\s+up\s+([\d.]+%)\s+quarter-over-quarter(?:\s+and\s+([\d.]+%)\s+year-over-year)?/i,
    (_m, amt, qoq, yoy) => `Revenue came to ${amt} — up ${qoq} on the previous quarter${yoy ? ` and ${yoy} year-over-year` : ''}`,
  );
  out = out.replace(
    /\boperating expenses were\s+(\$[\d.]+[MK]?),?\s+leaving an operating profit of\s+(\$[\d.]+[MK]?)/i,
    (_m, exp, profit) => `Operating profit came to ${profit}, with operating expenses of ${exp}`,
  );
  out = out.replace(/\boperating profit (?:was|of)\s+(\$[\d.]+[MK]?)/i, (_m, amt) => `Operating profit came to ${amt}`);
  out = out.replace(/\btotal revenue (?:reached|was|hit|grew to)\s+(\$[\d.]+[MK]?)/i, (_m, amt) => `Revenue came to ${amt}`);
  return out;
}

/** Cost frame: "The Team plan costs $99 per month" -> "<Product> charges $99 per month for the Team plan". */
function costFrame(text: string, product: string | null): string {
  const m = text.match(/^the\s+(.+?\s+plan)\s+costs?\s+(\$[\d.]+)\s+per month\b(.*)$/i);
  if (!m) return text;
  const [, plan, price, rest] = m;
  const tail = (rest || '').replace(/^\s+and\s+(includes|comes with)\s+/i, ', with ');
  if (product) return `${product} charges ${price} per month for the ${plan}${tail}`;
  return `The ${plan} is priced at ${price} per month${tail}`;
}

/** Who-frame: "<Name> is the <role> of <Entity>." / "<Name> <verb> <Entity>." */
function whoFrame(cand: SentenceCand, info: QueryInfo): string | null {
  const name = extractPerson(cand.text);
  if (!name) return null;
  // Grounding guard: a person may only be framed against an anchored
  // entity when the person's own passage mentions that entity — a name
  // harvested from another document is never attributed to it.
  if (info.anchors.length) {
    const toks = tokenize(cand.passage.text);
    if (!info.anchors.every((at) => toks.some((tt) => tokenMatch(at, tt)))) return null;
  }
  if (info.roleNoun) {
    const entity = info.entity || info.objectPhrase;
    if (entity) return `${name} is the ${info.roleNoun} of ${entity}`;
    return `${name} is the ${info.roleNoun}`;
  }
  if (info.verbCue) {
    const obj0 = info.objectPhrase || info.entity;
    if (obj0) {
      const obj = /^[a-z]/.test(obj0) && !/^the\s/.test(obj0) ? `the ${obj0}` : obj0;
      return `${name} ${info.verbCue} ${obj}`;
    }
  }
  return null;
}

function renderFact(cand: SentenceCand, info: QueryInfo, level: number, isFirst: boolean): string {
  if (info.type === 'who' || (info.multi && info.roleNoun)) {
    const frame = whoFrame(cand, info);
    if (frame && (cand.covered.size > 0 || extractPerson(cand.text))) return frame;
  }
  let t = cand.text.trim().replace(/[.!?]+$/, '');
  t = stripLabel(t);
  t = trimClauses(t, info);
  t = heldInFrame(t);
  t = passiveToActive(t);
  t = possessiveOf(t);
  t = definitionPossessive(t);
  t = everyPlural(t);
  t = financialFrames(t);
  const product = shortTitle(cand.passage.title).split('—')[0].split(' - ')[0].trim();
  t = costFrame(t, product || null);
  if (level >= 1) t = conjunctSwap(t);
  t = applySynonyms(t, level);
  if (level >= 2 && isFirst && (info.type === 'summarise' || info.type === 'general')) {
    t = `According to ${shortTitle(cand.passage.title)}, ${lowerFirst(t)}`;
  }
  return cap(t.trim());
}

// ---------------------------------------------------------------------------
// fact slots — template assembly for sources no frame transform can save
// ---------------------------------------------------------------------------

type SlotFact = { subject: string; attr: string; value: string };

function isPersonValue(v: string): boolean {
  return /^[A-Z][a-z]+(?:\s+[A-Z][a-z]+){1,2}$/.test(v.trim());
}

/**
 * Decompose possessive fact sentences into (subject, attribute, value)
 * slots. The compound shape "X's A is V and its B is W" splits into two
 * independent facts that can be reframed separately; a lone "X's A is V"
 * yields one. This is what makes a single-sentence source composable
 * instead of quotable.
 */
export function extractPossessiveFacts(text: string): SlotFact[] {
  const t = text.trim().replace(/[.!?]+$/, '');
  const compound = t.match(/^(.+?)'s\s+(.+?)\s+is\s+(.+?)\s+and\s+(?:its|his|her|their)\s+(.+?)\s+is\s+(.+)$/i);
  if (compound) {
    return [
      { subject: compound[1].trim(), attr: compound[2].trim(), value: compound[3].trim() },
      { subject: compound[1].trim(), attr: compound[4].trim(), value: compound[5].trim() },
    ];
  }
  const single = t.match(/^(.+?)'s\s+(.+?)\s+is\s+(.+)$/i);
  if (single && single[2].split(/\s+/).length <= 5 && single[3].split(/\s+/).length <= 8) {
    return [{ subject: single[1].trim(), attr: single[2].trim(), value: single[3].trim() }];
  }
  return [];
}

/** Template frames: person values front the subject ("Priya Nair is the
 *  owner of Project ZEBRA-9"); other values take the of-frame ("The launch
 *  code of Project ZEBRA-9 is 4471"). Neither frame copies the source's. */
function renderSlotFact(f: SlotFact): string {
  const attr = lowerFirst(f.attr.trim());
  const value = f.value.trim();
  if (isPersonValue(value)) return `${value} is the ${attr} of ${f.subject.trim()}`;
  return `The ${attr} of ${f.subject.trim()} is ${value}`;
}

function factRelevant(f: SlotFact, info: QueryInfo): boolean {
  if (info.type === 'summarise') return true;
  const attrToks = contentTokens(f.attr);
  if (attrToks.some((t) => info.tokens.some((qt) => tokenMatch(qt, t)))) return true;
  // The who-part of a question is answered by the entity's own person fact.
  if ((info.type === 'who' || info.multi) && isPersonValue(f.value)) return true;
  return false;
}

/**
 * Slot fallback: rebuild the answer from extracted fact slots (template
 * frames only) for picked sentences that decompose, and from the normal
 * frame transforms for the rest. Used when the transform ladder cannot
 * get the answer under the echo gate — a copied frame is never emitted.
 */
function buildSlotAnswer(picked: SentenceCand[], info: QueryInfo): { text: string; used: ComposePassage[] } | null {
  const used: ComposePassage[] = [];
  const sidFor = (p: ComposePassage) => {
    let i = used.indexOf(p);
    if (i < 0) { used.push(p); i = used.length - 1; }
    return `S${i + 1}`;
  };
  const parts: string[] = [];
  for (const c of picked) {
    const facts = extractPossessiveFacts(stripLabel(c.text.trim()));
    if (facts.length) {
      let rel = facts.filter((f) => factRelevant(f, info));
      if (!rel.length) {
        if (picked.length > 1) continue; // another picked sentence carries the answer
        rel = facts;
      }
      if (info.type === 'who') {
        rel = [...rel].sort((a, b) => (isPersonValue(b.value) ? 1 : 0) - (isPersonValue(a.value) ? 1 : 0));
      }
      for (const f of rel) parts.push(`${renderSlotFact(f)} [${sidFor(c.passage)}]`);
    } else {
      parts.push(`${renderFact(c, info, 2, parts.length === 0)} [${sidFor(c.passage)}]`);
    }
  }
  if (!parts.length) return null;
  return { text: parts.join('. ') + '.', used };
}

// ---------------------------------------------------------------------------
// yes/no verdicts — composed from the predicate-bearing sentence's slots
// ---------------------------------------------------------------------------

function buildYesNoAnswer(info: QueryInfo, cand: SentenceCand): { text: string; used: ComposePassage[] } | null {
  const text = cand.text;
  if (/\bno\s+(?:\w+\s+)?profit\b/i.test(text) || /\bnot\s+profit/i.test(text)) return null;
  const entity = info.entity || 'The company';
  const tail = info.period ? ` in ${info.period}` : '';
  // "<phrase> profit of $X": the money figure that belongs to the predicate.
  const m = text.match(/([A-Za-z]+(?:\s+[A-Za-z]+)?\s+profit)\s+of\s+(\$[\d.,]+[MK]?)/i);
  if (m) {
    const phrase = m[1].trim();
    const withArticle = /^(a|an|the)\s/i.test(phrase) ? phrase : `${/^[aeiou]/i.test(phrase) ? 'an' : 'a'} ${phrase}`;
    return { text: `Yes — ${entity} made ${withArticle} of ${m[2]}${tail} [S1].`, used: [cand.passage] };
  }
  // Generic: the first money figure after a strictly-matched predicate token.
  const entityToks = new Set(info.entity ? tokenize(info.entity) : []);
  const predicate = info.tokens.filter(
    (t) => !entityToks.has(t) && !info.anchors.includes(t) && !/^q\d$/i.test(t) && !/^\d{4}$/.test(t) && !MONTH_TOKENS.has(t) && strictCovers(text, t),
  );
  for (const p of predicate) {
    const idx = text.toLowerCase().search(new RegExp(`\\b${p}\\b`, 'i'));
    if (idx < 0) continue;
    const money = text.slice(idx).match(/\$[\d.,]+[MK]?/);
    if (money) return { text: `Yes — ${entity}'s ${p} was ${money[0]}${tail} [S1].`, used: [cand.passage] };
  }
  return null;
}

// ---------------------------------------------------------------------------
// pricing list renderer (plan/price facts rebuilt in our own frame)
// ---------------------------------------------------------------------------

type PlanFact = { name: string; price: string; storage: string | null };

export function parsePlans(text: string): PlanFact[] {
  const plans: PlanFact[] = [];
  const re = /(Starter|Pro|Team|Basic|Premium|Enterprise)\s+plan\s+(?:is free|costs?\s+\$([\d.]+)\s+per month)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    // Storage lives in the same sentence as the price — search the
    // remainder of that sentence (the plan regex alone would skip it,
    // since a lazy optional group never has to match).
    const rest = text.slice(m.index, m.index + 400);
    const sentEnd = rest.indexOf('. ');
    const sentence = sentEnd > 0 ? rest.slice(0, sentEnd) : rest;
    const sm = sentence.match(/includes\s+([\d.]+\s?(?:GB|TB)(?:\s+of\s+(?:pooled\s+)?storage)?)/i);
    plans.push({
      name: m[1],
      price: m[2] ? `$${m[2]} per month` : 'free',
      storage: sm ? sm[1].replace(/\s+/g, ' ') : null,
    });
  }
  return plans;
}

function renderPlans(plans: PlanFact[], entity: string | null): string {
  const parts = plans.map((p, i) => {
    const lead = i === 0 ? `the ${p.name} plan` : i === plans.length - 1 ? `the ${p.name} plan` : `the ${p.name} plan`;
    const price = p.price === 'free' ? 'is free' : `runs ${p.price}`;
    const storage = p.storage ? `, with ${p.storage} included` : '';
    return `${lead} ${price}${storage}`;
  });
  const body = parts.length > 1 ? `${parts.slice(0, -1).join('; ')}; and ${parts[parts.length - 1]}` : parts[0];
  return `${entity ? `For ${entity}, ` : ''}${body}`;
}

// ---------------------------------------------------------------------------
// main composer
// ---------------------------------------------------------------------------

/** Plans the query actually asks about (e.g. "the Team plan") or all of them. */
function focusedPlans(plans: PlanFact[], query: string): PlanFact[] {
  const ql = query.toLowerCase();
  const mentioned = plans.filter((p) => ql.includes(`${p.name.toLowerCase()} plan`));
  return mentioned.length ? mentioned : plans;
}

function buildAnswer(picked: SentenceCand[], info: QueryInfo, level: number, passages: ComposePassage[], query = ''): { text: string; used: ComposePassage[] } {
  const priceCue = /\b(cost|costs|price|pricing|how much)\b/i.test(query);
  // Assign sids in answer order (order of first use).
  const used: ComposePassage[] = [];
  const sidFor = (p: ComposePassage) => {
    let i = used.indexOf(p);
    if (i < 0) { used.push(p); i = used.length - 1; }
    return `S${i + 1}`;
  };

  const rendered: string[] = [];
  picked.forEach((c, i) => {
    // Pricing facts: when the passage carries a plan table and the query
    // asks about cost, rebuild the plan list from parsed facts instead of
    // rendering any single copied sentence.
    if (priceCue && /\bplan\b/i.test(c.text)) {
      const plans = parsePlans(c.passage.text);
      if (plans.length >= 2) {
        const product = c.passage.title.includes('—')
          ? shortTitle(c.passage.title).split('—')[0].trim()
          : info.entity;
        rendered.push(`${renderPlans(focusedPlans(plans, query), product)} [${sidFor(c.passage)}]`);
        return;
      }
    }
    let fact = renderFact(c, info, level, i === 0);
    // Second mention of the entity as possessive subject -> pronoun.
    // Only when the possessive owner is a short, verb-free subject phrase
    // (a mid-sentence "NovaTech's …" inside a longer clause must not fire).
    if (i > 0 && info.entity) {
      const pm = fact.match(/^(.+?)'s\s+(.*)$/);
      if (
        pm &&
        pm[1].length <= 42 &&
        pm[1].toLowerCase().includes(info.entity.toLowerCase()) &&
        !/\b(is|are|was|were|has|have|receives|offers|provides|leads|owns)\b/i.test(pm[1])
      ) {
        fact = `Its ${pm[2]}`;
      }
    }
    rendered.push(`${fact} [${sidFor(c.passage)}]`);
  });
  void passages;
  return { text: rendered.join('. ') + '.', used };
}

export function composeAnswer(query: string, passagesIn: ComposePassage[]): ComposedAnswer | null {
  if (!passagesIn.length) return null;
  const info = analyzeQuery(query);
  // Entity anchoring at fact-selection level (mirrors retrieval): when the
  // query anchors on a distinctive entity token, only passages that mention
  // it may supply facts about it.
  let passages = passagesIn;
  if (info.anchors.length) {
    const anchored = passagesIn.filter((p) =>
      info.anchors.every((at) => tokenize(p.text).some((tt) => tokenMatch(at, tt))),
    );
    if (anchored.length) passages = anchored;
  }
  let cands = sentenceCandidates(passages, info);
  // A pure pricing question is answered by the plan list alone — one fact,
  // taken from a passage that actually carries the plan table.
  const priceCue = /\b(cost|costs|price|pricing|how much)\b/i.test(query);
  const plansExist = passages.some((p) => parsePlans(p.text).length >= 2);
  const capOverride = priceCue && plansExist && !info.multi ? 1 : undefined;
  if (capOverride) {
    const planCands = cands.filter((c) => parsePlans(c.passage.text).length >= 2);
    if (planCands.length) cands = planCands;
  }
  const picked = selectSentences(cands, info, capOverride);
  if (!picked.length) return null;
  // Relevance floor: the best selected sentence must genuinely cover the query,
  // unless it carries a typed answer pattern (name/date/price) plus an entity hit.
  const best = picked[0];
  const typed = (info.type === 'who' && !!extractPerson(best.text)) ||
    (info.type === 'when' && DATE_RE.test(best.text)) ||
    (info.type === 'howmuch' && MONEY_RE.test(best.text)) ||
    (info.type === 'yesno' && best.discCovered.size > 0);
  if (best.coverage < 0.2 && !(typed && best.coverage > 0)) return null;
  if (best.coverage === 0 && !typed) return null;

  const finish = (text: string, used: ComposePassage[], echo: EchoMetric): ComposedAnswer => ({
    answer: text,
    sources: used.map((p, i) => ({
      sid: `S${i + 1}`,
      title: p.title,
      text: p.text.slice(0, 300),
      documentId: p.docId,
      score: Math.round(p.score * 1000) / 1000,
    })),
    echo,
    passagesUsed: used.length,
  });
  // HARD AND GATE: both thresholds, against every source passage.
  const passesGate = (e: EchoMetric) => e.maxRun <= 8 && e.ratio <= 0.5;

  // Yes/no questions lead with a verdict composed from the predicate slots.
  if (info.type === 'yesno') {
    const v = buildYesNoAnswer(info, best);
    if (!v) return null;
    const echo = echoMetric(v.text, passages);
    return passesGate(echo) ? finish(v.text, v.used, echo) : null;
  }

  let bestResult: { text: string; used: ComposePassage[]; echo: EchoMetric } | null = null;
  for (let level = 0; level <= 2; level++) {
    const { text, used } = buildAnswer(picked, info, level, passages, query);
    const echo = echoMetric(text, passages);
    if (!bestResult || echo.maxRun < bestResult.echo.maxRun) bestResult = { text, used, echo };
    if (passesGate(echo)) { bestResult = { text, used, echo }; break; }
  }
  if (bestResult && passesGate(bestResult.echo)) return finish(bestResult.text, bestResult.used, bestResult.echo);

  // Transforms could not break the copy: assemble from fact slots instead.
  const slot = buildSlotAnswer(picked, info);
  if (slot) {
    const echo = echoMetric(slot.text, passages);
    if (passesGate(echo)) return finish(slot.text, slot.used, echo);
  }
  return null;
}
