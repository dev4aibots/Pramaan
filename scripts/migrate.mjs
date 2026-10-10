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

const dbUrl = process.env.DATABASE_URL || '';
const isExternal =
  dbUrl &&
  !dbUrl.includes('localhost:5432') &&
  !dbUrl.includes('127.0.0.1:5432') &&
  !dbUrl.includes('postgres://postgres:postgres@localhost');

const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
let schema = fs.readFileSync(schemaPath, 'utf8');

if (isExternal) {
  const sql = postgres(dbUrl, { max: 1 });
  try {
    await sql.unsafe(schema);
    console.log('✅ PRAMAAN schema applied to external PostgreSQL');
  } catch (e) {
    console.error('❌ Migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
} else {
  const { PGlite } = await import('@electric-sql/pglite');
  const { vector } = await import('@electric-sql/pglite-pgvector');
  const db = new PGlite('./.pgdata', { extensions: { vector } });
  try {
    schema = schema.replace(/create extension if not exists pgcrypto;/gi, '-- pgcrypto built-in');
    await db.exec(schema);
    console.log('✅ PRAMAAN schema applied to embedded local PostgreSQL (.pgdata)');
  } catch (e) {
    console.error('❌ Embedded migration failed:', e.message);
    process.exitCode = 1;
  } finally {
    await db.close();
  }
}
