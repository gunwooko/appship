import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { stringify } from 'yaml';
import { appshipConfigSchema, type AppshipConfig } from '../config/schema.js';
import type { CommandRunner } from '../upload/index.js';
import {
  generateFlows,
  loadScreenshotPlan,
  preflightCapture,
  runCapture,
  ScreenshotsError,
  FLOWS_DIR,
  NAVIGATION_TODO,
} from './index.js';

const CONFIG: AppshipConfig = appshipConfigSchema.parse({
  project: { name: 'RN Voice App', description: 'A voice app.' },
  platforms: {
    ios: { bundle_id: 'com.example.ios' },
    android: { package_name: 'com.example.android' },
  },
  stores: {},
});

const PLAN = {
  screens: [
    { screen: 'Onboarding', headline: 'Start learning', source_route: 'src/screens/Onboarding.tsx' },
    { screen: 'VoiceRoom', headline: 'Practice speaking', source_route: 'src/screens/VoiceRoom.tsx' },
  ],
};

describe('screenshots', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-screens-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function writePlan(plan: unknown): Promise<void> {
    const dir = join(tempRoot, '.appship/app-store/screenshots');
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, 'screenshot-plan.yml'), stringify(plan), 'utf8');
  }

  describe('loadScreenshotPlan', () => {
    it('loads and validates the plan', async () => {
      await writePlan(PLAN);
      const plan = await loadScreenshotPlan(tempRoot);
      expect(plan.screens).toHaveLength(2);
      expect(plan.screens[0]!.screen).toBe('Onboarding');
    });

    it('fails clearly when no plan exists', async () => {
      await expect(loadScreenshotPlan(tempRoot)).rejects.toThrow(ScreenshotsError);
    });
  });

  describe('generateFlows', () => {
    it('writes one numbered flow per screen with appId, headline, and TODO navigation', async () => {
      await writePlan(PLAN);
      const result = await generateFlows(tempRoot, CONFIG, await loadScreenshotPlan(tempRoot));
      expect(result.written).toEqual([
        join(FLOWS_DIR, '01-onboarding.yaml'),
        join(FLOWS_DIR, '02-voice-room.yaml'),
      ]);

      const flow = await readFile(join(tempRoot, FLOWS_DIR, '02-voice-room.yaml'), 'utf8');
      expect(flow).toContain('appId: com.example.android'); // android preferred
      expect(flow).toContain('Practice speaking');
      expect(flow).toContain('src/screens/VoiceRoom.tsx');
      expect(flow).toContain(NAVIGATION_TODO);
      expect(flow).toContain('- takeScreenshot: .appship/screenshots/raw/02-voice-room');
    });

    it('keeps developer-edited flows unless forced', async () => {
      await writePlan(PLAN);
      const plan = await loadScreenshotPlan(tempRoot);
      await generateFlows(tempRoot, CONFIG, plan);

      const flowPath = join(tempRoot, FLOWS_DIR, '01-onboarding.yaml');
      await writeFile(flowPath, 'appId: x\n---\n- launchApp\n- tapOn: "Start"\n', 'utf8');

      const second = await generateFlows(tempRoot, CONFIG, plan);
      expect(second.skipped).toContain(join(FLOWS_DIR, '01-onboarding.yaml'));
      expect(await readFile(flowPath, 'utf8')).toContain('tapOn: "Start"');

      const forced = await generateFlows(tempRoot, CONFIG, plan, { force: true });
      expect(forced.written).toHaveLength(2);
      expect(await readFile(flowPath, 'utf8')).toContain(NAVIGATION_TODO);
    });

    it('rejects an empty plan', async () => {
      await writePlan({ screens: [] });
      await expect(
        generateFlows(tempRoot, CONFIG, await loadScreenshotPlan(tempRoot)),
      ).rejects.toThrow(/no screens/);
    });
  });

  describe('preflightCapture', () => {
    it('fails when flows were never generated', async () => {
      await expect(preflightCapture(tempRoot)).rejects.toThrow(/screenshots flows/);
    });

    it('lists flows that still contain the navigation TODO', async () => {
      await writePlan(PLAN);
      await generateFlows(tempRoot, CONFIG, await loadScreenshotPlan(tempRoot));
      // developer finished only the first flow
      await writeFile(
        join(tempRoot, FLOWS_DIR, '01-onboarding.yaml'),
        'appId: x\n---\n- launchApp\n- takeScreenshot: out/01\n',
        'utf8',
      );

      const preflight = await preflightCapture(tempRoot);
      expect(preflight.flowFiles).toHaveLength(2);
      expect(preflight.pendingTodos).toEqual([join(FLOWS_DIR, '02-voice-room.yaml')]);
    });
  });

  describe('runCapture', () => {
    it('invokes maestro test on the flows dir, with optional device', async () => {
      const calls: Array<{ command: string; args: string[] }> = [];
      const fakeRunner: CommandRunner = async (command, args) => {
        calls.push({ command, args });
        return 0;
      };
      await runCapture(tempRoot, fakeRunner);
      await runCapture(tempRoot, fakeRunner, { device: 'emulator-5554' });
      expect(calls).toEqual([
        { command: 'maestro', args: ['test', FLOWS_DIR] },
        { command: 'maestro', args: ['test', '--device', 'emulator-5554', FLOWS_DIR] },
      ]);
    });
  });
});
