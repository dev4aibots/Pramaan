import { sql } from '@/lib/db';
import { handler } from '@/lib/http';
import { requireCtx, isAdmin } from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireCtx();
  const rows = isAdmin(ctx)
    ? await sql`select a.uid, a.action, a.detail, a.hash, a.created_at, u.email from audit_log a left join users u on u.id = a.user_id where a.org_id = ${ctx.orgId} order by a.id desc limit 200`
    : await sql`select a.uid, a.action, a.detail, a.hash, a.created_at, u.email from audit_log a left join users u on u.id = a.user_id where a.org_id = ${ctx.orgId} and a.user_id = ${ctx.userId} order by a.id desc limit 200`;
  return { entries: rows };
});
