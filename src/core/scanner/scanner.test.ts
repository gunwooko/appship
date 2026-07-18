import { fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';
import { describe, expect, it } from 'vitest';
import { detectProjectType, UnsupportedProjectError } from '../project/detector.js';
import { analyzeReactNativeProject } from '../project/react-native.js';
import { assessUsageDescription, scanPermissions } from './permissions.js';
import { loadSignatures } from './signatures.js';
import { scanProject } from './index.js';

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  '../../../fixtures/rn-voice-app',
);

describe('detectProjectType', () => {
  it('detects the React Native fixture', async () => {
    await expect(detectProjectType(FIXTURE)).resolves.toBe('react-native');
  });

  it('rejects a directory without a supported project', async () => {
    await expect(detectProjectType('/nonexistent-dir')).rejects.toBeInstanceOf(
      UnsupportedProjectError,
    );
  });
});

describe('analyzeReactNativeProject', () => {
  it('extracts app name, version, bundle id, and package name', async () => {
    const project = await analyzeReactNativeProject(FIXTURE);
    expect(project).toMatchObject({
      projectType: 'react-native',
      appName: 'RN Voice App',
      version: '1.2.0',
      ios: { bundleId: 'com.example.rnvoiceapp' },
      android: { packageName: 'com.example.rnvoiceapp' },
    });
  });
});

describe('scanPermissions', () => {
  it('finds iOS usage descriptions with quality assessment and evidence', async () => {
    const { ios } = await scanPermissions(FIXTURE);
    const mic = ios.find((f) => f.key === 'NSMicrophoneUsageDescription');
    expect(mic).toBeDefined();
    expect(mic!.qualityAssessment).toBe('needs_improvement'); // generic wording
    expect(mic!.evidence).toContain('ios/RNVoiceApp/Info.plist');

    const location = ios.find((f) => f.key === 'NSLocationWhenInUseUsageDescription');
    expect(location!.qualityAssessment).toBe('ok'); // specific purpose stated
  });

  it('finds Android permissions from the manifest', async () => {
    const { android } = await scanPermissions(FIXTURE);
    const keys = android.map((f) => f.key);
    expect(keys).toContain('android.permission.RECORD_AUDIO');
    expect(keys).toContain('android.permission.ACCESS_FINE_LOCATION');
    for (const finding of android) {
      expect(finding.evidence.length).toBeGreaterThan(0);
    }
  });
});

describe('assessUsageDescription', () => {
  it('flags empty, short, and generic messages', () => {
    expect(assessUsageDescription('')).toBe('missing');
    expect(assessUsageDescription('Camera access.')).toBe('needs_improvement');
    expect(assessUsageDescription('This app requires microphone access for features.')).toBe(
      'needs_improvement',
    );
    expect(
      assessUsageDescription(
        'Microphone access is used when you join a voice room and speak with other participants.',
      ),
    ).toBe('ok');
  });
});

describe('loadSignatures', () => {
  it('loads and validates the bundled signature database', async () => {
    const signatures = await loadSignatures();
    expect(signatures.length).toBeGreaterThanOrEqual(18); // TRD §6.2 coverage
    expect(signatures.map((s) => s.id)).toContain('firebase-analytics');
  });

  it('has unique ids and a display name on every signature', async () => {
    const signatures = await loadSignatures();
    const ids = signatures.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const signature of signatures) {
      expect(signature.name, `signature ${signature.id} needs a name`).toBeTruthy();
    }
  });

  it('detects permission-backed device APIs from config keys (low confidence)', async () => {
    const result = await scanProject(FIXTURE);
    const microphone = result.sdkReport.sdks.find((s) => s.id === 'microphone');
    expect(microphone).toBeDefined();
    expect(microphone!.confidence).toBe('low'); // config_keys match only
    const audio = result.privacyReport.dataCollection['voice_or_audio'];
    expect(audio?.requiresConfirmation).toBe(true);
  });
});

describe('scanProject (integration)', () => {
  it('produces a full scan result for the fixture', async () => {
    const result = await scanProject(FIXTURE);

    const sdkIds = result.sdkReport.sdks.map((s) => s.id);
    expect(sdkIds).toEqual(
      expect.arrayContaining(['firebase-analytics', 'sentry', 'location']),
    );

    // dependency match -> high confidence, with both dependency and source evidence
    const firebase = result.sdkReport.sdks.find((s) => s.id === 'firebase-analytics')!;
    expect(firebase.confidence).toBe('high');
    expect(firebase.evidence).toContain('package.json: @react-native-firebase/analytics');
    expect(firebase.evidence).toContain('src/lib/analytics.ts:4');

    // privacy report: location requires user confirmation (precise vs approximate)
    const location = result.privacyReport.dataCollection['location'];
    expect(location).toBeDefined();
    expect(location!.requiresConfirmation).toBe(true);
    expect(location!.confirmed).toBeNull();
    expect(location!.evidence.length).toBeGreaterThan(0);

    // every finding must carry evidence (Principle 1)
    for (const sdk of result.sdkReport.sdks) {
      expect(sdk.evidence.length).toBeGreaterThan(0);
    }
  });

  it('does not detect SDKs that are absent from the fixture', async () => {
    const result = await scanProject(FIXTURE);
    const sdkIds = result.sdkReport.sdks.map((s) => s.id);
    expect(sdkIds).not.toContain('revenuecat');
  });
});
