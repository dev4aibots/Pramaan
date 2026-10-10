import { PROVIDERS, type ProviderId } from './providers';
import { HttpError } from './http';

export type Msg = { role: 'system' | 'user' | 'assistant'; content: string };

// Default product LLM (NVIDIA NIM) — used by /api/chat when no per-request engine is set.
export const DEFAULT_PRODUCT_LLM: { provider: ProviderId; baseUrl: string | null; apiKey: string; model: string } = {
  provider: 'nvidia',
  baseUrl: null,
  apiKey: process.env.NVIDIA_API_KEY || '',
  model: 'nvidia/nemotron-3-super-120b-a12b',
};

function assertSafeUrl(u: string) {
  // SSRF protection for custom base URLs
  let url: URL;
  try { url = new URL(u); } catch { throw new HttpError(400, 'Invalid base URL'); }
  if (url.protocol !== 'https:') throw new HttpError(400, 'Custom base URL must use https');
  const h = url.hostname;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|0\.|\[?::1\]?$)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h) || h.endsWith('.internal')) {
    throw new HttpError(400, 'Private network base URLs are not allowed on the server (use a local engine instead)');
  }
}

export async function callLLM(opts: { provider: ProviderId; baseUrl?: string | null; apiKey: string; model: string; messages: Msg[] }) {
  const base = (opts.provider === 'custom' ? opts.baseUrl : PROVIDERS[opts.provider]?.baseUrl) || '';
  if (opts.provider === 'custom') assertSafeUrl(base);
  const ctrl = AbortSignal.timeout(55_000);

  if (opts.provider === 'anthropic') {
    const system = opts.messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n');
    const res = await fetch(`${base}/messages`, {
      method: 'POST',
      signal: ctrl,
      headers: { 'content-type': 'application/json', 'x-api-key': opts.apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: opts.model,
        max_tokens: 1200,
        temperature: 0.1,
        system,
        messages: opts.messages.filter((m) => m.role !== 'system'),
      }),
    });
    const j: any = await res.json().catch(() => ({}));
    if (!res.ok) throw new HttpError(502, `LLM error: ${j?.error?.message ?? res.status}`);
    return (j.content ?? []).map((c: any) => c.text ?? '').join('');
  }

  const res = await fetch(`${base.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    signal: ctrl,
    headers: { 'content-type': 'application/json', authorization: `Bearer ${opts.apiKey}` },
    body: JSON.stringify({ model: opts.model, messages: opts.messages, temperature: 0.1, max_tokens: 1200 }),
  });
  const j: any = await res.json().catch(() => ({}));
  if (!res.ok) throw new HttpError(502, `LLM error: ${j?.error?.message ?? res.status}`);
  return j.choices?.[0]?.message?.content ?? '';
}
