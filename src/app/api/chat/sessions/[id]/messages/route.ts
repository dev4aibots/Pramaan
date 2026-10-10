import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';

export const runtime = 'nodejs';

async function ownSession(ctx: any, id: string) {
  const [s] = await sql`select id from chat_sessions where id = ${id} and org_id = ${ctx.orgId} and user_id = ${ctx.userId}`;
  if (!s) throw new HttpError(404, 'Chat session not found');
  return s;
}

// List messages in a session
export const GET = handler(async (_req: Request, ctx: any) => {
  const c = await requireCtx();
  const id = ctx.params.id as string;
  await ownSession(c, id);
  const rows = await sql`select id, role, content, sources, created_at from chat_messages where session_id = ${id} order by created_at asc limit 200`;
  return { messages: rows };
});

// Append a message to a session
export const POST = handler(async (req: Request, ctx: any) => {
  const c = await requireCtx();
  const id = ctx.params.id as string;
  await ownSession(c, id);
  const b = z.object({
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(20000),
    sources: z.array(z.any()).default([]),
  }).parse(await req.json());
  const [m] = await sql`insert into chat_messages (session_id, org_id, role, content, sources) values (${id}, ${c.orgId}, ${b.role}, ${b.content}, ${JSON.stringify(b.sources)}::jsonb) returning id, created_at`;
  // Auto-title the session from the first user message
  if (b.role === 'user') {
    await sql`update chat_sessions set title = ${b.content.slice(0, 60)} where id = ${id} and title = 'New chat'`;
  }
  return { message: m };
});
