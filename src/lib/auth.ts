import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { sql } from './db';
import { HttpError } from './http';

export const COOKIE = 'pramaan_session';
export type Role = 'owner' | 'admin' | 'manager' | 'member' | 'viewer';
export const ROLE_RANK: Record<Role, number> = { viewer: 0, member: 1, manager: 2, admin: 3, owner: 4 };

export type Ctx = {
  userId: string;
  email: string;
  name: string;
  orgId: string;
  orgName: string;
  orgKind: 'personal' | 'team';
  role: Role;
  subjectRef: string | null;
};

const secret = () => {
  const s = process.env.AUTH_SECRET || 'pramaan-production-auth-secret-fallback-key-2026';
  return new TextEncoder().encode(s);
};

export async function createSession(uid: string) {
  const token = await new SignJWT({ uid })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret());
  cookies().set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24 * 7,
  });
}

export function clearSession() {
  cookies().set(COOKIE, '', { path: '/', maxAge: 0 });
}

export async function requireCtx(): Promise<Ctx> {
  const token = cookies().get(COOKIE)?.value;
  if (!token) throw new HttpError(401, 'Not signed in');
  let uid: string;
  try {
    const { payload } = await jwtVerify(token, secret());
    uid = payload.uid as string;
  } catch {
    throw new HttpError(401, 'Session expired');
  }
  const rows = await sql`
    select u.id, u.email, u.name, m.org_id, m.role, m.subject_ref, o.name as org_name, o.kind
    from users u
    join memberships m on m.user_id = u.id
    join orgs o on o.id = m.org_id
    where u.id = ${uid}
    order by (m.org_id = u.active_org_id) desc nulls last, (o.kind = 'personal') desc
    limit 1`;
  if (!rows.length) throw new HttpError(401, 'Account not found');
  const r = rows[0];
  return {
    userId: r.id,
    email: r.email,
    name: r.name,
    orgId: r.org_id,
    orgName: r.org_name,
    orgKind: r.kind,
    role: r.role,
    subjectRef: r.subject_ref,
  };
}

export function atLeast(ctx: Ctx, role: Role) {
  return ROLE_RANK[ctx.role] >= ROLE_RANK[role];
}
export function requireRole(ctx: Ctx, role: Role) {
  if (!atLeast(ctx, role)) throw new HttpError(403, `Requires ${role} role or higher`);
}
export const isAdmin = (ctx: Ctx) => ctx.role === 'owner' || ctx.role === 'admin';
