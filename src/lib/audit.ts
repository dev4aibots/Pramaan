import crypto from 'node:crypto';
import { sql } from './db';
import { sha256 } from './crypto';
import type { Ctx } from './auth';
import { HttpError } from './http';

/** Tamper-evident, hash-chained audit log (per org). */
export async function audit(ctx: Pick<Ctx, 'orgId' | 'userId'>, action: string, detail: Record<string, any>) {
  const uid = crypto.randomUUID();
  const created = new Date().toISOString();
  await sql.begin(async (tx: any) => {
    await tx`select pg_advisory_xact_lock(hashtext(${ctx.orgId}))`;
    const [last] = await tx`select hash from audit_log where org_id = ${ctx.orgId} order by id desc limit 1`;
    const prev = last?.hash ?? 'GENESIS';
    const hash = sha256(prev + uid + action + JSON.stringify(detail) + created);
    await tx`
      insert into audit_log (uid, org_id, user_id, action, detail, prev_hash, hash, created_at)
      values (${uid}, ${ctx.orgId}, ${ctx.userId}, ${action}, ${tx.json(detail)}, ${prev}, ${hash}, ${created})`;
  });
  return uid;
}

/** Simple per-user rate limit derived from the audit log (no Redis required). */
export async function rateLimit(ctx: Ctx, perMinute = 20) {
  const [r] = await sql`
    select count(*)::int as n from audit_log
    where user_id = ${ctx.userId} and action in ('chat','retrieve') and created_at > now() - interval '1 minute'`;
  if (r.n >= perMinute) throw new HttpError(429, 'Rate limit exceeded. Please wait a minute.');
}
