// OpenAI-compatible chat completions provider (MVP 3+). One implementation
// covers every provider exposing the de-facto-standard endpoint: Gemini
// (free tier), Ollama (local), Groq, OpenRouter, OpenAI itself, and any
// self-hosted server. Structured output is prompt-enforced JSON — the least
// fragile approach across servers with wildly different response_format
// support — and callers validate with zod and re-prompt on violations.

import {
  AIProviderError,
  type AIProvider,
  type GenerateObjectRequest,
  type GenerateTextRequest,
} from './provider.js';

const DEFAULT_MAX_TOKENS = 16000;
const MAX_RETRIES_429 = 3;
const DEFAULT_RETRY_AFTER_SECONDS = 15; // free tiers throttle per-minute

export interface OpenAICompatibleOptions {
  /** Display name shown to the user (e.g. "gemini", "ollama"). */
  name: string;
  /** Base URL up to (not including) /chat/completions. */
  baseUrl: string;
  model: string;
  /** Env vars checked in order for the API key; empty for keyless (ollama). */
  apiKeyEnv: string[];
  /** Message shown when no key is found. */
  keyHint?: string;
}

export type FetchLike = (url: string, init: RequestInit) => Promise<Response>;
type Sleep = (ms: number) => Promise<void>;

const defaultSleep: Sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

interface ChatCompletionResponse {
  choices?: Array<{
    message?: { content?: string | null };
    finish_reason?: string;
  }>;
}

/** Strip markdown fences and surrounding prose to recover a JSON object. */
export function extractJson(text: string): unknown {
  const trimmed = text.trim();
  const candidates = [trimmed];
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced?.[1]) candidates.push(fenced[1].trim());
  const first = trimmed.indexOf('{');
  const last = trimmed.lastIndexOf('}');
  if (first >= 0 && last > first) candidates.push(trimmed.slice(first, last + 1));

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate) as unknown;
    } catch {
      // try the next shape
    }
  }
  throw new AIProviderError(`Model returned invalid JSON: ${text.slice(0, 200)}`);
}

export class OpenAICompatibleProvider implements AIProvider {
  readonly name: string;
  private options: OpenAICompatibleOptions;
  private fetchImpl: FetchLike;
  private sleep: Sleep;

  constructor(
    options: OpenAICompatibleOptions,
    fetchImpl: FetchLike = (url, init) => fetch(url, init),
    sleep: Sleep = defaultSleep,
  ) {
    this.name = `${options.name} (${options.model})`;
    this.options = options;
    this.fetchImpl = fetchImpl;
    this.sleep = sleep;
  }

  private resolveApiKey(): string | null {
    for (const env of this.options.apiKeyEnv) {
      const value = process.env[env];
      if (value) return value;
    }
    return null;
  }

  private async complete(system: string, prompt: string, maxTokens?: number): Promise<string> {
    const apiKey = this.resolveApiKey();
    if (this.options.apiKeyEnv.length > 0 && !apiKey) {
      throw new AIProviderError(
        `No API key found for ${this.options.name}. ` +
          (this.options.keyHint ?? `Set ${this.options.apiKeyEnv[0]}.`),
      );
    }

    const url = `${this.options.baseUrl.replace(/\/$/, '')}/chat/completions`;
    const body = JSON.stringify({
      model: this.options.model,
      max_tokens: maxTokens ?? DEFAULT_MAX_TOKENS,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: prompt },
      ],
    });

    let response: Response;
    for (let attempt = 0; ; attempt++) {
      try {
        response = await this.fetchImpl(url, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
          },
          body,
        });
      } catch (error) {
        throw new AIProviderError(
          `Could not reach ${this.options.name} at ${this.options.baseUrl} — ` +
            `${error instanceof Error ? error.message : 'network error'}.`,
        );
      }

      // Free tiers rate-limit per minute — wait and retry instead of failing.
      if ((response.status === 429 || response.status >= 500) && attempt < MAX_RETRIES_429) {
        const retryAfter = Number(response.headers.get('retry-after'));
        const seconds =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(retryAfter, 60)
            : DEFAULT_RETRY_AFTER_SECONDS;
        await this.sleep(seconds * 1000);
        continue;
      }
      break;
    }

    if (response.status === 401 || response.status === 403) {
      throw new AIProviderError(
        `${this.options.name} rejected the API key (${response.status}). ` +
          (this.options.keyHint ?? `Check ${this.options.apiKeyEnv[0] ?? 'your credentials'}.`),
      );
    }
    if (!response.ok) {
      const detail = (await response.text().catch(() => '')).slice(0, 300);
      throw new AIProviderError(
        `${this.options.name} API error (${response.status})${detail ? `: ${detail}` : ''}`,
      );
    }

    const parsed = (await response.json().catch(() => null)) as ChatCompletionResponse | null;
    const choice = parsed?.choices?.[0];
    const content = choice?.message?.content;
    if (typeof content !== 'string' || content.length === 0) {
      throw new AIProviderError(`${this.options.name} returned an empty response.`);
    }
    if (choice?.finish_reason === 'length') {
      throw new AIProviderError('Generation was truncated (max_tokens reached).');
    }
    return content;
  }

  async generateText(request: GenerateTextRequest): Promise<string> {
    return this.complete(request.system, request.prompt, request.maxTokens);
  }

  async generateObject(request: GenerateObjectRequest): Promise<unknown> {
    const system =
      request.system +
      '\n\nOutput format: respond with a single JSON object and nothing else — ' +
      'no prose, no markdown fences. The object must match this JSON Schema exactly:\n' +
      JSON.stringify(request.jsonSchema);
    const text = await this.complete(system, request.prompt, request.maxTokens);
    return extractJson(text);
  }
}

/** Provider presets — base URLs and defaults for the known ecosystems. */
export interface PresetConfig {
  provider: 'openai' | 'gemini' | 'ollama' | 'openai-compatible';
  model?: string;
  baseUrl?: string;
}

export function createOpenAICompatibleProvider(config: PresetConfig): OpenAICompatibleProvider {
  switch (config.provider) {
    case 'gemini':
      return new OpenAICompatibleProvider({
        name: 'gemini',
        baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai',
        model: config.model ?? 'gemini-2.5-flash',
        apiKeyEnv: ['GEMINI_API_KEY', 'GOOGLE_API_KEY'],
        keyHint:
          'Set GEMINI_API_KEY — free keys are available at https://aistudio.google.com/apikey.',
      });
    case 'openai':
      return new OpenAICompatibleProvider({
        name: 'openai',
        baseUrl: 'https://api.openai.com/v1',
        model: config.model ?? 'gpt-4o',
        apiKeyEnv: ['OPENAI_API_KEY'],
        keyHint: 'Set OPENAI_API_KEY (https://platform.openai.com/api-keys).',
      });
    case 'ollama': {
      if (!config.model) {
        throw new AIProviderError(
          'Set ai.model in appship.yml when using ollama (e.g. llama3.1, qwen2.5).',
        );
      }
      return new OpenAICompatibleProvider({
        name: 'ollama',
        baseUrl: config.baseUrl ?? 'http://localhost:11434/v1',
        model: config.model,
        apiKeyEnv: [],
      });
    }
    case 'openai-compatible': {
      if (!config.baseUrl) {
        throw new AIProviderError(
          'Set ai.base_url in appship.yml when using openai-compatible ' +
            '(e.g. https://openrouter.ai/api/v1).',
        );
      }
      if (!config.model) {
        throw new AIProviderError('Set ai.model in appship.yml when using openai-compatible.');
      }
      return new OpenAICompatibleProvider({
        name: 'openai-compatible',
        baseUrl: config.baseUrl,
        model: config.model,
        apiKeyEnv: ['OPENAI_COMPATIBLE_API_KEY', 'OPENAI_API_KEY'],
        keyHint: 'Set OPENAI_COMPATIBLE_API_KEY (or OPENAI_API_KEY) for your endpoint.',
      });
    }
  }
}
