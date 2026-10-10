export type ProviderId =
  | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter'
  | 'nvidia' | 'mistral' | 'deepseek' | 'together' | 'custom';

export const PROVIDERS: Record<ProviderId, {
  name: string;
  baseUrl: string;
  models: string[];
  embeddingModels: string[];
}> = {
  openai: {
    name: 'OpenAI',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'],
    embeddingModels: ['text-embedding-3-small', 'text-embedding-3-large', 'Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  anthropic: {
    name: 'Anthropic',
    baseUrl: 'https://api.anthropic.com/v1',
    models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'],
    embeddingModels: ['Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  gemini: {
    name: 'Google Gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
    models: ['gemini-2.5-flash', 'gemini-2.5-pro'],
    embeddingModels: ['text-embedding-004', 'Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  groq: {
    name: 'Groq',
    baseUrl: 'https://api.groq.com/openai/v1',
    models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'],
    embeddingModels: ['Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  openrouter: {
    name: 'OpenRouter',
    baseUrl: 'https://openrouter.ai/api/v1',
    models: ['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct'],
    embeddingModels: ['Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  nvidia: {
    name: 'NVIDIA NIM',
    baseUrl: 'https://integrate.api.nvidia.com/v1',
    models: [
      'nvidia/nemotron-3-super-120b-a12b',
      'nvidia/llama-3.1-nemotron-70b-instruct',
      'meta/llama-3.1-70b-instruct',
      'mistralai/mixtral-8x22b-instruct',
    ],
    embeddingModels: [
      'nvidia/llama-3.2-nv-embedqa-1b-v1',
      'nvidia/nv-embedqa-mistral-7b-v2',
      'nvidia/embed-qa-4',
      'nvidia/llama-nemotron-embed-vl-1b-v2',
      'Xenova/bge-small-en-v1.5 (Local In-Browser)',
    ],
  },
  mistral: {
    name: 'Mistral',
    baseUrl: 'https://api.mistral.ai/v1',
    models: ['mistral-small-latest', 'mistral-large-latest'],
    embeddingModels: ['mistral-embed', 'Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  deepseek: {
    name: 'DeepSeek',
    baseUrl: 'https://api.deepseek.com/v1',
    models: ['deepseek-chat'],
    embeddingModels: ['Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  together: {
    name: 'Together AI',
    baseUrl: 'https://api.together.xyz/v1',
    models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'],
    embeddingModels: ['togethercomputer/m2-bert-80M-8k-retrieval', 'Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
  custom: {
    name: 'Custom (OpenAI-compatible, https)',
    baseUrl: '',
    models: [],
    embeddingModels: ['Xenova/bge-small-en-v1.5 (Local In-Browser)'],
  },
};
