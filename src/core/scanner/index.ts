// Scanner orchestrator (TRD §3): detect → analyze → scan permissions → match SDKs.
// Fully local and deterministic — no AI calls, no network (Principle 2).

import { detectProjectType } from '../project/detector.js';
import { analyzeReactNativeProject } from '../project/react-native.js';
import type { ScanResult } from '../types.js';
import { loadSignatures } from './signatures.js';
import { scanPermissions } from './permissions.js';
import { scanSdks } from './sdk.js';

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  await detectProjectType(projectRoot); // throws UnsupportedProjectError if not RN

  const [project, permissions, signatures] = await Promise.all([
    analyzeReactNativeProject(projectRoot),
    scanPermissions(projectRoot),
    loadSignatures(),
  ]);

  const { sdkReport, privacyReport } = await scanSdks(projectRoot, signatures, permissions);

  return { project, permissions, sdkReport, privacyReport };
}
