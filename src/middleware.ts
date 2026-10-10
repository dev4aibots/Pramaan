import { NextResponse, type NextRequest } from 'next/server';

export function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/app') && !req.cookies.get('pramaan_session')) {
    return NextResponse.redirect(new URL('/login', req.url));
  }
  return NextResponse.next();
}
export const config = { matcher: ['/app/:path*'] };
