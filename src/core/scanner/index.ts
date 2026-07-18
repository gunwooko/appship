// Scanner orchestrator (TRD §3): detect → analyze → scan permissions → match SDKs.
// Fully local and deterministic — no AI calls, no network (Principle 2).

import { detectProjectType } from '../project/detector.js';
import { analyzeReactNativeProject } from '../project/react-native.js';
import { analyzeFlutterProject } from '../project/flutter.js';
import {
  analyzeNativeIosProject,
  analyzeNativeAndroidProject,
} from '../project/native.js';
import type { ProjectAnalysis, ScanResult } from '../types.js';
import { loadSignaturesWithCache } from '../rules-update/index.js';
import { scanPermissions } from './permissions.js';
import { scanSdks } from './sdk.js';

function analyzeByType(projectRoot: string, projectType: string): Promise<ProjectAnalysis> {
  switch (projectType) {
    case 'flutter':
      return analyzeFlutterProject(projectRoot);
    case 'native-ios':
      return analyzeNativeIosProject(projectRoot);
    case 'native-android':
      return analyzeNativeAndroidProject(projectRoot);
    default:
      return analyzeReactNativeProject(projectRoot);
  }
}

export async function scanProject(projectRoot: string): Promise<ScanResult> {
  const projectType = await detectProjectType(projectRoot); // throws UnsupportedProjectError

  const [project, permissions, signatures] = await Promise.all([
    analyzeByType(projectRoot, projectType),
    scanPermissions(projectRoot, projectType),
    loadSignaturesWithCache(),
  ]);

  const { sdkReport, privacyReport } = await scanSdks(projectRoot, signatures, permissions);

  return { project, permissions, sdkReport, privacyReport };
}
