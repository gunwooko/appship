// Native iOS / native Android project analysis (MVP 3). Unlike RN/Flutter,
// the native project IS the repository root: the .xcodeproj (or the gradle
// app/ module) sits at the top level instead of under ios/ / android/.

import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import * as plist from 'plist';
import { APPSHIP_VERSION } from '../../version.js';
import type { ProjectAnalysis } from '../types.js';

const IGNORE_DIRS = ['**/node_modules/**', '**/Pods/**', '**/build/**', '**/.git/**'];

export async function findRootPbxproj(projectRoot: string): Promise<string[]> {
  return glob('*.xcodeproj/project.pbxproj', { cwd: projectRoot, ignore: IGNORE_DIRS });
}

export function hasNativeAndroidLayout(projectRoot: string, exists: (p: string) => boolean): boolean {
  const hasSettings =
    exists(join(projectRoot, 'settings.gradle')) || exists(join(projectRoot, 'settings.gradle.kts'));
  const hasAppModule =
    exists(join(projectRoot, 'app', 'build.gradle')) ||
    exists(join(projectRoot, 'app', 'build.gradle.kts'));
  return hasSettings && hasAppModule;
}

/** Literal plist value — build-setting placeholders like $(PRODUCT_NAME) don't count. */
function literal(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && !value.includes('$(') ? value : null;
}

export async function analyzeNativeIosProject(projectRoot: string): Promise<ProjectAnalysis> {
  const pbxprojFiles = await findRootPbxproj(projectRoot);

  let bundleId: string | null = null;
  let version: string | null = null;
  let projectName: string | null = null;
  for (const file of pbxprojFiles) {
    const content = await readFile(join(projectRoot, file), 'utf8');
    if (!bundleId) {
      const ids = [
        ...content.matchAll(/PRODUCT_BUNDLE_IDENTIFIER\s*=\s*"?([A-Za-z0-9.\-$()]+)"?\s*;/g),
      ]
        .map((m) => m[1]!)
        .filter((id) => !id.endsWith('Tests') && !id.includes('$'));
      bundleId = ids[0] ?? null;
    }
    if (!version) {
      version = content.match(/MARKETING_VERSION\s*=\s*"?([0-9.]+)"?\s*;/)?.[1] ?? null;
    }
    projectName ??= file.split('.xcodeproj')[0] ?? null;
  }

  // Display name from an Info.plist when it is a literal string
  let appName: string | null = null;
  const plistFiles = await glob(['*/Info.plist', 'Info.plist'], {
    cwd: projectRoot,
    ignore: IGNORE_DIRS,
  });
  for (const file of plistFiles) {
    try {
      const parsed = plist.parse(await readFile(join(projectRoot, file), 'utf8')) as Record<
        string,
        unknown
      >;
      appName = literal(parsed['CFBundleDisplayName']) ?? literal(parsed['CFBundleName']);
      if (appName) break;
    } catch {
      // malformed plist — keep looking
    }
  }

  return {
    projectType: 'native-ios',
    appName: appName ?? projectName,
    version,
    ios: { bundleId },
    android: null,
    scannedAt: new Date().toISOString(),
    appshipVersion: APPSHIP_VERSION,
  };
}

async function tryRead(path: string): Promise<string | null> {
  try {
    return await readFile(path, 'utf8');
  } catch {
    return null;
  }
}

export async function analyzeNativeAndroidProject(projectRoot: string): Promise<ProjectAnalysis> {
  let packageName: string | null = null;
  let version: string | null = null;
  for (const gradleFile of ['app/build.gradle', 'app/build.gradle.kts']) {
    const content = await tryRead(join(projectRoot, gradleFile));
    if (!content) continue;
    packageName ??=
      content.match(/applicationId\s*[=(]?\s*["']([A-Za-z0-9._]+)["']/)?.[1] ??
      content.match(/namespace\s*[=(]?\s*["']([A-Za-z0-9._]+)["']/)?.[1] ??
      null;
    version ??= content.match(/versionName\s*[=(]?\s*["']([^"']+)["']/)?.[1] ?? null;
  }

  // App name: settings.gradle rootProject.name, else strings.xml app_name
  let appName: string | null = null;
  for (const settingsFile of ['settings.gradle', 'settings.gradle.kts']) {
    const content = await tryRead(join(projectRoot, settingsFile));
    appName ??= content?.match(/rootProject\.name\s*=\s*["']([^"']+)["']/)?.[1] ?? null;
  }
  if (!appName) {
    const strings = await tryRead(join(projectRoot, 'app/src/main/res/values/strings.xml'));
    appName = strings?.match(/<string name="app_name">([^<]+)<\/string>/)?.[1] ?? null;
  }

  return {
    projectType: 'native-android',
    appName,
    version,
    ios: null,
    android: { packageName },
    scannedAt: new Date().toISOString(),
    appshipVersion: APPSHIP_VERSION,
  };
}
