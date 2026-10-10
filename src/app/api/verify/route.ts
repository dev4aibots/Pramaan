import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit, rateLimit } from '@/lib/audit';
import { verifyAnswer } from '@/lib/security/verify';
export const runtime = 'nodejs';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  await rateLimit(ctx);
  const b = z.object({ auditId: z.string().uuid(), answer: z.string().max(20000) }).parse(await req.json());
  const [p] = await sql`delete from pending_answers where audit_uid = ${b.auditId} and user_id = ${ctx.userId} returning *`;
  if (!p) throw new HttpError(404, 'Verification session expired');
  const v = verifyAnswer(b.answer, p.sources, p.canary, p.redact_output);
  await audit(ctx, 'verify', { ref: b.auditId, faithfulness: v.faithfulness, blocked: v.blocked });
  const confScore = Math.round(v.faithfulness * 100);
  const confidence = {
    score: confScore,
    level: v.blocked ? 'Blocked' : v.faithfulness >= 0.85 ? 'High' : v.faithfulness >= 0.5 ? 'Medium' : 'Low',
    label: v.blocked
      ? 'Blocked by Security Policy'
      : v.faithfulness >= 0.85
      ? `High Confidence (${confScore}%) · Grounded in Evidence`
      : v.faithfulness >= 0.5
      ? `Moderate Confidence (${confScore}%) · Partial Evidence`
      : `Low Confidence (${confScore}%) · Unverified Output`,
    reason: v.blocked
      ? 'Canary token leak detected.'
      : v.faithfulness >= 0.85
      ? `All statements are directly backed by ${v.cited.length} verified citation(s).`
      : `${v.unsupported} sentence(s) could not be verified from cited evidence.`,
    category: 'verified',
  };
  return {
    ...v,
    confidence,
    layer: {
      n: 5, name: 'Output verification', status: v.blocked ? 'block' : v.unsupported ? 'warn' : 'pass',
      detail: v.blocked ? 'canary leak detected — response withheld' : `grounding ${Math.round(v.faithfulness * 100)}% · ${v.cited.length} citations · ${v.unsupported} unsupported · ${v.redacted} PII masked`,
    },
  };
});
