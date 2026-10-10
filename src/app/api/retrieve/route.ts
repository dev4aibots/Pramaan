import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit, rateLimit } from '@/lib/audit';
import { prepare } from '@/lib/pipeline';
import { REFUSAL } from '@/lib/security/verify';
export const runtime = 'nodejs';

/** For LOCAL engines (WebLLM / Ollama / LM Studio): server enforces layers 1-4 and returns only authorized, sanitized context. */
export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  await rateLimit(ctx);
  const b = z.object({ query: z.string().min(1).max(2000), embedding: z.array(z.number().finite()).length(384) }).parse(await req.json());
  const p = await prepare(ctx, b.query, b.embedding);
  if (p.blocked) {
    const auditId = await audit(ctx, 'retrieve', { blocked: true, flags: p.flags, query: b.query.slice(0, 300) });
    return { blocked: true, answer: 'This request was blocked by the PRAMAAN security firewall.', layers: p.layers, auditId, threat: p.threat };
  }
  const auditId = await audit(ctx, 'retrieve', { query: b.query.slice(0, 300), sources: p.sources.map((s) => s.documentId), engine: 'local' });
  if (!p.sources.length) {
    const detail = p.refusal?.detail ? ` ${p.refusal.detail}` : ' Try rephrasing or ask an administrator for access.';
    const answer = `${REFUSAL}${detail}`;
    return {
      blocked: false,
      answer,
      layers: p.layers,
      sources: [],
      auditId,
      refusal: p.refusal,
      threat: p.threat,
      confidence: {
        score: 100,
        level: 'Refused',
        label: p.refusal?.title || '100% Grounded Refusal',
        reason: p.refusal?.detail || 'No authorized evidence found.',
        category: p.refusal?.category || 'not_available',
      },
    };
  }
  await sql`delete from pending_answers where created_at < now() - interval '1 hour'`;
  await sql`insert into pending_answers (audit_uid, user_id, org_id, sources, canary, redact_output)
            values (${auditId}, ${ctx.userId}, ${ctx.orgId}, ${sql.json(p.sources as any)}, ${p.canary}, ${p.redactOutput})`;
  return { blocked: false, messages: p.messages, layers: p.layers, sources: p.sources, auditId, refusal: null, threat: p.threat };
});
