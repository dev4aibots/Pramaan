import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { createSession } from '@/lib/auth';
import { ensureSeeded, DEMO_EMAIL } from '@/lib/seed';

export const runtime = 'nodejs';

// One-click demo login: guarantees the demo account exists (re-seeds the
// ephemeral serverless DB if it was wiped), then starts a session.
export const POST = handler(async () => {
  await ensureSeeded(sql);
  const [u] = await sql`select id from users where email = ${DEMO_EMAIL}`;
  if (!u) throw new HttpError(500, 'Demo account unavailable — please try again');
  await createSession(u.id);
  return { ok: true };
});
