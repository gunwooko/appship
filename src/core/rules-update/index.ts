// Policy rule update system (MVP 3, TRD §"룰 파일만 업데이트"): store policies
// change between releases, so doctor rules and SDK signatures can be refreshed
// from the appship repository without shipping a new CLI version. Downloads
// are schema-validated before they are written; loaders silently fall back to
// the bundled data when no valid cache exists.

import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { findDataDir, loadSignatures, signaturesFileSchema } from '../scanner/signatures.js';
import { loadRules, ruleFileSchema, type DoctorRule } from '../doctor/rules.js';

export class RulesUpdateError extends Error {}

export const DEFAULT_RULES_SOURCE =
  'https://raw.githubusercontent.com/gunwooko/appship/main/data';

/** Files kept in sync, relative to the data/ directory. */
const SYNCED_FILES: Array<{ path: string; validate: (raw: string) => number }> = [
  {
    path: 'rules/app-store.yml',
    validate: (raw) => parseWith(ruleFileSchema, raw, 'rules/app-store.yml').length,
  },
  {
    path: 'rules/google-play.yml',
    validate: (raw) => parseWith(ruleFileSchema, raw, 'rules/google-play.yml').length,
  },
  {
    path: 'sdk-signatures/signatures.yml',
    validate: (raw) => parseWith(signaturesFileSchema, raw, 'sdk-signatures/signatures.yml').length,
  },
];

function parseWith<T>(schema: z.ZodType<T[]>, raw: string, label: string): T[] {
  const parsed = schema.safeParse(parse(raw));
  if (!parsed.success) {
    throw new RulesUpdateError(
      `Downloaded ${label} does not match the schema this appship version understands ` +
        '(update appship itself, or retry later).',
    );
  }
  return parsed.data;
}

export function dataCacheDir(): string {
  return process.env.APPSHIP_DATA_CACHE_DIR ?? join(homedir(), '.appship', 'data-cache');
}

export interface CacheMeta {
  updatedAt: string;
  source: string;
}

export async function readCacheMeta(cacheDir = dataCacheDir()): Promise<CacheMeta | null> {
  try {
    return JSON.parse(await readFile(join(cacheDir, 'meta.json'), 'utf8')) as CacheMeta;
  } catch {
    return null;
  }
}

export type FetchText = (url: string) => Promise<string>;

const defaultFetch: FetchText = async (url) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new RulesUpdateError(`Download failed (${response.status}) for ${url}`);
  }
  return response.text();
};

export interface UpdatedFile {
  path: string;
  entries: number;
  changed: boolean;
}

export interface RulesUpdateResult {
  files: UpdatedFile[];
  cacheDir: string;
  updatedAt: string;
}

export interface RulesUpdateOptions {
  source?: string;
  cacheDir?: string;
  fetchText?: FetchText;
  /** Injected for tests; defaults to the current time. */
  now?: () => Date;
}

export async function updateRules(options: RulesUpdateOptions = {}): Promise<RulesUpdateResult> {
  const source = (options.source ?? DEFAULT_RULES_SOURCE).replace(/\/$/, '');
  const cacheDir = options.cacheDir ?? dataCacheDir();
  const fetchText = options.fetchText ?? defaultFetch;
  const bundledDir = findDataDir();

  // Download and validate everything before writing anything — a partial
  // cache (e.g. new rules with old signatures) must never be observable.
  const downloads: Array<{ path: string; content: string; entries: number }> = [];
  for (const file of SYNCED_FILES) {
    let content: string;
    try {
      content = await fetchText(`${source}/${file.path}`);
    } catch (error) {
      if (error instanceof RulesUpdateError) throw error;
      throw new RulesUpdateError(
        `Could not download ${file.path} from ${source} — check your network and retry.`,
      );
    }
    downloads.push({ path: file.path, content, entries: file.validate(content) });
  }

  const files: UpdatedFile[] = [];
  for (const download of downloads) {
    const cachePath = join(cacheDir, download.path);
    let current: string | null = null;
    try {
      current = await readFile(
        existsSync(cachePath) ? cachePath : join(bundledDir, download.path),
        'utf8',
      );
    } catch {
      // nothing to compare against
    }
    await mkdir(dirname(cachePath), { recursive: true });
    await writeFile(cachePath, download.content, 'utf8');
    files.push({
      path: download.path,
      entries: download.entries,
      changed: current !== download.content,
    });
  }

  const updatedAt = (options.now?.() ?? new Date()).toISOString();
  const meta: CacheMeta = { updatedAt, source };
  await writeFile(join(cacheDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n', 'utf8');

  return { files, cacheDir, updatedAt };
}

export async function resetRules(cacheDir = dataCacheDir()): Promise<boolean> {
  if (!existsSync(cacheDir)) return false;
  await rm(cacheDir, { recursive: true, force: true });
  return true;
}

/**
 * Cache-aware loaders: prefer the updated cache, fall back to the bundled
 * data when the cache is absent or no longer parses (e.g. schema drift).
 */
export async function loadRulesWithCache(cacheDir = dataCacheDir()): Promise<DoctorRule[]> {
  if (existsSync(join(cacheDir, 'rules'))) {
    try {
      return await loadRules(cacheDir);
    } catch {
      // stale/incompatible cache — bundled rules still work
    }
  }
  return loadRules();
}

export async function loadSignaturesWithCache(cacheDir = dataCacheDir()) {
  if (existsSync(join(cacheDir, 'sdk-signatures'))) {
    try {
      return await loadSignatures(cacheDir);
    } catch {
      // stale/incompatible cache
    }
  }
  return loadSignatures();
}
