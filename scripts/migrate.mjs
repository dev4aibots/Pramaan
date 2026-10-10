import fs from 'node:fs';
import path from 'node:path';
import postgres from 'postgres';

// Minimal .env.local loader (no dependency)
for (const f of ['.env.local', '.env']) {
  if (fs.existsSync(f)) {
    for (const line of fs.readFileSync(f, 'utf8').split('\n')) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m && !process.env[m[1]]) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
    }
  }
}
if (!process.env.DATABASE_URL) {
  console.error('DATABASE_URL is not set');
  process.exit(1);
}
const sql = postgres(process.env.DATABASE_URL, { max: 1 });
const schema = fs.readFileSync(path.join(process.cwd(), 'db', 'schema.sql'), 'utf8');
try {
  await sql.unsafe(schema);
  console.log('✅ PRAMAAN schema applied');
} catch (e) {
  console.error('❌ Migration failed:', e.message);
  process.exitCode = 1;
} finally {
  await sql.end();
}
