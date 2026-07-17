import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ProjectType } from '../types.js';

export class UnsupportedProjectError extends Error {}

export interface PackageJson {
  name?: string;
  version?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

export async function readPackageJson(projectRoot: string): Promise<PackageJson | null> {
  try {
    const raw = await readFile(join(projectRoot, 'package.json'), 'utf8');
    return JSON.parse(raw) as PackageJson;
  } catch {
    return null;
  }
}

export async function detectProjectType(projectRoot: string): Promise<ProjectType> {
  const pkg = await readPackageJson(projectRoot);
  const deps = { ...pkg?.dependencies, ...pkg?.devDependencies };
  if (pkg && 'react-native' in deps) {
    return 'react-native';
  }
  throw new UnsupportedProjectError(
    'No supported project detected. MVP 1 supports React Native projects ' +
      '(package.json with a react-native dependency).',
  );
}
