import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, isAdmin } from '@/lib/auth';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/documents/chunks?documentId=<uuid>
// Returns the text chunks of one document for in-app preview.
// Same visibility rules as GET /api/documents, plus retrieval-style
// subject_ref filtering — a user only sees chunks they could retrieve.
const DEMO_USER_ID_CHUNKS = '00000000-0000-0000-0000-00000000de01';

export const GET = handler(async (req: Request) => {
  const ctx = await requireCtx();
  const u = new URL(req.url);
  const documentId = u.searchParams.get('documentId');
  if (!documentId) throw new HttpError(400, 'documentId is required');

  // Demo users: serve seed-doc chunks from code — no DB.
  if (ctx.userId === DEMO_USER_ID_CHUNKS) {
    const { getDemoDocs, getDemoDocChunks } = await import('@/lib/demo');
    const docs = getDemoDocs();
    const meta = docs.find((d: any) => d.id === documentId);
    if (!meta) throw new HttpError(404, 'Document not found');
    const chunks = getDemoDocChunks(documentId) ?? [];
    return { documentId: meta.id, title: meta.title, chunks };
  }

  const [d] = await sql`
    select d.id, d.title, d.owner_id, d.visibility, d.allowed_roles
    from documents d
    where d.id = ${documentId} and d.org_id = ${ctx.orgId} and (
      d.owner_id = ${ctx.userId}
      or (d.visibility <> 'private' and ${isAdmin(ctx)}::boolean)
      or (
        (d.visibility = 'org' or (d.visibility = 'roles' and ${ctx.role} = any(d.allowed_roles)))
        and not exists (
          select 1 from chunks c
          where c.document_id = d.id
            and c.subject_ref is not null
            and (${ctx.subjectRef}::text is null or c.subject_ref <> ${ctx.subjectRef})
        )
      )
    )
    limit 1`;
  if (!d) throw new HttpError(404, 'Document not found or not visible to you');

  const privileged = isAdmin(ctx) || d.owner_id === ctx.userId;
  const chunks = await sql`
    select idx, content, quarantined
    from chunks
    where document_id = ${documentId}
      and quarantined = false
      and (subject_ref is null or ${privileged}::boolean or subject_ref = ${ctx.subjectRef})
    order by idx asc
    limit 64`;

  return {
    documentId: d.id,
    title: d.title,
    chunks: chunks.map((c: any) => ({ idx: c.idx, content: c.content })),
  };
});
