/**
 * ESM resolve hook for integration tests.
 *
 * The app sources are TypeScript using the `@/` path alias (tsconfig
 * `paths: { "@/*": ["./src/*"] }`). Node 24 strips types natively, but it
 * cannot resolve `@/` or extensionless relative imports (`./db` -> `./db.ts`).
 * This hook handles both, then delegates everything else to default resolution.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function tryFile(p) {
  try {
    if (existsSync(p) && statSync(p).isFile()) return p;
  } catch { /* ignore */ }
  return null;
}

function resolveWithExtensions(base) {
  return (
    tryFile(base) ||
    tryFile(base + '.ts') ||
    tryFile(base + '.tsx') ||
    tryFile(base + '.mts') ||
    tryFile(path.join(base, 'index.ts'))
  );
}

function splitQuery(specifier) {
  const q = specifier.indexOf('?');
  if (q < 0) return [specifier, ''];
  return [specifier.slice(0, q), specifier.slice(q)];
}

function parentDir(parentURL) {
  try {
    return path.dirname(fileURLToPath(new URL(parentURL.split('?')[0])));
  } catch {
    return null;
  }
}

export async function resolve(specifier, context, nextResolve) {
  // Next 14 ships root-level CJS shims (`next/server.js`, `next/headers.js`)
  // but its package.json has no `exports` map, so bare `next/server` /
  // `next/headers` specifiers fail under Node ESM. Map them explicitly.
  if (specifier === 'next/server' || specifier === 'next/headers') {
    const shim = path.join(PROJECT_ROOT, 'node_modules', specifier + '.js');
    if (tryFile(shim)) return { url: pathToFileURL(shim).href, shortCircuit: true };
  }

  // `@/` alias -> <project>/src/...
  if (specifier.startsWith('@/')) {
    const [clean, query] = splitQuery(specifier);
    const base = path.join(PROJECT_ROOT, 'src', clean.slice(2));
    const resolved = resolveWithExtensions(base);
    if (resolved) return { url: pathToFileURL(resolved).href + query, shortCircuit: true };
    // fall through to default (will throw a useful error)
  }

  try {
    return await nextResolve(specifier, context);
  } catch (err) {
    // Extensionless relative imports inside TS sources (e.g. `import { sql } from './db'`).
    const [clean, query] = splitQuery(specifier);
    const isRelative = clean.startsWith('./') || clean.startsWith('../');
    const dir = context.parentURL ? parentDir(context.parentURL) : null;
    if ((isRelative || specifier.startsWith('@/')) && dir && err && err.code === 'ERR_MODULE_NOT_FOUND') {
      const base = specifier.startsWith('@/')
        ? path.join(PROJECT_ROOT, 'src', clean.slice(2))
        : path.resolve(dir, clean);
      const resolved = resolveWithExtensions(base);
      if (resolved) return { url: pathToFileURL(resolved).href + query, shortCircuit: true };
    }
    throw err;
  }
}
