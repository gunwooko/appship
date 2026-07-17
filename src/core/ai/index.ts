import type { AppshipConfig } from '../config/schema.js';
import { AnthropicProvider } from './anthropic.js';
import { AIProviderError, type AIProvider } from './provider.js';

export function createProvider(config: AppshipConfig): AIProvider {
  switch (config.ai.provider) {
    case 'anthropic':
      return new AnthropicProvider(config.ai.model);
    default:
      throw new AIProviderError(
        `AI provider "${config.ai.provider}" is not implemented yet. ` +
          'MVP 1 supports "anthropic" — set ai.provider in appship.yml.',
      );
  }
}

export * from './provider.js';
export * from './payload.js';
