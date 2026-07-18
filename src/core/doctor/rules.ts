import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'zod';
import { findDataDir } from '../scanner/signatures.js';

export const storeSchema = z.enum(['app-store', 'google-play']);
export type Store = z.infer<typeof storeSchema>;

const checkSchema = z.object({
  type: z.enum(['max_length', 'file_exists', 'not_contains', 'no_emoji']),
  value: z.union([z.string(), z.number()]).optional(),
});

const ruleSchema = z.object({
  id: z.string().min(1),
  store: storeSchema,
  category: z.enum(['required', 'length', 'policy', 'quality', 'consistency']),
  severity: z.enum(['error', 'warning']),
  /** Glob relative to .appship/ that the check runs against (content checks). */
  target: z.string().optional(),
  /** Only evaluate when this scanner-derived finding is present. */
  condition: z.object({ finding: z.string() }).optional(),
  check: checkSchema,
  message: z.string().min(1),
  /** Report line when the check passes; defaults to a humanized rule id. */
  pass_message: z.string().optional(),
  guideline: z.string().optional(),
  fix_suggestions: z.array(z.string()).optional(),
});

export type DoctorRule = z.infer<typeof ruleSchema>;

export const ruleFileSchema = z.array(ruleSchema);

export async function loadRules(dataDir = findDataDir()): Promise<DoctorRule[]> {
  const rulesDir = join(dataDir, 'rules');
  const files = (await readdir(rulesDir)).filter((f) => f.endsWith('.yml') || f.endsWith('.yaml'));
  const rules: DoctorRule[] = [];
  for (const file of files.sort()) {
    const raw = await readFile(join(rulesDir, file), 'utf8');
    const parsed = ruleFileSchema.safeParse(parse(raw));
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((i) => `  ${i.path.join('.')}: ${i.message}`)
        .join('\n');
      throw new Error(`Invalid doctor rule file (${file}):\n${details}`);
    }
    rules.push(...parsed.data);
  }
  return rules;
}
