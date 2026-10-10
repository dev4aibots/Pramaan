import crypto from 'node:crypto';

function key(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (raw) {
    const b = Buffer.from(raw, 'base64');
    if (b.length === 32) return b;
  }
  const fallbackSecret = process.env.AUTH_SECRET || 'pramaan-production-auth-secret-fallback-key-2026';
  return crypto.createHash('sha256').update(fallbackSecret).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), ct].map((b) => b.toString('base64')).join('.');
}

export function decrypt(enc: string): string {
  const [iv, tag, ct] = enc.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(ct), d.final()]).toString('utf8');
}

export const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');
export const randomToken = (n = 6) => crypto.randomBytes(n).toString('hex');
