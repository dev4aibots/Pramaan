/**
 * Integration tests for PRAMAAN zero-config demo mode.
 *
 * Covers the complete demo flow at the API-route level (no browser):
 *   1. GET /api/demo            -> { demoMode: true } when DATABASE_URL is unset
 *   2. POST /api/demo           -> creates session (auth cookie), { ok: true }; idempotent
 *   3. GET /api/documents       -> 6 seeded documents with expected titles (after demo session)
 *   4. POST /api/demo           -> 400 "Demo mode is not available" when DATABASE_URL is external
 *   5. isDemoMode()             -> true unset / true localhost / false real Postgres URLs
 *   6. ensureDemoSeeded()       -> idempotent: twice -> still 6 documents, no duplicates
 *   7. hashEmbedding()          -> deterministic, 384-d, normalized
 *
 * Run from the project root:
 *   node --import ./test/setup.mjs --test test/demo.test.mts
 *
 * Notes:
 * - setup.mjs (loaded via --import) registers the ESM loader (resolves `@/`
 *   and extensionless TS imports through Node 24's native type-stripping),
 *   forces demo mode (DATABASE_URL unset), isolates PGlite to a fresh /tmp
 *   dir, and pins AUTH_SECRET.
 * - Next's `cookies()` requires a request store; tests run each handler call
 *   inside requestAsyncStorage + actionAsyncStorage({ isAppRoute: true }) so
 *   `cookies().set()` (createSession) and `cookies().get()` (requireCtx)
 *   hit a controllable in-memory cookie jar, mimicking a browser.
 */
import { describe, it, after, before } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { jwtVerify } from 'jose';

const require = createRequire(import.meta.url);
const { requestAsyncStorage } = require('next/dist/client/components/request-async-storage.external.js');
const { actionAsyncStorage } = require('next/dist/client/components/action-async-storage.external.js');
const { RequestCookies, ResponseCookies } = require('next/dist/server/web/spec-extension/cookies.js');

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

/** In-memory cookie jar standing in for a browser across request-store runs. */
function makeStore(initial = {}) {
  const mutableCookies = new ResponseCookies(new Headers());
  for (const [k, v] of Object.entries(initial)) mutableCookies.set(k, v);
  return { cookies: new RequestCookies(new Headers()), mutableCookies };
}

/** Run a route handler with Next's request stores so cookies() works. */
function withRequestScope(store, fn) {
  return requestAsyncStorage.run(store, () => actionAsyncStorage.run({ isAppRoute: true }, fn));
}

const get = (url) => new Request(url, { method: 'GET' });
const post = (url) => new Request(url, { method: 'POST' });

const EXPECTED_TITLES = [
  'NovaTech Employee Handbook 2026',
  'CloudSync Pro — Product Manual v4.2',
  '2026 Remote Work Productivity Study — Summary',
  'Customer Support FAQ',
  'Q3 2026 Financial Report.pdf',
  'Product Launch Plan.docx',
];

// Modules imported lazily inside tests so each scenario controls env first.
// (Static imports are hoisted above any env manipulation.)
let demoLib;
let demoRoute;
let docsRoute;
let db;

before(async () => {
  demoLib = await import('@/lib/demo.ts');
  db = await import('@/lib/db.ts');
  demoRoute = await import('@/app/api/demo/route.ts');
  docsRoute = await import('@/app/api/documents/route.ts');
});

after(async () => {
  // Close PGlite so the test process can exit.
  if (db?.sql?.end) await db.sql.end();
});

// ---------------------------------------------------------------------------
// scenario 5 — isDemoMode() (pure function; run first, saves/restores env)
// ---------------------------------------------------------------------------
describe('isDemoMode()', () => {
  it('is true when DATABASE_URL is unset', () => {
    const prev = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    try {
      assert.equal(demoLib.isDemoMode(), true);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it('is true when DATABASE_URL is empty', () => {
    const prev = process.env.DATABASE_URL;
    process.env.DATABASE_URL = '';
    try {
      assert.equal(demoLib.isDemoMode(), true);
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it('is true for localhost Postgres URLs', () => {
    const prev = process.env.DATABASE_URL;
    try {
      for (const url of [
        'postgres://postgres:postgres@localhost:5432/pramaan',
        'postgresql://user:pass@127.0.0.1:5432/pramaan',
        'postgres://localhost/mydb',
      ]) {
        process.env.DATABASE_URL = url;
        assert.equal(demoLib.isDemoMode(), true, `expected demo mode for ${url}`);
      }
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });

  it('is false for real (external) Postgres URLs', () => {
    const prev = process.env.DATABASE_URL;
    try {
      for (const url of [
        'postgres://app:secret@db.supabase.co:5432/postgres',
        'postgresql://user:pass@my-cluster.aws-rds.example.com:5432/pramaan',
      ]) {
        process.env.DATABASE_URL = url;
        assert.equal(demoLib.isDemoMode(), false, `expected NON-demo mode for ${url}`);
      }
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});

// ---------------------------------------------------------------------------
// scenario 7 — hashEmbedding() (pure function)
// ---------------------------------------------------------------------------
describe('hashEmbedding()', () => {
  it('is deterministic: same input -> same output', () => {
    const a = demoLib.hashEmbedding('NovaTech leave policy: 21 days of annual paid leave.');
    const b = demoLib.hashEmbedding('NovaTech leave policy: 21 days of annual paid leave.');
    assert.deepEqual(a, b);
  });

  it('gives different output for different input', () => {
    const a = demoLib.hashEmbedding('the quick brown fox jumps over the lazy dog');
    const b = demoLib.hashEmbedding('completely unrelated financial report figures q3 2026');
    assert.notDeepEqual(a, b);
  });

  it('returns a 384-d vector of finite numbers', () => {
    const v = demoLib.hashEmbedding('some representative document chunk text here');
    assert.equal(v.length, 384);
    assert.ok(v.every((x) => Number.isFinite(x)), 'all components must be finite numbers');
  });

  it('returns an L2-normalized vector (unit length)', () => {
    const v = demoLib.hashEmbedding('normalization check: benefits include Rs. 5 lakh health insurance');
    const norm = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
    assert.ok(Math.abs(norm - 1) < 1e-3, `expected unit norm, got ${norm}`);
  });

  it('handles empty / tiny input without NaN', () => {
    for (const s of ['', 'a', 'ab']) {
      const v = demoLib.hashEmbedding(s);
      assert.equal(v.length, 384);
      assert.ok(v.every((x) => Number.isFinite(x)), `finite for input ${JSON.stringify(s)}`);
    }
  });
});

// ---------------------------------------------------------------------------
// scenario 1 — GET /api/demo
// ---------------------------------------------------------------------------
describe('GET /api/demo', () => {
  it('returns { demoMode: true } when DATABASE_URL is unset', async () => {
    delete process.env.DATABASE_URL;
    const res = await withRequestScope(makeStore(), () => demoRoute.GET(get('http://localhost/api/demo')));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.deepEqual(body, { demoMode: true });
  });
});

// ---------------------------------------------------------------------------
// scenario 6 — ensureDemoSeeded() idempotency (seeds the DB for later tests)
// ---------------------------------------------------------------------------
describe('ensureDemoSeeded()', () => {
  it('is idempotent: call twice (fresh module instances) -> still 6 documents, no duplicates', async () => {
    delete process.env.DATABASE_URL;
    await demoLib.ensureDemoSeeded();

    // A second import gets a FRESH module instance (seededThisInvocation=false),
    // so this exercises the real DB-level guard, not just the in-memory flag.
    const fresh = await import('@/lib/demo.ts?fresh=idempotency');
    await fresh.ensureDemoSeeded();

    const rows = await db.sql`select id, title from documents`;
    const titles = rows.map((r) => r.title).sort();
    assert.equal(rows.length, 6, `expected 6 documents, got ${rows.length}: ${titles.join(' | ')}`);
    assert.equal(new Set(titles).size, 6, 'no duplicate titles — seed must not duplicate');
  });
});

// ---------------------------------------------------------------------------
// scenario 2 — POST /api/demo (session creation + idempotency)
// ---------------------------------------------------------------------------
describe('POST /api/demo', () => {
  let firstToken;

  it('creates a session: sets the auth cookie and returns { ok: true }', async () => {
    delete process.env.DATABASE_URL;
    const store = makeStore();
    const res = await withRequestScope(store, () => demoRoute.POST(post('http://localhost/api/demo'), {}));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });

    const cookie = store.mutableCookies.get('pramaan_session');
    assert.ok(cookie?.value, 'expected the pramaan_session auth cookie to be set');
    firstToken = cookie.value;

    // The cookie must be a valid JWT for the deterministic demo user.
    const { payload } = await jwtVerify(firstToken, new TextEncoder().encode(process.env.AUTH_SECRET));
    assert.equal(payload.uid, demoLib.DEMO_USER_ID);
  });

  it('is idempotent: a second call still works and issues a fresh session', async () => {
    delete process.env.DATABASE_URL;
    const store = makeStore();
    const res = await withRequestScope(store, () => demoRoute.POST(post('http://localhost/api/demo'), {}));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    const cookie = store.mutableCookies.get('pramaan_session');
    assert.ok(cookie?.value, 'expected a session cookie on the second call too');
    const { payload } = await jwtVerify(cookie.value, new TextEncoder().encode(process.env.AUTH_SECRET));
    assert.equal(payload.uid, demoLib.DEMO_USER_ID);
  });
});

// ---------------------------------------------------------------------------
// scenario 3 — GET /api/documents after demo session
// ---------------------------------------------------------------------------
describe('GET /api/documents (demo session)', () => {
  it('returns the 6 seeded documents with expected titles', async () => {
    delete process.env.DATABASE_URL;

    // Establish a session exactly like a browser would: POST /api/demo, keep cookie.
    const jar = makeStore();
    const loginRes = await withRequestScope(jar, () => demoRoute.POST(post('http://localhost/api/demo'), {}));
    assert.equal(loginRes.status, 200);
    const token = jar.mutableCookies.get('pramaan_session')?.value;
    assert.ok(token, 'demo login must set a session cookie');

    // Now request documents presenting that cookie (browser cookie-jar behavior).
    const authed = makeStore({ pramaan_session: token });
    const res = await withRequestScope(authed, () => docsRoute.GET(get('http://localhost/api/documents')));
    assert.equal(res.status, 200);
    const body = await res.json();
    assert.ok(Array.isArray(body.documents), 'expected { documents: [...] }');

    const titles = body.documents.map((d) => d.title);
    assert.equal(
      body.documents.length,
      6,
      `expected 6 seeded documents, got ${body.documents.length}: ${titles.join(' | ')}`,
    );
    for (const t of EXPECTED_TITLES) {
      assert.ok(titles.includes(t), `missing seeded document: ${t}`);
    }
    // Every seed doc carries its 4 chunks and the demo-seed source marker.
    for (const d of body.documents) {
      assert.equal(d.chunk_count, 4, `${d.title}: expected 4 chunks`);
      assert.equal(d.source, 'demo-seed', `${d.title}: expected source=demo-seed`);
    }
  });

  it('returns 401 without a session cookie', async () => {
    delete process.env.DATABASE_URL;
    const res = await withRequestScope(makeStore(), () => docsRoute.GET(get('http://localhost/api/documents')));
    assert.equal(res.status, 401);
  });
});

// ---------------------------------------------------------------------------
// scenario 4 — POST /api/demo with an external DATABASE_URL
// ---------------------------------------------------------------------------
describe('POST /api/demo with external DATABASE_URL', () => {
  it('returns 400 "Demo mode is not available"', async () => {
    const prev = process.env.DATABASE_URL;
    // Fast-failing, non-localhost address: isExternalDatabase() treats it as
    // external, and no real connection is ever needed (route rejects first).
    process.env.DATABASE_URL = 'postgres://test:test@127.0.0.2:1/pramaan_test';
    try {
      assert.equal(demoLib.isDemoMode(), false, 'precondition: external URL must disable demo mode');
      const res = await withRequestScope(makeStore(), () => demoRoute.POST(post('http://localhost/api/demo'), {}));
      assert.equal(res.status, 400);
      const body = await res.json();
      assert.ok(
        typeof body.error === 'string' && body.error.includes('Demo mode is not available'),
        `expected "Demo mode is not available" error, got: ${JSON.stringify(body)}`,
      );
    } finally {
      if (prev === undefined) delete process.env.DATABASE_URL;
      else process.env.DATABASE_URL = prev;
    }
  });
});
