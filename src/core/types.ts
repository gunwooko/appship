// Shared analysis data model (TRD §4). Every finding carries evidence —
// a finding without evidence must never be constructed (Principle 1).

export type Confidence = 'high' | 'medium' | 'low';

export type ProjectType = 'react-native';

export interface ProjectAnalysis {
  projectType: ProjectType;
  appName: string | null;
  version: string | null;
  ios: { bundleId: string | null } | null;
  android: { packageName: string | null } | null;
  scannedAt: string;
  appshipVersion: string;
}

export type UsageDescriptionQuality = 'ok' | 'needs_improvement' | 'missing';

export interface IosPermissionFinding {
  key: string;
  currentMessage: string;
  qualityAssessment: UsageDescriptionQuality;
  evidence: string[];
}

export interface AndroidPermissionFinding {
  key: string;
  evidence: string[];
}

export interface PermissionsReport {
  ios: IosPermissionFinding[];
  android: AndroidPermissionFinding[];
}

export interface SdkFinding {
  id: string;
  category: string;
  confidence: Confidence;
  evidence: string[];
}

export interface SdkReport {
  sdks: SdkFinding[];
}

export interface DataCollectionEntry {
  collected: true;
  purpose: string[];
  shared: boolean;
  evidence: string[];
  requiresConfirmation: boolean;
  /** User's answer from init/generate confirmation. null = not yet confirmed. */
  confirmed: boolean | null;
}

export interface PrivacyReport {
  dataCollection: Record<string, DataCollectionEntry>;
}

export interface ScanResult {
  project: ProjectAnalysis;
  permissions: PermissionsReport;
  sdkReport: SdkReport;
  privacyReport: PrivacyReport;
}

/** Guard shared by all scanners: refuse to create a finding without evidence. */
export function requireEvidence(evidence: string[], context: string): string[] {
  if (evidence.length === 0) {
    throw new Error(`Refusing to create a finding without evidence: ${context}`);
  }
  return evidence;
}
