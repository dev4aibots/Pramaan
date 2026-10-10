export type Engine =
  | { kind: 'cloud'; keyId: string; model: string; label: string }
  | { kind: 'webllm'; model: string }
  | { kind: 'ollama'; baseUrl: string; model: string }
  | { kind: 'lmstudio'; baseUrl: string; model: string };

type Msg = { role: string; content: string };
const KEY = 'pramaan.engine';

export const getEngine = (): Engine | null => { try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch { return null; } };
export const setEngine = (e: Engine) => { localStorage.setItem(KEY, JSON.stringify(e)); window.dispatchEvent(new Event('pramaan-engine')); };
export const engineLabel = (e: Engine | null) =>
  !e ? 'No model selected' : e.kind === 'cloud' ? `${e.label} · ${e.model}` : `${({ webllm: 'Browser', ollama: 'Ollama', lmstudio: 'LM Studio' } as any)[e.kind]} · ${e.model}`;

export const WEBLLM_MODELS = [
  { id: 'Llama-3.2-1B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 1B (fast)', size: '~0.9 GB' },
  { id: 'Qwen2.5-1.5B-Instruct-q4f16_1-MLC', name: 'Qwen 2.5 1.5B', size: '~1.6 GB' },
  { id: 'Llama-3.2-3B-Instruct-q4f16_1-MLC', name: 'Llama 3.2 3B', size: '~2.3 GB' },
  { id: 'Phi-3.5-mini-instruct-q4f16_1-MLC', name: 'Phi 3.5 mini', size: '~3.7 GB' },
  { id: 'Llama-3.1-8B-Instruct-q4f16_1-MLC', name: 'Llama 3.1 8B (best)', size: '~5 GB' },
];
export const OLLAMA_CATALOG = ['llama3.2:3b', 'qwen2.5:7b', 'mistral:7b', 'gemma2:9b', 'phi3.5', 'llama3.1:8b', 'deepseek-r1:7b'];

let webllm: any = null;
let webllmModel = '';
export async function loadWebLLM(model: string, onProgress?: (p: number, text: string) => void) {
  if (!(navigator as any).gpu) throw new Error('WebGPU is not available in this browser (use Chrome/Edge 113+)');
  if (webllm && webllmModel === model) return;
  const { CreateMLCEngine } = await import('@mlc-ai/web-llm');
  if (webllm) await webllm.unload();
  webllm = await CreateMLCEngine(model, { initProgressCallback: (r: any) => onProgress?.(Math.round((r.progress ?? 0) * 100), r.text) });
  webllmModel = model;
}

export async function ollamaTags(base: string): Promise<string[]> {
  const r = await fetch(`${base}/api/tags`);
  if (!r.ok) throw new Error('Ollama not reachable');
  return ((await r.json()).models ?? []).map((m: any) => m.name);
}

export async function ollamaPull(base: string, model: string, onProgress: (p: number, status: string) => void) {
  const r = await fetch(`${base}/api/pull`, { method: 'POST', body: JSON.stringify({ model, name: model, stream: true }) });
  if (!r.ok || !r.body) throw new Error('Pull failed — is Ollama running with OLLAMA_ORIGINS set?');
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
      const j = JSON.parse(l);
      if (j.error) throw new Error(j.error);
      onProgress(j.total ? Math.round((j.completed / j.total) * 100) : 0, j.status);
    }
  }
}

export async function lmstudioModels(base: string): Promise<string[]> {
  const r = await fetch(`${base}/v1/models`);
  if (!r.ok) throw new Error('LM Studio server not reachable (enable server + CORS)');
  return ((await r.json()).data ?? []).map((m: any) => m.id);
}

export async function runLocal(e: Engine, messages: Msg[], onProgress?: (p: number, t: string) => void): Promise<string> {
  if (e.kind === 'webllm') {
    await loadWebLLM(e.model, onProgress);
    const r = await webllm.chat.completions.create({ messages, temperature: 0.1, max_tokens: 1000 });
    return r.choices[0].message.content ?? '';
  }
  if (e.kind === 'ollama') {
    const r = await fetch(`${e.baseUrl}/api/chat`, { method: 'POST', body: JSON.stringify({ model: e.model, messages, stream: false, options: { temperature: 0.1 } }) });
    if (!r.ok) throw new Error('Ollama request failed');
    return (await r.json()).message?.content ?? '';
  }
  if (e.kind === 'lmstudio') {
    const r = await fetch(`${e.baseUrl}/v1/chat/completions`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ model: e.model, messages, temperature: 0.1 }) });
    if (!r.ok) throw new Error('LM Studio request failed');
    return (await r.json()).choices?.[0]?.message?.content ?? '';
  }
  throw new Error('Not a local engine');
}
