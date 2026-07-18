import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { scanProject } from '../core/scanner/index.js';
import { mergePreviousConfirmations } from '../core/scanner/confirmations.js';
import { UnsupportedProjectError } from '../core/project/detector.js';
import { loadRules, storeSchema, type Store } from '../core/doctor/rules.js';
import { runDoctor, type StoreReport } from '../core/doctor/engine.js';

const STORE_LABELS: Record<Store, string> = {
  'app-store': 'App Store',
  'google-play': 'Google Play',
};

function renderReport(report: StoreReport): void {
  console.log();
  console.log(pc.bold(`${STORE_LABELS[report.store]} readiness: ${report.score}%`));
  console.log();

  const order = { pass: 0, fail: 1, skip: 2 } as const;
  const sorted = [...report.results].sort(
    (a, b) =>
      order[a.status] - order[b.status] ||
      (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1),
  );

  for (const result of sorted) {
    if (result.status === 'skip') continue;
    const icon =
      result.status === 'pass'
        ? pc.green('✓')
        : result.severity === 'error'
          ? pc.red('✗')
          : pc.yellow('⚠');
    const detail = result.detail ? pc.dim(` (${result.detail})`) : '';
    console.log(`${icon} ${result.message}${detail}`);
    if (result.status === 'fail') {
      if (result.guideline) console.log(pc.dim(`    ${result.guideline}`));
      for (const fix of result.fixSuggestions ?? []) {
        console.log(pc.dim(`    → ${fix}`));
      }
    }
  }

  const skipped = report.results.filter((r) => r.status === 'skip').length;
  if (skipped > 0) {
    console.log(pc.dim(`(${skipped} check(s) skipped — not applicable or nothing generated yet)`));
  }
}

export const doctorCommand = new Command('doctor')
  .description('Check store submission readiness (runs fully offline, no AI calls)')
  .option('--store <store>', 'app-store | google-play (default: both)')
  .option('--json', 'output machine-readable JSON instead of the human report')
  .action(async (options: { store?: string; json?: boolean }) => {
    const projectRoot = process.cwd();

    let stores: Store[] = ['app-store', 'google-play'];
    if (options.store !== undefined) {
      const parsed = storeSchema.safeParse(options.store);
      if (!parsed.success) {
        console.error(pc.red(`✗ Unknown store "${options.store}". Use app-store or google-play.`));
        process.exitCode = 1;
        return;
      }
      stores = [parsed.data];
    }

    let config;
    let scan;
    try {
      config = await loadConfig(projectRoot);
      scan = await scanProject(projectRoot);
    } catch (error) {
      if (error instanceof ConfigError || error instanceof UnsupportedProjectError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }
    await mergePreviousConfirmations(projectRoot, scan);

    const rules = await loadRules();
    const reports = await runDoctor({ projectRoot, config, scan }, rules, stores);

    const machineReport = {
      appshipVersion: scan.project.appshipVersion,
      generatedAt: new Date().toISOString(),
      stores: Object.fromEntries(reports.map((r) => [r.store, { score: r.score, results: r.results }])),
    };
    const checklistDir = join(projectRoot, '.appship', 'checklist');
    await mkdir(checklistDir, { recursive: true });
    await writeFile(
      join(checklistDir, 'release-readiness.json'),
      JSON.stringify(machineReport, null, 2) + '\n',
      'utf8',
    );

    if (options.json) {
      console.log(JSON.stringify(machineReport, null, 2));
    } else {
      for (const report of reports) renderReport(report);
      console.log();
      console.log(pc.dim('Full report written to .appship/checklist/release-readiness.json'));
    }

    const hasErrors = reports.some((r) =>
      r.results.some((result) => result.status === 'fail' && result.severity === 'error'),
    );
    if (hasErrors) process.exitCode = 1;
  });
