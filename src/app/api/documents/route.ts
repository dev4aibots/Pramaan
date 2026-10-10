import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, atLeast, isAdmin } from '@/lib/auth';
import { scan, CHUNK_QUARANTINE } from '@/lib/security/guard';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const Chunk = z.object({
  idx: z.number().int().min(0),
  content: z.string().min(1).max(6000),
  subjectRef: z.string().max(100).optional().nullable(),
  embedding: z.array(z.number().finite()).length(384),
});
const Body = z.object({
  documentId: z.string().uuid().optional(),
  title: z.string().min(1).max(300),
  source: z.string().max(40).default('upload'),
  mime: z.string().max(120).default('text/plain'),
  visibility: z.enum(['private', 'org', 'roles']).default('private'),
  allowedRoles: z.array(z.enum(['admin', 'manager', 'member', 'viewer'])).default([]),
  chunks: z.array(Chunk).min(1).max(64),
});

export const GET = handler(async () => {
  const ctx = await requireCtx();
  const docs = await sql`
    select d.id, d.title, d.source, d.mime, d.visibility, d.allowed_roles, d.chunk_count, d.quarantined_chunks,
           d.created_at, (d.owner_id = ${ctx.userId}) as mine, u.email as owner_email
    from documents d join users u on u.id = d.owner_id
    where d.org_id = ${ctx.orgId} and (
      d.owner_id = ${ctx.userId}
      or (d.visibility <> 'private' and ${isAdmin(ctx)}::boolean)
      or (
        (d.visibility = 'org' or (d.visibility = 'roles' and ${ctx.role} = any(d.allowed_roles)))
        -- Fail-closed titles (L5): hide docs carrying any chunk subject-restricted
        -- away from this user, unless they own the doc or are admin. Chunk
        -- content was already protected by retrieval.ts; this closes the title leak.
        and not exists (
          select 1 from chunks c
          where c.document_id = d.id
            and c.subject_ref is not null
            and (${ctx.subjectRef}::text is null or c.subject_ref <> ${ctx.subjectRef})
        )
      )
    )
    order by d.created_at desc limit 500`;
  return { documents: docs };
});

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  if (ctx.role === 'viewer') throw new HttpError(403, 'Viewers cannot add documents');
  const b = Body.parse(await req.json());
  if (ctx.orgKind === 'personal' && b.visibility !== 'private') b.visibility = 'private';
  if (b.visibility !== 'private' && !atLeast(ctx, 'manager')) throw new HttpError(403, 'Only managers and admins can share documents with the team');

  let documentId = b.documentId;
  if (documentId) {
    const [d] = await sql`select owner_id from documents where id = ${documentId} and org_id = ${ctx.orgId}`;
    if (!d || (d.owner_id !== ctx.userId && !isAdmin(ctx))) throw new HttpError(403, 'Not allowed to modify this document');
  } else {
    const [d] = await sql`
      insert into documents (org_id, owner_id, title, source, mime, visibility, allowed_roles)
      values (${ctx.orgId}, ${ctx.userId}, ${b.title}, ${b.source}, ${b.mime}, ${b.visibility}, ${b.allowedRoles})
      returning id`;
    documentId = d.id;
  }

  let quarantined = 0;
  await sql.begin(async (tx: any) => {
    for (const c of b.chunks) {
      const s = scan(c.content);
      const q = s.score >= CHUNK_QUARANTINE;
      if (q) quarantined++;
      await tx`
        insert into chunks (document_id, org_id, idx, content, subject_ref, quarantined, risk, embedding)
        values (${documentId}, ${ctx.orgId}, ${c.idx}, ${s.clean}, ${c.subjectRef?.trim() || null}, ${q}, ${s.score}, ${`[${c.embedding.join(',')}]`}::vector)`;
    }
    await tx`update documents set chunk_count = chunk_count + ${b.chunks.length}, quarantined_chunks = quarantined_chunks + ${quarantined} where id = ${documentId}`;
  });
  if (!b.documentId) await audit(ctx, 'document.create', { documentId, title: b.title, visibility: b.visibility, source: b.source });
  if (quarantined) await audit(ctx, 'ingest.quarantine', { documentId, quarantined });
  return { documentId, quarantined };
});

export const DELETE = handler(async (req) => {
  const ctx = await requireCtx();
  const id = new URL(req.url).searchParams.get('id') || '';
  const [d] = await sql`select owner_id, title from documents where id = ${id} and org_id = ${ctx.orgId}`;
  if (!d || (d.owner_id !== ctx.userId && !isAdmin(ctx))) throw new HttpError(403, 'Not allowed');
  await sql`delete from documents where id = ${id} and org_id = ${ctx.orgId}`;
  await audit(ctx, 'document.delete', { documentId: id, title: d.title });
  return { ok: true };
});
