import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import { readPackageJson } from '../project/detector.js';
import type { SdkSignature } from './signatures.js';
import {
  requireEvidence,
  type Confidence,
  type DataCollectionEntry,
  type PermissionsReport,
  type PrivacyReport,
  type SdkFinding,
  type SdkReport,
} from '../types.js';

const SOURCE_GLOBS = ['**/*.{js,jsx,ts,tsx}'];
const SOURCE_IGNORE = [
  '**/node_modules/**',
  'ios/**',
  'android/**',
  '**/dist/**',
  '**/build/**',
  '**/.git/**',
  '**/*.test.*',
  '**/*.spec.*',
];

interface SignatureMatch {
  dependencyEvidence: string[];
  sourceEvidence: string[];
  configEvidence: string[];
}

function confidenceOf(match: SignatureMatch): Confidence | null {
  if (match.dependencyEvidence.length > 0) return 'high';
  if (match.sourceEvidence.length > 0) return 'medium';
  if (match.configEvidence.length > 0) return 'low';
  return null;
}

async function readPodfile(projectRoot: string): Promise<string | null> {
  try {
    return await readFile(join(projectRoot, 'ios', 'Podfile'), 'utf8');
  } catch {
    return null;
  }
}

async function collectSourceFiles(
  projectRoot: string,
): Promise<Array<{ path: string; lines: string[] }>> {
  const files = await glob(SOURCE_GLOBS, { cwd: projectRoot, ignore: SOURCE_IGNORE });
  return Promise.all(
    files.map(async (path) => ({
      path,
      lines: (await readFile(join(projectRoot, path), 'utf8')).split('\n'),
    })),
  );
}

export async function scanSdks(
  projectRoot: string,
  signatures: SdkSignature[],
  permissions: PermissionsReport,
): Promise<{ sdkReport: SdkReport; privacyReport: PrivacyReport }> {
  const pkg = await readPackageJson(projectRoot);
  const dependencyNames = Object.keys({ ...pkg?.dependencies, ...pkg?.devDependencies });
  const podfile = await readPodfile(projectRoot);
  const sourceFiles = await collectSourceFiles(projectRoot);
  const permissionKeys = new Map<string, string[]>();
  for (const finding of [...permissions.ios, ...permissions.android]) {
    permissionKeys.set(finding.key, finding.evidence);
  }

  const sdks: SdkFinding[] = [];
  const dataCollection: Record<string, DataCollectionEntry> = {};

  for (const signature of signatures) {
    const match: SignatureMatch = {
      dependencyEvidence: [],
      sourceEvidence: [],
      configEvidence: [],
    };

    for (const dep of signature.detect.dependencies) {
      if (dependencyNames.includes(dep)) {
        match.dependencyEvidence.push(`package.json: ${dep}`);
      }
      if (podfile?.includes(dep)) {
        match.dependencyEvidence.push(`ios/Podfile: ${dep}`);
      }
    }

    const patterns = signature.detect.source_patterns.map((p) => new RegExp(p));
    for (const { path, lines } of sourceFiles) {
      for (const pattern of patterns) {
        const lineIndex = lines.findIndex((line) => pattern.test(line));
        if (lineIndex >= 0) {
          match.sourceEvidence.push(`${path}:${lineIndex + 1}`);
          break; // one evidence entry per file per signature is enough
        }
      }
    }

    for (const key of signature.detect.config_keys) {
      const evidence = permissionKeys.get(key);
      if (evidence) match.configEvidence.push(...evidence);
    }

    const confidence = confidenceOf(match);
    if (!confidence) continue;

    const evidence = requireEvidence(
      [...match.dependencyEvidence, ...match.sourceEvidence, ...match.configEvidence],
      `sdk ${signature.id}`,
    );
    sdks.push({ id: signature.id, category: signature.category, confidence, evidence });

    for (const dataType of signature.data_safety.collects) {
      const existing = dataCollection[dataType];
      if (existing) {
        existing.purpose = [...new Set([...existing.purpose, ...signature.data_safety.purpose_defaults])];
        existing.shared = existing.shared || signature.data_safety.shared_default;
        existing.evidence = [...new Set([...existing.evidence, ...evidence])];
        existing.requiresConfirmation =
          existing.requiresConfirmation || signature.data_safety.requires_confirmation;
      } else {
        dataCollection[dataType] = {
          collected: true,
          purpose: [...signature.data_safety.purpose_defaults],
          shared: signature.data_safety.shared_default,
          evidence: [...evidence],
          requiresConfirmation: signature.data_safety.requires_confirmation,
          confirmed: null,
        };
      }
    }
  }

  return { sdkReport: { sdks }, privacyReport: { dataCollection } };
}
