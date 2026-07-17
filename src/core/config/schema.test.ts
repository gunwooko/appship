import { describe, expect, it } from 'vitest';
import { appshipConfigSchema } from './schema.js';

const minimalConfig = {
  project: {
    name: 'My App',
    description: 'A language learning app with real-time voice rooms.',
  },
  platforms: {
    ios: { bundle_id: 'com.example.myapp' },
    android: { package_name: 'com.example.myapp' },
  },
  stores: {},
};

describe('appshipConfigSchema', () => {
  it('accepts a minimal config and applies defaults', () => {
    const config = appshipConfigSchema.parse(minimalConfig);
    expect(config.stores.default_locale).toBe('en-US');
    expect(config.ai.provider).toBe('anthropic');
    expect(config.privacy.send_source_code_to_ai).toBe(false);
    expect(config.privacy.require_manual_confirmation).toBe(true);
  });

  it('rejects a config without a project description', () => {
    const result = appshipConfigSchema.safeParse({
      ...minimalConfig,
      project: { name: 'My App' },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown AI provider', () => {
    const result = appshipConfigSchema.safeParse({
      ...minimalConfig,
      ai: { provider: 'my-custom-llm' },
    });
    expect(result.success).toBe(false);
  });

  it('defaults to never sending source code to AI', () => {
    const config = appshipConfigSchema.parse(minimalConfig);
    expect(config.privacy.send_source_code_to_ai).toBe(false);
  });
});
