import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { appshipConfigSchema, type AppshipConfig } from './schema.js';

export const CONFIG_FILENAME = 'appship.yml';

export class ConfigError extends Error {}

export async function loadConfig(projectRoot: string): Promise<AppshipConfig> {
  const path = join(projectRoot, CONFIG_FILENAME);
  let raw: string;
  try {
    raw = await readFile(path, 'utf8');
  } catch {
    throw new ConfigError(
      `${CONFIG_FILENAME} not found in ${projectRoot}. Run \`appship init\` first.`,
    );
  }

  const parsed = parse(raw);
  const result = appshipConfigSchema.safeParse(parsed);
  if (!result.success) {
    const details = result.error.issues
      .map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('\n');
    throw new ConfigError(`Invalid ${CONFIG_FILENAME}:\n${details}`);
  }
  return result.data;
}
