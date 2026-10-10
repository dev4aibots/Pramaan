// Demo auto-seed: on Vercel the PGlite data dir is ephemeral (/tmp), so a cold
// start wipes all data. When the DB is empty we re-create the demo org, demo
// user and demo documents (with pre-computed embeddings from db/seed-demo.json)
// so the live demo ALWAYS works: one click, no signup, no "account not found".
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';

export const DEMO_EMAIL = 'demo@pramaan.app';
export const DEMO_PASSWORD = 'demo1234';
// STABLE demo identity: every Vercel instance must create the SAME demo user
// and org IDs, otherwise a JWT minted on one cold instance won't match the
// freshly-seeded DB on another instance ("Account not found").
export const DEMO_USER_ID = 'de40de40-de40-4de4-8de4-de40de40de40';
export const DEMO_ORG_ID = '0de40de4-0de4-4de4-8de4-0de40de40de4';

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
    // Use stable IDs so a demo JWT works on ANY instance (ephemeral DBs).
    const [u] = await tx`insert into users (id, email, name, password_hash) values (${DEMO_USER_ID}, ${DEMO_EMAIL}, ${'Demo User'}, ${hash}) returning id`;
    const [o] = await tx`insert into orgs (id, name, kind, created_by) values (${DEMO_ORG_ID}, ${'Northbridge University'}, 'team', ${u.id}) returning id`;
    await tx`insert into memberships (org_id, user_id, role) values (${o.id}, ${u.id}, 'owner')`;
    await tx`update users set active_org_id = ${o.id} where id = ${u.id}`;
    return { uid: u.id, orgId: o.id };
  });

  // Demo documents with embeddings.
  // If NVIDIA_API_KEY is set, embed with NVIDIA NIM (default provider) so the
  // vectors match query embeddings. Otherwise use the pre-computed bge-small
  // vectors from db/seed-demo.json (browser-compatible fallback).
  try {
    const seedPath = path.join(process.cwd(), 'db', 'seed-demo.json');
    if (fs.existsSync(seedPath)) {
      const docs = JSON.parse(fs.readFileSync(seedPath, 'utf8'));
      const useNvidia = !!process.env.NVIDIA_API_KEY;
      let nvidia: any = null;
      if (useNvidia) {
        try { nvidia = await import('./embeddings'); } catch { nvidia = null; }
      }
      for (const doc of docs) {
        const [d] = await sql`insert into documents (org_id, owner_id, title, source, mime, visibility) values (${orgId}, ${uid}, ${doc.title}, 'demo-seed', ${doc.mime}, ${doc.visibility || 'org'}) returning id`;
        let vectors: number[][] | null = null;
        if (nvidia) {
          try {
            vectors = await nvidia.embedNvidia(doc.chunks.map((c: any) => c.content));
          } catch (e: any) { console.warn('[pramaan seed] nvidia embed failed, using fallback:', e?.message); }
        }
        for (let i = 0; i < doc.chunks.length; i++) {
          const c = doc.chunks[i];
          const vec = vectors ? vectors[i] : c.embedding;
          await sql`insert into chunks (document_id, org_id, idx, content, quarantined, risk, embedding) values (${d.id}, ${orgId}, ${c.idx}, ${c.content}, false, 0, ${`[${vec.join(',')}]`}::vector)`;
        }
        await sql`update documents set chunk_count = ${doc.chunks.length} where id = ${d.id}`;
      }
      console.log(`[pramaan seed] seeded ${docs.length} demo documents (${useNvidia && nvidia ? 'nvidia' : 'bge-small'} embeddings)`);
    }
  } catch (e: any) {
    console.warn('[pramaan seed] demo documents skipped:', e?.message);
  }
  console.log('[pramaan seed] done — demo login: demo@pramaan.app / demo1234');
}
