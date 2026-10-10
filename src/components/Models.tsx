'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Cpu, Key, Laptop, Server, Trash2, Check, Download, RefreshCw,
  AlertTriangle, XCircle, Info, ExternalLink, HardDrive,
} from 'lucide-react';
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
    return <span className="pill pill-amber"><RefreshCw size={11} className="animate-spin" /> Checking</span>;
  if (avail.state === 'ok')
    return <span className="pill pill-green"><span className="dot" /> Available</span>;
  return <span className="pill pill-red"><span className="dot" /> Unavailable</span>;
}

function WhyNot({ avail }: { avail: Avail }) {
  if (avail.state !== 'no') return null;
  return (
    <div className="flex gap-2.5 rounded-lg border border-[var(--border)] bg-[#111] p-3 text-xs leading-relaxed text-[var(--muted)]">
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-[var(--amber)]" />
      <span><span className="font-medium text-[var(--text)]">Why not? </span>{avail.reason}</span>
    </div>
  );
}

function ThinProgress({ value, label }: { value: number; label?: string }) {
  return (
    <div className="space-y-2">
      {label && (
        <div className="flex items-center justify-between gap-4 text-xs text-[var(--muted)]">
          <span className="truncate">{label}</span>
          <span className="tnum shrink-0 text-[var(--text)]">{Math.round(value)}%</span>
        </div>
      )}
      <div className="h-[2px] overflow-hidden rounded-full bg-[var(--border)]">
        <div className="h-full bg-white transition-all" style={{ width: `${Math.min(100, value)}%` }} />
      </div>
    </div>
  );
}

function IconButton(props: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { className, ...rest } = props;
  return (
    <button
      {...rest}
      className={`inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-md border border-[var(--border-strong)] text-[var(--muted)] transition hover:border-[#737373] hover:text-white disabled:cursor-not-allowed disabled:opacity-50 ${className ?? ''}`}
    />
  );
}

function EngineCard(props: {
  icon: React.ReactNode; name: string; tagline: string; avail: Avail;
  actionLabel: string; onAction: () => void; footer?: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col gap-3 p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg border border-[var(--border)] bg-[#111] text-[var(--muted)]">{props.icon}</div>
          <div>
            <div className="text-sm font-medium text-white">{props.name}</div>
            <div className="text-xs text-[var(--muted)]">{props.tagline}</div>
          </div>
        </div>
        <Pill avail={props.avail} />
      </div>
      <WhyNot avail={props.avail} />
      {props.footer}
      <div className="mt-auto pt-1">
        <button className="btn btn-secondary btn-sm w-full" onClick={props.onAction}>{props.actionLabel}</button>
      </div>
    </div>
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
    { id: 'cloud', label: 'Cloud (BYOK)', icon: <Key size={14} /> },
    { id: 'webllm', label: 'Browser (WebLLM)', icon: <Laptop size={14} /> },
    { id: 'ollama', label: 'Ollama', icon: <Server size={14} /> },
    { id: 'lmstudio', label: 'LM Studio', icon: <Cpu size={14} /> },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="h-tight text-xl font-semibold text-white">Models & Inference Keys</h2>
        <p className="mt-1 max-w-2xl text-sm text-[var(--muted)]">
          Bring your own cloud API key, or run inference on-device: in the browser (WebGPU), via Ollama, or via LM Studio.
        </p>
      </div>

      {/* Active engine banner */}
      <div className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="micro-label">Active engine</div>
            <div className="mt-2 flex items-center gap-2 text-[15px] font-medium text-white">
              <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${engine ? 'bg-[var(--green)]' : 'bg-[var(--faint)]'}`} />
              {engineLabel(engine)}
            </div>
            {engine && <div className="mt-1 text-xs text-[var(--muted)]">Saved in this browser — used for every chat until changed.</div>}
          </div>
          {engine && <button className="btn btn-secondary btn-sm" onClick={clearEngine}>Clear</button>}
        </div>
      </div>

      {/* Engine cards with live availability */}
      <div>
        <div className="mb-3 flex items-center justify-between">
          <h3 className="micro-label">Engines</h3>
          <button className="btn btn-secondary btn-sm" onClick={probeLocal} disabled={probing}>
            <RefreshCw size={13} className={probing ? 'animate-spin' : ''} /> Recheck
          </button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <EngineCard
            icon={<Key size={18} />} name="Cloud (BYOK)" tagline="Your API keys · encrypted server-side"
            avail={cloudAvail}
            footer={keys.length ? <div className="text-xs text-[var(--muted)]">{keys.length} key{keys.length === 1 ? '' : 's'} saved{keys.some((k) => isCurrent('cloud', k.id)) ? ' · one active' : ''}</div> : undefined}
            actionLabel="Manage keys" onAction={() => setTab('cloud')}
          />
          <EngineCard
            icon={<Laptop size={18} />} name="Browser (WebLLM)" tagline="In-browser LLM · zero token cost"
            avail={webllmAvail}
            footer={downloaded.length ? <div className="flex items-center gap-1.5 text-xs text-[var(--muted)]"><HardDrive size={13} className="text-[var(--faint)]" />{downloaded.length} model{downloaded.length === 1 ? '' : 's'} cached in this browser</div> : undefined}
            actionLabel="Browse models" onAction={() => setTab('webllm')}
          />
          <EngineCard
            icon={<Server size={18} />} name="Ollama" tagline="Local models on this machine"
            avail={ollamaAvail}
            footer={ollamaAvail.state === 'ok' ? <div className="text-xs text-[var(--muted)]">{ollamaInstalled.length} model{ollamaInstalled.length === 1 ? '' : 's'} installed locally</div> : undefined}
            actionLabel="Connect Ollama" onAction={() => setTab('ollama')}
          />
          <EngineCard
            icon={<Cpu size={18} />} name="LM Studio" tagline="Local server · OpenAI-compatible"
            avail={lmsAvail}
            footer={lmsAvail.state === 'ok' ? <div className="text-xs text-[var(--muted)]">{lmsInstalled.length} model{lmsInstalled.length === 1 ? '' : 's'} loaded in LM Studio</div> : undefined}
            actionLabel="Connect LM Studio" onAction={() => setTab('lmstudio')}
          />
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-6 border-b border-[var(--border)]" role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id} role="tab" aria-selected={tab === t.id}
            onClick={() => setTab(t.id)}
            className={`flex items-center gap-2 border-b-2 pb-3 text-sm transition ${
              tab === t.id ? 'border-white font-medium text-white' : 'border-transparent text-[var(--muted)] hover:text-[var(--text)]'
            }`}
          >
            {t.icon} {t.label}
          </button>
        ))}
      </div>

      {/* TAB 1: CLOUD BYOK */}
      {tab === 'cloud' && (
        <div className="space-y-8">
          <div>
            <h3 className="micro-label mb-3">Saved keys</h3>
            <p className="mb-3 text-xs text-[var(--muted)]">
              Raw keys are stored encrypted on the server and are never returned to the browser — values shown here are masked.
            </p>
            {!keys.length ? (
              <div className="card p-6 text-center text-sm text-[var(--muted)]">
                No keys added yet. Add an API key below to enable cloud reasoning.
              </div>
            ) : (
              <div className="card divide-y divide-[var(--border)]">
                {keys.map((k) => (
                  <div key={k.id} className={`flex flex-wrap items-center justify-between gap-3 px-4 py-3.5 ${isCurrent('cloud', k.id) ? 'bg-[#111]' : ''}`}>
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {isCurrent('cloud', k.id) && <Check size={14} className="shrink-0 text-[var(--green)]" />}
                        <span className="truncate text-sm font-medium text-white">{k.label}</span>
                        <span className="pill">{PROVIDERS[k.provider as ProviderId]?.name || k.provider}</span>
                        {k.shared && <span className="pill pill-green"><span className="dot" /> Shared</span>}
                        {!k.mine && <span className="pill">Org key</span>}
                        {isCurrent('cloud', k.id) && <span className="pill pill-green"><span className="dot" /> Active</span>}
                      </div>
                      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-xs text-[var(--muted)]">
                        <span>••••••••</span>
                        <span className="font-sans">model <span className="text-[var(--text)]">{k.model}</span></span>
                        {k.base_url && <span className="truncate">base {k.base_url}</span>}
                        <span className="font-sans">added {k.created_at ? new Date(k.created_at).toLocaleDateString() : '—'}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        className={`btn btn-sm ${isCurrent('cloud', k.id) ? 'btn-secondary' : 'btn-primary'}`}
                        onClick={() => activate({ kind: 'cloud', keyId: k.id, model: k.model, label: k.label })}
                      >
                        {isCurrent('cloud', k.id) ? 'Selected' : 'Use this'}
                      </button>
                      {k.mine && confirmDel !== k.id && (
                        <IconButton title="Delete key" onClick={() => setConfirmDel(k.id)}>
                          <Trash2 size={14} />
                        </IconButton>
                      )}
                      {k.mine && confirmDel === k.id && (
                        <span className="flex items-center gap-2 text-xs text-[var(--muted)]">
                          Delete?
                          <button className="btn btn-sm border border-[rgba(243,18,96,0.5)] text-[var(--red)] hover:bg-[rgba(243,18,96,0.1)]" onClick={() => deleteKey(k.id)}>Confirm</button>
                          <button className="btn btn-sm btn-secondary" onClick={() => setConfirmDel(null)}>Cancel</button>
                        </span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div>
            <h3 className="micro-label mb-3">Add API key</h3>
            <form onSubmit={addKey}>
              <div className="card divide-y divide-[var(--border)]">
                <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
                  <div className="micro-label">Provider</div>
                  <select
                    className="input sm:max-w-sm"
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
                  </select>
                </div>

                <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
                  <div className="micro-label">Label</div>
                  <input className="input sm:max-w-sm" placeholder="e.g. Work OpenAI Key" value={label} onChange={(e) => setLabel(e.target.value)} maxLength={60} />
                </div>

                <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
                  <div className="micro-label sm:pt-3">Model</div>
                  <div className="max-w-sm space-y-2">
                    {PROVIDERS[provider].models.length > 0 && (
                      <select className="input" value={PROVIDERS[provider].models.includes(model) ? model : '__custom'} onChange={(e) => setModel(e.target.value)}>
                        {PROVIDERS[provider].models.map((m) => <option key={m} value={m}>{m}</option>)}
                        <option value="__custom">Custom model ID…</option>
                      </select>
                    )}
                    <input
                      className="input font-mono"
                      placeholder={PROVIDERS[provider].models.length ? 'Or type a custom model ID' : 'e.g. meta-llama/Llama-3-70b-chat'}
                      required
                      value={model === '__custom' ? '' : model}
                      onChange={(e) => setModel(e.target.value)}
                      maxLength={120}
                    />
                  </div>
                </div>

                <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
                  <div className="micro-label sm:pt-3">API key</div>
                  <div className="max-w-sm">
                    <input className="input font-mono" type="password" required autoComplete="off" placeholder="sk-…" value={apiKey} onChange={(e) => setApiKey(e.target.value)} maxLength={500} />
                    <p className="mt-1.5 text-xs text-[var(--muted)]">Sent once, encrypted on the server. It is never displayed again.</p>
                  </div>
                </div>

                {provider === 'custom' && (
                  <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
                    <div className="micro-label">Base URL</div>
                    <input className="input max-w-sm font-mono" type="url" required placeholder="https://api.example.com/v1" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} maxLength={300} />
                  </div>
                )}

                <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
                  <div className="micro-label">Sharing</div>
                  <div>
                    {canShare ? (
                      <label className="flex cursor-pointer items-start gap-2.5 text-sm text-[var(--text)]">
                        <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} className="mt-0.5 h-4 w-4 shrink-0 accent-white" />
                        <span>Share this key with all workspace members <span className="text-[var(--muted)]">(encrypted server-side, raw key never disclosed)</span></span>
                      </label>
                    ) : (
                      <div className="flex gap-2.5 text-xs text-[var(--muted)]">
                        <Info size={14} className="mt-0.5 shrink-0" />
                        <span>Key sharing is available to admins in team workspaces{me?.orgKind !== 'team' ? ' — you are in a personal workspace, so keys stay private to you' : ' — your role does not allow sharing, so this key stays private to you'}.</span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              {keyErr && <p className="mt-3 text-sm text-[var(--red)]">{keyErr}</p>}
              <div className="mt-4">
                <button type="submit" className="btn btn-primary" disabled={keyBusy}>{keyBusy ? 'Saving…' : 'Save & activate key'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* TAB 2: WEBLLM */}
      {tab === 'webllm' && (
        <div className="card">
          <div className="border-b border-[var(--border)] px-4 py-4">
            <h3 className="micro-label">Browser models · WebLLM</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              Weights download directly into your browser cache and run via WebGPU. No network calls during inference, zero token cost.
            </p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <WhyNot avail={webllmAvail} />
            {wllmErr && (
              <div className="flex gap-2.5 rounded-lg border border-[rgba(243,18,96,0.35)] bg-[#111] p-3 text-xs text-[var(--text)]">
                <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--red)]" /> <span>{wllmErr}</span>
              </div>
            )}
            {wllmDl && (
              <div className="rounded-lg border border-[var(--border)] bg-[#111] p-4">
                <ThinProgress
                  value={wllmDl.pct}
                  label={wllmDl.phase === 'verifying'
                    ? `Verifying & loading ${wllmDl.modelId}…`
                    : `Downloading ${wllmDl.modelId}${wllmDl.mb != null ? ` · ${fmtMB(wllmDl.mb)} fetched` : ''}${wllmDl.speed ? ` · ${wllmDl.speed}` : ''}`}
                />
                <div className="mt-1.5 truncate font-mono text-xs text-[var(--muted)]">{wllmDl.text}</div>
              </div>
            )}
          </div>
          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            {WEBLLM_MODELS.map((m) => {
              const active = isCurrent('webllm', m.id);
              const cached = downloaded.includes(m.id);
              const busy = !!wllmDl;
              return (
                <div key={m.id} className={`flex items-center justify-between gap-4 px-4 py-3.5 ${active ? 'bg-[#111]' : ''}`}>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      {active && <Check size={14} className="shrink-0 text-[var(--green)]" />}
                      <span className="text-sm font-medium text-white">{m.name}</span>
                      <span className="pill">{m.size}</span>
                      {cached && !active && <span className="pill pill-green"><span className="dot" /> Cached</span>}
                      {active && <span className="pill pill-green"><span className="dot" /> Active</span>}
                    </div>
                    <div className="mt-1 truncate font-mono text-xs text-[var(--muted)]">{m.id}</div>
                  </div>
                  <button
                    className={`btn btn-sm shrink-0 ${active || cached ? 'btn-secondary' : 'btn-primary'}`}
                    disabled={busy || webllmAvail.state === 'no'}
                    onClick={() => (active ? undefined : downloadWebLLM(m.id))}
                    title={webllmAvail.state === 'no' ? WEBGPU_HELP : cached ? 'Weights cached — loads instantly' : 'Download weights into this browser'}
                  >
                    {active ? 'Active' : wllmDl?.modelId === m.id ? 'Downloading…' : cached ? <><Download size={14} /> Load cached</> : <><Download size={14} /> Download</>}
                  </button>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* TAB 3: OLLAMA */}
      {tab === 'ollama' && (
        <div className="card">
          <div className="border-b border-[var(--border)] px-4 py-4">
            <h3 className="micro-label">Ollama · local models</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              PRAMAAN talks to Ollama from your browser — the model runs on your machine, your documents never leave it.
              Start with <code className="rounded border border-[var(--border)] bg-[#111] px-1.5 py-0.5 font-mono text-xs text-[var(--text)]">OLLAMA_ORIGINS=&quot;*&quot; ollama serve</code> so the browser is allowed to connect.
            </p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <WhyNot avail={ollamaAvail} />
            {ollamaErr && (
              <div className="flex gap-2.5 rounded-lg border border-[rgba(243,18,96,0.35)] bg-[#111] p-3 text-xs text-[var(--text)]">
                <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--red)]" /> <span>{ollamaErr}</span>
              </div>
            )}
          </div>
          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
              <div className="micro-label">Server URL</div>
              <div className="flex gap-2">
                <input className="input font-mono" value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} placeholder="http://localhost:11434" />
                <IconButton onClick={refreshOllama} disabled={ollamaLoading} title="Probe Ollama">
                  <RefreshCw size={14} className={ollamaLoading ? 'animate-spin' : ''} />
                </IconButton>
              </div>
            </div>
            <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
              <div className="micro-label sm:pt-3">Model</div>
              <div className="max-w-sm space-y-2">
                <select className="input" value={ollamaInstalled.includes(ollamaModel) ? ollamaModel : '__custom'} onChange={(e) => setOllamaModel(e.target.value)}>
                  {ollamaInstalled.length > 0
                    ? ollamaInstalled.map((m) => <option key={m} value={m}>{m} (installed)</option>)
                    : OLLAMA_CATALOG.map((m) => <option key={m} value={m}>{m} (catalog)</option>)}
                  <option value="__custom">Type a custom tag…</option>
                </select>
                <input className="input font-mono" placeholder="e.g. llama3.1:8b" value={ollamaModel === '__custom' ? '' : ollamaModel} onChange={(e) => setOllamaModel(e.target.value)} />
              </div>
            </div>
            {ollamaInstalled.length > 0 && (
              <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
                <div className="micro-label sm:pt-1.5">Installed</div>
                <div className="flex flex-wrap gap-2">
                  {ollamaInstalled.map((m) => (
                    <button
                      key={m}
                      onClick={() => setOllamaModel(m)}
                      className={`inline-flex h-8 items-center gap-1.5 rounded-full border px-3 font-mono text-xs transition ${
                        ollamaModel === m ? 'border-white bg-[#111] text-white' : 'border-[var(--border)] text-[var(--muted)] hover:border-[#737373] hover:text-white'
                      }`}
                    >
                      {m}{isCurrent('ollama', m) && <span className="text-[var(--green)]">· active</span>}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-4 border-t border-[var(--border)] px-4 py-4">
            {pull && <ThinProgress value={pull.pct} label={`${pull.phase} — ${pull.detail}`} />}
            <div className="flex flex-wrap gap-2">
              <button
                className="btn btn-primary btn-sm"
                onClick={() => activate({ kind: 'ollama', baseUrl: ollamaUrl.trim().replace(/\/$/, ''), model: ollamaModel.trim() })}
                disabled={!ollamaModel.trim() || ollamaAvail.state === 'no'}
                title={ollamaAvail.state === 'no' ? 'Ollama is not reachable — start it first' : 'Set as the active engine'}
              >
                {isCurrent('ollama', ollamaModel.trim()) ? 'Active engine' : 'Activate model'}
              </button>
              <button className="btn btn-secondary btn-sm" onClick={pullModel} disabled={!!pull || !ollamaModel.trim() || ollamaAvail.state === 'no'}>
                <Download size={14} /> Pull model
              </button>
            </div>
          </div>
        </div>
      )}

      {/* TAB 4: LM STUDIO */}
      {tab === 'lmstudio' && (
        <div className="card">
          <div className="border-b border-[var(--border)] px-4 py-4">
            <h3 className="micro-label">LM Studio · local server</h3>
            <p className="mt-2 text-sm text-[var(--muted)]">
              In LM Studio, start the <strong className="font-medium text-[var(--text)]">Local Server</strong> (port 1234 by default) and switch on
              <strong className="font-medium text-[var(--text)]"> “Enable CORS”</strong> under Developer settings — otherwise your browser cannot reach it.
            </p>
          </div>
          <div className="space-y-3 px-4 py-4">
            <WhyNot avail={lmsAvail} />
            {lmsErr && (
              <div className="flex gap-2.5 rounded-lg border border-[rgba(243,18,96,0.35)] bg-[#111] p-3 text-xs text-[var(--text)]">
                <XCircle size={14} className="mt-0.5 shrink-0 text-[var(--red)]" /> <span>{lmsErr}</span>
              </div>
            )}
          </div>
          <div className="divide-y divide-[var(--border)] border-t border-[var(--border)]">
            <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-center sm:gap-4">
              <div className="micro-label">Server URL</div>
              <div className="flex gap-2">
                <input className="input font-mono" value={lmsUrl} onChange={(e) => setLmsUrl(e.target.value)} placeholder="http://localhost:1234" />
                <IconButton onClick={refreshLms} disabled={lmsLoading} title="Probe LM Studio">
                  <RefreshCw size={14} className={lmsLoading ? 'animate-spin' : ''} />
                </IconButton>
              </div>
            </div>
            <div className="grid gap-2 px-4 py-4 sm:grid-cols-[200px_1fr] sm:items-start sm:gap-4">
              <div className="micro-label sm:pt-3">Model ID</div>
              <div className="max-w-sm space-y-2">
                {lmsInstalled.length > 0 ? (
                  <select className="input" value={lmsModel} onChange={(e) => setLmsModel(e.target.value)}>
                    {lmsInstalled.map((m) => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input className="input font-mono" placeholder="e.g. meta-llama-3.1-8b-instruct" value={lmsModel} onChange={(e) => setLmsModel(e.target.value)} />
                )}
                {lmsInstalled.length > 0 && (
                  <input className="input font-mono" placeholder="Or type a model ID manually" value={lmsModel} onChange={(e) => setLmsModel(e.target.value)} />
                )}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-4 border-t border-[var(--border)] px-4 py-4">
            <button
              className="btn btn-primary btn-sm"
              onClick={() => activate({ kind: 'lmstudio', baseUrl: lmsUrl.trim().replace(/\/$/, ''), model: lmsModel.trim() })}
              disabled={!lmsModel.trim() || lmsAvail.state === 'no'}
              title={lmsAvail.state === 'no' ? 'LM Studio server is not reachable — start it first' : 'Set as the active engine'}
            >
              {isCurrent('lmstudio', lmsModel.trim()) && lmsModel.trim() ? 'Active engine' : 'Activate model'}
            </button>
            <a
              href="https://lmstudio.ai/docs/app/advanced/cors"
              target="_blank" rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-[var(--muted)] underline-offset-2 hover:text-white hover:underline"
            >
              How to enable CORS <ExternalLink size={11} />
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
