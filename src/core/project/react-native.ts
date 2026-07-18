import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import { APPSHIP_VERSION } from '../../version.js';
import type { ProjectAnalysis } from '../types.js';
import { readPackageJson } from './detector.js';
import { readExpoConfig } from './expo.js';

const IGNORE_DIRS = ['**/node_modules/**', '**/Pods/**', '**/build/**', '**/.git/**'];

async function readAppName(projectRoot: string): Promise<string | null> {
  // React Native CLI: app.json { name, displayName }
  // Expo: app.json { expo: { name } }. app.config.js needs JS evaluation and
  // is not supported yet — init falls back to asking the user.
  try {
    const raw = await readFile(join(projectRoot, 'app.json'), 'utf8');
    const appJson = JSON.parse(raw) as {
      displayName?: string;
      name?: string;
      expo?: { name?: string };
    };
    return appJson.displayName ?? appJson.expo?.name ?? appJson.name ?? null;
  } catch {
    return null;
  }
}

export async function readIosBundleId(projectRoot: string): Promise<string | null> {
  const pbxprojFiles = await glob('ios/*.xcodeproj/project.pbxproj', {
    cwd: projectRoot,
    ignore: IGNORE_DIRS,
    absolute: false,
  });
  for (const file of pbxprojFiles) {
    const content = await readFile(join(projectRoot, file), 'utf8');
    const matches = [
      ...content.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([A-Za-z0-9.\-$()]+)"?\s*;/g),
    ]
      .map((m) => m[1]!)
      // skip test targets and unresolved build-setting variables
      .filter((id) => !id.endsWith('Tests') && !id.includes('$'));
    if (matches[0]) return matches[0];
  }
  // Expo managed: no ios/ directory — identity lives in app.json
  const expo = await readExpoConfig(projectRoot);
  return expo?.ios?.bundleIdentifier ?? null;
}

export async function readAndroidPackageName(projectRoot: string): Promise<string | null> {
  // Modern RN: applicationId (and namespace) in android/app/build.gradle
  for (const gradleFile of ['android/app/build.gradle', 'android/app/build.gradle.kts']) {
    try {
      const content = await readFile(join(projectRoot, gradleFile), 'utf8');
      const match =
        content.match(/applicationId\s*[=(]?\s*["']([A-Za-z0-9._]+)["']/) ??
        content.match(/namespace\s*[=(]?\s*["']([A-Za-z0-9._]+)["']/);
      if (match?.[1]) return match[1];
    } catch {
      // try next candidate
    }
  }
  // Legacy fallback: package attribute on AndroidManifest.xml
  try {
    const manifest = await readFile(
      join(projectRoot, 'android/app/src/main/AndroidManifest.xml'),
      'utf8',
    );
    const match = manifest.match(/package\s*=\s*["']([A-Za-z0-9._]+)["']/);
    if (match?.[1]) return match[1];
  } catch {
    // no manifest
  }
  // Expo managed: no android/ directory — identity lives in app.json
  const expo = await readExpoConfig(projectRoot);
  return expo?.android?.package ?? null;
}

export async function analyzeReactNativeProject(projectRoot: string): Promise<ProjectAnalysis> {
  const pkg = await readPackageJson(projectRoot);
  const [appName, bundleId, packageName, expo] = await Promise.all([
    readAppName(projectRoot),
    readIosBundleId(projectRoot),
    readAndroidPackageName(projectRoot),
    readExpoConfig(projectRoot),
  ]);

  return {
    projectType: 'react-native',
    appName: appName ?? pkg?.name ?? null,
    version: pkg?.version ?? expo?.version ?? null,
    ios: { bundleId },
    android: { packageName },
    scannedAt: new Date().toISOString(),
    appshipVersion: APPSHIP_VERSION,
  };
}
