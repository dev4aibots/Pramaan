'use client';

/**
 * detect.ts — browser-only probes for local LLM engines.
 *
 * Client-only module: imports nothing from the server. These probes let the UI
 * tell the user exactly why a feature is (un)available, instead of silently
 * disabling it.
 *
 * Complement to `engines.ts` (WebLLM load/run, Ollama pull streaming, engine
 * selection). This file answers "is anything there at all?" — with timeouts,
 * timings, and actionable reasons.
 */

export type ProbeResult = {
  /** Did the endpoint answer (HTTP, CORS-clean) within the timeout? */
  reachable: boolean;
  /** Model ids reported by the server (empty when unreachable). */
  models: string[];
  /** Round-trip time in ms (best-effort; includes timeout waits on failure). */
  ms: number;
  /** Human-readable, actionable explanation — always safe to show in UI. */
  reason: string;
};

export type FeatureState = 'available' | 'unavailable';

export type FeatureStatus = {
  feature: string;
  status: FeatureState;
  reason: string;
};

/** Shape V2-A's server `platform.ts` emits for `GET /api/platform`. */
export type ServerFeature = {
  feature: string;
  status: FeatureState | 'client_probe_required';
  /** Server-side explanation (e.g. why Vercel serverless can never see localhost). */
  reason: string;
};
export type ServerFeatures = ServerFeature[];

/** Result of detectLocalEngines(): per-engine statuses shaped to merge with the server table. */
export type LocalReport = {
  webgpu: boolean;
  secureContext: boolean;
  webllm: FeatureStatus;
  ollama: FeatureStatus;
  lmstudio: FeatureStatus;
  /** Raw probe payloads, in case the UI wants model lists / timings. */
  ollamaProbe: ProbeResult;
  lmstudioProbe: ProbeResult;
  generatedAt: string;
};

export const OLLAMA_URL = 'http://localhost:11434';
export const LMSTUDIO_URL = 'http://localhost:1234';

const now = () =>
  typeof performance !== 'undefined' && typeof performance.now === 'function' ? performance.now() : Date.now();

// NOTE (mixed content): an https page MAY fetch http://localhost. Localhost is a
// "trustworthy"/potentially-trustworthy origin, so browsers do not treat this as
// mixed content. No https wrapper is needed to reach Ollama/LM Studio.

function deadProbe(ms: number, reason: string): ProbeResult {
  return { reachable: false, models: [], ms, reason };
}

/**
 * GET http://localhost:11434/api/tags with a timeout.
 * Never throws — connection refused / timeouts map to a helpful reason.
 */
export async function probeOllama(timeoutMs = 2000): Promise<ProbeResult> {
  const t0 = now();
  try {
    const res = await fetch(`${OLLAMA_URL}/api/tags`, { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(now() - t0);
    if (!res.ok) {
      return deadProbe(ms, `Ollama answered HTTP ${res.status} at localhost:11434 — the server may be misconfigured or still starting`);
    }
    const j = (await res.json().catch(() => ({}))) as any;
    const models: string[] = ((j?.models ?? []) as any[]).map((m) => m?.name).filter(Boolean);
    const msNote = `${ms} ms`;
    return {
      reachable: true,
      models,
      ms,
      reason: models.length
        ? `Ollama reachable at localhost:11434 (${msNote}) — ${models.length} model(s): ${models.join(', ')}`
        : `Ollama reachable at localhost:11434 (${msNote}) — no models installed yet; run \`ollama pull <model>\``,
    };
  } catch (e: any) {
    const ms = Math.round(now() - t0);
    const base = 'Ollama not detected at localhost:11434 — start Ollama on this machine (ollama serve)';
    return deadProbe(ms, e?.name === 'TimeoutError' ? `${base} — timed out after ${timeoutMs} ms` : base);
  }
}

/**
 * GET http://localhost:1234/v1/models with a timeout.
 * A TypeError almost always means CORS rejection (or nothing listening), so it
 * gets the CORS-specific guidance per the spec. Never throws.
 */
export async function probeLMStudio(timeoutMs = 2000): Promise<ProbeResult> {
  const t0 = now();
  const corsReason = "LM Studio did not answer — enable 'Serve on local network' AND 'Enable CORS' in LM Studio settings";
  try {
    const res = await fetch(`${LMSTUDIO_URL}/v1/models`, { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Math.round(now() - t0);
    if (!res.ok) {
      return deadProbe(ms, `LM Studio answered HTTP ${res.status} at localhost:1234 — check the server status in LM Studio`);
    }
    const j = (await res.json().catch(() => ({}))) as any;
    const models: string[] = ((j?.data ?? []) as any[]).map((m) => m?.id).filter(Boolean);
    return {
      reachable: true,
      models,
      ms,
      reason: models.length
        ? `LM Studio reachable at localhost:1234 (${ms} ms) — ${models.length} model(s): ${models.join(', ')}`
        : `LM Studio reachable at localhost:1234 (${ms} ms) — no model loaded; load one in LM Studio`,
    };
  } catch (e: any) {
    const ms = Math.round(now() - t0);
    if (e?.name === 'TimeoutError') {
      return deadProbe(ms, `LM Studio timed out after ${timeoutMs} ms at localhost:1234 — is the LM Studio server running? ${corsReason}`);
    }
    // TypeError: connection refused OR CORS preflight failed — CORS guidance covers both next steps.
    return deadProbe(ms, corsReason);
  }
}

/** `true` when the browser exposes WebGPU (Chrome/Edge 113+, Safari 26+). */
export function detectWebGPU(): boolean {
  return typeof navigator !== 'undefined' && !!(navigator as any).gpu;
}

/** `true` when the page is a secure context (https, or http://localhost). */
export function detectSecureContext(): boolean {
  return typeof window !== 'undefined' && !!window.isSecureContext;
}

/**
 * Run every probe in parallel. NEVER throws — every probe catches internally
 * and this wraps the whole run in a final guard.
 */
export async function detectLocalEngines(): Promise<LocalReport> {
  try {
    const webgpu = detectWebGPU();
    const secureContext = detectSecureContext();
    const [ollamaProbe, lmstudioProbe] = await Promise.all([probeOllama(), probeLMStudio()]);

    const webllm: FeatureStatus = webgpu
      ? {
          feature: 'webllm',
          status: 'available',
          reason: 'WebGPU is available — in-browser models can run (model downloads on first use)',
        }
      : {
          feature: 'webllm',
          status: 'unavailable',
          reason: 'WebGPU not detected — WebLLM needs a browser with WebGPU (Chrome/Edge 113+, Safari 26+)',
        };

    return {
      webgpu,
      secureContext,
      webllm,
      ollama: { feature: 'ollama', status: ollamaProbe.reachable ? 'available' : 'unavailable', reason: ollamaProbe.reason },
      lmstudio: { feature: 'lmstudio', status: lmstudioProbe.reachable ? 'available' : 'unavailable', reason: lmstudioProbe.reason },
      ollamaProbe,
      lmstudioProbe,
      generatedAt: new Date().toISOString(),
    };
  } catch (e: any) {
    // Absolute last resort: the report shape must always come back intact.
    const reason = `Browser probes failed unexpectedly: ${e?.message ?? 'unknown error'}`;
    const dead = (feature: string): FeatureStatus => ({ feature, status: 'unavailable', reason });
    return {
      webgpu: false,
      secureContext: false,
      webllm: dead('webllm'),
      ollama: dead('ollama'),
      lmstudio: dead('lmstudio'),
      ollamaProbe: deadProbe(0, reason),
      lmstudioProbe: deadProbe(0, reason),
      generatedAt: new Date().toISOString(),
    };
  }
}

/**
 * Merge the server feature table with local probe results.
 *
 * Server entries whose status is `client_probe_required` (e.g. ollama/lmstudio:
 * Vercel serverless can never reach localhost, only the browser can) are
 * resolved to available/unavailable from the local report. The server's
 * explanatory reason is kept and the probe detail is appended — nothing is
 * silently disabled, and the "why not" is always visible.
 */
export function mergePlatform(server: ServerFeatures, local: LocalReport): FeatureStatus[] {
  const byName: Record<string, FeatureStatus> = {
    webllm: local.webllm,
    ollama: local.ollama,
    lmstudio: local.lmstudio,
  };

  return server.map((s) => {
    if (s.status !== 'client_probe_required') {
      return { feature: s.feature, status: s.status, reason: s.reason };
    }
    const localStatus = byName[s.feature];
    if (!localStatus) {
      return {
        feature: s.feature,
        status: 'unavailable' as FeatureState,
        reason: `${s.reason} · Browser probe: could not run a client probe for "${s.feature}" on this page`,
      };
    }
    return {
      feature: s.feature,
      status: localStatus.status,
      reason: `${s.reason} · Browser probe: ${localStatus.reason}`,
    };
  });
}
