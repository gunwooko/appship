import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'yaml';
import { z } from 'zod';

const sdkSignatureSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1).optional(),
  category: z.string().min(1),
  detect: z.object({
    dependencies: z.array(z.string()).default([]),
    source_patterns: z.array(z.string()).default([]),
    config_keys: z.array(z.string()).default([]),
  }),
  data_safety: z.object({
    collects: z.array(z.string()).min(1),
    purpose_defaults: z.array(z.string()),
    shared_default: z.boolean(),
    requires_confirmation: z.boolean(),
  }),
});

export const signaturesFileSchema = z.array(sdkSignatureSchema);

export type SdkSignature = z.infer<typeof sdkSignatureSchema>;

/**
 * Locate the packaged data/ directory. Works both from src (tsx) and from
 * the bundled dist/index.js, since `data/` ships alongside them in the package.
 */
export function findDataDir(): string {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 6; i++) {
    const candidate = join(dir, 'data');
    if (existsSync(join(candidate, 'sdk-signatures'))) return candidate;
    dir = dirname(dir);
  }
  throw new Error('Could not locate the appship data/ directory');
}

export async function loadSignatures(dataDir = findDataDir()): Promise<SdkSignature[]> {
  const path = join(dataDir, 'sdk-signatures', 'signatures.yml');
  const raw = await readFile(path, 'utf8');
  const parsed = signaturesFileSchema.safeParse(parse(raw));
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((i) => `  ${i.path.join('.')}: ${i.message}`)
      .join('\n');
    throw new Error(`Invalid SDK signature database (${path}):\n${details}`);
  }
  return parsed.data;
}
