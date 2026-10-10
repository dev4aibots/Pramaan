import postgres from 'postgres';
import fs from 'node:fs';
import path from 'node:path';

const g = globalThis as unknown as { __pramaanSql?: any; __pgliteInstance?: any };

// External database support disabled per user request (2026-10-10):
// "Without any external connection, NVIDIA only as .env".
// The app always uses the built-in PGlite database. NVIDIA_API_KEY is the
// only external credential, used for the chat LLM.
function isExternalDatabase(_url?: string): boolean {
  return false;
}

function createPgliteAdapter(dataDir?: string) {
  // Debate #1 (ENGINE-1): on Vercel the filesystem is read-only except /tmp,
  // so the default <cwd>/.pgdata would crash — and even in /tmp nothing
  // persists between invocations. Default to /tmp on Vercel; durable
  // production data requires an external DATABASE_URL. PGLITE_DATA_DIR
  // overrides explicitly everywhere.
  const resolvedDir =
    dataDir ||
    process.env.PGLITE_DATA_DIR ||
    (process.env.VERCEL ? '/tmp/pramaan-pgdata' : path.join(process.cwd(), '.pgdata'));
  let dbPromise: Promise<any> | null = null;

  async function getDb() {
    if (g.__pgliteInstance) return g.__pgliteInstance;
    if (!dbPromise) {
      dbPromise = (async () => {
        const { PGlite } = await import('@electric-sql/pglite');
        const { vector } = await import('@electric-sql/pglite-pgvector');
        const db = new PGlite(resolvedDir, { extensions: { vector } });

        // Auto-apply schema if not applied
        try {
          const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
          if (fs.existsSync(schemaPath)) {
            let schema = fs.readFileSync(schemaPath, 'utf8');
            schema = schema.replace(/create extension if not exists pgcrypto;/gi, '-- pgcrypto built-in');
            await db.exec(schema);
          }
        } catch (e: any) {
          console.warn('[pramaan db] Schema auto-init notice:', e.message);
        }

        g.__pgliteInstance = db;
        return db;
      })();
    }
    return dbPromise;
  }

  function formatQuery(strings: TemplateStringsArray, values: any[]) {
    let text = '';
    const params: any[] = [];

    for (let i = 0; i < strings.length; i++) {
      text += strings[i];
      if (i < values.length) {
        const val = values[i];
        if (val && val.__isSqlFragment) {
          const nested = formatQuery(val.strings, val.values);
          // Single-pass renumber: $n -> $(base+n). The old sequential loop
          // rewrote placeholders it had just inserted (a later j+1 matching
          // an earlier newIndex), so nested $n bound to the wrong params —
          // every retrieve() threw `cannot cast type uuid to boolean`.
          const base = params.length;
          for (const p of nested.params) params.push(p);
          text += nested.text.replace(/\$(\d+)\b/g, (_m, n) => `$${base + Number(n)}`);
        } else if (val && val.__isJson) {
          params.push(val.value);
          text += `$${params.length}`;
        } else {
          params.push(val);
          text += `$${params.length}`;
        }
      }
    }
    return { text, params };
  }

  function createSqlInstance(targetResolver: () => Promise<any> | any) {
    const fn = function (strings: TemplateStringsArray, ...values: any[]) {
      if (!Array.isArray(strings)) {
        throw new Error('sql must be called as a tagged template literal');
      }

      const fragment = {
        __isSqlFragment: true,
        strings,
        values,
        then(onFulfilled?: (value: any) => any, onRejected?: (reason: any) => any) {
          return Promise.resolve(targetResolver())
            .then(async (db) => {
              const { text, params } = formatQuery(strings, values);
              const res = await db.query(text, params);
              const rows = res.rows || [];
              rows.count = res.affectedRows ?? rows.length;
              return onFulfilled ? onFulfilled(rows) : rows;
            })
            .catch((err) => (onRejected ? onRejected(err) : Promise.reject(err)));
        },
      };

      return fragment;
    };

    fn.begin = async function (callback: (tx: any) => Promise<any>) {
      const db = await targetResolver();
      return await db.transaction(async (txTarget: any) => {
        const txSql = createSqlInstance(() => txTarget);
        return await callback(txSql);
      });
    };

    fn.json = function (val: any) {
      return { __isJson: true, value: JSON.stringify(val) };
    };

    fn.unsafe = async function (query: string) {
      const db = await targetResolver();
      const res = await db.query(query);
      const rows = res.rows || [];
      rows.count = res.affectedRows ?? rows.length;
      return rows;
    };

    fn.end = async function () {
      if (g.__pgliteInstance) {
        await g.__pgliteInstance.close();
        g.__pgliteInstance = null;
      }
    };

    return fn;
  }

  return createSqlInstance(getDb);
}

export const sql =
  g.__pramaanSql ??
  (isExternalDatabase(process.env.DATABASE_URL)
    ? postgres(process.env.DATABASE_URL!, {
        max: 5,
        prepare: false, // compatible with pgbouncer / Neon pooled URLs
        idle_timeout: 20,
      })
    : createPgliteAdapter());

if (process.env.NODE_ENV !== 'production') g.__pramaanSql = sql;

// Auto-init schema on external databases (e.g. Supabase): if the users table
// is missing, apply db/schema.sql automatically. This makes the app self-
// provisioning — no manual SQL step needed.
let schemaInit: Promise<void> | null = null;
export function ensureSchema(): Promise<void> {
  if (!isExternalDatabase(process.env.DATABASE_URL)) return Promise.resolve();
  if (!schemaInit) {
    schemaInit = (async () => {
      try {
        await sql`select 1 from users limit 1`;
      } catch (e: any) {
        if (e?.message?.includes('does not exist') || e?.code === '42P01') {
          console.log('[pramaan db] schema missing — applying db/schema.sql');
          const fs = await import('node:fs');
          const path = await import('node:path');
          const schemaPath = path.join(process.cwd(), 'db', 'schema.sql');
          let schema = fs.readFileSync(schemaPath, 'utf8');
          // Supabase already has pgcrypto; keep vector extension
          schema = schema.replace(/create extension if not exists pgcrypto;/gi, '-- pgcrypto pre-installed');
          // Split on semicolons and run each statement (simple but works for our schema)
          const stmts = schema.split(/;\s*\n/).map(s => s.trim()).filter(s => s && !s.startsWith('--'));
          for (const stmt of stmts) {
            try { await sql.unsafe(stmt); } catch (err: any) {
              if (!err?.message?.includes('already exists')) throw err;
            }
          }
          console.log('[pramaan db] schema applied');
        } else throw e;
      }
    })().catch((e) => { console.warn('[pramaan db] schema init failed:', e?.message); schemaInit = null; });
  }
  return schemaInit;
}
// Kick off schema check in background (don't block import)
ensureSchema().catch(() => {});
