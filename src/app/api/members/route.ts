import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, requireRole, atLeast } from '@/lib/auth';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireCtx();
  const rows = atLeast(ctx, 'manager')
    ? await sql`select u.id, u.email, u.name, m.role, m.subject_ref from memberships m join users u on u.id = m.user_id where m.org_id = ${ctx.orgId} order by m.created_at`
    : await sql`select u.id, u.email, u.name, m.role, m.subject_ref from memberships m join users u on u.id = m.user_id where m.org_id = ${ctx.orgId} and u.id = ${ctx.userId}`;
  return { members: rows };
});

export const PATCH = handler(async (req) => {
  const ctx = await requireCtx();
  requireRole(ctx, 'admin');
  const b = z.object({
    userId: z.string().uuid(),
    role: z.enum(['admin', 'manager', 'member', 'viewer']),
    subjectRef: z.string().max(100).nullable().optional(),
  }).parse(await req.json());
  const [target] = await sql`select role from memberships where org_id = ${ctx.orgId} and user_id = ${b.userId}`;
  if (!target) throw new HttpError(404, 'Member not found');
  if (target.role === 'owner') throw new HttpError(403, 'Owner role cannot be changed');
  if ((b.role === 'admin' || target.role === 'admin') && ctx.role !== 'owner') throw new HttpError(403, 'Only the owner can manage admins');
  await sql`update memberships set role = ${b.role}, subject_ref = ${b.subjectRef || null} where org_id = ${ctx.orgId} and user_id = ${b.userId}`;
  await audit(ctx, 'member.update', { target: b.userId, role: b.role, subjectRef: b.subjectRef ?? null });
  return { ok: true };
});

export const DELETE = handler(async (req) => {
  const ctx = await requireCtx();
  requireRole(ctx, 'admin');
  const userId = new URL(req.url).searchParams.get('userId') || '';
  const [target] = await sql`select role from memberships where org_id = ${ctx.orgId} and user_id = ${userId}`;
  if (!target) throw new HttpError(404, 'Member not found');
  if (target.role === 'owner') throw new HttpError(403, 'Owner cannot be removed');
  await sql`delete from memberships where org_id = ${ctx.orgId} and user_id = ${userId}`;
  await audit(ctx, 'member.remove', { target: userId });
  return { ok: true };
});
