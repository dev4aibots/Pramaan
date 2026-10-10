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
      if (req.method !== 'GET') {
        // CSRF defense: reject cross-origin state-changing requests
        const origin = req.headers.get('origin');
        const host = req.headers.get('x-forwarded-host') ?? req.headers.get('host');
        if (origin && host && new URL(origin).host !== host) {
          throw new HttpError(403, 'Cross-origin request blocked');
        }
      }
      const data = await fn(req, ctx);
      return data instanceof Response ? data : NextResponse.json(data);
    } catch (e: any) {
      if (e instanceof HttpError) return NextResponse.json({ error: e.message }, { status: e.status });
      if (e?.name === 'ZodError') return NextResponse.json({ error: 'Invalid input', issues: e.issues }, { status: 400 });
      console.error('[pramaan]', e);
      return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
    }
  };
}
