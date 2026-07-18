import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import { readPackageJson } from '../project/detector.js';
import { readPubspec } from '../project/flutter.js';
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

const SOURCE_GLOBS = ['**/*.{js,jsx,ts,tsx}', 'lib/**/*.dart', '**/*.swift', '**/*.{kt,java}'];
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

/** RN/Flutter keep the Podfile under ios/; native iOS keeps it at the root. */
async function readPodfile(
  projectRoot: string,
): Promise<{ path: string; content: string } | null> {
  for (const path of [join('ios', 'Podfile'), 'Podfile']) {
    try {
      return { path, content: await readFile(join(projectRoot, path), 'utf8') };
    } catch {
      // try next location
    }
  }
  return null;
}

/** Gradle build scripts hold Maven coordinates (native Android, or RN's android/). */
async function collectGradleFiles(
  projectRoot: string,
): Promise<Array<{ path: string; content: string }>> {
  const files = await glob(['**/build.gradle', '**/build.gradle.kts'], {
    cwd: projectRoot,
    ignore: SOURCE_IGNORE.filter((i) => i !== 'android/**'),
  });
  return Promise.all(
    files.map(async (path) => ({
      path,
      content: await readFile(join(projectRoot, path), 'utf8'),
    })),
  );
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
  const pubspec = await readPubspec(projectRoot);
  const pubspecDependencyNames = Object.keys({
    ...pubspec?.dependencies,
    ...pubspec?.dev_dependencies,
  });
  const podfile = await readPodfile(projectRoot);
  const gradleFiles = await collectGradleFiles(projectRoot);
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
      if (pubspecDependencyNames.includes(dep)) {
        match.dependencyEvidence.push(`pubspec.yaml: ${dep}`);
      }
      // Dart package names (lower_snake_case, e.g. "camera", "record") are too
      // generic for substring matching against a Podfile — exact pubspec
      // matches above are their only dependency evidence.
      if (!/^[a-z0-9_]+$/.test(dep) && podfile?.content.includes(dep)) {
        match.dependencyEvidence.push(`${podfile.path}: ${dep}`);
      }
      // Maven coordinates ("group:artifact") only ever appear in gradle scripts.
      if (dep.includes(':')) {
        for (const gradle of gradleFiles) {
          if (gradle.content.includes(dep)) {
            match.dependencyEvidence.push(`${gradle.path}: ${dep}`);
          }
        }
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
    sdks.push({
      id: signature.id,
      name: signature.name ?? signature.id,
      category: signature.category,
      confidence,
      evidence,
    });

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
