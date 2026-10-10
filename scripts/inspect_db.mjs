import { PGlite } from '@electric-sql/pglite';
import { vector } from '@electric-sql/pglite-pgvector';

const db = new PGlite('./.pgdata', { extensions: { vector } });

try {
  const users = await db.query('select id, email, name, active_org_id from users');
  console.log('=== USERS ===', users.rows);

  const orgs = await db.query('select id, name, kind, created_by from orgs');
  console.log('=== ORGS ===', orgs.rows);

  const memberships = await db.query('select org_id, user_id, role, subject_ref from memberships');
  console.log('=== MEMBERSHIPS ===', memberships.rows);

  const docs = await db.query('select id, title, visibility, allowed_roles, chunk_count, quarantined_chunks from documents');
  console.log('=== DOCUMENTS ===', docs.rows);

  const chunks = await db.query('select id, document_id, idx, subject_ref, quarantined, risk, left(content, 60) as sample from chunks');
  console.log('=== CHUNKS ===', chunks.rows);
} catch (err) {
  console.error('Error:', err);
} finally {
  await db.close();
}
