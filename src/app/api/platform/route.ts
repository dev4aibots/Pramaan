import { handler } from '@/lib/http';
import { detectRuntime, getServerPlatform, type FeatureStatus } from '@/lib/platform';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * Public, badge-safe: no auth, no secrets, no env values in the response.
 * `getServerPlatform()` (src/lib/platform.ts, ENGINE-2 V2-A) resolves the
 * server profile once per process — its DB probe has its own 2.5s timeout,
 * so this handler stays well under the 3s budget even with the DB down.
 */

// Engines that can ONLY be probed from the browser: no server — Vercel
// serverless included — can ever reach the user's localhost.
const CLIENT_PROBE_ENGINES = ['ollama', 'lmstudio', 'webllm'] as const;
const CLIENT_PROBE_NOTE =
  'Ollama/LM Studio/WebGPU can only be probed from the browser — Vercel serverless can never reach your localhost.';

/** Static fallback features for the fail-soft path: every reason is non-empty, nothing leaks. */
function degradedFeatures(): FeatureStatus[] {
  return [
    {
      feature: 'pglite',
      status: 'unavailable',
      reason: 'The database is unreachable, so document storage and vector search are disabled until it recovers.',
    },
    {
      feature: 'webllm',
      status: 'client_probe_required',
      reason: 'In-browser LLM via WebLLM — only your browser can tell if WebGPU is available.',
    },
    {
      feature: 'browser_embeddings',
      status: 'client_probe_required',
      reason: 'Embeddings run in your browser (Transformers.js, WebGPU with WASM fallback).',
    },
    {
      feature: 'ollama',
      status: 'client_probe_required',
      reason:
        'Ollama runs on your machine at localhost:11434 — probe it from the browser; the server can never reach your localhost.',
    },
    {
      feature: 'lmstudio',
      status: 'client_probe_required',
      reason: 'LM Studio at localhost:1234/v1 (switch on “Enable CORS”) — browser-only probe.',
    },
    {
      feature: 'byok',
      status: 'needs_setup',
      reason: 'Add an API key in Settings → Keys to enable cloud providers.',
    },
  ];
}

export const GET = handler(async () => {
  try {
    const profile = await getServerPlatform();
    return {
      platform: profile.runtime,
      db: { reachable: profile.db.reachable, latencyMs: profile.db.latencyMs },
      features: profile.features,
      clientProbes: { engines: [...CLIENT_PROBE_ENGINES], note: CLIENT_PROBE_NOTE },
    };
  } catch {
    // Fail soft, never 500 on DB-down: degraded 200 body, badge-safe.
    return {
      platform: detectRuntime(),
      db: { reachable: false, latencyMs: 0 },
      features: degradedFeatures(),
      clientProbes: { engines: [...CLIENT_PROBE_ENGINES], note: CLIENT_PROBE_NOTE },
      degraded: true,
    };
  }
});
