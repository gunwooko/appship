// Flutter project analysis (MVP 3). Identity still lives in the native
// projects (ios/Runner, android/app) — the same readers as React Native
// apply. Only the dependency manifest differs (pubspec.yaml).

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { APPSHIP_VERSION } from '../../version.js';
import type { ProjectAnalysis } from '../types.js';
import { readIosBundleId, readAndroidPackageName } from './react-native.js';

export interface Pubspec {
  name?: string;
  version?: string;
  dependencies?: Record<string, unknown>;
  dev_dependencies?: Record<string, unknown>;
}

export async function readPubspec(projectRoot: string): Promise<Pubspec | null> {
  try {
    const parsed = parse(await readFile(join(projectRoot, 'pubspec.yaml'), 'utf8'));
    return typeof parsed === 'object' && parsed !== null ? (parsed as Pubspec) : null;
  } catch {
    return null;
  }
}

export function isFlutterPubspec(pubspec: Pubspec | null): boolean {
  return pubspec?.dependencies !== undefined && 'flutter' in pubspec.dependencies;
}

export async function analyzeFlutterProject(projectRoot: string): Promise<ProjectAnalysis> {
  const [pubspec, bundleId, packageName] = await Promise.all([
    readPubspec(projectRoot),
    readIosBundleId(projectRoot),
    readAndroidPackageName(projectRoot),
  ]);

  // pubspec version is "1.2.3+45" (semver + build number)
  const version =
    typeof pubspec?.version === 'string' ? pubspec.version.split('+')[0]! : null;

  return {
    projectType: 'flutter',
    appName: pubspec?.name ?? null,
    version,
    ios: { bundleId },
    android: { packageName },
    scannedAt: new Date().toISOString(),
    appshipVersion: APPSHIP_VERSION,
  };
}
