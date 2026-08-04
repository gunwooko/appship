import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import * as plist from 'plist';
import { XMLParser } from 'fast-xml-parser';
import {
  requireEvidence,
  type AndroidPermissionFinding,
  type IosPermissionFinding,
  type PermissionsReport,
  type UsageDescriptionQuality,
} from '../types.js';
import {
  normalizeAndroidPermission,
  readExpoConfig,
  expoConfigEvidence,
} from '../project/expo.js';
import type { ProjectType } from '../types.js';

const IGNORE_DIRS = ['**/node_modules/**', '**/Pods/**', '**/build/**', '**/.git/**'];

// RN/Flutter keep their native projects under ios/ & android/; native projects
// ARE the root, so their manifests are found anywhere (minus the ignore dirs).
const IOS_PLIST_GLOBS: Record<ProjectType, string[]> = {
  'react-native': ['ios/**/Info.plist'],
  flutter: ['ios/**/Info.plist'],
  'native-ios': ['**/Info.plist'],
  'native-android': [],
};

const ANDROID_MANIFEST_GLOBS: Record<ProjectType, string[]> = {
  'react-native': ['android/**/AndroidManifest.xml'],
  flutter: ['android/**/AndroidManifest.xml'],
  'native-ios': [],
  'native-android': ['**/AndroidManifest.xml'],
};

// Vague messages Apple regularly rejects: no purpose, no user-facing context.
const GENERIC_MESSAGE_PATTERNS = [
  /^this app (requires|needs|uses)\b/i,
  /^(requires|needs|used for)\b/i,
  /\baccess\.?$/i,
];

export function assessUsageDescription(message: string): UsageDescriptionQuality {
  const trimmed = message.trim();
  if (trimmed.length === 0) return 'missing';
  if (trimmed.length < 25) return 'needs_improvement';
  if (GENERIC_MESSAGE_PATTERNS.some((p) => p.test(trimmed))) return 'needs_improvement';
  return 'ok';
}

export async function scanIosPermissions(
  projectRoot: string,
  projectType: ProjectType = 'react-native',
): Promise<IosPermissionFinding[]> {
  const plistFiles = await glob(IOS_PLIST_GLOBS[projectType], {
    cwd: projectRoot,
    ignore: IGNORE_DIRS,
  });

  const findings = new Map<string, IosPermissionFinding>();
  for (const file of plistFiles) {
    const raw = await readFile(join(projectRoot, file), 'utf8');
    let parsed: Record<string, unknown>;
    try {
      parsed = plist.parse(raw) as Record<string, unknown>;
    } catch {
      continue; // malformed plist — skip, doctor can flag separately later
    }
    for (const [key, value] of Object.entries(parsed)) {
      if (!key.endsWith('UsageDescription')) continue;
      const message = typeof value === 'string' ? value : '';
      const existing = findings.get(key);
      if (existing) {
        existing.evidence.push(file);
      } else {
        findings.set(key, {
          key,
          currentMessage: message,
          qualityAssessment: assessUsageDescription(message),
          evidence: requireEvidence([file], `ios permission ${key}`),
        });
      }
    }
  }

  // Expo managed: usage descriptions live in the expo config's ios.infoPlist
  const expo = await readExpoConfig(projectRoot);
  for (const [key, value] of Object.entries(expo?.ios?.infoPlist ?? {})) {
    if (!key.endsWith('UsageDescription') || findings.has(key)) continue;
    const message = typeof value === 'string' ? value : '';
    findings.set(key, {
      key,
      currentMessage: message,
      qualityAssessment: assessUsageDescription(message),
      evidence: requireEvidence([expoConfigEvidence(projectRoot)], `ios permission ${key}`),
    });
  }
  return [...findings.values()];
}

export async function scanAndroidPermissions(
  projectRoot: string,
  projectType: ProjectType = 'react-native',
): Promise<AndroidPermissionFinding[]> {
  const manifestFiles = await glob(ANDROID_MANIFEST_GLOBS[projectType], {
    cwd: projectRoot,
    ignore: [...IGNORE_DIRS, '**/debug/**', '**/androidTest/**'],
  });

  const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });
  const findings = new Map<string, AndroidPermissionFinding>();

  for (const file of manifestFiles) {
    const raw = await readFile(join(projectRoot, file), 'utf8');
    let manifest: Record<string, unknown>;
    try {
      manifest = parser.parse(raw) as Record<string, unknown>;
    } catch {
      continue;
    }
    const root = manifest['manifest'] as Record<string, unknown> | undefined;
    if (!root) continue;
    const entries = root['uses-permission'];
    const list = Array.isArray(entries) ? entries : entries ? [entries] : [];
    for (const entry of list as Array<Record<string, string>>) {
      const name = entry['@_android:name'];
      if (!name) continue;
      const existing = findings.get(name);
      if (existing) {
        existing.evidence.push(file);
      } else {
        findings.set(name, {
          key: name,
          evidence: requireEvidence([file], `android permission ${name}`),
        });
      }
    }
  }

  // Expo managed: permissions live in the expo config's android.permissions
  const expo = await readExpoConfig(projectRoot);
  for (const raw of expo?.android?.permissions ?? []) {
    const name = normalizeAndroidPermission(raw);
    if (findings.has(name)) continue;
    findings.set(name, {
      key: name,
      evidence: requireEvidence([expoConfigEvidence(projectRoot)], `android permission ${name}`),
    });
  }
  return [...findings.values()];
}

export async function scanPermissions(
  projectRoot: string,
  projectType: ProjectType = 'react-native',
): Promise<PermissionsReport> {
  const [ios, android] = await Promise.all([
    scanIosPermissions(projectRoot, projectType),
    scanAndroidPermissions(projectRoot, projectType),
  ]);
  return { ios, android };
}
