// doctor rule engine (TRD §7). Fully offline and deterministic — no AI calls.
// Declarative rules come from data/rules/*.yml; checks that need real logic
// (permission quality, consistency) are built-in checkers below.

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import glob from 'fast-glob';
import type { AppshipConfig } from '../config/schema.js';
import type { ScanResult } from '../types.js';
import type { DoctorRule, Store } from './rules.js';

export interface RuleResult {
  id: string;
  store: Store;
  category: string;
  severity: 'error' | 'warning';
  status: 'pass' | 'fail' | 'skip';
  /** Human line for the report: what passed, or what is wrong. */
  message: string;
  detail?: string;
  guideline?: string;
  fixSuggestions?: string[];
}

export interface DoctorContext {
  projectRoot: string;
  config: AppshipConfig;
  scan: ScanResult;
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

function humanize(id: string): string {
  return id.replace(/-/g, ' ').replace(/^./, (c) => c.toUpperCase());
}

/** Scanner/config-derived findings usable in rule `condition:` clauses. */
export function deriveFindings(ctx: DoctorContext): Set<string> {
  const findings = new Set<string>();
  if (
    ctx.config.project.requires_login === true ||
    ctx.scan.sdkReport.sdks.some((s) => s.category === 'auth')
  ) {
    findings.add('login_detected');
  }
  if (ctx.scan.sdkReport.sdks.some((s) => s.category === 'analytics')) {
    findings.add('analytics_detected');
  }
  if (ctx.scan.sdkReport.sdks.some((s) => s.category === 'payments')) {
    findings.add('payments_detected');
  }
  return findings;
}

async function evaluateRule(
  rule: DoctorRule,
  ctx: DoctorContext,
  findings: Set<string>,
): Promise<RuleResult> {
  const base = {
    id: rule.id,
    store: rule.store,
    category: rule.category,
    severity: rule.severity,
    ...(rule.guideline ? { guideline: rule.guideline } : {}),
    ...(rule.fix_suggestions ? { fixSuggestions: rule.fix_suggestions } : {}),
  };
  const pass = (): RuleResult => ({
    ...base,
    status: 'pass',
    message: rule.pass_message ?? humanize(rule.id),
  });
  const fail = (detail?: string): RuleResult => ({
    ...base,
    status: 'fail',
    message: rule.message,
    ...(detail ? { detail } : {}),
  });
  const skip = (why: string): RuleResult => ({ ...base, status: 'skip', message: why });

  if (rule.condition && !findings.has(rule.condition.finding)) {
    return skip(`not applicable (${rule.condition.finding} not found)`);
  }

  const appshipDir = join(ctx.projectRoot, '.appship');

  if (rule.check.type === 'file_exists') {
    const target = join(appshipDir, String(rule.check.value));
    return existsSync(target) ? pass() : fail();
  }

  // Content checks need target files under .appship/
  const targets = rule.target
    ? await glob(rule.target, { cwd: appshipDir })
    : [];
  if (targets.length === 0) {
    return skip('no generated files to check (run appship generate)');
  }

  for (const file of targets) {
    const content = (await readFile(join(appshipDir, file), 'utf8')).trimEnd();
    switch (rule.check.type) {
      case 'max_length':
        if (content.length > Number(rule.check.value)) {
          return fail(`${file}: ${content.length} characters`);
        }
        break;
      case 'not_contains':
        if (content.includes(String(rule.check.value))) {
          return fail(file);
        }
        break;
      case 'no_emoji':
        if (EMOJI_PATTERN.test(content)) {
          return fail(file);
        }
        break;
    }
  }
  return pass();
}

/** Checks too complex for declarative rules (TRD §7.2). */
async function builtInChecks(ctx: DoctorContext, findings: Set<string>): Promise<RuleResult[]> {
  const results: RuleResult[] = [];
  const { config, scan, projectRoot } = ctx;

  const push = (
    store: Store,
    id: string,
    category: RuleResult['category'],
    severity: RuleResult['severity'],
    ok: boolean,
    passMessage: string,
    failMessage: string,
    extra: Partial<RuleResult> = {},
  ) =>
    results.push({
      id,
      store,
      category,
      severity,
      status: ok ? 'pass' : 'fail',
      message: ok ? passMessage : failMessage,
      ...extra,
    });

  // Identity
  push(
    'app-store', 'bundle-id-configured', 'required', 'error',
    scan.project.ios?.bundleId != null,
    'Bundle ID configured', 'iOS bundle ID could not be detected',
  );
  push(
    'google-play', 'package-name-configured', 'required', 'error',
    scan.project.android?.packageName != null,
    'Android package name configured', 'Android package name could not be detected',
  );

  // Required assets / files
  const appIcon = await glob('ios/**/AppIcon.appiconset', {
    cwd: projectRoot, onlyDirectories: true, ignore: ['**/node_modules/**', '**/Pods/**'],
  });
  push(
    'app-store', 'app-icon-present', 'required', 'warning',
    appIcon.length > 0,
    'App icon found', 'App icon (AppIcon.appiconset) not found in the iOS project',
  );
  const privacyManifest = await glob('ios/**/PrivacyInfo.xcprivacy', {
    cwd: projectRoot, ignore: ['**/node_modules/**', '**/Pods/**'],
  });
  push(
    'app-store', 'privacy-manifest-present', 'required', 'warning',
    privacyManifest.length > 0,
    'Privacy manifest found', 'PrivacyInfo.xcprivacy not found — Apple requires a privacy manifest',
  );

  // Config completeness
  for (const store of ['app-store', 'google-play'] as const) {
    push(
      store, 'support-url-configured', 'required', 'error',
      config.project.support_url !== undefined,
      'Support URL configured',
      'Support URL missing — add project.support_url to appship.yml',
    );
    push(
      store, 'description-filled', 'required', 'error',
      !config.project.description.startsWith('[CONFIRM:'),
      'Project description filled in',
      'project.description in appship.yml is still a placeholder',
    );
    push(
      store, 'generated-materials-exist', 'required', 'error',
      existsSync(join(projectRoot, '.appship', store)),
      'Store materials generated',
      `No generated materials for ${store} — run appship generate`,
    );
  }

  // Permission usage description quality (app-store)
  for (const permission of scan.permissions.ios) {
    push(
      'app-store', `permission-quality:${permission.key}`, 'quality', 'warning',
      permission.qualityAssessment === 'ok',
      `${permission.key} usage description looks specific`,
      `${permission.key} usage description ${
        permission.qualityAssessment === 'missing' ? 'is empty' : 'is too generic'
      }: "${permission.currentMessage}"`,
      {
        fixSuggestions: [
          'Describe the concrete user-facing situation, e.g. "Microphone access is used when you join a voice room and speak with other participants."',
        ],
      },
    );
  }

  // Unconfirmed data-collection findings (self-declared forms)
  const unconfirmed = Object.entries(scan.privacyReport.dataCollection)
    .filter(([, e]) => e.requiresConfirmation && e.confirmed === null)
    .map(([t]) => t);
  for (const store of ['app-store', 'google-play'] as const) {
    push(
      store, 'data-collection-confirmed', 'consistency', 'error',
      unconfirmed.length === 0,
      'All detected data collection confirmed',
      `Unconfirmed data-collection detection(s): ${unconfirmed.join(', ')} — run appship generate to confirm`,
    );
  }

  // Privacy policy should mention detected analytics/crash SDKs
  const privacyPolicyPath = join(projectRoot, '.appship/legal/privacy-policy.md');
  if (findings.has('analytics_detected') || scan.sdkReport.sdks.some((s) => s.category === 'crash-reporting')) {
    if (existsSync(privacyPolicyPath)) {
      const policy = await readFile(privacyPolicyPath, 'utf8');
      const missing = scan.sdkReport.sdks
        .filter((s) => s.category === 'analytics' || s.category === 'crash-reporting')
        .filter((s) => !policy.toLowerCase().includes(s.name.toLowerCase()))
        .map((s) => s.name);
      for (const store of ['app-store', 'google-play'] as const) {
        push(
          store, 'privacy-policy-mentions-sdks', 'consistency', 'warning',
          missing.length === 0,
          'Privacy policy mentions detected analytics/crash SDKs',
          `Privacy policy does not mention: ${missing.join(', ')}`,
        );
      }
    }
  }

  return results;
}

export interface StoreReport {
  store: Store;
  score: number;
  results: RuleResult[];
}

function scoreOf(results: RuleResult[]): number {
  const evaluated = results.filter((r) => r.status !== 'skip');
  const weight = (r: RuleResult) => (r.severity === 'error' ? 3 : 1);
  const total = evaluated.reduce((n, r) => n + weight(r), 0);
  if (total === 0) return 100;
  const passed = evaluated
    .filter((r) => r.status === 'pass')
    .reduce((n, r) => n + weight(r), 0);
  return Math.round((100 * passed) / total);
}

export async function runDoctor(
  ctx: DoctorContext,
  rules: DoctorRule[],
  stores: Store[] = ['app-store', 'google-play'],
): Promise<StoreReport[]> {
  const findings = deriveFindings(ctx);
  const declarative = await Promise.all(rules.map((rule) => evaluateRule(rule, ctx, findings)));
  const builtIn = await builtInChecks(ctx, findings);
  const all = [...builtIn, ...declarative];

  return stores.map((store) => {
    const results = all.filter((r) => r.store === store);
    return { store, score: scoreOf(results), results };
  });
}
