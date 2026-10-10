/**
 * Server-side platform detection for PRAMAAN v2.
 *
 * Pure server-only module: answers "where am I running, and what can this
 * server tell us about feature availability?". Anything that can only be
 * decided in the user's browser (WebGPU, localhost LLM servers) is marked
 * `client_probe_required` with a human-readable reason — never silently
 * disabled, never leaking secrets, env values, paths, or hostnames.
 */

import { sql } from './db';

export type Runtime = 'vercel' | 'self-hosted';

export type DbProbe = {
  reachable: boolean;
  latencyMs: number;
  /** Sanitized, human-safe message. Never contains connection strings, paths, or hostnames. */
  error?: string;
};

export type FeatureName =
  | 'webllm'
  | 'browser_embeddings'
  | 'ollama'
  | 'lmstudio'
  | 'byok'
  | 'pglite';

export type FeatureStatusValue =
  | 'available'
  | 'unavailable'
  | 'needs_setup'
  | 'client_probe_required';

export type FeatureStatus = {
  feature: FeatureName;
  status: FeatureStatusValue;
  reason: string;
};

export type ServerPlatform = {
  runtime: Runtime;
  db: DbProbe;
  features: FeatureStatus[];
  /** ISO-8601 timestamp of when detection ran (cached per process). */
  detectedAt: string;
};

/**
 * Vercel sets the `VERCEL` env var (to "1") on every deployment.
 * Any other environment counts as self-hosted.
 */
export function detectRuntime(): Runtime {
  return process.env.VERCEL ? 'vercel' : 'self-hosted';
}

/**
 * Collapse arbitrary DB driver errors into a short, safe message.
 * No connection strings, credentials, filesystem paths, or hostnames
 * ever reach the caller.
 */
function sanitizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? '');
  const m = raw.toLowerCase();

  if (/timeout|timed out|etimedout/.test(m)) return 'Database query timed out.';
  if (/econnrefused|connection refused/.test(m)) return 'Database connection refused.';
  if (/enotfound|getaddrinfo|dns/.test(m)) return 'Database host could not be resolved.';
  if (/econnreset|econnaborted|epipe|socket hang up/.test(m)) return 'Database connection was reset.';
  if (/28p01|password authentication|authentication failed|role .* does not exist/.test(m))
    return 'Database authentication failed.';
  if (/could not connect/.test(m)) return 'Could not connect to the database.';

  // Generic fallback: redact anything that looks like a secret, URL, IP, or path.
  let s = raw.split('\n')[0].trim();
  s = s.replace(/[a-z][a-z0-9+.-]{1,20}:\/\/\S+/gi, '[connection]');
  s = s.replace(/\b\d{1,3}(?:\.\d{1,3}){3}(?::\d+)?\b/g, '[host]');
  s = s.replace(/(["'`]?)((?:\/[\w.~][\w.~\-]*)+)\1/g, '[path]');
  s = s.replace(/\b[a-zA-Z]:\\[\w.~\\-]+\b/g, '[path]');
  s = s.replace(/\s{2,}/g, ' ');
  s = s.slice(0, 200);
  return s || 'Database unavailable.';
}

/**
 * Check DB reachability with a `select 1`. Never throws: failures return
 * `{ reachable: false, error }` with a sanitized message.
 */
export async function probeDb(timeoutMs = 2500): Promise<DbProbe> {
  const start = Date.now();
  try {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Database query timed out after ${timeoutMs}ms`)),
        timeoutMs
      );
    });
    try {
      // `sql` is the project's existing tagged-template client (db.ts);
      // Promise.race assimilates its thenable.
      await Promise.race([sql`select 1`, timeout]);
    } finally {
      if (timer) clearTimeout(timer);
    }
    return { reachable: true, latencyMs: Date.now() - start };
  } catch (e) {
    return { reachable: false, latencyMs: Date.now() - start, error: sanitizeError(e) };
  }
}

function buildFeatures(db: DbProbe): FeatureStatus[] {
  return [
    {
      feature: 'pglite',
      status: db.reachable ? 'available' : 'unavailable',
      reason: db.reachable
        ? `Embedded database is reachable (query round-trip ${db.latencyMs}ms). Document storage and vector search are ready.`
        : `Embedded database is unreachable: ${db.error ?? 'unknown error'} Documents cannot be stored or searched until the database is available.`,
    },
    {
      feature: 'webllm',
      status: 'client_probe_required',
      reason:
        'In-browser LLM via WebLLM. Works on Vercel and self-hosted — only your browser can tell if WebGPU is available.',
    },
    {
      feature: 'browser_embeddings',
      status: 'client_probe_required',
      reason: 'Transformers.js embeddings run in your browser (WebGPU, WASM fallback).',
    },
    {
      feature: 'ollama',
      status: 'client_probe_required',
      reason:
        'Ollama runs on YOUR machine at localhost:11434. Your browser can reach it directly; Vercel\'s servers can never reach your localhost — that is why this check runs in the browser, not on the server.',
    },
    {
      feature: 'lmstudio',
      status: 'client_probe_required',
      reason:
        "LM Studio's OpenAI-compatible server at localhost:1234/v1. Enable CORS in LM Studio. Browser-only: no remote server can reach your localhost.",
    },
    {
      feature: 'byok',
      status: 'needs_setup',
      reason:
        'Add an API key in Settings → Keys. Keys are encrypted server-side and never exposed.',
    },
  ];
}

let cached: Promise<ServerPlatform> | null = null;

/**
 * Compute the server platform profile once per process and reuse it.
 * Safe to call from any route handler.
 */
export function getServerPlatform(): Promise<ServerPlatform> {
  if (!cached) {
    cached = (async (): Promise<ServerPlatform> => {
      const runtime = detectRuntime();
      const db = await probeDb();
      return { runtime, db, features: buildFeatures(db), detectedAt: new Date().toISOString() };
    })();
  }
  return cached;
}
