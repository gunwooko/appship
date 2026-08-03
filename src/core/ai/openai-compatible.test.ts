import { afterEach, describe, expect, it } from 'vitest';
import { AIProviderError } from './provider.js';
import {
  createOpenAICompatibleProvider,
  extractJson,
  OpenAICompatibleProvider,
  type FetchLike,
} from './openai-compatible.js';

const NO_SLEEP = async () => {};

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

function completion(content: string, finishReason = 'stop'): unknown {
  return { choices: [{ message: { content }, finish_reason: finishReason }] };
}

function capturingFetch(
  responses: Response[],
): { fetch: FetchLike; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  return {
    calls,
    fetch: async (url, init) => {
      calls.push({ url, init });
      const next = responses.shift();
      if (!next) throw new Error('no more stubbed responses');
      return next;
    },
  };
}

const KEYLESS = { name: 'test', baseUrl: 'http://localhost:9999/v1', model: 'm', apiKeyEnv: [] };

describe('extractJson', () => {
  it('parses bare, fenced, and prose-wrapped JSON', () => {
    expect(extractJson('{"a": 1}')).toEqual({ a: 1 });
    expect(extractJson('```json\n{"a": 1}\n```')).toEqual({ a: 1 });
    expect(extractJson('Here is the result:\n{"a": {"b": 2}}\nDone.')).toEqual({ a: { b: 2 } });
  });

  it('throws AIProviderError on unrecoverable text', () => {
    expect(() => extractJson('not json at all')).toThrow(AIProviderError);
  });
});

describe('OpenAICompatibleProvider', () => {
  afterEach(() => {
    delete process.env.TEST_AI_KEY;
  });

  it('sends the chat completions request shape and returns the text', async () => {
    const { fetch, calls } = capturingFetch([jsonResponse(completion('hello'))]);
    const provider = new OpenAICompatibleProvider(KEYLESS, fetch, NO_SLEEP);

    const text = await provider.generateText({ system: 'sys', prompt: 'user prompt' });
    expect(text).toBe('hello');
    expect(calls[0]!.url).toBe('http://localhost:9999/v1/chat/completions');
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.model).toBe('m');
    expect(body.messages).toEqual([
      { role: 'system', content: 'sys' },
      { role: 'user', content: 'user prompt' },
    ]);
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBeUndefined();
  });

  it('sends a bearer token from the configured env var', async () => {
    process.env.TEST_AI_KEY = 'secret';
    const { fetch, calls } = capturingFetch([jsonResponse(completion('ok'))]);
    const provider = new OpenAICompatibleProvider(
      { ...KEYLESS, apiKeyEnv: ['TEST_AI_KEY'] },
      fetch,
      NO_SLEEP,
    );
    await provider.generateText({ system: 's', prompt: 'p' });
    expect((calls[0]!.init.headers as Record<string, string>).authorization).toBe('Bearer secret');
  });

  it('fails fast with the key hint when no key is set', async () => {
    const { fetch, calls } = capturingFetch([]);
    const provider = new OpenAICompatibleProvider(
      { ...KEYLESS, apiKeyEnv: ['TEST_AI_KEY'], keyHint: 'Get one at example.com.' },
      fetch,
      NO_SLEEP,
    );
    await expect(provider.generateText({ system: 's', prompt: 'p' })).rejects.toThrow(
      /example\.com/,
    );
    expect(calls).toHaveLength(0);
  });

  it('retries on 429 with retry-after, then succeeds', async () => {
    const { fetch, calls } = capturingFetch([
      jsonResponse({}, 429, { 'retry-after': '1' }),
      jsonResponse(completion('recovered')),
    ]);
    const provider = new OpenAICompatibleProvider(KEYLESS, fetch, NO_SLEEP);
    await expect(provider.generateText({ system: 's', prompt: 'p' })).resolves.toBe('recovered');
    expect(calls).toHaveLength(2);
  });

  it('surfaces auth failures and truncation clearly', async () => {
    const { fetch } = capturingFetch([jsonResponse({}, 401)]);
    const provider = new OpenAICompatibleProvider(
      { ...KEYLESS, apiKeyEnv: ['TEST_AI_KEY'] },
      fetch,
      NO_SLEEP,
    );
    process.env.TEST_AI_KEY = 'bad';
    await expect(provider.generateText({ system: 's', prompt: 'p' })).rejects.toThrow(
      /rejected the API key/,
    );

    const truncatedFetch = capturingFetch([jsonResponse(completion('partial', 'length'))]).fetch;
    const truncated = new OpenAICompatibleProvider(KEYLESS, truncatedFetch, NO_SLEEP);
    await expect(truncated.generateText({ system: 's', prompt: 'p' })).rejects.toThrow(/truncated/);
  });

  it('generateObject appends the schema to the system prompt and parses fenced output', async () => {
    const { fetch, calls } = capturingFetch([
      jsonResponse(completion('```json\n{"name": "App"}\n```')),
    ]);
    const provider = new OpenAICompatibleProvider(KEYLESS, fetch, NO_SLEEP);
    const result = await provider.generateObject({
      system: 'base system',
      prompt: 'p',
      jsonSchema: { type: 'object', properties: { name: { type: 'string' } } },
    });
    expect(result).toEqual({ name: 'App' });
    const body = JSON.parse(calls[0]!.init.body as string);
    expect(body.messages[0].content).toContain('base system');
    expect(body.messages[0].content).toContain('"type":"object"');
  });
});

describe('createOpenAICompatibleProvider presets', () => {
  it('configures gemini with the AI Studio endpoint and free-tier default model', () => {
    const provider = createOpenAICompatibleProvider({ provider: 'gemini' });
    expect(provider.name).toBe('gemini (gemini-2.5-flash)');
  });

  it('honors ai.model overrides', () => {
    const provider = createOpenAICompatibleProvider({
      provider: 'gemini',
      model: 'gemini-2.5-pro',
    });
    expect(provider.name).toBe('gemini (gemini-2.5-pro)');
  });

  it('requires model for ollama and base_url+model for openai-compatible', () => {
    expect(() => createOpenAICompatibleProvider({ provider: 'ollama' })).toThrow(/ai\.model/);
    expect(() =>
      createOpenAICompatibleProvider({ provider: 'openai-compatible', model: 'x' }),
    ).toThrow(/ai\.base_url/);
    expect(() =>
      createOpenAICompatibleProvider({
        provider: 'openai-compatible',
        baseUrl: 'https://openrouter.ai/api/v1',
      }),
    ).toThrow(/ai\.model/);
  });
});
