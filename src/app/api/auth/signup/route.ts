import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { createSession } from '@/lib/auth';
import { audit } from '@/lib/audit';

export const runtime = 'nodejs';
const Body = z.object({ email: z.string().email().max(200), password: z.string().min(8).max(200), name: z.string().max(100).default('') });

export const POST = handler(async (req) => {
  const b = Body.parse(await req.json());
  const email = b.email.toLowerCase().trim();
  const [exists] = await sql`select 1 from users where email = ${email}`;
  if (exists) throw new HttpError(409, 'Email already registered');
  const hash = await bcrypt.hash(b.password, 12);
  const { uid, orgId } = await sql.begin(async (tx: any) => {
    const [u] = await tx`insert into users (email, name, password_hash) values (${email}, ${b.name}, ${hash}) returning id`;
    const [o] = await tx`insert into orgs (name, kind, created_by) values (${'Personal vault'}, 'personal', ${u.id}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${u.id}, 'owner')`;
    await tx`update users set active_org_id = ${o.id} where id = ${u.id}`;
    return { uid: u.id, orgId: o.id };
  });
  await createSession(uid);
  await audit({ orgId, userId: uid }, 'signup', {});
  return { ok: true };
});
