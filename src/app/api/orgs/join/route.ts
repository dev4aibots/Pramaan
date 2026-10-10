import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const { code } = z.object({ code: z.string().min(6).max(64) }).parse(await req.json());
  const orgId = await sql.begin(async (tx: any) => {
    const [inv] = await tx`select * from invites where code = ${code.trim()} for update`;
    if (!inv || inv.uses >= inv.max_uses || new Date(inv.expires_at) < new Date()) throw new HttpError(400, 'Invite is invalid or expired');
    await tx`insert into memberships (org_id, user_id, role, subject_ref)
             values (${inv.org_id}, ${ctx.userId}, ${inv.role}, ${inv.subject_ref})
             on conflict (org_id, user_id) do nothing`;
    await tx`update invites set uses = uses + 1 where code = ${inv.code}`;
    await tx`update users set active_org_id = ${inv.org_id} where id = ${ctx.userId}`;
    return inv.org_id;
  });
  await audit({ orgId, userId: ctx.userId }, 'org.join', {});
  return { orgId };
});
