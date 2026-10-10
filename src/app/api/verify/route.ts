import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit } from '@/lib/audit';
import { verifyAnswer } from '@/lib/security/verify';
export const runtime = 'nodejs';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const b = z.object({ auditId: z.string().uuid(), answer: z.string().max(20000) }).parse(await req.json());
  const [p] = await sql`delete from pending_answers where audit_uid = ${b.auditId} and user_id = ${ctx.userId} returning *`;
  if (!p) throw new HttpError(404, 'Verification session expired');
  const v = verifyAnswer(b.answer, p.sources, p.canary, p.redact_output);
  await audit(ctx, 'verify', { ref: b.auditId, faithfulness: v.faithfulness, blocked: v.blocked });
  return {
    ...v,
    layer: {
      n: 5, name: 'Output verification', status: v.blocked ? 'block' : v.unsupported ? 'warn' : 'pass',
      detail: v.blocked ? 'canary leak detected — response withheld' : `grounding ${Math.round(v.faithfulness * 100)}% · ${v.cited.length} citations · ${v.unsupported} unsupported · ${v.redacted} PII masked`,
    },
  };
});
