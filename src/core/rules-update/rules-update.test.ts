import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { findDataDir } from '../scanner/signatures.js';
import {
  loadRulesWithCache,
  loadSignaturesWithCache,
  readCacheMeta,
  resetRules,
  RulesUpdateError,
  updateRules,
  type FetchText,
} from './index.js';

const NOW = () => new Date('2026-07-18T12:00:00Z');

/** Serves the bundled data files, optionally with overrides per path suffix. */
function bundledFetch(overrides: Record<string, string> = {}): FetchText {
  return async (url) => {
    for (const [suffix, content] of Object.entries(overrides)) {
      if (url.endsWith(suffix)) return content;
    }
    const path = url.replace('https://example.com/data/', '');
    return readFile(join(findDataDir(), path), 'utf8');
  };
}

describe('updateRules', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'appship-rules-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('downloads, validates, and caches all data files with metadata', async () => {
    const result = await updateRules({
      source: 'https://example.com/data/',
      cacheDir,
      fetchText: bundledFetch(),
      now: NOW,
    });

    expect(result.files.map((f) => f.path)).toEqual([
      'rules/app-store.yml',
      'rules/google-play.yml',
      'sdk-signatures/signatures.yml',
    ]);
    // identical to bundled content -> not "changed"
    expect(result.files.every((f) => !f.changed)).toBe(true);
    expect(result.files.every((f) => f.entries > 0)).toBe(true);
    expect(existsSync(join(cacheDir, 'sdk-signatures/signatures.yml'))).toBe(true);

    const meta = await readCacheMeta(cacheDir);
    expect(meta).toEqual({
      updatedAt: '2026-07-18T12:00:00.000Z',
      source: 'https://example.com/data',
    });
  });

  it('marks files as changed when the remote content differs', async () => {
    const changedRule = `- id: new-policy
  store: app-store
  category: policy
  severity: warning
  target: "app-store/*/name.txt"
  check: { type: no_emoji }
  message: New policy check
`;
    const result = await updateRules({
      source: 'https://example.com/data/',
      cacheDir,
      fetchText: bundledFetch({ 'rules/app-store.yml': changedRule }),
      now: NOW,
    });
    expect(result.files.find((f) => f.path === 'rules/app-store.yml')!.changed).toBe(true);
    expect(result.files.find((f) => f.path === 'rules/google-play.yml')!.changed).toBe(false);
  });

  it('rejects schema-invalid downloads and writes nothing', async () => {
    await expect(
      updateRules({
        source: 'https://example.com/data/',
        cacheDir,
        fetchText: bundledFetch({ 'rules/app-store.yml': '- id: broken\n  nope: true\n' }),
        now: NOW,
      }),
    ).rejects.toThrow(RulesUpdateError);
    expect(existsSync(join(cacheDir, 'meta.json'))).toBe(false);
    expect(existsSync(join(cacheDir, 'rules'))).toBe(false);
  });

  it('wraps network failures in a friendly error', async () => {
    await expect(
      updateRules({
        source: 'https://example.com/data/',
        cacheDir,
        now: NOW,
        fetchText: async () => {
          throw new Error('ECONNREFUSED');
        },
      }),
    ).rejects.toThrow(/check your network/);
  });
});

describe('cache-aware loaders', () => {
  let cacheDir: string;

  beforeEach(async () => {
    cacheDir = await mkdtemp(join(tmpdir(), 'appship-rules-'));
  });

  afterEach(async () => {
    await rm(cacheDir, { recursive: true, force: true });
  });

  it('falls back to bundled data when there is no cache', async () => {
    const rules = await loadRulesWithCache(join(cacheDir, 'missing'));
    expect(rules.length).toBeGreaterThan(0);
    const signatures = await loadSignaturesWithCache(join(cacheDir, 'missing'));
    expect(signatures.length).toBeGreaterThan(0);
  });

  it('prefers valid cached data over bundled data', async () => {
    const onlyRule = `- id: cached-only-rule
  store: app-store
  category: policy
  severity: warning
  target: "app-store/*/name.txt"
  check: { type: no_emoji }
  message: Cached rule
`;
    await updateRules({
      source: 'https://example.com/data/',
      cacheDir,
      fetchText: bundledFetch({
        'rules/app-store.yml': onlyRule,
        'rules/google-play.yml': '[]\n',
      }),
      now: NOW,
    });
    const rules = await loadRulesWithCache(cacheDir);
    expect(rules.map((r) => r.id)).toEqual(['cached-only-rule']);
  });

  it('falls back to bundled data when the cache no longer parses', async () => {
    await updateRules({
      source: 'https://example.com/data/',
      cacheDir,
      fetchText: bundledFetch(),
      now: NOW,
    });
    // simulate schema drift: corrupt the cached file after download
    const { writeFile } = await import('node:fs/promises');
    await writeFile(join(cacheDir, 'rules/app-store.yml'), '- id: broken\n  nope: 1\n');
    const rules = await loadRulesWithCache(cacheDir);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules.map((r) => r.id)).not.toContain('broken');
  });
});

describe('resetRules', () => {
  it('removes an existing cache and reports when there is none', async () => {
    const cacheDir = await mkdtemp(join(tmpdir(), 'appship-rules-'));
    expect(await resetRules(cacheDir)).toBe(true);
    expect(existsSync(cacheDir)).toBe(false);
    expect(await resetRules(cacheDir)).toBe(false);
  });
});
