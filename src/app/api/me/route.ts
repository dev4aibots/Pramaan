import { sql } from '@/lib/db';
import { handler } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireCtx();
  const orgs = await sql`
    select o.id, o.name, o.kind, m.role from memberships m join orgs o on o.id = m.org_id
    where m.user_id = ${ctx.userId} order by o.kind desc, o.created_at`;
  return { ...ctx, orgs, googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null };
});
