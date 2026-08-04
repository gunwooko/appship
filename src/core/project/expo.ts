import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

// Expo managed projects have no ios/ or android/ directories — identity and
// permissions live in the Expo config. That config is either static (app.json,
// "expo" key) or dynamic (app.config.js/.cjs/.mjs, evaluated with the static
// config as input, exactly like Expo CLI does). app.config.ts still needs a
// TypeScript loader and falls back to app.json.

export interface ExpoConfig {
  name?: string;
  version?: string;
  ios?: {
    bundleIdentifier?: string;
    infoPlist?: Record<string, unknown>;
  };
  android?: {
    package?: string;
    permissions?: string[];
  };
}

const DYNAMIC_CONFIG_FILES = ['app.config.js', 'app.config.cjs', 'app.config.mjs'];

async function readAppJsonExpo(projectRoot: string): Promise<ExpoConfig | null> {
  try {
    const raw = await readFile(join(projectRoot, 'app.json'), 'utf8');
    const parsed = JSON.parse(raw) as { expo?: ExpoConfig };
    return parsed.expo ?? null;
  } catch {
    return null;
  }
}

/** The exported value may be the config itself or wrapped in { expo: ... }. */
function unwrap(value: unknown): ExpoConfig | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Record<string, unknown>;
  if (record['expo'] && typeof record['expo'] === 'object') {
    return record['expo'] as ExpoConfig;
  }
  return record as ExpoConfig;
}

export async function readExpoConfig(projectRoot: string): Promise<ExpoConfig | null> {
  const staticConfig = await readAppJsonExpo(projectRoot);

  for (const file of DYNAMIC_CONFIG_FILES) {
    const path = join(projectRoot, file);
    if (!existsSync(path)) continue;
    try {
      const mod = (await import(pathToFileURL(path).href)) as { default?: unknown };
      let exported: unknown = mod.default ?? mod;
      if (typeof exported === 'function') {
        // Expo passes the static config in; the function returns the final one.
        exported = (exported as (ctx: { config: ExpoConfig }) => unknown)({
          config: staticConfig ?? {},
        });
      }
      const config = unwrap(await Promise.resolve(exported));
      if (config) return config;
    } catch {
      // The config evaluates in the user's project context and can fail here
      // (TS syntax, missing project deps) — degrade to the static config.
    }
    break; // only the first existing dynamic config counts, like Expo CLI
  }

  return staticConfig;
}

/** Which file the Expo config came from — used as scanner evidence. */
export function expoConfigEvidence(projectRoot: string): string {
  for (const file of DYNAMIC_CONFIG_FILES) {
    if (existsSync(join(projectRoot, file))) return `${file} (expo)`;
  }
  return 'app.json (expo)';
}

/** @deprecated static-config label kept for callers that predate dynamic configs. */
export const EXPO_APP_JSON_EVIDENCE = 'app.json (expo)';

/** Expo allows short permission names ("CAMERA") — normalize to the full form. */
export function normalizeAndroidPermission(permission: string): string {
  return permission.includes('.') ? permission : `android.permission.${permission}`;
}
