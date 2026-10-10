'use client';
import { useCallback, useEffect, useState } from 'react';
import { Cpu, Key, Laptop, Server, Trash2, CheckCircle2, Download, RefreshCw } from 'lucide-react';
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
  ollamaPull,
  lmstudioModels,
} from '@/lib/client/engines';

export default function Models({ me }: { me: any }) {
  const [engine, setEng] = useState<Engine | null>(null);
  const [keys, setKeys] = useState<any[]>([]);
  const [tab, setTab] = useState<'cloud' | 'webllm' | 'ollama' | 'lmstudio'>('cloud');

  // Cloud form state
  const [provider, setProvider] = useState<ProviderId>('openai');
  const [label, setLabel] = useState('');
  const [model, setModel] = useState(PROVIDERS.openai.models[0] || '');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [shared, setShared] = useState(false);
  const [keyBusy, setKeyBusy] = useState(false);
  const [keyErr, setKeyErr] = useState('');

  // Ollama state
  const [ollamaUrl, setOllamaUrl] = useState('http://localhost:11434');
  const [ollamaModel, setOllamaModel] = useState(OLLAMA_CATALOG[0]);
  const [ollamaInstalled, setOllamaInstalled] = useState<string[]>([]);
  const [pullProgress, setPullProgress] = useState<{ pct: number; status: string } | null>(null);
  const [ollamaLoading, setOllamaLoading] = useState(false);

  // LM Studio state
  const [lmsUrl, setLmsUrl] = useState('http://localhost:1234');
  const [lmsModel, setLmsModel] = useState('');
  const [lmsInstalled, setLmsInstalled] = useState<string[]>([]);
  const [lmsLoading, setLmsLoading] = useState(false);

  const loadKeys = useCallback(async () => {
    try {
      const r = await api('/api/keys');
      setKeys(r.keys || []);
    } catch {
      setKeys([]);
    }
  }, []);

  useEffect(() => {
    setEng(getEngine());
    loadKeys();
  }, [loadKeys]);

  function activate(e: Engine) {
    setEngine(e);
    setEng(e);
  }

  async function addKey(e: React.FormEvent) {
    e.preventDefault();
    setKeyErr('');
    setKeyBusy(true);
    try {
      const res = await api('/api/keys', {
        body: {
          provider,
          label: label.trim() || `${PROVIDERS[provider].name} key`,
          model: model.trim(),
          apiKey: apiKey.trim(),
          baseUrl: provider === 'custom' ? baseUrl.trim() : undefined,
          shared,
        },
      });
      await loadKeys();
      activate({
        kind: 'cloud',
        keyId: res.id,
        model: model.trim(),
        label: label.trim() || `${PROVIDERS[provider].name} key`,
      });
      setApiKey('');
      setLabel('');
    } catch (err: any) {
      setKeyErr(err.message);
    } finally {
      setKeyBusy(false);
    }
  }

  async function deleteKey(id: string) {
    if (confirm('Delete this API key?')) {
      await api(`/api/keys?id=${id}`, { method: 'DELETE' });
      await loadKeys();
      if (engine?.kind === 'cloud' && engine.keyId === id) {
        localStorage.removeItem('pramaan.engine');
        setEng(null);
      }
    }
  }

  async function fetchOllama() {
    setOllamaLoading(true);
    try {
      const tags = await ollamaTags(ollamaUrl.trim());
      setOllamaInstalled(tags);
      if (tags.length && !tags.includes(ollamaModel)) setOllamaModel(tags[0]);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setOllamaLoading(false);
    }
  }

  async function pullModel() {
    setPullProgress({ pct: 0, status: 'Starting pull...' });
    try {
      await ollamaPull(ollamaUrl.trim(), ollamaModel, (pct, status) => {
        setPullProgress({ pct, status });
      });
      await fetchOllama();
      setPullProgress(null);
    } catch (e: any) {
      alert(`Pull failed: ${e.message}`);
      setPullProgress(null);
    }
  }

  async function fetchLms() {
    setLmsLoading(true);
    try {
      const m = await lmstudioModels(lmsUrl.trim());
      setLmsInstalled(m);
      if (m.length && !m.includes(lmsModel)) setLmsModel(m[0]);
    } catch (e: any) {
      alert(e.message);
    } finally {
      setLmsLoading(false);
    }
  }

  const isCurrent = (kind: string, identifier?: string) => {
    if (!engine || engine.kind !== kind) return false;
    if (kind === 'cloud') return engine.keyId === identifier;
    if (kind === 'webllm') return engine.model === identifier;
    if (kind === 'ollama') return engine.model === identifier;
    if (kind === 'lmstudio') return engine.model === identifier;
    return true;
  };

  return (
    <div className="space-y-6">
      <SectionTitle
        title="Models & Inference Keys"
        desc="Bring your own cloud API key or run inference locally on device (WebGPU, Ollama, LM Studio)."
      />

      {/* Active engine banner */}
      <Card className="flex flex-wrap items-center justify-between gap-4 border-indigo-500/30 bg-indigo-950/20">
        <div>
          <div className="text-xs uppercase tracking-wider text-indigo-400">Currently Active Engine</div>
          <div className="mt-1 flex items-center gap-2 text-base font-semibold text-white">
            <CheckCircle2 size={18} className="text-emerald-400" />
            {engineLabel(engine)}
          </div>
        </div>
        {engine && (
          <Button
            variant="ghost"
            onClick={() => {
              localStorage.removeItem('pramaan.engine');
              window.dispatchEvent(new Event('pramaan-engine'));
              setEng(null);
            }}
          >
            Clear Active Model
          </Button>
        )}
      </Card>

      {/* Mode selection tabs */}
      <div className="flex flex-wrap gap-2 border-b border-white/10 pb-3">
        <button
          onClick={() => setTab('cloud')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'cloud' ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
          }`}
        >
          <Key size={16} /> Cloud (BYOK)
        </button>
        <button
          onClick={() => setTab('webllm')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'webllm' ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
          }`}
        >
          <Laptop size={16} /> Browser (WebLLM)
        </button>
        <button
          onClick={() => setTab('ollama')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'ollama' ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
          }`}
        >
          <Server size={16} /> Ollama
        </button>
        <button
          onClick={() => setTab('lmstudio')}
          className={`flex items-center gap-2 rounded-xl px-4 py-2 text-sm font-medium transition ${
            tab === 'lmstudio' ? 'bg-indigo-600 text-white' : 'border border-white/10 bg-white/5 text-zinc-300 hover:bg-white/10'
          }`}
        >
          <Cpu size={16} /> LM Studio
        </button>
      </div>

      {/* TAB 1: CLOUD BYOK */}
      {tab === 'cloud' && (
        <div className="space-y-6">
          <Card>
            <div className="mb-4 font-medium text-white">Your Saved Cloud Keys</div>
            {!keys.length ? (
              <p className="text-sm text-zinc-400">No keys added yet. Add an API key below to enable cloud reasoning.</p>
            ) : (
              <div className="divide-y divide-white/5">
                {keys.map((k) => (
                  <div key={k.id} className="flex items-center justify-between py-3 text-sm">
                    <div>
                      <div className="flex items-center gap-2 font-medium">
                        {k.label}
                        <Badge tone="indigo">{k.provider}</Badge>
                        <span className="text-xs text-zinc-400">({k.model})</span>
                        {k.shared && <Badge tone="green">shared with org</Badge>}
                        {isCurrent('cloud', k.id) && <Badge tone="green">Active</Badge>}
                      </div>
                      <div className="text-xs text-zinc-500">Added {new Date(k.created_at).toLocaleDateString()}</div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Button
                        variant={isCurrent('cloud', k.id) ? 'ghost' : 'primary'}
                        onClick={() => activate({ kind: 'cloud', keyId: k.id, model: k.model, label: k.label })}
                      >
                        {isCurrent('cloud', k.id) ? 'Selected' : 'Use this'}
                      </Button>
                      {k.mine && (
                        <Button variant="ghost" onClick={() => deleteKey(k.id)}>
                          <Trash2 size={14} />
                        </Button>
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
                      <option key={pid} value={pid}>
                        {p.name}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label>Label</Label>
                  <Input
                    placeholder="e.g. Work OpenAI Key"
                    value={label}
                    onChange={(e) => setLabel(e.target.value)}
                  />
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label>Model Name</Label>
                  {PROVIDERS[provider].models.length > 0 ? (
                    <div className="space-y-1">
                      <Select value={model} onChange={(e) => setModel(e.target.value)}>
                        {PROVIDERS[provider].models.map((m) => (
                          <option key={m} value={m}>
                            {m}
                          </option>
                        ))}
                      </Select>
                      <Input
                        placeholder="Or custom model ID"
                        value={model}
                        onChange={(e) => setModel(e.target.value)}
                        className="text-xs"
                      />
                    </div>
                  ) : (
                    <Input
                      placeholder="e.g. meta-llama/Llama-3-70b-chat"
                      required
                      value={model}
                      onChange={(e) => setModel(e.target.value)}
                    />
                  )}
                </div>
                <div>
                  <Label>API Key</Label>
                  <Input
                    type="password"
                    required
                    placeholder="sk-..."
                    value={apiKey}
                    onChange={(e) => setApiKey(e.target.value)}
                  />
                </div>
              </div>

              {provider === 'custom' && (
                <div>
                  <Label>Base URL (must use HTTPS)</Label>
                  <Input
                    type="url"
                    required
                    placeholder="https://api.example.com/v1"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                  />
                </div>
              )}

              {me?.orgKind === 'team' && ['owner', 'admin'].includes(me?.role) && (
                <label className="flex items-center gap-2 pt-1 text-sm text-zinc-300">
                  <input
                    type="checkbox"
                    checked={shared}
                    onChange={(e) => setShared(e.target.checked)}
                    className="rounded"
                  />
                  Share this key with all workspace members (encrypted server-side, raw key never disclosed)
                </label>
              )}

              {keyErr && <p className="text-sm text-red-400">{keyErr}</p>}
              <Button disabled={keyBusy}>{keyBusy ? 'Saving...' : 'Save & Activate Key'}</Button>
            </form>
          </Card>
        </div>
      )}

      {/* TAB 2: WEBLLM (BROWSER INFERENCE) */}
      {tab === 'webllm' && (
        <Card className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Browser Edge Models (WebLLM)</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Weights download directly into your browser cache and run via WebGPU. No network calls for inference, zero token cost.
            </p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {WEBLLM_MODELS.map((m) => (
              <div
                key={m.id}
                className={`flex flex-col justify-between rounded-xl border p-4 transition ${
                  isCurrent('webllm', m.id)
                    ? 'border-indigo-500 bg-indigo-950/30'
                    : 'border-white/10 bg-zinc-950/60 hover:border-white/20'
                }`}
              >
                <div>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-white">{m.name}</span>
                    <Badge tone="zinc">{m.size}</Badge>
                  </div>
                  <div className="mt-1 truncate text-xs text-zinc-500">{m.id}</div>
                </div>
                <div className="mt-4">
                  <Button
                    className="w-full"
                    variant={isCurrent('webllm', m.id) ? 'ghost' : 'primary'}
                    onClick={() => activate({ kind: 'webllm', model: m.id })}
                  >
                    {isCurrent('webllm', m.id) ? 'Active Model' : 'Select Model'}
                  </Button>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {/* TAB 3: OLLAMA */}
      {tab === 'ollama' && (
        <Card className="space-y-4">
          <div>
            <h3 className="font-medium text-white">Connect Local Ollama</h3>
            <p className="mt-1 text-sm text-zinc-400">
              Ensure Ollama is running with CORS enabled (e.g., <code>OLLAMA_ORIGINS="*" ollama serve</code>).
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Ollama Base URL</Label>
              <div className="flex gap-2">
                <Input value={ollamaUrl} onChange={(e) => setOllamaUrl(e.target.value)} />
                <Button variant="ghost" onClick={fetchOllama} disabled={ollamaLoading}>
                  <RefreshCw size={14} className={ollamaLoading ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
            <div>
              <Label>Model to Run</Label>
              <div className="space-y-1">
                <Select value={ollamaModel} onChange={(e) => setOllamaModel(e.target.value)}>
                  {ollamaInstalled.length > 0 ? (
                    ollamaInstalled.map((m) => (
                      <option key={m} value={m}>
                        {m} (Installed)
                      </option>
                    ))
                  ) : (
                    OLLAMA_CATALOG.map((m) => (
                      <option key={m} value={m}>
                        {m} (Catalog)
                      </option>
                    ))
                  )}
                </Select>
                <Input
                  placeholder="Or type custom model tag"
                  value={ollamaModel}
                  onChange={(e) => setOllamaModel(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>
          </div>

          {pullProgress && <Progress value={pullProgress.pct} label={`Pulling ${ollamaModel}: ${pullProgress.status}`} />}

          <div className="flex flex-wrap gap-2 pt-2">
            <Button
              onClick={() => activate({ kind: 'ollama', baseUrl: ollamaUrl.trim(), model: ollamaModel })}
              disabled={!ollamaModel}
            >
              {isCurrent('ollama', ollamaModel) ? 'Active Engine' : 'Activate Ollama Model'}
            </Button>
            <Button variant="ghost" onClick={pullModel} disabled={!!pullProgress || !ollamaModel}>
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
              Start the LM Studio Local Server (port 1234 by default) and turn on <strong>Enable CORS</strong> in developer settings.
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label>Server URL</Label>
              <div className="flex gap-2">
                <Input value={lmsUrl} onChange={(e) => setLmsUrl(e.target.value)} />
                <Button variant="ghost" onClick={fetchLms} disabled={lmsLoading}>
                  <RefreshCw size={14} className={lmsLoading ? 'animate-spin' : ''} />
                </Button>
              </div>
            </div>
            <div>
              <Label>Model ID</Label>
              {lmsInstalled.length > 0 ? (
                <Select value={lmsModel} onChange={(e) => setLmsModel(e.target.value)}>
                  {lmsInstalled.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              ) : (
                <Input
                  placeholder="e.g. meta-llama-3.1-8b-instruct"
                  value={lmsModel}
                  onChange={(e) => setLmsModel(e.target.value)}
                />
              )}
            </div>
          </div>

          <Button
            onClick={() => activate({ kind: 'lmstudio', baseUrl: lmsUrl.trim(), model: lmsModel })}
            disabled={!lmsModel}
          >
            {isCurrent('lmstudio', lmsModel) ? 'Active Engine' : 'Activate LM Studio Model'}
          </Button>
        </Card>
      )}
    </div>
  );
}
