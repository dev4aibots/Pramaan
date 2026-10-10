export type ProviderId =
  | 'openai' | 'anthropic' | 'gemini' | 'groq' | 'openrouter'
  | 'nvidia' | 'mistral' | 'deepseek' | 'together' | 'custom';

export const PROVIDERS: Record<ProviderId, { name: string; baseUrl: string; models: string[] }> = {
  openai: { name: 'OpenAI', baseUrl: 'https://api.openai.com/v1', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4.1-mini'] },
  anthropic: { name: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', models: ['claude-sonnet-5', 'claude-haiku-4-5-20251001', 'claude-opus-5-5'] },
  gemini: { name: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', models: ['gemini-2.5-flash', 'gemini-2.5-pro'] },
  groq: { name: 'Groq', baseUrl: 'https://api.groq.com/openai/v1', models: ['llama-3.3-70b-versatile', 'llama-3.1-8b-instant'] },
  openrouter: { name: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', models: ['meta-llama/llama-3.3-70b-instruct', 'qwen/qwen-2.5-72b-instruct'] },
  nvidia: { name: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', models: ['meta/llama-3.1-70b-instruct', 'mistralai/mixtral-8x22b-instruct'] },
  mistral: { name: 'Mistral', baseUrl: 'https://api.mistral.ai/v1', models: ['mistral-small-latest', 'mistral-large-latest'] },
  deepseek: { name: 'DeepSeek', baseUrl: 'https://api.deepseek.com/v1', models: ['deepseek-chat'] },
  together: { name: 'Together AI', baseUrl: 'https://api.together.xyz/v1', models: ['meta-llama/Llama-3.3-70B-Instruct-Turbo'] },
  custom: { name: 'Custom (OpenAI-compatible, https)', baseUrl: '', models: [] },
};
