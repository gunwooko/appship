import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parse as parseYaml } from 'yaml';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appshipConfigSchema, type AppshipConfig } from '../config/schema.js';
import {
  CIExportError,
  exportCI,
  readinessWorkflowContent,
  releaseWorkflowContent,
} from './index.js';

const BOTH: AppshipConfig = appshipConfigSchema.parse({
  project: { name: 'App', description: 'x' },
  platforms: {
    ios: { bundle_id: 'com.example.app' },
    android: { package_name: 'com.example.app' },
  },
  stores: {},
});

const ANDROID_ONLY: AppshipConfig = appshipConfigSchema.parse({
  project: { name: 'App', description: 'x' },
  platforms: { android: { package_name: 'com.example.app' } },
  stores: {},
});

describe('workflow contents', () => {
  it('readiness workflow is valid YAML and gates on doctor', () => {
    const parsed = parseYaml(readinessWorkflowContent()) as Record<string, unknown>;
    expect(parsed.name).toBe('Release readiness');
    expect(JSON.stringify(parsed)).toContain('npx appship doctor');
  });

  it('release workflow is valid YAML with jobs for both platforms', () => {
    const content = releaseWorkflowContent(BOTH, {});
    const parsed = parseYaml(content) as {
      jobs: Record<string, unknown>;
      on: { workflow_dispatch: { inputs: { platform: { options: string[] } } } };
    };
    expect(Object.keys(parsed.jobs)).toEqual(['android', 'ios']);
    expect(parsed.on.workflow_dispatch.inputs.platform.options).toEqual(['ios', 'android', 'both']);
    expect(content).toContain('appship upload android --track');
    expect(content).toContain('appship submit ios --yes');
    expect(content).toContain('TODO(appship)');
    expect(content).toContain('SUPPLY_JSON_KEY_DATA');
    expect(content).toContain('APP_STORE_CONNECT_API_KEY_KEY_ID');
  });

  it('omits unconfigured platforms and offers only real choices', () => {
    const content = releaseWorkflowContent(ANDROID_ONLY, {});
    const parsed = parseYaml(content) as {
      jobs: Record<string, unknown>;
      on: { workflow_dispatch: { inputs: { platform: { options: string[] } } } };
    };
    expect(Object.keys(parsed.jobs)).toEqual(['android']);
    expect(parsed.on.workflow_dispatch.inputs.platform.options).toEqual(['android']);
  });

  it('suggests an Expo-aware android build step', () => {
    expect(releaseWorkflowContent(BOTH, { isExpo: true })).toContain('expo prebuild');
    expect(releaseWorkflowContent(BOTH, {})).not.toContain('expo prebuild');
  });
});

describe('exportCI', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-ci-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes both workflows under .github/workflows/', async () => {
    const result = await exportCI(tempRoot, BOTH);
    expect(result.written).toEqual([
      join('.github', 'workflows', 'appship-readiness.yml'),
      join('.github', 'workflows', 'appship-release.yml'),
    ]);
    expect(existsSync(join(tempRoot, '.github/workflows/appship-release.yml'))).toBe(true);
  });

  it('never clobbers existing workflows without force', async () => {
    await mkdir(join(tempRoot, '.github/workflows'), { recursive: true });
    await writeFile(join(tempRoot, '.github/workflows/appship-release.yml'), '# mine\n');

    const result = await exportCI(tempRoot, BOTH);
    expect(result.skipped).toEqual([join('.github', 'workflows', 'appship-release.yml')]);
    expect(await readFile(join(tempRoot, '.github/workflows/appship-release.yml'), 'utf8')).toBe(
      '# mine\n',
    );

    const forced = await exportCI(tempRoot, BOTH, { force: true });
    expect(forced.skipped).toEqual([]);
  });

  it('fails when the target excludes every configured platform', async () => {
    await expect(exportCI(tempRoot, ANDROID_ONLY, { target: 'ios' })).rejects.toThrow(
      CIExportError,
    );
  });
});
