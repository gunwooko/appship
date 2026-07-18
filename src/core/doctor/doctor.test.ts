import { cp, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { scanProject } from '../scanner/index.js';
import { buildConfig, type InitAnswers } from '../init/init.js';
import { loadRules } from './rules.js';
import { runDoctor, deriveFindings, type StoreReport } from './engine.js';
import type { AppshipConfig } from '../config/schema.js';
import type { ScanResult } from '../types.js';

const FIXTURE = join(dirname(fileURLToPath(import.meta.url)), '../../../fixtures/rn-voice-app');

const ANSWERS: InitAnswers = {
  description: 'A language learning app with real-time voice rooms.',
  audience: ['language learners'],
  requiresLogin: true,
  collectsPersonalData: true,
  countries: [],
  locales: ['en-US'],
};

function resultOf(report: StoreReport, id: string) {
  return report.results.find((r) => r.id === id);
}

describe('loadRules', () => {
  it('loads and validates the bundled rule files', async () => {
    const rules = await loadRules();
    expect(rules.length).toBeGreaterThanOrEqual(10);
    const accountDeletion = rules.find((r) => r.id === 'account-deletion-required');
    expect(accountDeletion?.condition?.finding).toBe('login_detected');
    expect(accountDeletion?.guideline).toContain('5.1.1');
  });
});

describe('runDoctor', () => {
  let tempRoot: string;
  let scan: ScanResult;
  let config: AppshipConfig;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-doctor-'));
    await cp(FIXTURE, tempRoot, { recursive: true });
    scan = await scanProject(tempRoot);
    config = buildConfig(scan, ANSWERS);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  async function writeAppshipFile(relPath: string, content: string): Promise<void> {
    const absolute = join(tempRoot, '.appship', relPath);
    await mkdir(dirname(absolute), { recursive: true });
    await writeFile(absolute, content, 'utf8');
  }

  it('derives findings from config and scan', () => {
    const findings = deriveFindings({ projectRoot: tempRoot, config, scan });
    expect(findings.has('login_detected')).toBe(true); // requires_login: true
    expect(findings.has('analytics_detected')).toBe(true); // firebase-analytics
    expect(findings.has('payments_detected')).toBe(false);
  });

  it('reports missing generated materials, support URL, and generic permission text', async () => {
    const rules = await loadRules();
    const [appStore] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);

    expect(resultOf(appStore!, 'generated-materials-exist')?.status).toBe('fail');
    expect(resultOf(appStore!, 'support-url-configured')?.status).toBe('fail');
    expect(resultOf(appStore!, 'bundle-id-configured')?.status).toBe('pass');
    // fixture microphone message is generic → quality warning
    const mic = resultOf(appStore!, 'permission-quality:NSMicrophoneUsageDescription');
    expect(mic?.status).toBe('fail');
    expect(mic?.severity).toBe('warning');
    // location message is specific → pass
    const location = resultOf(appStore!, 'permission-quality:NSLocationWhenInUseUsageDescription');
    expect(location?.status).toBe('pass');
  });

  it('fails length and placeholder rules against generated files', async () => {
    await writeAppshipFile('app-store/en-US/name.txt', 'A'.repeat(31) + '\n');
    await writeAppshipFile('legal/privacy-policy.md', '# Policy\n\n[CONFIRM: contact email]\n');
    const rules = await loadRules();
    const [appStore] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);

    const nameRule = resultOf(appStore!, 'apple-name-length');
    expect(nameRule?.status).toBe('fail');
    expect(nameRule?.detail).toContain('31');
    expect(resultOf(appStore!, 'unresolved-confirm-placeholders')?.status).toBe('fail');
  });

  it('checks account deletion only when login is detected (Guideline 5.1.1)', async () => {
    const rules = await loadRules();
    const [withLogin] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);
    expect(resultOf(withLogin!, 'account-deletion-required')?.status).toBe('fail');

    await writeAppshipFile('legal/account-deletion.md', '# Account deletion\n');
    const [resolved] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);
    expect(resultOf(resolved!, 'account-deletion-required')?.status).toBe('pass');

    const noLoginConfig = buildConfig(scan, { ...ANSWERS, requiresLogin: false });
    const [noLogin] = await runDoctor(
      { projectRoot: tempRoot, config: noLoginConfig, scan },
      rules,
      ['app-store'],
    );
    expect(resultOf(noLogin!, 'account-deletion-required')?.status).toBe('skip');
  });

  it('flags a privacy policy that does not mention detected SDKs', async () => {
    await writeAppshipFile('legal/privacy-policy.md', '# Policy\n\nWe respect privacy.\n');
    const rules = await loadRules();
    const [appStore] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);
    const mention = resultOf(appStore!, 'privacy-policy-mentions-sdks');
    expect(mention?.status).toBe('fail');
    expect(mention?.message).toContain('Firebase Analytics');
    expect(mention?.message).toContain('Sentry');
  });

  it('flags unconfirmed data collection and clears after confirmation', async () => {
    const rules = await loadRules();
    const [before] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['google-play']);
    expect(resultOf(before!, 'data-collection-confirmed')?.status).toBe('fail');

    scan.privacyReport.dataCollection['location']!.confirmed = true;
    const [after] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['google-play']);
    expect(resultOf(after!, 'data-collection-confirmed')?.status).toBe('pass');
  });

  it('computes a weighted score (error=3, warning=1) over evaluated checks', async () => {
    const rules = await loadRules();
    const [report] = await runDoctor({ projectRoot: tempRoot, config, scan }, rules, ['app-store']);
    const evaluated = report!.results.filter((r) => r.status !== 'skip');
    const weight = (severity: string) => (severity === 'error' ? 3 : 1);
    const total = evaluated.reduce((n, r) => n + weight(r.severity), 0);
    const passed = evaluated
      .filter((r) => r.status === 'pass')
      .reduce((n, r) => n + weight(r.severity), 0);
    expect(report!.score).toBe(Math.round((100 * passed) / total));
    expect(report!.score).toBeGreaterThan(0);
    expect(report!.score).toBeLessThan(100);
  });
});
