/** Layer 5 — output verification: canary leak, citation validity, grounding score, exfil stripping. */
import { redact } from './redact';

export type Source = { sid: string; title: string; text: string; documentId: string; score: number };

const tokens = (s: string) =>
  new Set(s.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').split(/\s+/).filter((t) => t.length > 2));

export const REFUSAL = 'I could not find this in the documents you are authorized to access.';

export function verifyAnswer(raw: string, sources: Source[], canary: string, redactOutput: boolean) {
  if (canary && raw.includes(canary)) {
    return { blocked: true, answer: 'Response withheld: the model attempted to disclose protected system data.', faithfulness: 0, cited: [] as string[], unsupported: 0, redacted: 0 };
  }
  let answer = raw
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '[image removed]')                // markdown image exfiltration
    .replace(/\[([^\]]+)\]\((https?:\/\/[^)]+)\)/g, '$1');                // strip outbound links
  // remove invalid citations
  answer = answer.replace(/\[S(\d+)\]/g, (m, n) => (Number(n) >= 1 && Number(n) <= sources.length ? m : ''));

  let redacted = 0;
  if (redactOutput) { const r = redact(answer); answer = r.text; redacted = r.count; }

  const cited = Array.from(new Set(Array.from(answer.matchAll(/\[S(\d+)\]/g)).map((m) => `S${m[1]}`)));
  const body = answer.split(/suggested follow-ups:/i)[0];
  const sentences = body.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.split(/\s+/).length >= 6);

  if (body.includes(REFUSAL) || !sentences.length) {
    return { blocked: false, answer, faithfulness: 1, cited, unsupported: 0, redacted };
  }
  const srcTokens = new Map(sources.map((s) => [s.sid, tokens(s.text)]));
  let supported = 0;
  for (const s of sentences) {
    const ids = Array.from(s.matchAll(/\[S(\d+)\]/g)).map((m) => `S${m[1]}`);
    const pool = ids.length ? ids : sources.map((x) => x.sid);
    const st = tokens(s.replace(/\[S\d+\]/g, ''));
    let best = 0;
    for (const id of pool) {
      const t = srcTokens.get(id);
      if (!t || !st.size) continue;
      let hit = 0;
      st.forEach((w) => { if (t.has(w)) hit++; });
      best = Math.max(best, hit / st.size);
    }
    if (best >= 0.5) supported++;
  }
  const faithfulness = +(supported / sentences.length).toFixed(2);
  return { blocked: false, answer, faithfulness, cited, unsupported: sentences.length - supported, redacted };
}
