'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cpu, Key, Laptop, Server, Trash2, CheckCircle2, Download, RefreshCw,
  AlertTriangle, XCircle, Info, ExternalLink, ShieldCheck, HardDrive,
} from 'lucide-react';
import { Button, Card, Input, Label, Select, Badge, SectionTitle, Progress } from './ui';
import { api } from '@/lib/client/api';
import { PROVIDERS, type ProviderId } from '@/lib/providers';
import {
  type Engine,
  getEngine,
  setEngine,
  engineLabel,
  WEBLLM_MODELS,
  OLLAMA_CATALOG,
  ollamaTags,
  loadWebLLM,
  lmstudioModels,
} from '@/lib/client/engines';

/* ------------------------------------------------------------------ */
/* Types                                                              */
/* ------------------------------------------------------------------ */

type TabId = 'cloud' | 'webllm' | 'ollama' | 'lmstudio';

type AvailState = 'checking' | 'ok' | 'no';
type Avail = { state: AvailState; reason: string };

type WllmDl = {
  modelId: string;
  pct: number;
  phase: 'downloading' | 'verifying';
  mb: number | null;
  speed: string | null;
  eta: string | null;
  text: string;
};

type PullState = { pct: number; phase: string; detail: string };

const WEBGPU_HELP =
  'WebGPU was not detected in this browser. WebLLM needs Chrome or Edge 113+ on a desktop (with hardware acceleration enabled). Safari, Firefox and most mobile browsers cannot run in-browser models.';

const OLLAMA_WHY_NOT = (base: string) =>
  `Ollama is not reachable at ${base}. Start Ollama on this machine ("ollama serve", with OLLAMA_ORIGINS set so the browser can call it). Note: PRAMAAN's cloud servers can never reach your localhost — Ollama only works when you open PRAMAAN on the same machine.`;

const LMS_WHY_NOT = (base: string) =>
  `No LM Studio server answered at ${base}. In LM Studio, start the Local Server and switch ON "Enable CORS" under Developer settings. The server must be running on the same machine as this browser.`;

const LS_DOWNLOADED = 'pramaan.webllm.downloaded';

function getDownloaded(): string[] {
  try { return JSON.parse(localStorage.getItem(LS_DOWNLOADED) || '[]'); } catch { return []; }
}
function markDownloaded(id: string) {
  try { localStorage.setItem(LS_DOWNLOADED, JSON.stringify([...new Set([...getDownloaded(), id])])); } catch { /* noop */ }
}

function fmtMB(n: number) { return n >= 1024 ? `${(n / 1024).toFixed(1)} GB` : `${n.toFixed(0)} MB`; }
function fmtDur(s: number) {
  if (!isFinite(s) || s < 0) return null;
  if (s < 60) return `~${Math.ceil(s)}s left`;
  return `~${Math.floor(s / 60)}m ${Math.ceil(s % 60)}s left`;
}

/* ------------------------------------------------------------------ */
/* Small building blocks                                               */
/* ------------------------------------------------------------------ */

function Pill({ avail }: { avail: Avail }) {
  if (avail.state === 'checking')
    return <Badge tone="zinc"><RefreshCw size={12} className="animate-spin" /> Checking…</Badge>;
  if (avail.state === 'ok')
    return <Badge tone="green"><CheckCircle2 size={12} /> Available</Badge>;
  return <Badge tone="red"><XCircle size={12} /> Unavailable</Badge>;
}

function WhyNot({ avail }: { avail: Avail }) {
  if (avail.state !== 'no') return null;
  return (
    <div className="flex gap-2 rounded-xl border border-amber-500/30 bg-amber-950/20 p-3 text-xs leading-relaxed text-amber-200/90">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-400" />
      <span><span className="font-semibold text-amber-300">Why not? </span>{avail.reason}</span>
    </div>
  );
}

function EngineCard(props: {
  icon: React.ReactNode; name: string; tagline: string; avail: Avail;
  actionLabel: string; onAction: () => void; footer?: React.ReactNode;
}) {
  return (
    <Card className="flex flex-col gap-3">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-indigo-500/15 text-indigo-300">{props.icon}</div>
          <div>
            <div className="font-medium text-white">{props.name}</div>
            <div className="text-xs text-zinc-500">{props.tagline}</div>
          </div>
        </div>
        <Pill avail={props.avail} />
      </div>
      <WhyNot avail={props.avail} />
      {props.footer}
      <div className="mt-auto pt-1">
        <Button variant="ghost" className="w-full" onClick={props.onAction}>{props.actionLabel}</Button>
      </div>
    </Card>
  );
}

/* ------------------------------------------------------------------ */
/* Main component                                                      */
/* ------------------------------------------------------------------ */

export default function Models({ me }: { me: any }) {
  const [engine, setEng] = useState<Engine | null>(null);
  const [keys, setKeys] = useState<any[]>([]);
  const [tab, setTab] = useState<TabId>('cloud');

  // availability
  const [webllmAvail, setWebllmAvail] = useState<Avail>({ state: 'checking', reason: '' });
  const [ollamaAvail, setOllamaAvail] = useState<Avail>({ state: 'checking', reason: '' });
  const [lmsAvail, setLmsAvail] = useState<Avail>({ state: 'checking', reason: '' });
  const [probing, setProbing] = useState(false);

  // cloud form
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState(PROVIDERS.openai.models[0] || '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [shared, setShared] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyErr, setKeyErr] = useState('');
  const [confirmDel, setConfirmDel] = useState<string | null>(null);

  // webllm
  const [wllmDl, setWllmDl] = useState<WllmDl | null>(null);
  const [wllmErr, setWllmErr] = useState('');
  const [downloaded, setDownloaded] = useState<string[]>([]);
  const wllmStat = useRef<{ t: number; mb: number } | null>(null);

  // ollama
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState(OLLAMA_CATALOG[0]);
  const [ollamaInstalled, setOllamaInstalled] = useState<string[]>([]);
  const [pull, setPull] = useState<PullState | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);
  const [ollamaErr, setOllamaErr] = useState('');

  // lm studio
  const [lmsUrl, setLmsUrl] = useState('http://localhost:1234');
  const [lmsModel, setLmsModel] = useState('');
  const [lmsInstalled, setLmsInstalled] = useState<string[]>([]);
  const [lmsLoading, setLmsLoading] = useState(false);
  const [lmsErr, setLmsErr] = useState('');

  const isAdmin = !!me && (me.role === 'owner' || me.role === 'admin');
  const canShare = isAdmin && me?.orgKind === 'team';

  /* ---------------- data loading ---------------- */

  const loadKeys = useCallback(async () => {
    try {
      const r = await api('/api/keys');
      setKeys(r.keys || []);
    } catch { setKeys([]); }
  }, []);

  useEffect(() => {
    setEng(getEngine());
    setDownloaded(getDownloaded());
    loadKeys();
    const onEvt = () => setEng(getEngine());
    window.addEventListener('pramaan-engine', onEvt);
    return () => window.removeEventListener('pramaan-engine', onEvt);
  }, [loadKeys]);

  /* ---------------- availability probes ---------------- */

  // Probe reads URLs from a ref so typing in the URL fields never triggers a fetch storm.
  const urlsRef = useRef({ ollama: ollamaUrl, lms: lmsUrl });
  useEffect(() => { urlsRef.current = { ollama: ollamaUrl, lms: lmsUrl }; });

  const probeLocal = useCallback(async () => {
    const { ollama, lms } = urlsRef.current;
    const ollamaBase = ollama.trim().replace(/\/$/, '');
    const lmsBase = lms.trim().replace(/\/$/, '');
    setProbing(true);
    setWebllmAvail({ state: 'checking', reason: '' });
    setOllamaAvail({ state: 'checking', reason: '' });
    setLmsAvail({ state: 'checking', reason: '' });

    // WebLLM: WebGPU present?
    const gpu = typeof navigator !== 'undefined' && !!(navigator as any).gpu;
    setWebllmAvail(gpu
      ? { state: 'ok', reason: '' }
      : { state: 'no', reason: WEBGPU_HELP });

    const withTimeout = (ms: number) => {
      const c = new AbortController();
      const t = setTimeout(() => c.abort(), ms);
      return { signal: c.signal, done: () => clearTimeout(t) };
    };

    // Ollama probe
    try {
      const { signal, done } = withTimeout(2500);
      const r = await fetch(`${ollamaBase}/api/tags`, { signal, cache: 'no-store' });
      done();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const tags = ((await r.json()).models ?? []).map((m: any) => m.name) as string[];
      setOllamaAvail({ state: 'ok', reason: '' });
      setOllamaInstalled(tags);
      setOllamaModel((cur) => (tags.length && !tags.includes(cur) ? tags[0] : cur));
    } catch {
      setOllamaAvail({ state: 'no', reason: OLLAMA_WHY_NOT(ollamaBase) });
    }

    // LM Studio probe
    try {
      const { signal, done } = withTimeout(2500);
      const r = await fetch(`${lmsBase}/v1/models`, { signal, cache: 'no-store' });
      done();
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const ms = ((await r.json()).data ?? []).map((m: any) => m.id) as string[];
      setLmsAvail({ state: 'ok', reason: '' });
      setLmsInstalled(ms);
      setLmsModel((cur) => (ms.length && !ms.includes(cur) ? ms[0] : cur));
    } catch {
      setLmsAvail({ state: 'no', reason: LMS_WHY_NOT(lmsBase) });
    }
    setProbing(false);
  }, []);

  useEffect(() => { probeLocal(); }, [probeLocal]);

  const cloudAvail: Avail = keys.length
    ? { state: 'ok', reason: '' }
    : { state: 'no', reason: 'No cloud API keys saved yet. Add one below — the key is stored encrypted on the server and never shown again.' };

  /* ---------------- engine activation (persisted) ---------------- */

  function activate(e: Engine) {
    setEngine(e); // persists to localStorage + notifies other components
    setEng(e);
  }

  function clearEngine() {
    localStorage.removeItem('pramaan.engine');
    window.dispatchEvent(new Event('pramaan-engine'));
    setEng(null);
  }

  const isCurrent = (kind: Engine['kind'], identifier?: string) => {
    if (!engine || engine.kind !== kind) return false;
    if (kind === 'cloud') return (engine as any).keyId === identifier;
    return (engine as any).model === identifier;
  };

  /* ---------------- cloud key manager ---------------- */

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyErr('');
    const cleanModel = model.trim();
    if (!cleanModel) { setKeyErr('Enter a model name.'); return; }
    if (provider === 'custom') {
      const u = baseUrl.trim();
      try {
        const parsed = new URL(u);
        if (parsed.protocol !== 'https:') throw new Error('https required');
      } catch { setKeyErr('Custom base URL must be a valid https:// URL.'); return; }
    }
    if (apiKey.trim().length < 8) { setKeyErr('API key looks too short.'); return; }
    setKeyBusy(true);
    try {
      const res = await api('/api/keys', {
        body: {
          provider,
          label: label.trim() || `${PROVIDERS[provider].name} key`,
          model: cleanModel,
          apiKey: apiKey.trim(),
          baseUrl: provider === 'custom' ? baseUrl.trim() : undefined,
          shared: canShare && shared,
        },
      });
      await loadKeys();
      activate({ kind: 'cloud', keyId: res.id, model: cleanModel, label: label.trim() || `${PROVIDERS[provider].name} key` });
      setApiKey(''); setLabel(''); setBaseUrl(''); setShared(false);
    } catch (err: any) {
      setKeyErr(err.message || 'Could not save key.');
    } finally { setKeyBusy(false); }
  }

  async function deleteKey(id: string) {
    setConfirmDel(null);
    try {
      await api(`/api/keys?id=${id}`, { method: 'DELETE' });
      await loadKeys();
      if (engine?.kind === 'cloud' && (engine as any).keyId === id) clearEngine();
    } catch (err: any) {
      alert(`Delete failed: ${err.message}`);
    }
  }

  /* ---------------- webllm download ---------------- */

  async function downloadWebLLM(id: string) {
    if (wllmDl) return;
    setWllmErr('');
    wllmStat.current = null;
    const update = (pct: number, text: string) => {
      const mbm = text.match(/(\d+(?:\.\d+)?)\s*MB fetched/i);
      const mb = mbm ? parseFloat(mbm[1]) : null;
      const now = Date.now();
      let speed: string | null = null, eta: string | null = null;
      const prev = wllmStat.current;
      if (mb != null && prev && now - prev.t > 1500 && mb >= prev.mb) {
        const mbps = (mb - prev.mb) / ((now - prev.t) / 1000);
        if (mbps > 0.05) {
          speed = `${mbps.toFixed(1)} MB/s`;
          wllmStat.current = { t: now, mb };
        }
      } else if (mb != null && !prev) {
        wllmStat.current = { t: now, mb };
      }
      void eta;
      setWllmDl({
        modelId: id, pct: Math.min(100, pct),
        phase: /finish|compil|load|warm/i.test(text) || pct >= 100 ? 'verifying' : 'downloading',
        mb, speed, eta, text,
      });
    };
    try {
      await loadWebLLM(id, update);
      markDownloaded(id);
      setDownloaded(getDownloaded());
      setWllmDl(null);
      activate({ kind: 'webllm', model: id });
    } catch (err: any) {
      setWllmDl(null);
      setWllmErr(err.message || 'Could not load model.');
    }
  }

  /* ---------------- ollama pull (aggregated progress) ---------------- */

  async function pullModel() {
    if (pull || !ollamaModel.trim()) return;
    setOllamaErr('');
    const base = ollamaUrl.trim().replace(/\/$/, '');
    setPull({ pct: 0, phase: 'Pulling manifest', detail: 'starting…' });
    const layers = new Map<string, { completed: number; total: number }>();
    try {
      const r = await fetch(`${base}/api/pull`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: ollamaModel.trim(), name: ollamaModel.trim(), stream: true }),
      });
      if (!r.ok || !r.body) throw new Error('Pull request rejected — is Ollama running with OLLAMA_ORIGINS set?');
      const reader = r.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split('\n');
        buf = lines.pop() || '';
        for (const l of lines) {
          if (!l.trim()) continue;
          let j: any;
          try { j = JSON.parse(l); } catch { continue; }
          if (j.error) throw new Error(j.error);
          const st = String(j.status || '');
          if (st === 'success') { setPull({ pct: 100, phase: 'Verifying manifest', detail: 'writing model…' }); continue; }
          if (/verif/i.test(st)) { setPull((p) => p && { ...p, phase: 'Verifying checksum', detail: st }); continue; }
          if (j.digest && j.total) {
            layers.set(j.digest, { completed: j.completed || 0, total: j.total });
          } else if (/pulling manifest/i.test(st)) {
            setPull((p) => p && { ...p, phase: 'Pulling manifest', detail: st });
            continue;
          }
          let doneB = 0, totB = 0;
          layers.forEach((v) => { doneB += v.completed; totB += v.total; });
          if (totB > 0) {
            const pct = Math.min(99, Math.round((doneB / totB) * 100));
            setPull({ pct, phase: 'Downloading layers', detail: `${fmtMB(doneB / 1048576)} / ${fmtMB(totB / 1048576)} · ${layers.size} layer${layers.size === 1 ? '' : 's'}` });
          }
        }
      }
      setPull({ pct: 100, phase: 'Done', detail: 'model verified and ready' });
      await refreshOllama();
      setPull(null);
    } catch (err: any) {
      setPull(null);
      setOllamaErr(err.message || 'Pull failed.');
    }
  }

  async function refreshOllama() {
    setOllamaLoading(true);
    setOllamaErr('');
    try {
      const tags = await ollamaTags(ollamaUrl.trim().replace(/\/$/, ''));
      setOllamaInstalled(tags);
      setOllamaAvail({ state: 'ok', reason: '' });
      if (tags.length && !tags.includes(ollamaModel)) setOllamaModel(tags[0]);
    } catch (e: any) {
      setOllamaAvail({ state: 'no', reason: OLLAMA_WHY_NOT(ollamaUrl.trim()) });
      setOllamaErr(e.message);
    } finally { setOllamaLoading(false); }
  }

  async function refreshLms() {
    setLmsLoading(true);
    setLmsErr('');
    try {
      const ms = await lmstudioModels(lmsUrl.trim().replace(/\/$/, ''));
      setLmsInstalled(ms);
      setLmsAvail({ state: 'ok', reason: '' });
      if (ms.length && !ms.includes(lmsModel)) setLmsModel(ms[0]);
    } catch (e: any) {
      setLmsAvail({ state: 'no', reason: LMS_WHY_NOT(lmsUrl.trim()) });
      setLmsErr(e.message);
    } finally { setLmsLoading(false); }
  }

  /* ---------------- render ---------------- */

  const tabs: { id: TabId; label: string; icon: React.ReactNode }[] = [
    { id: 'cloud', label: 'Cloud (BYOK)', icon: <Key size={16} /> },
    { id: 'webllm', label: 'Browser (WebLLM)', icon: <Laptop size={16} /> },
    { id: 'ollama', label: 'Ollama', icon: <Server size={16} /> },
    { id: 'lmstudio', label: 'LM Studio', icon: <Cpu size={16} /> },
  ];

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Models & Inference Keys"
        desc="Bring your own cloud API key, or run inference on-device: in the browser (WebGPU), via Ollama, or via LM Studio."
      />

      {/* Active engine banner */}
      <Card className="flex flex-wrap items-center justify-between gap-4 border-indigo-500/30 bg-indigo-950/20">
        <div>
          <div className="text-xs uppercase tracking-wider text-indigo-400">Currently Active Engine</div>
          <div className="mt-1 flex items-center gap-2 text-base font-semibold text-white">
            <CheckCircle2 size={18} className="text-emerald-400" />
            {engineLabel(engine)}
          </div>
          {engine && <div className="mt-0.5 text-xs text-zinc-500">Saved in this browser — used for every chat until changed.</div>}
        </div>
        {engine && <Button variant="ghost" onClick={clearEngine}>Clear Active Model</Button>}
      </Card>

      {/* Engine cards with live availability */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-white">Engines</h3>
          <Button variant="ghost" onClick={probeLocal} disabled={probing} className="!px-3 !py-1.5 text-xs">
            <RefreshCw size={13} className={probing ? 'animate-spin' : ''} /> Recheck
          </Button>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <EngineCard
            icon={<Key size={18} />} name="Cloud (BYOK)" tagline="Your API keys · encrypted server-side"
            avail={cloudAvail}
            footer={keys.length ? <div className="text-xs text-zinc-400">{keys.length} key{keys.length === 1 ? '' : 's'} saved{keys.some((k) => isCurrent('cloud', k.id)) ? ' · one active' : ''}</div> : undefined}
            actionLabel="Manage keys" onAction={() => setTab('cloud')}
          />
          <EngineCard
            icon={<Laptop size={18} />} name="Browser (WebLLM)" tagline="In-browser LLM · zero token cost"
            avail={webllmAvail}
            footer={downloaded.length ? <div className="flex items-center gap-1.5 text-xs text-zinc-400"><HardDrive size={13} className="text-zinc-500" />{downloaded.length} model{downloaded.length === 1 ? '' : 's'} cached in this browser</div> : undefined}
            actionLabel="Browse models" onAction={() => setTab('webllm')}
          />
          <EngineCard
            icon={<Server size={18} />} name="Ollama" tagline="Local models on this machine"
            avail={ollamaAvail}
            footer={ollamaAvail.state === 'ok' ? <div className="text-xs text-zinc-400">{ollamaInstalled.length} model{ollamaInstalled.length === 1 ? '' : 's'} installed locally</div> : undefined}
            actionLabel="Connect Ollama" onAction={() => setTab('ollama')}
          />
          <EngineCard
            icon={<Cpu size={18} />} name="LM Studio" tagline="Local server · OpenAI-compatible"
            avail={lmsAvail}
            footer={lmsAvail.state === 'ok' ? <div className="text-xs text-zinc-400">{lmsInstalled.length} model{lmsInstalled.length === 1 ? '' : 's'} loaded in LM Studio</div> : undefined}
            actionLabel="Connect LM Studio" onAction={() => setTab('lmstudio')}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
              tab === t.id ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: CLOUD BYOK */}
      {tab === 'cloud' && (
        <div className="space-y-6">
          <Card>
            <div className="mb-1 flex items-center gap-2 font-medium text-white">
              <ShieldCheck size={16} className="text-emerald-400" /> Your Saved Cloud Keys
            </div>
            <p className="mb-4 text-xs text-zinc-500">
              Raw keys are stored encrypted on the server and are never returned to the browser — values shown here are masked.
            </p>
            {!keys.length ? (
              <p className="text-sm text-zinc-400">No keys added yet. Add an API key below to enable cloud reasoning.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {keys.map((k) => (
                  <div key={k.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2 font-medium text-white">
                        <span className="truncate">{k.label}</span>
                        <Badge tone="indigo">{PROVIDERS[k.provider as ProviderId]?.name || k.provider}</Badge>
                        {k.shared && <Badge tone="green">shared with org</Badge>}
                        {!k.mine && <Badge tone="zinc">org key</Badge>}
                        {isCurrent('cloud', k.id) && <Badge tone="green"><CheckCircle2 size={11} /> Active</Badge>}
                      </div>
                      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-zinc-500">
                        <span className="font-mono">•••••••• <span className="font-sans">(never shown)</span></span>
                        <span>model: <span className="text-zinc-300">{k.model}</span></span>
                        {k.base_url && <span className="truncate">base: <span className="font-mono text-zinc-400">{k.base_url}</span></span>}
                        <span>added {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={isCurrent('cloud', k.id) ? 'ghost' : 'primary'}
                        className="!px-3 !py-1.5 text-xs"
                        onClick={() => activate({ kind: 'cloud', keyId: k.id, model: k.model, label: k.label })}
                      >
                        {isCurrent('cloud', k.id) ? 'Selected' : 'Use this'}
                      </Button>
                      {k.mine && confirmDel !== k.id && (
                        <Button variant="ghost" className="!px-2.5 !py-1.5" title="Delete key" onClick={() => setConfirmDel(k.id)}>
                          <Trash2 size={14} />
                        </Button>
                      )}
                      {k.mine && confirmDel === k.id && (
                        <span className="flex items-center gap-1.5 text-xs">
                          <span className="text-zinc-400">Delete?</span>
                          <Button variant="danger" className="!px-2.5 !py-1.5" onClick={() => deleteKey(k.id)}>Confirm</Button>
                          <Button variant="ghost" className="!px-2.5 !py-1.5" onClick={() => setConfirmDel(null)}>Cancel</Button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <div className="mb-4 font-medium text-white">Add Cloud API Key</div>
            <form onSubmit={addKey} className="space-y-3">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Provider</Label>
                  <Select
                    value={provider}
                    onChange={(e) => {
                      const p = e.target.value as ProviderId;
                      setProvider(p);
                      setModel(PROVIDERS[p].models[0] || '');
                    }}
                  >
                    {Object.entries(PROVIDERS).map(([pid, p]) => (
                      <option key={pid} value={pid}>{p.name}</option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Label</Label>
                  <Input placeholder="e.g. Work OpenAI Key" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Model</Label>
                  {PROVIDERS[provider].models.length > 0 && (
                    <Select value={PROVIDERS[provider].models.includes(model) ? model : '__custom'} onChange={(e) => setModel(e.target.value)} className="mb-2">
                      {PROVIDERS[provider].models.map((m) => <option key={m} value={m}>{m}</option>)}
                      <option value="__custom">Custom model ID…</option>
                    </Select>
                  )}
                  <Input
                    placeholder={PROVIDERS[provider].models.length ? 'Or type a custom model ID' : 'e.g. meta-llama/Llama-3-70b-chat'}
                    required
                    value={model === '__custom' ? '' : model}
                    onChange={(e) => setModel(e.target.value)}
                    maxLength={120}
                  />
                </div>
                <div>
                  <Label>API Key</Label>
                  <Input type="password" required autoComplete="off" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} maxLength={500} />
                  <p className="mt-1 text-xs text-zinc-500">Sent once, encrypted on the server. It is never displayed again.</p>
                </div>
              </div>

              {provider === 'custom' && (
                <div>
                  <Label>Base URL (must use HTTPS)</Label>
                  <Input type="url" required placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} maxLength={300} />
                </div>
              )}

              {canShare ? (
                <label className="flex items-start gap-2 pt-1 text-sm text-zinc-300">
                  <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 rounded accent-indigo-600" />
                  <span>Share this key with all workspace members <span className="text-zinc-500">(encrypted server-side, raw key never disclosed)</span></span>
                </label>
              ) : (
                <div className="flex gap-2 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-500">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <span>Key sharing is available to admins in team workspaces{me?.orgKind !== 'team' ? ' — you are in a personal workspace, so keys stay private to you' : ' — your role does not allow sharing, so this key stays private to you'}.</span>
                </div>
              )}

              {keyErr && <p className="text-sm text-red-400">{keyErr}</p>}
              <Button disabled={keyBusy}>{keyBusy ? 'Saving…' : 'Save & Activate Key'}</Button>
            </form>
          </Card>
        </div>
      )}

      {/* TAB 2: WEBLLM */}
      {tab === 'webllm' && (
        <Card className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Browser Edge Models (WebLLM)</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Weights download directly into your browser cache and run via WebGPU. No network calls during inference, zero token cost.
            </p>
          </div>
          <WhyNot avail={webllmAvail} />
          {wllmErr && (
            <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
              <XCircle size={14} className="mt-0.5 shrink-0" /> <span>{wllmErr}</span>
            </div>
          )}

          {wllmDl && (
            <div className="rounded-xl border border-indigo-500/30 bg-indigo-950/20 p-4">
              <Progress
                value={wllmDl.pct}
                label={wllmDl.phase === 'verifying'
                  ? `Verifying & loading ${wllmDl.modelId}…`
                  : `Downloading ${wllmDl.modelId}${wllmDl.mb != null ? ` · ${fmtMB(wllmDl.mb)} fetched` : ''}${wllmDl.speed ? ` · ${wllmDl.speed}` : ''}`}
              />
              <div className="mt-1 truncate text-xs text-zinc-500">{wllmDl.text}</div>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            {WEBLLM_MODELS.map((m) => {
              const active = isCurrent('webllm', m.id);
              const cached = downloaded.includes(m.id);
              const busy = !!wllmDl;
              return (
                <div
                  key={m.id}
                  className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                    active ? 'border-indigo-500 bg-indigo-950/30' : 'border-white/10 bg-zinc-950/60 hover:border-white/20'
                  }`}
                >
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-medium text-white">{m.name}</span>
                      <Badge tone="zinc">{m.size}</Badge>
                    </div>
                    <div className="mt-1 flex flex-wrap items-center gap-2">
                      <span className="truncate text-xs text-zinc-500">{m.id}</span>
                      {cached && !active && <Badge tone="green">cached</Badge>}
                      {active && <Badge tone="green"><CheckCircle2 size={11} /> Active</Badge>}
                    </div>
                  </div>
                  <div className="mt-4">
                    <Button
                      className="w-full" variant={active ? 'ghost' : 'primary'}
                      disabled={busy || webllmAvail.state === 'no'}
                      onClick={() => (active ? undefined : downloadWebLLM(m.id))}
                      title={webllmAvail.state === 'no' ? WEBGPU_HELP : cached ? 'Weights cached — loads instantly' : 'Download weights into this browser'}
                    >
                      {active ? 'Active Model' : wllmDl?.modelId === m.id ? 'Downloading…' : cached ? <><Download size={14} /> Load cached</> : <><Download size={14} /> Download & Use</>}
                    </Button>
                  </div>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* TAB 3: OLLAMA */}
      {tab === 'ollama' && (
        <Card className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Connect Local Ollama</h3>
            <p className="mt-1 text-sm text-zinc-400">
              PRAMAAN talks to Ollama from your browser — the model runs on your machine, your documents never leave it.
              Start with <code className="rounded bg-white/10 px-1">OLLAMA_ORIGINS="*" ollama serve</code> so the browser is allowed to connect.
            </p>
          </div>
          <WhyNot avail={ollamaAvail} />
          {ollamaErr && (
            <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
              <XCircle size={14} className="mt-0.5 shrink-0" /> <span>{ollamaErr}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Ollama Base URL</Label>
              <div className="flex gap-2">
                <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                <Button variant="ghost" onClick={refreshOllama} disabled={ollamaLoading} title="Probe Ollama">
                  <RefreshCw size={14} className={ollamaLoading ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
            <div>
              <Label>Model to Run</Label>
              <Select value={ollamaInstalled.includes(ollamaModel) ? ollamaModel : '__custom'} onChange={(e) => setOllamaModel(e.target.value)} className="mb-2">
                {ollamaInstalled.length > 0
                  ? ollamaInstalled.map((m) => <option key={m} value={m}>{m} (installed)</option>)
                  : OLLAMA_CATALOG.map((m) => <option key={m} value={m}>{m} (catalog)</option>)}
                <option value="__custom">Type a custom tag…</option>
              </Select>
              <Input placeholder="e.g. llama3.1:8b" value={ollamaModel === '__custom' ? '' : ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} />
            </div>
          </div>

          {ollamaInstalled.length > 0 && (
            <div>
              <Label>Installed on this machine</Label>
              <div className="flex flex-wrap gap-2">
                {ollamaInstalled.map((m) => (
                  <button
                    key={m}
                    onClick={() => setOllamaModel(m)}
                    className={`rounded-full border px-3 py-1 text-xs transition ${
                      ollamaModel === m ? 'border-indigo-500 bg-indigo-950/40 text-indigo-200' : 'border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
                    }`}
                  >
                    {m} {isCurrent('ollama', m) && '· active'}
                  </button>
                ))}
              </div>
            </div>
          )}

          {pull && <Progress value={pull.pct} label={`${pull.phase} — ${pull.detail}`} />}

          <div className="flex flex-wrap gap-2 pt-1">
            <Button
              onClick={() => activate({ kind: 'ollama', baseUrl: ollamaUrl.trim().replace(/\/$/, ''), model: ollamaModel.trim() })}
              disabled={!ollamaModel.trim() || ollamaAvail.state === 'no'}
              title={ollamaAvail.state === 'no' ? 'Ollama is not reachable — start it first' : 'Set as the active engine'}
            >
              {isCurrent('ollama', ollamaModel.trim()) ? 'Active Engine' : 'Activate Ollama Model'}
            </Button>
            <Button variant="ghost" onClick={pullModel} disabled={!!pull || !ollamaModel.trim() || ollamaAvail.state === 'no'}>
              <Download size={14} /> Pull Model to Local
            </Button>
          </div>
        </Card>
      )}

      {/* TAB 4: LM STUDIO */}
      {tab === 'lmstudio' && (
        <Card className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Connect LM Studio Local Server</h3>
            <p className="mt-1 text-sm text-zinc-400">
              In LM Studio, start the <strong className="text-zinc-200">Local Server</strong> (port 1234 by default) and switch on
              <strong className="text-zinc-200"> “Enable CORS”</strong> under Developer settings — otherwise your browser cannot reach it.
            </p>
          </div>
          <WhyNot avail={lmsAvail} />
          {lmsErr && (
            <div className="flex gap-2 rounded-xl border border-red-500/30 bg-red-950/20 p-3 text-xs text-red-300">
              <XCircle size={14} className="mt-0.5 shrink-0" /> <span>{lmsErr}</span>
            </div>
          )}

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Server URL</Label>
              <div className="flex gap-2">
                <Input value={lmsUrl} onChange={(e) => setLmsUrl(e.target.value)} placeholder="http://localhost:1234" />
                <Button variant="ghost" onClick={refreshLms} disabled={lmsLoading} title="Probe LM Studio">
                  <RefreshCw size={14} className={lmsLoading ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
            <div>
              <Label>Model ID</Label>
              {lmsInstalled.length > 0 ? (
                <Select value={lmsModel} onChange={(e) => setLmsModel(e.target.value)}>
                  {lmsInstalled.map((m) => <option key={m} value={m}>{m}</option>)}
                </Select>
              ) : (
                <Input placeholder="e.g. meta-llama-3.1-8b-instruct" value={lmsModel} onChange={(e) => setLmsModel(e.target.value)} />
              )}
              {lmsInstalled.length > 0 && (
                <Input className="mt-2 text-xs" placeholder="Or type a model ID manually" value={lmsModel} onChange={(e) => setLmsModel(e.target.value)} />
              )}
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2 pt-1">
            <Button
              onClick={() => activate({ kind: 'lmstudio', baseUrl: lmsUrl.trim().replace(/\/$/, ''), model: lmsModel.trim() })}
              disabled={!lmsModel.trim() || lmsAvail.state === 'no'}
              title={lmsAvail.state === 'no' ? 'LM Studio server is not reachable — start it first' : 'Set as the active engine'}
            >
              {isCurrent('lmstudio', lmsModel.trim()) && lmsModel.trim() ? 'Active Engine' : 'Activate LM Studio Model'}
            </Button>
            <a
              href="https://lmstudio.ai/docs/app/advanced/cors"
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-zinc-500 underline-offset-2 hover:text-zinc-300 hover:underline"
            >
              How to enable CORS <ExternalLink size={11} />
            </a>
          </div>
        </Card>
      )}
    </div>
  );
}
