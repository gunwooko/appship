// Builds the summary payload sent to AI providers (TRD §5.1).
// PRIVACY INVARIANT: this is the ONLY module that shapes what leaves the
// machine. It must never include source code, file contents, or file paths —
// only abstract summaries. Guarded by a regression test.

import type { AppshipConfig } from '../config/schema.js';
import type { ScanResult } from '../types.js';

export interface SummaryPayload {
  projectType: string;
  appName: string | null;
  userDescription: string;
  audience: string[];
  features: string[];
  permissions: string[];
  sdks: string[];
  locales: string[];
}

const PERMISSION_FEATURES: Record<string, string> = {
  NSMicrophoneUsageDescription: 'microphone',
  'android.permission.RECORD_AUDIO': 'microphone',
  NSCameraUsageDescription: 'camera',
  'android.permission.CAMERA': 'camera',
  NSLocationWhenInUseUsageDescription: 'location',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'location',
  'android.permission.ACCESS_FINE_LOCATION': 'location',
  'android.permission.ACCESS_COARSE_LOCATION': 'location',
  NSContactsUsageDescription: 'contacts',
  'android.permission.READ_CONTACTS': 'contacts',
  NSPhotoLibraryUsageDescription: 'photo-library',
  'android.permission.POST_NOTIFICATIONS': 'notifications',
};

export function buildSummaryPayload(scan: ScanResult, config: AppshipConfig): SummaryPayload {
  const permissions = [
    ...new Set(
      [...scan.permissions.ios, ...scan.permissions.android]
        .map((f) => PERMISSION_FEATURES[f.key])
        .filter((name): name is string => name !== undefined),
    ),
  ];

  const features = [
    ...new Set([
      ...scan.sdkReport.sdks.map((s) => s.category),
      ...permissions,
      ...(config.project.requires_login ? ['login'] : []),
    ]),
  ];

  return {
    projectType: scan.project.projectType,
    appName: scan.project.appName,
    userDescription: config.project.description,
    audience: config.project.audience,
    features,
    permissions,
    sdks: scan.sdkReport.sdks.map((s) => s.name),
    locales: config.stores.locales,
  };
}
