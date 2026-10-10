import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, isAdmin } from '@/lib/auth';
import { encrypt } from '@/lib/crypto';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const GET = handler(async () => {
  const ctx = await requireCtx();
  const keys = await sql`
    select id, provider, label, model, base_url, shared, (user_id = ${ctx.userId}) as mine, created_at
    from api_keys
    where user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId})
    order by created_at desc`;
  return { keys }; // secrets are never returned
});

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const b = z.object({
    provider: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'nvidia', 'mistral', 'deepseek', 'together', 'custom']),
    label: z.string().min(1).max(60),
    model: z.string().min(1).max(120),
    apiKey: z.string().min(8).max(500),
    baseUrl: z.string().url().max(300).optional().nullable(),
    shared: z.boolean().default(false),
  }).parse(await req.json());
  if (b.shared && (!isAdmin(ctx) || ctx.orgKind !== 'team')) throw new HttpError(403, 'Only team admins can share keys');
  const [k] = await sql`
    insert into api_keys (user_id, org_id, provider, label, base_url, model, enc, shared)
    values (${ctx.userId}, ${ctx.orgId}, ${b.provider}, ${b.label}, ${b.baseUrl || null}, ${b.model}, ${encrypt(b.apiKey)}, ${b.shared})
    returning id`;
  await audit(ctx, 'key.create', { provider: b.provider, shared: b.shared });
  return { id: k.id };
});

export const DELETE = handler(async (req) => {
  const ctx = await requireCtx();
  const id = new URL(req.url).searchParams.get('id') || '';
  const r = await sql`delete from api_keys where id = ${id} and user_id = ${ctx.userId} returning id`;
  if (!r.length) throw new HttpError(404, 'Key not found');
  await audit(ctx, 'key.delete', {});
  return { ok: true };
});
