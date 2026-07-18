import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ScanResult } from '../types.js';

export const PRIVACY_REPORT_PATH = '.appship/analysis/privacy-report.json';

/** Carry over user confirmations from a previous run so re-scans don't lose them. */
export async function mergePreviousConfirmations(
  projectRoot: string,
  scan: ScanResult,
): Promise<void> {
  try {
    const raw = await readFile(join(projectRoot, PRIVACY_REPORT_PATH), 'utf8');
    const previous = JSON.parse(raw) as ScanResult['privacyReport'];
    for (const [dataType, entry] of Object.entries(previous.dataCollection ?? {})) {
      const current = scan.privacyReport.dataCollection[dataType];
      if (current && entry.confirmed !== null && entry.confirmed !== undefined) {
        current.confirmed = entry.confirmed;
      }
    }
  } catch {
    // no previous report — nothing to merge
  }
}
