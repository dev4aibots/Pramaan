import { sql } from '@/lib/db';
import { handler } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
// Demo IDs hardcoded to avoid circular imports (demo.ts imports from db.ts)
const DEMO_USER_ID = '00000000-0000-0000-0000-00000000de01';
const DEMO_ORG_ID = '00000000-0000-0000-0000-00000000de02';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireCtx();
  // Demo user gets a synthetic org response — no DB dependency for the demo workspace shell.
  // Document/chat APIs still use the real DB; this just unblocks the initial page load.
  if (ctx.userId === DEMO_USER_ID) {
    return {
      ...ctx,
      orgs: [{ id: DEMO_ORG_ID, name: 'Demo workspace', kind: 'personal', role: 'owner' }],
      googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null,
    };
  }
  const orgs = await sql`
    select o.id, o.name, o.kind, m.role from memberships m join orgs o on o.id = m.org_id
    where m.user_id = ${ctx.userId} order by o.kind desc, o.created_at`;
  return { ...ctx, orgs, googleClientId: process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || null };
});
