import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit, rateLimit } from '@/lib/audit';
import { prepare } from '@/lib/pipeline';
import { callLLM } from '@/lib/llm';
import { decrypt } from '@/lib/crypto';
import { verifyAnswer, REFUSAL } from '@/lib/security/verify';
export const runtime = 'nodejs';
export const maxDuration = 60;

const Body = z.object({
  query: z.string().min(1).max(2000),
  embedding: z.array(z.number().finite()).length(384),
  keyId: z.string().uuid(),
  model: z.string().max(120).optional(),
});

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  await rateLimit(ctx);
  const b = Body.parse(await req.json());
  const p = await prepare(ctx, b.query, b.embedding);

  if (p.blocked) {
    const auditId = await audit(ctx, 'chat', { blocked: true, flags: p.flags, risk: p.risk, query: b.query.slice(0, 300) });
    return { blocked: true, answer: 'This request was blocked by the PRAMAAN security firewall.', layers: p.layers, sources: [], auditId };
  }

  let answer: string, faithfulness = 1, cited: string[] = [];
  if (!p.sources.length) {
    answer = `${REFUSAL} Try rephrasing, uploading the relevant document, or ask an administrator for access.`;
    p.layers.push({ n: 5, name: 'Output verification', status: 'pass', detail: 'no authorized evidence — LLM not called (zero cost, zero leakage)' });
  } else {
    const [k] = await sql`select * from api_keys where id = ${b.keyId} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId}))`;
    if (!k) throw new HttpError(403, 'API key not available to you');
    // Model override is honored only for the key owner — a shared-key user must
    // not be able to burn the owner's BYOK budget on an expensive model. (L3)
    const raw = await callLLM({ provider: k.provider, baseUrl: k.base_url, apiKey: decrypt(k.enc), model: (k.user_id === ctx.userId && b.model) || k.model, messages: p.messages });
    const v = verifyAnswer(raw, p.sources, p.canary, p.redactOutput);
    answer = v.answer; faithfulness = v.faithfulness; cited = v.cited;
    p.layers.push({
      n: 5, name: 'Output verification', status: v.blocked ? 'block' : v.unsupported ? 'warn' : 'pass',
      detail: v.blocked ? 'canary leak detected — response withheld' : `grounding ${Math.round(v.faithfulness * 100)}% · ${v.cited.length} citations · ${v.unsupported} unsupported sentences · ${v.redacted} PII masked`,
    });
  }
  const auditId = await audit(ctx, 'chat', {
    query: b.query.slice(0, 300), sources: p.sources.map((s) => s.documentId), faithfulness, engine: 'cloud',
  });
  return { blocked: false, answer, faithfulness, cited, layers: p.layers, sources: p.sources, auditId };
});
