import { z } from 'zod';
import postgres from 'postgres';
import { handler, HttpError } from '@/lib/http';
import { requireCtx, requireRole } from '@/lib/auth';
import { audit } from '@/lib/audit';
export const runtime = 'nodejs';
export const maxDuration = 60;

/** Read-only SQL import. Server fetches rows; the BROWSER embeds them (privacy + Vercel limits). */
export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  requireRole(ctx, 'manager');
  const b = z.object({
    connectionString: z.string().startsWith('postgres').max(1000),
    query: z.string().min(6).max(5000),
    subjectColumn: z.string().max(100).optional().nullable(),
  }).parse(await req.json());
  const q = b.query.trim().replace(/;+\s*$/, '');
  if (!/^(select|with)\b/i.test(q) || q.includes(';')) throw new HttpError(400, 'Only a single SELECT/WITH statement is allowed');

  const db = postgres(b.connectionString, { max: 1, connect_timeout: 10, idle_timeout: 5, prepare: false });
  try {
    const rows: any[] = await db.begin('read only', async (tx: any) => {
      await tx`set local statement_timeout = 15000`;
      return tx.unsafe(`select * from (${q}) as pramaan_q limit 5000`);
    });
    const out = rows.map((r) => ({
      text: Object.entries(r).map(([k, v]) => `${k}: ${v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : v}`).join(' | '),
      subject: b.subjectColumn && r[b.subjectColumn] != null ? String(r[b.subjectColumn]) : null,
    }));
    await audit(ctx, 'connector.postgres', { rows: out.length });
    return { rows: out };
  } catch (e: any) {
    if (e instanceof HttpError) throw e;
    throw new HttpError(400, `Database error: ${e.message}`);
  } finally {
    await db.end({ timeout: 2 });
  }
});
