import { z } from 'zod';
import { sql } from '@/lib/db';
import { handler, HttpError } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { decrypt } from '@/lib/crypto';
import { PROVIDERS, type ProviderId } from '@/lib/providers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export const POST = handler(async (req) => {
  const ctx = await requireCtx();
  const body = await req.json();

  let provider: ProviderId = 'openai';
  let apiKey = '';
  let baseUrl: string | undefined;

  if (body.keyId) {
    const [row] = await sql`
      select provider, base_url, enc
      from api_keys
      where id = ${body.keyId} and (user_id = ${ctx.userId} or (shared and org_id = ${ctx.orgId}))
      limit 1`;
    if (!row) throw new HttpError(404, 'API key not found');
    provider = row.provider as ProviderId;
    baseUrl = row.base_url || undefined;
    apiKey = decrypt(row.enc);
  } else {
    const parsed = z.object({
      provider: z.enum(['openai', 'anthropic', 'gemini', 'groq', 'openrouter', 'nvidia', 'mistral', 'deepseek', 'together', 'custom']),
      apiKey: z.string().min(1).max(500),
      baseUrl: z.string().url().max(300).optional().nullable(),
    }).parse(body);
    provider = parsed.provider;
    apiKey = parsed.apiKey;
    baseUrl = parsed.baseUrl || undefined;
  }

  // Determine models endpoint URL
  let targetUrl = '';
  const headers: Record<string, string> = {};

  if (provider === 'custom') {
    if (!baseUrl) throw new HttpError(400, 'Custom provider requires baseUrl');
    targetUrl = `${baseUrl.replace(/\/$/, '')}/models`;
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'nvidia') {
    targetUrl = 'https://integrate.api.nvidia.com/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'openai') {
    targetUrl = 'https://api.openai.com/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'groq') {
    targetUrl = 'https://api.groq.com/openai/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'openrouter') {
    targetUrl = 'https://openrouter.ai/api/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'mistral') {
    targetUrl = 'https://api.mistral.ai/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'deepseek') {
    targetUrl = 'https://api.deepseek.com/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'together') {
    targetUrl = 'https://api.together.xyz/v1/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'gemini') {
    targetUrl = 'https://generativelanguage.googleapis.com/v1beta/openai/models';
    headers['Authorization'] = `Bearer ${apiKey}`;
  } else if (provider === 'anthropic') {
    targetUrl = 'https://api.anthropic.com/v1/models';
    headers['x-api-key'] = apiKey;
    headers['anthropic-version'] = '2023-06-01';
  }

  try {
    const res = await fetch(targetUrl, {
      method: 'GET',
      headers,
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text();
      let errMsg = `Provider returned HTTP ${res.status}`;
      try {
        const j = JSON.parse(errText);
        if (j.error?.message) errMsg = j.error.message;
        else if (j.message) errMsg = j.message;
      } catch {
        /* noop */
      }
      throw new HttpError(400, errMsg);
    }

    const data = await res.json();
    let modelIds: string[] = [];

    if (Array.isArray(data.data)) {
      modelIds = data.data.map((m: any) => m.id || m.name).filter(Boolean);
    } else if (Array.isArray(data.models)) {
      modelIds = data.models.map((m: any) => m.id || m.name).filter(Boolean);
    }

    modelIds.sort((a, b) => a.localeCompare(b));

    // Fall back to default catalog if provider returned empty list
    if (modelIds.length === 0 && PROVIDERS[provider]?.models) {
      modelIds = PROVIDERS[provider].models;
    }

    const embeddingModels = [
      'Xenova/bge-small-en-v1.5 (Local In-Browser)',
      ...modelIds.filter((m) => /embed|retriev|bge|arctic/i.test(m)),
    ];
    const chatModels = modelIds.filter((m) => !/embed(ding)?$/i.test(m));

    return {
      provider,
      count: modelIds.length,
      models: modelIds,
      chatModels: chatModels.length ? chatModels : modelIds,
      embeddingModels: embeddingModels.length > 1 ? embeddingModels : [
        'Xenova/bge-small-en-v1.5 (Local In-Browser)',
        ...(PROVIDERS[provider]?.embeddingModels || []),
      ],
    };
  } catch (err: any) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(500, `Failed to fetch models: ${err.message || String(err)}`);
  }
});
