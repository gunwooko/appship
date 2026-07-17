import { cp, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanProject } from '../scanner/index.js';
import { loadConfig } from '../config/load.js';
import {
  buildConfig,
  defaultAnswers,
  runInit,
  DESCRIPTION_PLACEHOLDER,
  type InitAnswers,
} from './init.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/rn-voice-app');

const ANSWERS: InitAnswers = {
  description: 'A language learning app with real-time voice rooms.',
  audience: ['language learners'],
  requiresLogin: true,
  collectsPersonalData: true,
  countries: ['US', 'KR'],
  locales: ['en-US', 'ko-KR'],
};

describe('buildConfig', () => {
  it('builds a schema-valid config from scan results and answers', async () => {
    const scan = await scanProject(FIXTURE);
    const config = buildConfig(scan, ANSWERS);
    expect(config.project.name).toBe('RN Voice App');
    expect(config.platforms.ios?.bundle_id).toBe('com.example.rnvoiceapp');
    expect(config.platforms.android?.package_name).toBe('com.example.rnvoiceapp');
    expect(config.stores.default_locale).toBe('en-US');
    expect(config.stores.locales).toEqual(['en-US', 'ko-KR']);
    expect(config.project.requires_login).toBe(true);
  });

  it('uses a [CONFIRM] placeholder and suggests data collection in defaults', async () => {
    const scan = await scanProject(FIXTURE);
    const defaults = defaultAnswers(scan);
    expect(defaults.description).toBe(DESCRIPTION_PLACEHOLDER);
    // fixture contains Firebase Analytics + location, so suggest true
    expect(defaults.collectsPersonalData).toBe(true);
    const config = buildConfig(scan, defaults);
    expect(config.project.description).toBe(DESCRIPTION_PLACEHOLDER);
  });
});

describe('runInit', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-init-'));
    await cp(FIXTURE, tempRoot, { recursive: true });
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('writes appship.yml and all four analysis files', async () => {
    const scan = await scanProject(tempRoot);
    const result = await runInit(tempRoot, scan, ANSWERS);

    const reloaded = await loadConfig(tempRoot);
    expect(reloaded.project.description).toBe(ANSWERS.description);
    expect(reloaded.stores.countries).toEqual(['US', 'KR']);

    expect(result.analysisPaths).toHaveLength(4);
    const sdkReport = JSON.parse(
      await readFile(join(tempRoot, '.appship/analysis/sdk-report.json'), 'utf8'),
    );
    expect(sdkReport.sdks.map((s: { id: string }) => s.id)).toContain('firebase-analytics');

    const privacyReport = JSON.parse(
      await readFile(join(tempRoot, '.appship/analysis/privacy-report.json'), 'utf8'),
    );
    expect(privacyReport.dataCollection.location.requiresConfirmation).toBe(true);
  });

  it('is idempotent — re-running overwrites cleanly', async () => {
    const scan = await scanProject(tempRoot);
    await runInit(tempRoot, scan, ANSWERS);
    const second = await runInit(tempRoot, scan, {
      ...ANSWERS,
      description: 'Updated description.',
    });
    expect(second.config.project.description).toBe('Updated description.');
    const reloaded = await loadConfig(tempRoot);
    expect(reloaded.project.description).toBe('Updated description.');
  });
});
