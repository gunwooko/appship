import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Expo managed projects have no ios/ or android/ directories — identity and
// permissions live in app.json under the "expo" key. app.config.js requires
// JS evaluation and is not supported yet; init falls back to asking the user.

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

export const EXPO_APP_JSON_EVIDENCE = 'app.json (expo)';

export async function readExpoConfig(projectRoot: string): Promise<ExpoConfig | null> {
  try {
    const raw = await readFile(join(projectRoot, 'app.json'), 'utf8');
    const parsed = JSON.parse(raw) as { expo?: ExpoConfig };
    return parsed.expo ?? null;
  } catch {
    return null;
  }
}

/** Expo allows short permission names ("CAMERA") — normalize to the full form. */
export function normalizeAndroidPermission(permission: string): string {
  return permission.includes('.') ? permission : `android.permission.${permission}`;
}
