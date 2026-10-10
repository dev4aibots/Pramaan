import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { createSession } from '@/lib/auth';

export const runtime = 'nodejs';
const DUMMY = '$2a$12$C6UzMDM.H6dfI/f/IKcEeO7b1Q7Yx1nV0t3n0Jq1o5yJ9cQd8c3xS';

export const POST = handler(async (req) => {
  const b = z.object({ email: z.string().email(), password: z.string().min(1) }).parse(await req.json());
  const [u] = await sql`select id, password_hash from users where email = ${b.email.toLowerCase().trim()}`;
  const ok = await bcrypt.compare(b.password, u?.password_hash ?? DUMMY); // constant-ish time
  if (!u || !ok) throw new HttpError(401, 'Invalid email or password');
  await createSession(u.id);
  return { ok: true };
});
