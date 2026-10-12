import { handler, HttpError } from '@/lib/http';
import { createSession } from '@/lib/auth';
import { isDemoMode, ensureDemoSeeded, DEMO_USER_ID } from '@/lib/demo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET /api/demo → { demoMode: boolean }
// Lets the landing page decide whether to show the "Try Demo" button.
export const GET = handler(async () => {
  return { demoMode: isDemoMode() };
});

// POST /api/demo → creates the demo session (no password needed).
// Only works when no external DATABASE_URL is configured.
export const POST = handler(async () => {
  if (!isDemoMode()) {
    throw new HttpError(400, 'Demo mode is not available on this deployment');
  }
  await ensureDemoSeeded();
  await createSession(DEMO_USER_ID);
  return { ok: true };
});
