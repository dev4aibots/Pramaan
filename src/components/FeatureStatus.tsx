'use client';

import React, { useCallback, useEffect, useState, type ComponentType } from 'react';
import { Check, X, Loader2, Copy, KeyRound, Cpu, Sparkles, Globe, Database, Terminal, Info } from 'lucide-react';

/* ---------------------------------------------------------------------------
 * FeatureStatus / WhyNot — the shared "why not" availability system.
 *
 * Turf note: ENGINE-2 owns src/lib/client/detect.ts (browser probes) and
 * src/lib/platform.ts + GET /api/platform (server detect). This component
 * NEVER ships its own copy of that logic — it consumes it via a dynamic
 * import so the page still renders even while ENGINE-2's module is landing:
 *
 *   const mod = await import('@/lib/client/detect');
 *
 * EXPECTED IMPORT SHAPE (from '@/lib/client/detect'):
 *
 *   export async function probeOllama(timeoutMs?: number): Promise<{
 *     reachable: boolean; models: string[]; ms: number; reason: string }>
 *   export async function probeLMStudio(timeoutMs?: number): Promise<{
 *     reachable: boolean; models: string[]; ms: number; reason: string }>
 *   export function detectWebGPU(): boolean          // alias: hasWebGPU()
 *   export function detectSecureContext(): boolean   // alias: isSecureContext()
 *   export function fetchPlatform(): Promise<{ platform: 'vercel' | 'local' | 'unknown' }>
 *   export function detectPlatform(): Promise<PlatformProfile>
 *
 *   export type PlatformProfile = {
 *     platform: 'vercel' | 'local' | 'unknown';
 *     ollama:     { status: FeatureState; reason: string };
 *     lmstudio:   { status: FeatureState; reason: string };
 *     webgpu:     { status: FeatureState; reason: string };
 *     embeddings: { status: FeatureState; reason: string };
 *     cloud:      { status: FeatureState; reason: string };
 *   };
 *   export type FeatureState = 'available' | 'unavailable' | 'checking';
 *
 * If the module (or GET /api/platform) is missing, every call below falls
 * back to minimal inline probes (localhost:11434, localhost:1234,
 * navigator.gpu) so the component works standalone. No mock data anywhere.
 * ------------------------------------------------------------------------- */

export type FeatureId = 'webllm' | 'ollama' | 'lmstudio' | 'embeddings' | 'cloud' | 'pglite';
export type FeatureState = 'available' | 'unavailable' | 'checking';
export type PlatformId = 'vercel' | 'local' | 'unknown';

export type FeatureAvail = { status: FeatureState; reason: string };

export const FEATURES: FeatureId[] = ['webllm', 'ollama', 'lmstudio', 'embeddings', 'cloud', 'pglite'];

const META: Record<FeatureId, { name: string; icon: ComponentType<{ className?: string }> }> = {
  webllm: { name: 'WebLLM (in-browser LLM)', icon: Sparkles },
  ollama: { name: 'Ollama (local)', icon: Terminal },
  lmstudio: { name: 'LM Studio (local)', icon: Cpu },
  embeddings: { name: 'Browser embeddings', icon: Globe },
  cloud: { name: 'Cloud BYOK', icon: KeyRound },
  pglite: { name: 'PGlite database', icon: Database },
};

const cx = (...c: (string | false | undefined | null)[]) => c.filter(Boolean).join(' ');

/* ---------------- inline fallback probes (used only if detect.ts is absent) ---------------- */

const PROBE_TIMEOUT = 2000;

async function inlineProbe(url: string, kind: 'ollama' | 'lmstudio'): Promise<FeatureAvail> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (!res.ok) {
      return {
        status: 'unavailable',
        reason: `${META[kind].name} answered HTTP ${res.status} — it may be misconfigured or still starting`,
      };
    }
    const j = (await res.json().catch(() => ({}))) as any;
    const models: string[] =
      kind === 'ollama'
        ? ((j?.models ?? []) as any[]).map((m) => m?.name).filter(Boolean)
        : ((j?.data ?? []) as any[]).map((m) => m?.id).filter(Boolean);
    return {
      status: 'available',
      reason: models.length
        ? `${META[kind].name} reachable — ${models.length} model(s): ${models.join(', ')}`
        : `${META[kind].name} reachable — no model loaded yet`,
    };
  } catch {
    const fix = kind === 'ollama' ? 'start Ollama on this machine (ollama serve)' : "start the LM Studio server and enable 'Enable CORS' in settings";
    return { status: 'unavailable', reason: `${META[kind].name} not detected at localhost — ${fix}` };
  }
}

async function inlineDetect(): Promise<Record<FeatureId, FeatureAvail>> {
  const webgpu = typeof navigator !== 'undefined' && !!(navigator as any).gpu;
  const [ollama, lmstudio] = await Promise.all([
    inlineProbe('http://localhost:11434/api/tags', 'ollama'),
    inlineProbe('http://localhost:1234/v1/models', 'lmstudio'),
  ]);
  let platform: PlatformId = 'unknown';
  try {
    const r = await fetch('/api/platform', { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as any;
      if (j?.platform === 'vercel' || j?.platform === 'local') platform = j.platform;
    }
  } catch { /* platform endpoint may not exist yet — stay unknown */ }

  let cloud: FeatureAvail = {
    status: 'unavailable',
    reason: 'No API key configured — add a key in Models to enable cloud models',
  };
  try {
    const r = await fetch('/api/keys', { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
    if (r.ok) {
      const j = (await r.json().catch(() => ({}))) as any;
      const n = Array.isArray(j?.keys) ? j.keys.length : 0;
      cloud =
        n > 0
          ? { status: 'available', reason: `${n} API key(s) configured — cloud models are ready` }
          : cloud;
    }
  } catch { /* keys endpoint may not exist or user may not be signed in */ }

  return {
    webllm: webgpu
      ? { status: 'available', reason: 'WebGPU detected — in-browser models can run (one-time model download)' }
      : { status: 'unavailable', reason: 'WebGPU not detected — WebLLM needs Chrome/Edge 113+ or Safari 26+' },
    ollama,
    lmstudio,
    embeddings: webgpu
      ? { status: 'available', reason: 'Browser embeddings work here — WebGPU acceleration available' }
      : { status: 'available', reason: 'Browser embeddings work here via WASM (WebGPU not detected — slower)' },
    cloud,
    pglite: { status: 'available', reason: 'PGlite is embedded in the app — works everywhere, zero setup' },
  };
}

/* ---------------- resolve ENGINE-2's detect.ts if present ---------------- */

type DetectModule = {
  probeOllama?: (t?: number) => Promise<{ reachable: boolean; reason: string }>;
  probeLMStudio?: (t?: number) => Promise<{ reachable: boolean; reason: string }>;
  detectWebGPU?: () => boolean;
  hasWebGPU?: () => boolean;
  detectSecureContext?: () => boolean;
  isSecureContext?: () => boolean;
  fetchPlatform?: () => Promise<{ platform?: string }>;
  detectPlatform?: () => Promise<any>;
};

async function loadDetectModule(): Promise<DetectModule | null> {
  try {
    const mod = (await import('@/lib/client/detect')) as DetectModule;
    if (!mod || (typeof mod.probeOllama !== 'function' && typeof mod.detectPlatform !== 'function')) return null;
    return mod;
  } catch {
    return null;
  }
}

function normalize(mod: DetectModule, p: any): Record<FeatureId, FeatureAvail> {
  const ok = (x: any): x is FeatureAvail =>
    !!x && (x.status === 'available' || x.status === 'unavailable' || x.status === 'checking') && typeof x.reason === 'string';
  const fall = (f: FeatureId, reason: string): FeatureAvail => ({ status: 'unavailable', reason });
  return {
    webllm: ok(p?.webllm) ? p.webllm : fall('webllm', 'WebLLM status unknown'),
    ollama: ok(p?.ollama) ? p.ollama : fall('ollama', 'Ollama not detected at localhost — start Ollama on this machine (ollama serve)'),
    lmstudio: ok(p?.lmstudio) ? p.lmstudio : fall('lmstudio', "LM Studio not detected at localhost — enable 'Enable CORS' in LM Studio settings"),
    embeddings: ok(p?.embeddings) ? p.embeddings : { status: 'available', reason: 'Browser embeddings work everywhere via WebGPU/WASM' },
    cloud: ok(p?.cloud) ? p.cloud : fall('cloud', 'No API key configured — add a key in Models to enable cloud models'),
    pglite: { status: 'available', reason: 'PGlite is embedded in the app — works everywhere, zero setup' },
  };
}

/* ---------------- shared detection hook (cached per page load) ---------------- */

let cache: Promise<{ platform: PlatformId; features: Record<FeatureId, FeatureAvail> }> | null = null;

function detectOnce(): Promise<{ platform: PlatformId; features: Record<FeatureId, FeatureAvail> }> {
  if (!cache) {
    cache = (async () => {
      const mod = await loadDetectModule();
      if (mod?.detectPlatform) {
        try {
          const p = await mod.detectPlatform();
          const platform: PlatformId = p?.platform === 'vercel' || p?.platform === 'local' ? p.platform : 'unknown';
          return { platform, features: normalize(mod, p) };
        } catch { /* fall through to inline */ }
      }
      if (mod && typeof mod.probeOllama === 'function' && typeof mod.probeLMStudio === 'function') {
        try {
          const hasGPU = typeof mod.detectWebGPU === 'function' ? mod.detectWebGPU() : typeof mod.hasWebGPU === 'function' ? mod.hasWebGPU() : !!(navigator as any)?.gpu;
          const [o, l] = await Promise.all([mod.probeOllama!(PROBE_TIMEOUT), mod.probeLMStudio!(PROBE_TIMEOUT)]);
          let platform: PlatformId = 'unknown';
          if (typeof mod.fetchPlatform === 'function') {
            try {
              const pf = await mod.fetchPlatform();
              if (pf?.platform === 'vercel' || pf?.platform === 'local') platform = pf.platform;
            } catch { /* endpoint may 404 until ENGINE-2 lands it */ }
          }
          return {
            platform,
            features: {
              webllm: hasGPU
                ? { status: 'available', reason: 'WebGPU detected — in-browser models can run (one-time model download)' }
                : { status: 'unavailable', reason: 'WebGPU not detected — WebLLM needs Chrome/Edge 113+ or Safari 26+' },
              ollama: { status: o.reachable ? 'available' : 'unavailable', reason: o.reason },
              lmstudio: { status: l.reachable ? 'available' : 'unavailable', reason: l.reason },
              embeddings: { status: 'available', reason: 'Browser embeddings work everywhere via WebGPU/WASM' },
              cloud: { status: 'unavailable', reason: 'No API key configured — add a key in Models to enable cloud models' },
              pglite: { status: 'available', reason: 'PGlite is embedded in the app — works everywhere, zero setup' },
            },
          };
        } catch { /* fall through to inline */ }
      }
      const features = await inlineDetect();
      let platform: PlatformId = 'unknown';
      try {
        const r = await fetch('/api/platform', { signal: AbortSignal.timeout(PROBE_TIMEOUT) });
        if (r.ok) {
          const j = (await r.json().catch(() => ({}))) as any;
          if (j?.platform === 'vercel' || j?.platform === 'local') platform = j.platform;
        }
      } catch { /* may 404 until ENGINE-2 lands it */ }
      return { platform, features };
    })();
  }
  return cache;
}

export function refreshDetection() {
  cache = null;
}

export function useAvailability() {
  const [platform, setPlatform] = useState<PlatformId>('unknown');
  const [features, setFeatures] = useState<Record<FeatureId, FeatureAvail> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = useCallback(() => {
    setError(null);
    detectOnce()
      .then((d) => { setPlatform(d.platform); setFeatures(d.features); })
      .catch((e) => setError(e?.message ?? 'Detection failed'));
  }, []);

  useEffect(() => { run(); }, [run]);

  const retry = useCallback(() => { refreshDetection(); run(); }, [run]);
  return { platform, features, error, retry };
}

/* ---------------- fix actions per feature ---------------- */

const FIX: Record<FeatureId, { label: string; hint?: string; copy?: string } | null> = {
  webllm: { label: 'Why it matters', hint: 'In-browser models run fully locally. Works on Vercel and locally — needs a WebGPU-capable browser and a one-time model download.' },
  ollama: { label: 'Start Ollama', hint: 'Vercel servers can never reach localhost — Ollama only works from your browser. Install it and run:', copy: 'ollama serve' },
  lmstudio: { label: 'Enable CORS in LM Studio', hint: 'Vercel servers can never reach localhost — LM Studio only works from your browser. In LM Studio: Settings → Developer → turn on "Serve on local network" AND "Enable CORS", then start the server.' },
  embeddings: null, // always available
  cloud: { label: 'Add a key in Models', hint: 'Cloud models work everywhere — on Vercel and locally — but need your own API key. Keys are stored encrypted server-side.' },
  pglite: null, // always available
};

export function FixAction({ feature, onFix, className }: { feature: FeatureId; onFix?: (f: FeatureId) => void; className?: string }) {
  const fix = FIX[feature];
  const [copied, setCopied] = useState(false);
  if (!fix) return null;
  return (
    <div className={cx('flex flex-wrap items-center gap-2', className)}>
      <button
        type="button"
        onClick={async () => {
          if (fix.copy) {
            try { await navigator.clipboard.writeText(fix.copy); setCopied(true); setTimeout(() => setCopied(false), 1600); } catch { /* clipboard unavailable */ }
          }
          onFix?.(feature);
          if (feature === 'cloud' && !onFix) window.dispatchEvent(new CustomEvent('pramaan:goto-models'));
        }}
        className="inline-flex items-center gap-1.5 rounded-lg bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-indigo-500"
      >
        {fix.copy ? (copied ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />) : <Info className="h-3.5 w-3.5" />}
        {fix.copy && copied ? 'Copied!' : fix.label}
      </button>
      {fix.copy && (
        <code className="rounded-md border border-white/10 bg-zinc-950/80 px-2 py-1 font-mono text-xs text-zinc-300">{fix.copy}</code>
      )}
    </div>
  );
}

/* ---------------- pill: green / amber / gray ---------------- */

const PILL: Record<FeatureState, string> = {
  available: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30',
  unavailable: 'bg-zinc-500/15 text-zinc-400 ring-zinc-500/25',
  checking: 'bg-amber-500/15 text-amber-300 ring-amber-500/30',
};
const LABEL: Record<FeatureState, string> = {
  available: 'Available',
  unavailable: 'Unavailable',
  checking: 'Checking…',
};

export function StatusDot({ status, className }: { status: FeatureState; className?: string }) {
  return (
    <span className={cx('relative inline-flex h-2 w-2 shrink-0', className)}>
      {status === 'checking' && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-amber-400 opacity-60" />}
      <span className={cx(
        'relative inline-flex h-2 w-2 rounded-full',
        status === 'available' && 'bg-emerald-400',
        status === 'unavailable' && 'bg-zinc-500',
        status === 'checking' && 'bg-amber-400',
      )} />
    </span>
  );
}

/** Compact availability pill: `<FeatureStatus feature="ollama" />` */
export function FeatureStatus({
  feature,
  avail,
  className,
}: {
  feature: FeatureId;
  /** Pass a pre-detected result to avoid duplicate probing; otherwise detected automatically. */
  avail?: FeatureAvail;
  className?: string;
}) {
  const { features } = useAvailability();
  const a: FeatureAvail = avail ?? features?.[feature] ?? { status: 'checking', reason: 'Probing…' };
  const Icon = META[feature].icon;
  return (
    <span
      title={a.reason}
      className={cx(
        'inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset',
        PILL[a.status],
        className,
      )}
    >
      {a.status === 'checking' ? <Loader2 className="h-3 w-3 animate-spin" /> : a.status === 'available' ? <Check className="h-3 w-3" /> : <X className="h-3 w-3" />}
      <Icon className="hidden h-3 w-3 sm:inline" />
      <span className="hidden sm:inline">{META[feature].name}</span>
      <span className="sm:hidden">{META[feature].name.split(' ')[0]}</span>
      <span className="opacity-80">· {LABEL[a.status]}</span>
    </span>
  );
}

/* ---------------- WhyNot explainer block ---------------- */

/** Explainer block: reason + fix action. `<WhyNot feature="lmstudio" />` */
export function WhyNot({
  feature,
  avail,
  onFix,
  showWhenAvailable = true,
  className,
}: {
  feature: FeatureId;
  /** Pass a pre-detected result to avoid duplicate probing; otherwise detected automatically. */
  avail?: FeatureAvail;
  onFix?: (f: FeatureId) => void;
  /** When false, available features render nothing. */
  showWhenAvailable?: boolean;
  className?: string;
}) {
  const { features, platform, retry } = useAvailability();
  const a: FeatureAvail = avail ?? features?.[feature] ?? { status: 'checking', reason: 'Probing local engines…' };
  const fix = FIX[feature];
  const Icon = META[feature].icon;

  if (!showWhenAvailable && a.status === 'available') return null;

  const localhostOnly = feature === 'ollama' || feature === 'lmstudio';
  const vercelCaveat = localhostOnly && platform === 'vercel';

  return (
    <div className={cx('rounded-2xl border border-white/10 bg-zinc-900/60 p-4', className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-zinc-400" />
          <span className="text-sm font-semibold">{META[feature].name}</span>
        </div>
        <span className={cx('inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset', PILL[a.status])}>
          <StatusDot status={a.status} />
          {LABEL[a.status]}
        </span>
      </div>

      <p className="text-sm leading-relaxed text-zinc-300">{a.reason}</p>

      {vercelCaveat && (
        <p className="mt-2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-2 text-xs leading-relaxed text-amber-200">
          You are on Vercel. Vercel servers can <strong>never</strong> reach <code className="font-mono">localhost</code> on your
          machine — {META[feature].name} is probed from your browser instead. Start it on this machine and refresh.
        </p>
      )}

      {fix?.hint && a.status !== 'available' && (
        <p className="mt-2 text-xs leading-relaxed text-zinc-400">{fix.hint}</p>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {a.status !== 'available' && fix && <FixAction feature={feature} onFix={onFix} />}
        <button
          type="button"
          onClick={retry}
          className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
        >
          <Loader2 className="h-3.5 w-3.5" />
          Re-check
        </button>
      </div>
    </div>
  );
}

/** One-block overview of every feature — handy for the Models tab. */
export function AvailabilityPanel({ onFix, className }: { onFix?: (f: FeatureId) => void; className?: string }) {
  const { features, error, retry } = useAvailability();
  return (
    <div className={cx('space-y-3', className)}>
      {error && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-xs text-red-300">
          Detection hiccup: {error}{' '}
          <button type="button" onClick={retry} className="underline underline-offset-2">retry</button>
        </div>
      )}
      {FEATURES.map((f) => (
        <WhyNot key={f} feature={f} avail={features?.[f]} onFix={onFix} />
      ))}
    </div>
  );
}
