import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { expoConfigEvidence, readExpoConfig } from './expo.js';

describe('readExpoConfig with dynamic configs', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-expo-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('reads app.json when no dynamic config exists', async () => {
    await writeFile(
      join(tempRoot, 'app.json'),
      JSON.stringify({ expo: { name: 'Static App', ios: { bundleIdentifier: 'com.x.static' } } }),
    );
    const config = await readExpoConfig(tempRoot);
    expect(config?.name).toBe('Static App');
    expect(expoConfigEvidence(tempRoot)).toBe('app.json (expo)');
  });

  it('evaluates an app.config.js exporting a plain object', async () => {
    await writeFile(
      join(tempRoot, 'app.config.js'),
      `module.exports = {
        expo: {
          name: 'Dynamic App',
          version: '2.0.0',
          ios: { bundleIdentifier: 'com.x.dynamic' },
          android: { package: 'com.x.dynamic', permissions: ['CAMERA'] },
        },
      };`,
    );
    const config = await readExpoConfig(tempRoot);
    expect(config).toMatchObject({
      name: 'Dynamic App',
      ios: { bundleIdentifier: 'com.x.dynamic' },
    });
    expect(expoConfigEvidence(tempRoot)).toBe('app.config.js (expo)');
  });

  it('passes the static app.json config into a config function and unwraps bare configs', async () => {
    await writeFile(
      join(tempRoot, 'app.json'),
      JSON.stringify({ expo: { name: 'Base', version: '1.0.0' } }),
    );
    await writeFile(
      join(tempRoot, 'app.config.js'),
      // function form returning the config directly (no expo wrapper)
      `module.exports = ({ config }) => ({
        ...config,
        name: config.name + ' Pro',
        ios: { bundleIdentifier: 'com.x.pro' },
      });`,
    );
    const config = await readExpoConfig(tempRoot);
    expect(config).toMatchObject({
      name: 'Base Pro',
      version: '1.0.0',
      ios: { bundleIdentifier: 'com.x.pro' },
    });
  });

  it('supports ESM app.config.mjs', async () => {
    await writeFile(
      join(tempRoot, 'app.config.mjs'),
      `export default { expo: { name: 'ESM App' } };`,
    );
    const config = await readExpoConfig(tempRoot);
    expect(config?.name).toBe('ESM App');
    expect(expoConfigEvidence(tempRoot)).toBe('app.config.mjs (expo)');
  });

  it('falls back to app.json when the dynamic config fails to evaluate', async () => {
    await writeFile(
      join(tempRoot, 'app.json'),
      JSON.stringify({ expo: { name: 'Fallback App' } }),
    );
    await writeFile(
      join(tempRoot, 'app.config.js'),
      `const config: SomeType = {}; // TS syntax — not valid JS`,
    );
    const config = await readExpoConfig(tempRoot);
    expect(config?.name).toBe('Fallback App');
  });

  it('returns null when nothing is configured', async () => {
    expect(await readExpoConfig(tempRoot)).toBeNull();
  });
});
