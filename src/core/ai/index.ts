import type { AppshipConfig } from '../config/schema.js';
import { AnthropicProvider } from './anthropic.js';
import { createOpenAICompatibleProvider } from './openai-compatible.js';
import { type AIProvider } from './provider.js';

export function createProvider(config: AppshipConfig): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.ai.model);
    case 'gemini':
    case 'openai':
    case 'ollama':
    case 'openai-compatible':
      return createOpenAICompatibleProvider({
        provider: config.ai.provider,
        ...(config.ai.model ? { model: config.ai.model } : {}),
        ...(config.ai.base_url ? { baseUrl: config.ai.base_url } : {}),
      });
  }
}

export * from './provider.js';
export * from './payload.js';
