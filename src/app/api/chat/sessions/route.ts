import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';

export const runtime = 'nodejs';

// List the user's chat sessions (newest first)
export const GET = handler(async () => {
  const ctx = await requireCtx();
  const rows = await sql`select id, title, created_at from chat_sessions where org_id = ${ctx.orgId} and user_id = ${ctx.userId} order by created_at desc limit 50`;
  return { sessions: rows };
});

// Start a new chat session
export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const b = z.object({ title: z.string().max(120).default('New chat') }).parse(await req.json().catch(() => ({})));
  const [s] = await sql`insert into chat_sessions (org_id, user_id, title) values (${ctx.orgId}, ${ctx.userId}, ${b.title}) returning id, title, created_at`;
  return { session: s };
});
