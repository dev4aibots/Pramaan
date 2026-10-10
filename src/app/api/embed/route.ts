import { z } from 'zod';
import { handler } from '@/lib/http';
import { requireCtx } from '@/lib/auth';
import { embedTexts, getEmbedProvider, NVIDIA_EMBED_MODEL } from '@/lib/embeddings';

export const runtime = 'nodejs';
export const maxDuration = 60;

// Server-side embedding. DEFAULT is NVIDIA NIM (nvidia/nv-embed-v2).
// Returns 400 when no NVIDIA_API_KEY is set — the client then falls back
// to in-browser embeddings automatically.
export const POST = handler(async (req) => {
  await requireCtx();
  const b = z.object({ texts: z.array(z.string().min(1).max(8000)).min(1).max(64) }).parse(await req.json());
  const { provider, vectors } = await embedTexts(b.texts);
  return { provider, model: provider === 'nvidia' ? NVIDIA_EMBED_MODEL : 'browser/bge-small-en-v1.5', vectors };
});

// Which embedding provider is active by default
export const GET = handler(async () => {
  await requireCtx();
  const provider = getEmbedProvider();
  return {
    provider,
    model: provider === 'nvidia' ? NVIDIA_EMBED_MODEL : 'Xenova/bge-small-en-v1.5',
    note:
      provider === 'nvidia'
        ? 'NVIDIA NIM is the default embedding provider'
        : 'Add NVIDIA_API_KEY to use NVIDIA embeddings — browser embeddings active for now',
  };
});
