import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const { name } = z.object({ name: z.string().min(2).max(80) }).parse(await req.json());
  const orgId = await sql.begin(async (tx: any) => {
    const [o] = await tx`insert into orgs (name, kind, created_by) values (${name}, 'team', ${ctx.userId}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${ctx.userId}, 'owner')`;
    await tx`update users set active_org_id = ${o.id} where id = ${ctx.userId}`;
    return o.id;
  });
  await audit({ orgId, userId: ctx.userId }, 'org.create', { name });
  return { orgId };
});

export const PUT = handler(async (req) => {
  const ctx = await requireCtx();
  const { orgId } = z.object({ orgId: z.string().uuid() }).parse(await req.json());
  const [m] = await sql`select 1 from memberships where org_id = ${orgId} and user_id = ${ctx.userId}`;
  if (!m) throw new HttpError(403, 'Not a member of that workspace');
  await sql`update users set active_org_id = ${orgId} where id = ${ctx.userId}`;
  return { ok: true };
});
