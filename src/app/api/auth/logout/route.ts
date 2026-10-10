import { handler } from '@/lib/http';
import { clearSession } from '@/lib/auth';
export const runtime = 'nodejs';
export const POST = handler(async () => { clearSession(); return { ok: true }; });
