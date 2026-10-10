import { sql } from './db';
import { type Ctx, isAdmin } from './auth';

/**
 * Layer 3 — permission-aware hybrid retrieval.
 * The ACL predicate is applied INSIDE SQL before ranking, so unauthorized chunks never reach the app or the LLM.
 */
function acl(ctx: Ctx) {
  return sql`
    c.org_id = ${ctx.orgId}
    and c.quarantined = false
    and (
      d.owner_id = ${ctx.userId}
      or (d.visibility <> 'private' and ${isAdmin(ctx)}::boolean)
      or (d.visibility <> 'private' and c.subject_ref is not null and c.subject_ref = ${ctx.subjectRef})
      or (d.visibility = 'org' and c.subject_ref is null)
      or (d.visibility = 'roles' and ${ctx.role} = any(d.allowed_roles))
    )`;
}

export type Hit = {
  id: string; content: string; idx: number; subject_ref: string | null;
  document_id: string; title: string; owner_id: string; score: number; similarity: number;
};

export async function retrieve(ctx: Ctx, query: string, embedding: number[], k = 8): Promise<Hit[]> {
  const vec = `[${embedding.join(',')}]`;
  const rows = await sql`
    with vec as (
      select c.id, row_number() over (order by c.embedding <=> ${vec}::vector) as r
      from chunks c join documents d on d.id = c.document_id
      where ${acl(ctx)}
      order by c.embedding <=> ${vec}::vector
      limit 40
    ),
    kw as (
      select c.id, row_number() over (order by ts_rank_cd(c.tsv, q) desc) as r
      from chunks c join documents d on d.id = c.document_id,
           websearch_to_tsquery('simple', ${query}) q
      where ${acl(ctx)} and c.tsv @@ q
      order by ts_rank_cd(c.tsv, q) desc
      limit 40
    ),
    fused as (
      select id, sum(s) as score from (
        select id, 1.0 / (60 + r) as s from vec
        union all
        select id, 1.2 / (60 + r) as s from kw   -- slight boost for exact matches (IDs, roll numbers)
      ) u group by id
    )
    select c.id, c.content, c.idx, c.subject_ref, d.id as document_id, d.title, d.owner_id,
           f.score::float as score,
           (1 - (c.embedding <=> ${vec}::vector))::float as similarity
    from fused f
    join chunks c on c.id = f.id
    join documents d on d.id = c.document_id
    order by f.score desc
    limit ${k * 2}`;

  // relevance floor + per-document diversity (max 3 chunks per document)
  const perDoc = new Map<string, number>();
  const out: Hit[] = [];
  for (const r of rows as any as Hit[]) {
    if (r.similarity < 0.2 && r.score < 1.2 / 61) continue;
    const n = perDoc.get(r.document_id) ?? 0;
    if (n >= 3) continue;
    perDoc.set(r.document_id, n + 1);
    out.push(r);
    if (out.length >= k) break;
  }
  return out;
}
