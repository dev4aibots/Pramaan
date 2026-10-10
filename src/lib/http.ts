import { NextResponse } from 'next/server';

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export function handler(fn: (req: Request, ctx: any) => Promise<any>) {
  return async (req: Request, ctx: any) => {
    try {
      if (req.method === 'OPTIONS') {
        return new Response(null, {
          status: 204,
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type, Authorization, x-user-id, x-org-id, x-role',
          },
        });
      }

      if (req.method !== 'GET') {
        const origin = req.headers.get('origin');
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
        if (origin && origin !== 'null') {
          try {
            const parsedOrigin = new URL(origin);
            if (host && parsedOrigin.host !== host && !parsedOrigin.hostname.includes('localhost') && !parsedOrigin.hostname.includes('127.0.0.1')) {
              throw new HttpError(403, 'Cross-origin request blocked');
            }
          } catch (e: any) {
            if (e instanceof HttpError) throw e;
          }
        }
      }

      const data = await fn(req, ctx);
      const res = data instanceof Response ? data : NextResponse.json(data);
      res.headers.set('Access-Control-Allow-Origin', '*');
      res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization, x-user-id, x-org-id, x-role');
      return res;
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e?.name === 'ZodError') return NextResponse.json({ error: 'Invalid input', issues: e.issues }, { status: 400 });
      console.error('[pramaan]', e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
