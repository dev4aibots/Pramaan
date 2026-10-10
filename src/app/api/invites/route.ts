import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, requireRole } from '@/lib/auth';
import { randomToken } from '@/lib/crypto';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  requireRole(ctx, 'admin');
  if (ctx.orgKind !== 'team') throw new HttpError(400, 'Create a team workspace first');
  const b = z.object({
    role: z.enum(['admin', 'manager', 'member', 'viewer']),
    subjectRef: z.string().max(100).optional().nullable(),
    maxUses: z.number().int().min(1).max(1000).default(1),
  }).parse(await req.json());
  if (b.role === 'admin' && ctx.role !== 'owner') throw new HttpError(403, 'Only the owner can invite admins');
  const code = `PRM-${randomToken(8)}`;
  await sql`insert into invites (code, org_id, role, subject_ref, created_by, max_uses)
            values (${code}, ${ctx.orgId}, ${b.role}, ${b.subjectRef || null}, ${ctx.userId}, ${b.maxUses})`;
  await audit(ctx, 'invite.create', { role: b.role, subjectRef: b.subjectRef ?? null });
  return { code };
});
