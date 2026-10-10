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
    select id, provider, label, model, embed_model, base_url, shared, (user_id = ${ctx.userId}) as mine, created_at
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
    embedModel: z.string().max(120).optional().default('Xenova/bge-small-en-v1.5'),
    apiKey: z.string().min(8).max(500),
    baseUrl: z.string().url().max(300).optional().nullable(),
    shared: z.boolean().default(false),
  }).parse(await req.json());
  if (b.shared && (!isAdmin(ctx) || ctx.orgKind !== 'team')) throw new HttpError(403, 'Only team admins can share keys');
  const [k] = await sql`
    insert into api_keys (user_id, org_id, provider, label, base_url, model, embed_model, enc, shared)
    values (${ctx.userId}, ${ctx.orgId}, ${b.provider}, ${b.label}, ${b.baseUrl || null}, ${b.model}, ${b.embedModel || 'Xenova/bge-small-en-v1.5'}, ${encrypt(b.apiKey)}, ${b.shared})
    returning id`;
  await audit(ctx, 'key.create', { provider: b.provider, shared: b.shared, embedModel: b.embedModel });
  return { id: k.id };
});

export const PATCH = handler(async (req) => {
  const ctx = await requireCtx();
  const b = z.object({
    id: z.string().uuid(),
    model: z.string().min(1).max(120).optional(),
    embedModel: z.string().min(1).max(120).optional(),
    label: z.string().min(1).max(60).optional(),
  }).parse(await req.json());
  const [row] = await sql`
    update api_keys
    set
      model = coalesce(${b.model || null}, model),
      embed_model = coalesce(${b.embedModel || null}, embed_model),
      label = coalesce(${b.label || null}, label)
    where id = ${b.id} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId} and ${isAdmin(ctx)}::boolean))
    returning id, model, embed_model, label`;
  if (!row) throw new HttpError(404, 'Key not found');
  await audit(ctx, 'key.update', { id: b.id, model: b.model, embedModel: b.embedModel });
  return { ok: true, key: row };
});

export const DELETE = handler(async (req) => {
  const ctx = await requireCtx();
  const id = new URL(req.url).searchParams.get('id') || '';
  // Creator can always revoke; team admins can additionally revoke shared org keys (M1).
  const r = await sql`delete from api_keys where id = ${id} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId} and ${isAdmin(ctx)}::boolean)) returning id`;
  if (!r.length) throw new HttpError(404, 'Key not found');
  await audit(ctx, 'key.delete', {});
  return { ok: true };
});
