/**
 * Bootstrap for integration tests. Loaded via `node --import ./test/setup.mjs`
 * BEFORE any test file, so it runs ahead of all static imports.
 *
 * 1. Registers the ESM loader (resolves `@/` alias + extensionless TS imports).
 * 2. Forces demo mode: DATABASE_URL unset (demo tests must never touch a real DB).
 * 3. Isolates PGlite storage per run: fresh dir under /tmp (never the dev `.pgdata`).
 * 4. Pins AUTH_SECRET so session JWTs are verifiable in tests.
 */
import { register } from 'node:module';
import { AsyncLocalStorage } from 'node:async_hooks';
import fs from 'node:fs';
import path from 'node:path';

// Next 14's request-async-storage falls back to a throwing FakeAsyncLocalStorage
// when globalThis.AsyncLocalStorage is missing (true on this Node build).
// Install the real one BEFORE any next/* module is loaded, so cookies()/etc.
// work inside requestAsyncStorage.run() in tests.
if (!globalThis.AsyncLocalStorage) {
  globalThis.AsyncLocalStorage = AsyncLocalStorage;
}

register('./loader.mjs', import.meta.url);

delete process.env.DATABASE_URL;

const dataDir = path.join('/tmp', `pramaan-test-pgdata-${process.pid}`);
fs.rmSync(dataDir, { recursive: true, force: true });
fs.mkdirSync(dataDir, { recursive: true });
process.env.PGLITE_DATA_DIR = dataDir;

process.env.AUTH_SECRET = 'test-only-auth-secret-for-demo-integration-tests';

process.env.NODE_ENV = process.env.NODE_ENV || 'test';
