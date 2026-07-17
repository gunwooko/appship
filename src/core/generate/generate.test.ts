import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanProject } from '../scanner/index.js';
import { buildConfig } from '../init/init.js';
import { buildSummaryPayload } from '../ai/payload.js';
import type {
  AIProvider,
  GenerateObjectRequest,
  GenerateTextRequest,
} from '../ai/provider.js';
import { planArtifacts, runGenerate } from './index.js';
import type { AppshipConfig } from '../config/schema.js';
import type { ScanResult } from '../types.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/rn-voice-app');

/** Deterministic fake provider; optionally violates the name limit on the first call. */
class FakeProvider implements AIProvider {
  readonly name = 'fake';
  objectCalls: GenerateObjectRequest[] = [];
  textCalls: GenerateTextRequest[] = [];
  private appStoreAttempts = 0;

  constructor(private violateNameFirst = false) {}

  async generateText(request: GenerateTextRequest): Promise<string> {
    this.textCalls.push(request);
    return '> This is an AI-generated draft, not legal advice.\n\n# Draft\n\n[CONFIRM: contact email]\n';
  }

  async generateObject(request: GenerateObjectRequest): Promise<unknown> {
    this.objectCalls.push(request);
    const required = (request.jsonSchema as { required?: string[] }).required ?? [];
    if (required.includes('reviewNotes')) {
      this.appStoreAttempts += 1;
      const tooLong = this.violateNameFirst && this.appStoreAttempts === 1;
      return {
        name: tooLong ? 'A'.repeat(45) : 'RN Voice App',
        subtitle: 'Practice speaking daily',
        description: 'A language learning app with real-time voice rooms.',
        keywords: 'language,learning,voice',
        promotionalText: 'Join live voice rooms.',
        releaseNotes: 'Initial release.',
        reviewNotes: 'Login required: test account will be provided.',
      };
    }
    if (required.includes('shortDescription')) {
      return {
        title: 'RN Voice App',
        shortDescription: 'Practice speaking in live voice rooms.',
        fullDescription: 'A language learning app with real-time voice rooms.',
        releaseNotes: 'Initial release.',
        suggestedCategory: 'Education',
        suggestedTags: ['language learning'],
      };
    }
    if (required.includes('screens')) {
      return { screens: [{ screen: 'VoiceRoom', headline: 'Practice speaking with the world' }] };
    }
    throw new Error(`FakeProvider: unexpected schema ${JSON.stringify(required)}`);
  }
}

async function fixtureSetup(): Promise<{ scan: ScanResult; config: AppshipConfig }> {
  const scan = await scanProject(FIXTURE);
  const config = buildConfig(scan, {
    description: 'A language learning app with real-time voice rooms.',
    audience: ['language learners'],
    requiresLogin: true,
    collectsPersonalData: true,
    countries: [],
    locales: ['en-US'],
  });
  return { scan, config };
}

describe('buildSummaryPayload (privacy invariant)', () => {
  it('contains only abstract summaries — no file paths, evidence, or source code', async () => {
    const { scan, config } = await fixtureSetup();
    const payload = buildSummaryPayload(scan, config);
    const serialized = JSON.stringify(payload);
    expect(serialized).not.toMatch(/src\//);
    expect(serialized).not.toMatch(/Info\.plist|AndroidManifest/);
    expect(serialized).not.toMatch(/evidence/i);
    expect(payload.sdks).toContain('Firebase Analytics');
    expect(payload.features).toContain('login');
    expect(payload.permissions).toContain('microphone');
  });
});

describe('runGenerate', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-generate-'));
    await cp(FIXTURE, tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes exactly the planned artifact tree', async () => {
    const { scan, config } = await fixtureSetup();
    const provider = new FakeProvider();
    const result = await runGenerate(tempRoot, config, scan, provider);

    const planned = planArtifacts(config).sort();
    const produced = result.files.map((f) => f.path).sort();
    expect(produced).toEqual(planned);
    for (const path of planned) {
      expect(existsSync(join(tempRoot, path)), `${path} should exist`).toBe(true);
    }
  });

  it('renders confirm markers for unconfirmed data-safety entries', async () => {
    const { scan, config } = await fixtureSetup();
    await runGenerate(tempRoot, config, scan, new FakeProvider());
    const dataSafety = await readFile(join(tempRoot, '.appship/google-play/data-safety.yml'), 'utf8');
    expect(dataSafety).toContain('location');
    expect(dataSafety).toContain('confirm_before_submitting');
    expect(dataSafety).toContain('src/services/location.ts'); // evidence preserved locally
  });

  it('retries once when the name exceeds the App Store limit', async () => {
    const { scan, config } = await fixtureSetup();
    const provider = new FakeProvider(true);
    const result = await runGenerate(tempRoot, config, scan, provider);

    const nameFile = result.files.find((f) => f.path.endsWith('app-store/en-US/name.txt'))!;
    expect(nameFile.content.trim()).toBe('RN Voice App');
    expect(nameFile.violations).toEqual([]);
    // Retry prompt must reference the violated constraint
    const retryCall = provider.objectCalls.find((c) => c.prompt.includes('violated these constraints'));
    expect(retryCall?.prompt).toContain('30');
  });

  it('builds a screenshot plan from detected screens with AI headlines', async () => {
    const { scan, config } = await fixtureSetup();
    await runGenerate(tempRoot, config, scan, new FakeProvider());
    const plan = await readFile(
      join(tempRoot, '.appship/app-store/screenshots/screenshot-plan.yml'),
      'utf8',
    );
    expect(plan).toContain('VoiceRoom');
    expect(plan).toContain('Practice speaking with the world');
    expect(plan).toContain('src/screens/VoiceRoom.tsx');
  });

  it('respects target and dryRun options', async () => {
    const { scan, config } = await fixtureSetup();
    const result = await runGenerate(tempRoot, config, scan, new FakeProvider(), {
      target: 'android',
      dryRun: true,
    });
    expect(result.files.every((f) => !f.path.includes('app-store'))).toBe(true);
    expect(existsSync(join(tempRoot, '.appship/google-play'))).toBe(false); // no writes
  });

  it('includes Guideline 5.1.1 item in the checklist when login is required', async () => {
    const { scan, config } = await fixtureSetup();
    await runGenerate(tempRoot, config, scan, new FakeProvider());
    const checklist = await readFile(join(tempRoot, '.appship/checklist/app-store.md'), 'utf8');
    expect(checklist).toContain('5.1.1');
    expect(checklist).toContain('NSMicrophoneUsageDescription');
  });
});
