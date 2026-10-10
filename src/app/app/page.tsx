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
      <button disabled className="pill cursor-wait" aria-label="Detecting platform availability">
        <span className="dot animate-pulse" />
        Detecting
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
        className={`pill transition hover:opacity-80 ${allOk ? 'pill-green' : 'pill-amber'}`}
        aria-label={`Platform availability: ${ready} of ${features.length} features ready. Open details.`}
      >
        <span className="dot" />
        <Server size={11} />
        {hostPlatform()} · {ready}/{features.length}
        <ChevronDown size={11} />
      </button>
      <BottomSheet open={open} onClose={() => setOpen(false)} title="Platform & availability">
        <p className="mb-4 text-xs text-[var(--muted)]">
          Resolved from {`GET /api/platform`} + browser probes · checked {checkedAt}. Nothing is hidden — each feature explains why it works or doesn't.
        </p>
        <div className="space-y-2">
          {features.map((f) => (
            <div key={f.feature} className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3.5">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-[var(--text)]">{f.label}</span>
                <Badge tone={f.status === 'available' ? 'green' : 'red'}>{f.status === 'available' ? 'Available' : 'Unavailable'}</Badge>
              </div>
              <p className="text-xs leading-relaxed text-[var(--muted)]">{f.reason}</p>
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
      <div className="grid min-h-dvh place-items-center bg-[var(--bg)] p-6">
        <div className="w-full max-w-sm space-y-3">
          <Skeleton className="h-10 w-2/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-5/6" />
          <div className="pt-2 text-center text-sm text-[var(--muted)]">Loading secure workspace…</div>
        </div>
      </div>
    );
  }

  const active = TABS.find((t) => t.id === tab)!;
  const inMore = MORE_TABS.includes(tab);
  const roleTone = me.role === 'owner' || me.role === 'admin' ? 'amber' : 'indigo';

  return (
    <div className="flex min-h-dvh bg-[var(--bg)] text-[var(--text)]">
      {/* Desktop sidebar */}
      <aside className="hidden w-60 shrink-0 flex-col border-r border-[var(--border)] md:flex">
        <div className="flex items-center gap-2.5 px-5 pb-4 pt-5">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-white text-sm font-bold text-black">P</span>
          <span className="h-tight text-sm font-semibold tracking-tight">PRAMAAN</span>
        </div>

        <div className="px-5">
          <span className="micro-label">Workspace</span>
          <div className="mt-2">
            <Select value={me.orgId} onChange={(e) => switchOrg(e.target.value)} disabled={switching} aria-label="Switch workspace">
              {me.orgs.map((o: any) => <option key={o.id} value={o.id}>{o.kind === 'personal' ? 'Personal — ' : 'Team — '}{o.name}</option>)}
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={roleTone}>{me.role}</Badge>
            {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
          </div>
        </div>

        <nav className="mt-6 space-y-0.5 px-3" aria-label="Primary">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}
              className={`flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] transition ${tab === t.id ? 'bg-[var(--surface-2)] font-medium text-white' : 'text-[var(--muted)] hover:bg-white/[0.04] hover:text-white'}`}>
              <t.icon size={15} /> {t.name}
            </button>
          ))}
        </nav>

        <div className="px-3 pt-3">
        </div>

        <div className="mt-auto border-t border-[var(--border)] p-4">
          <div className="truncate text-[13px] font-medium text-white">{me.name || me.email}</div>
          <div className="truncate text-xs text-[var(--muted)]">{me.email}</div>
          <button onClick={logout} className="mt-2.5 flex items-center gap-2 text-xs text-[var(--muted)] transition hover:text-white">
            <LogOut size={13} /> Sign out
          </button>
        </div>
      </aside>

      {/* Main area */}
      <main className="min-w-0 flex-1 overflow-y-auto pb-28 md:pb-0">
        <header className="sticky top-0 z-30 border-b border-[var(--border)] bg-[var(--bg)]">
          <div className="mx-auto flex h-16 max-w-6xl items-center gap-3 px-4 md:px-8">
            <div className="min-w-0 flex-1">
              <h1 className="h-tight truncate text-sm font-semibold">{active.name}</h1>
              <p className="hidden truncate text-xs text-[var(--muted)] sm:block">{active.desc}</p>
            </div>
            <PlatformBadge />
            <button
              onClick={() => setUserOpen(true)}
              aria-haspopup="dialog"
              aria-label="Account menu"
              className="grid h-8 w-8 shrink-0 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-xs font-semibold text-white transition hover:border-[var(--border-strong)]"
            >
              {(me.name || me.email || '?').charAt(0).toUpperCase()}
            </button>
          </div>
        </header>

        <div className="mx-auto max-w-6xl p-4 md:p-8">
          {tab === 'chat' && <Chat me={me} goModels={() => setTab('models')} />}
          {tab === 'knowledge' && <Knowledge me={me} />}
          {tab === 'connectors' && <Connectors me={me} />}
          {tab === 'team' && <Team me={me} reload={load} />}
          {tab === 'models' && <Models me={me} />}
          {tab === 'audit' && <Audit />}
        </div>
      </main>

      {/* Mobile bottom tab bar */}
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--bg)] pb-[env(safe-area-inset-bottom)] md:hidden">
        <div className="grid grid-cols-4">
          {MOBILE_TABS.map((t) => {
            const isActive = t.id === 'more' ? inMore : tab === t.id;
            return (
              <button
                key={t.id}
                onClick={() => (t.id === 'more' ? setMoreOpen(true) : setTab(t.id as TabId))}
                aria-current={isActive ? 'page' : undefined}
                className={`flex min-h-[56px] flex-col items-center justify-center gap-1 text-[11px] transition ${isActive ? 'text-white' : 'text-[var(--muted)]'}`}
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
          <span className="micro-label">Workspace</span>
          <div className="mt-2">
            <Select value={me.orgId} onChange={(e) => { setMoreOpen(false); switchOrg(e.target.value); }} disabled={switching} aria-label="Switch workspace">
              {me.orgs.map((o: any) => <option key={o.id} value={o.id}>{o.kind === 'personal' ? 'Personal — ' : 'Team — '}{o.name}</option>)}
            </Select>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            <Badge tone={roleTone}>{me.role}</Badge>
            {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
          </div>
        </div>
        <div className="space-y-0.5">
          {MORE_TABS.map((id) => {
            const t = TABS.find((x) => x.id === id)!;
            return (
              <button key={id} onClick={() => { setMoreOpen(false); setTab(id); }}
                className={`flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm transition ${tab === id ? 'bg-[var(--surface-2)] font-medium text-white' : 'text-[var(--text)] hover:bg-white/[0.04]'}`}>
                <t.icon size={16} />
                <span className="flex-1 text-left">{t.name}</span>
                {tab === id && <Badge tone="indigo">Current</Badge>}
              </button>
            );
          })}
        </div>
        <button onClick={logout} className="mt-4 flex w-full items-center gap-3 rounded-md px-3 py-2.5 text-sm text-[var(--muted)] transition hover:bg-white/[0.04] hover:text-white">
          <LogOut size={16} /> Sign out
        </button>
      </BottomSheet>

      {/* User menu sheet */}
      <BottomSheet open={userOpen} onClose={() => setUserOpen(false)} title="Account">
        <div className="mb-4 flex items-center gap-3">
          <div className="grid h-11 w-11 place-items-center rounded-full border border-[var(--border)] bg-[var(--surface-2)] text-base font-semibold text-white">
            {(me.name || me.email || '?').charAt(0).toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-white">{me.name || me.email}</div>
            <div className="truncate text-xs text-[var(--muted)]">{me.email}</div>
          </div>
        </div>
        <div className="mb-4 flex flex-wrap gap-1">
          <Badge tone={roleTone}>{me.role}</Badge>
          <Badge>{me.orgName}</Badge>
          {me.subjectRef && <Badge>ID {me.subjectRef}</Badge>}
        </div>
        <button onClick={logout} className="btn btn-secondary w-full">
          <LogOut size={14} /> Sign out
        </button>
      </BottomSheet>
    </div>
  );
}
