'use client';
import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { MessageSquare, FolderLock, Plug, Users, Cpu, ScrollText, LogOut, Menu, Server, ChevronDown } from 'lucide-react';
import { api } from '@/lib/client/api';
import { detectLocalEngines, mergePlatform, type ServerFeature, type FeatureStatus } from '@/lib/client/detect';
import { Select, Badge, BottomSheet, Skeleton } from '@/components/ui';
import Chat from '@/components/Chat';
import Knowledge from '@/components/Knowledge';
import Connectors from '@/components/Connectors';
import Team from '@/components/Team';
import Models from '@/components/Models';
import Audit from '@/components/Audit';

const TABS = [
  { id: 'chat', name: 'Ask', icon: MessageSquare, desc: 'Evidence-bound answers from your documents' },
  { id: 'knowledge', name: 'Knowledge', icon: FolderLock, desc: 'Upload and manage documents' },
  { id: 'connectors', name: 'Connectors', icon: Plug, desc: 'Postgres and Google Drive sources' },
  { id: 'team', name: 'Team & roles', icon: Users, desc: 'Members, invites, and roles' },
  { id: 'models', name: 'Models & keys', icon: Cpu, desc: 'Local engines and cloud API keys' },
  { id: 'audit', name: 'Audit log', icon: ScrollText, desc: 'Tamper-evident activity trail' },
] as const;
type TabId = (typeof TABS)[number]['id'];

/* ---------------- platform availability ---------------- */

type Feature = { feature: string; label: string; status: 'available' | 'unavailable'; reason: string };

const FEATURE_LABELS: Record<string, string> = {
  platform: 'Deployment',
  database: 'Database',
  webllm: 'WebLLM (in-browser LLM)',
  ollama: 'Ollama (local)',
  lmstudio: 'LM Studio (local)',
  browser_embeddings: 'Browser embeddings',
  cloud_byok: 'Cloud models (BYOK)',
};
const label = (f: string) => FEATURE_LABELS[f] ?? f;

function hostPlatform(): 'Cloud' | 'Local' {
  const h = window.location.hostname;
  return h === 'localhost' || h === '127.0.0.1' || h === '::1' || h.endsWith('.local') ? 'Local' : 'Cloud';
}

async function fetchServerFeatures(): Promise<ServerFeature[] | null> {
  try {
    const res = await fetch('/api/platform', { signal: AbortSignal.timeout(3500) });
    if (!res.ok) return null; // ENGINE-2 may not have shipped it yet — degrade gracefully
    const j = await res.json().catch(() => ({}));
    return Array.isArray(j?.features) ? (j.features as ServerFeature[]) : null;
  } catch {
    return null;
  }
}

async function fetchKeyCount(): Promise<number | null> {
  try {
    const j = await api<{ keys: unknown[] }>('/api/keys');
    return Array.isArray(j.keys) ? j.keys.length : null;
  } catch {
    return null;
  }
}

function extras(local: { webgpu: boolean; secureContext: boolean }): Feature[] {
  return [
    {
      feature: 'platform',
      label: label('platform'),
      status: 'available',
      reason: `Running as ${hostPlatform()} (from this page's URL — server env isn't visible in the browser).`,
    },
    {
      feature: 'browser_embeddings',
      label: label('browser_embeddings'),
      status: local.secureContext ? 'available' : 'unavailable',
      reason: local.secureContext
        ? 'Transformers.js runs embedding models in this browser (WebGPU/WASM) — works on any deployment.'
        : 'Browser embeddings need a secure context (https or localhost) — this page is not one.',
    },
    {
      feature: 'database',
      label: label('database'),
      status: 'available',
      reason: 'Connected — your workspace loaded from the server just now.',
    },
  ];
}

function withByok(features: Feature[], keyCount: number | null): Feature[] {
  const byok: Feature = {
    feature: 'cloud_byok',
    label: label('cloud_byok'),
    status: keyCount !== null && keyCount > 0 ? 'available' : 'unavailable',
    reason:
      keyCount === null
        ? 'Could not check saved keys right now — open Models & keys to see your cloud keys.'
        : keyCount > 0
          ? `${keyCount} API key${keyCount === 1 ? '' : 's'} saved — cloud chat is ready.`
          : 'No API key saved yet — add one under Models & keys to enable cloud models.',
  };
  return features.some((f) => f.feature === 'cloud_byok') ? features : [...features, byok];
}

function PlatformBadge() {
  const [state, setState] = useState<{ kind: 'detecting' } | { kind: 'ready'; features: Feature[]; checkedAt: string }>({ kind: 'detecting' });
  const [open, setOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [server, local, keyCount] = await Promise.all([fetchServerFeatures(), detectLocalEngines(), fetchKeyCount()]);
      if (cancelled) return;
      let features: Feature[];
      if (server) {
        const merged: FeatureStatus[] = mergePlatform(server, local);
        const extra = extras(local).filter((e) => !merged.some((m) => m.feature === e.feature));
        features = withByok([...merged.map((m) => ({ ...m, label: label(m.feature) })), ...extra], keyCount);
      } else {
        // No server endpoint — resolve everything from the browser.
        features = withByok(
          [
            ...extras(local),
            { ...local.webllm, label: label('webllm') },
            { ...local.ollama, label: label('ollama') },
            { ...local.lmstudio, label: label('lmstudio') },
          ],
          keyCount,
        );
      }
      setState({ kind: 'ready', features, checkedAt: new Date().toLocaleTimeString() });
    })();
    return () => { cancelled = true; };
  }, []);

  if (state.kind === 'detecting') {
    return (
      <button disabled className="inline-flex cursor-wait items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-400" aria-label="Detecting platform availability">
        <span className="h-2 w-2 animate-pulse rounded-full bg-zinc-500" />
        Detecting…
      </button>
    );
  }

  const { features, checkedAt } = state;
  const ready = features.filter((f) => f.status === 'available').length;
  const allOk = ready === features.length;
  return (
    <>
      <button
        onClick={() => setOpen(true)}
        aria-haspopup="dialog"
        className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:bg-white/10"
        aria-label={`Platform availability: ${ready} of ${features.length} features ready. Open details.`}
      >
        <span className={`h-2 w-2 rounded-full ${allOk ? 'bg-emerald-400' : 'bg-amber-400'}`} />
        <Server size={13} className="text-zinc-400" />
        {hostPlatform()} · {ready}/{features.length}
        <ChevronDown size={13} className="text-zinc-500" />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Platform & availability">
        <p className="mb-4 text-xs text-zinc-500">
          Resolved from {`GET /api/platform`} + browser probes · checked {checkedAt}. Nothing is hidden — each feature explains why it works or doesn't.
        </p>
        <div className="space-y-3">
          {features.map((f) => (
            <div key={f.feature} className="rounded-xl border border-white/10 bg-white/[0.03] p-3">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-zinc-100">{f.label}</span>
                <Badge tone={f.status === 'available' ? 'green' : 'red'}>{f.status === 'available' ? 'Available' : 'Unavailable'}</Badge>
              </div>
              <p className="text-xs leading-relaxed text-zinc-400">{f.reason}</p>
            </div>
          ))}
        </div>
      </BottomSheet>
    </>
  );
}

/* ---------------- shell ---------------- */

const MOBILE_TABS: { id: TabId | 'more'; name: string; icon: typeof MessageSquare }[] = [
  { id: 'chat', name: 'Chat', icon: MessageSquare },
  { id: 'knowledge', name: 'Knowledge', icon: FolderLock },
  { id: 'models', name: 'Models', icon: Cpu },
  { id: 'more', name: 'More', icon: Menu },
];
const MORE_TABS: TabId[] = ['connectors', 'team', 'audit'];

export default function AppPage() {
  const router = useRouter();
  const [me, setMe] = useState<any>(null);
  const [tab, setTab] = useState<TabId>('chat');
  const [moreOpen, setMoreOpen] = useState(false);
  const [userOpen, setUserOpen] = useState(false);
  const [switching, setSwitching] = useState(false);

  const load = useCallback(async () => {
    try { setMe(await api('/api/me')); } catch { router.push('/login'); }
  }, [router]);
  useEffect(() => { load(); }, [load]);

  async function switchOrg(orgId: string) {
    setSwitching(true);
    try { await api('/api/orgs', { method: 'PUT', body: { orgId } }); await load(); }
    catch { /* keep current org; surfaced by staying on the page */ }
    finally { setSwitching(false); }
  }
  async function logout() { await api('/api/auth/logout', { body: {} }); router.push('/login'); }

  if (!me) {
    return (
      <div className="grid min-h-dvh place-items-center p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="pt-2 text-center text-sm text-zinc-500">Loading secure workspace…</div>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab)!;
  const inMore = MORE_TABS.includes(tab);
  const roleTone = me.role === 'owner' || me.role === 'admin' ? 'amber' : 'indigo';

  return (
    <div className="flex min-h-dvh">
      {/* Desktop sidebar */}
      <aside className="hidden w-64 shrink-0 flex-col border-r border-white/10 bg-zinc-950 p-4 md:flex">
        <div className="mb-6 flex items-center gap-2 font-semibold"><span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600">प्र</span> PRAMAAN</div>
        <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Workspace</label>
        <Select value={me.orgId} onChange={(e) => switchOrg(e.target.value)} disabled={switching} aria-label="Switch workspace">
          {me.orgs.map((o: any) => <option key={o.id} value={o.id}>{o.kind === 'personal' ? '🔒 ' : '🏛 '}{o.name}</option>)}
        </Select>
        <div className="mt-2 flex flex-wrap gap-1">
          <Badge tone={roleTone}>{me.role}</Badge>
          {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
        </div>
        <nav className="mt-6 space-y-1" aria-label="Primary">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2 text-sm transition ${tab === t.id ? 'bg-indigo-600/20 font-medium text-indigo-200' : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'}`}>
              <t.icon size={16} /> {t.name}
            </button>
          ))}
        </nav>
        <div className="mt-auto border-t border-white/10 pt-4 text-xs text-zinc-500">
          <div className="truncate font-medium text-zinc-300">{me.name || me.email}</div>
          <div className="truncate">{me.email}</div>
          <button onClick={logout} className="mt-2 flex items-center gap-2 rounded-lg px-1 py-1 text-zinc-400 transition hover:text-white">
            <LogOut size={14} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <main className="grid-bg min-w-0 flex-1 overflow-y-auto pb-28 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-white/10 bg-zinc-950/85 backdrop-blur">
          <div className="mx-auto flex max-w-5xl items-center gap-3 px-4 py-3 md:px-6">
            <div className="min-w-0 flex-1">
              <h1 className="truncate text-base font-semibold text-zinc-100 md:text-lg">{active.name}</h1>
              <p className="hidden truncate text-xs text-zinc-500 sm:block">{active.desc}</p>
            </div>
            <PlatformBadge />
            <button
              onClick={() => setUserOpen(true)}
              aria-haspopup="dialog"
              aria-label="Account menu"
              className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-indigo-600/25 text-sm font-semibold text-indigo-200 ring-1 ring-white/10 transition hover:bg-indigo-600/40"
            >
              {(me.name || me.email || '?').charAt(0).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-5xl p-4 md:p-6">
          {tab === 'chat' && <Chat me={me} goModels={() => setTab('models')} />}
          {tab === 'knowledge' && <Knowledge me={me} />}
          {tab === 'connectors' && <Connectors me={me} />}
          {tab === 'team' && <Team me={me} reload={load} />}
          {tab === 'models' && <Models me={me} />}
          {tab === 'audit' && <Audit />}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-white/10 bg-zinc-950/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <div className="grid grid-cols-4">
          {MOBILE_TABS.map((t) => {
            const isActive = t.id === 'more' ? inMore : tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => (t.id === 'more' ? setMoreOpen(true) : setTab(t.id as TabId))}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] transition ${isActive ? 'text-indigo-300' : 'text-zinc-500 hover:text-zinc-300'}`}
              >
                <t.icon size={20} />
                {t.name}
              </button>
            );
          })}
        </div>
      </nav>

      {/* "More" sheet on mobile */}
      <BottomSheet open={moreOpen} onClose={() => setMoreOpen(false)} title="More">
        <div className="mb-4">
          <label className="mb-1 block text-xs font-medium uppercase tracking-wide text-zinc-500">Workspace</label>
          <Select value={me.orgId} onChange={(e) => { setMoreOpen(false); switchOrg(e.target.value); }} disabled={switching} aria-label="Switch workspace">
            {me.orgs.map((o: any) => <option key={o.id} value={o.id}>{o.kind === 'personal' ? '🔒 ' : '🏛 '}{o.name}</option>)}
          </Select>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={roleTone}>{me.role}</Badge>
            {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
          </div>
        </div>
        <div className="space-y-1">
          {MORE_TABS.map((id) => {
            const t = TABS.find((x) => x.id === id)!;
            return (
              <button key={id} onClick={() => { setMoreOpen(false); setTab(id); }}
                className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm transition ${tab === id ? 'bg-indigo-600/20 text-indigo-200' : 'text-zinc-300 hover:bg-white/5'}`}>
                <t.icon size={18} />
                <span className="flex-1 text-left">{t.name}</span>
                {tab === id && <Badge tone="indigo">Current</Badge>}
              </button>
            );
          })}
        </div>
        <button onClick={logout} className="mt-4 flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm text-zinc-400 transition hover:bg-white/5 hover:text-white">
          <LogOut size={18} /> Sign out
        </button>
      </BottomSheet>

      {/* User menu sheet */}
      <BottomSheet open={userOpen} onClose={() => setUserOpen(false)} title="Account">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-12 w-12 place-items-center rounded-full bg-indigo-600/25 text-lg font-semibold text-indigo-200">
            {(me.name || me.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-zinc-100">{me.name || me.email}</div>
            <div className="truncate text-xs text-zinc-500">{me.email}</div>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-1">
          <Badge tone={roleTone}>{me.role}</Badge>
          <Badge>{me.orgName}</Badge>
          {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
        </div>
        <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/5 px-4 py-2.5 text-sm font-medium text-zinc-200 transition hover:bg-white/10">
          <LogOut size={15} /> Sign out
        </button>
      </BottomSheet>
    </div>
  );
}
