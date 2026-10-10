// Demo auto-seed: on Vercel the PGlite data dir is ephemeral (/tmp), so a cold
// start wipes all data. When the DB is empty we re-create the demo org, demo
// user and demo documents (with pre-computed embeddings from db/seed-demo.json)
// so the live demo ALWAYS works: one click, no signup, no "account not found".
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

export const DEMO_EMAIL = 'demo@pramaan.app';
export const DEMO_PASSWORD = 'demo1234';

let seeded: Promise<void> | null = null;

export function ensureSeeded(sql: any): Promise<void> {
  if (!seeded) seeded = doSeed(sql).catch((e) => {
    console.warn('[pramaan seed] failed:', e?.message);
    seeded = null; // retry next time
  });
  return seeded;
}

async function doSeed(sql: any) {
  const [existing] = await sql`select 1 from users limit 1`;
  if (existing) return; // DB already has data

  console.log('[pramaan seed] empty DB — seeding demo org, user and documents');
  const hash = await bcrypt.hash(DEMO_PASSWORD, 10);
  const { uid, orgId } = await sql.begin(async (tx: any) => {
    const [u] = await tx`insert into users (email, name, password_hash) values (${DEMO_EMAIL}, ${'Demo User'}, ${hash}) returning id`;
    const [o] = await tx`insert into orgs (name, kind, created_by) values (${'Northbridge University'}, 'team', ${u.id}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${u.id}, 'owner')`;
    await tx`update users set active_org_id = ${o.id} where id = ${u.id}`;
    return { uid: u.id, orgId: o.id };
  });

  // Demo documents with pre-computed 384-d embeddings
  try {
    const seedPath = path.join(process.cwd(), 'db', 'seed-demo.json');
    if (fs.existsSync(seedPath)) {
      const docs = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      for (const doc of docs) {
        const [d] = await sql`insert into documents (org_id, owner_id, title, source, mime, visibility) values (${orgId}, ${uid}, ${doc.title}, 'demo-seed', ${doc.mime}, ${doc.visibility || 'org'}) returning id`;
        for (const c of doc.chunks) {
          await sql`insert into chunks (document_id, org_id, idx, content, quarantined, risk, embedding) values (${d.id}, ${orgId}, ${c.idx}, ${c.content}, false, 0, ${`[${c.embedding.join(',')}]`}::vector)`;
        }
        await sql`update documents set chunk_count = ${doc.chunks.length} where id = ${d.id}`;
      }
      console.log(`[pramaan seed] seeded ${docs.length} demo documents`);
    }
  } catch (e: any) {
    console.warn('[pramaan seed] demo documents skipped:', e?.message);
  }
  console.log('[pramaan seed] done — demo login: demo@pramaan.app / demo1234');
}
