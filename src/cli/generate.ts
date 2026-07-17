import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { scanProject } from '../core/scanner/index.js';
import { UnsupportedProjectError } from '../core/project/detector.js';
import { createProvider, AIProviderError } from '../core/ai/index.js';
import { planArtifacts, runGenerate, type GenerateTarget } from '../core/generate/index.js';
import type { ScanResult } from '../core/types.js';

const PRIVACY_REPORT_PATH = '.appship/analysis/privacy-report.json';

/** Carry over confirmations from a previous run so re-scans don't lose them. */
async function mergePreviousConfirmations(projectRoot: string, scan: ScanResult): Promise<void> {
  try {
    const raw = await readFile(join(projectRoot, PRIVACY_REPORT_PATH), 'utf8');
    const previous = JSON.parse(raw) as ScanResult['privacyReport'];
    for (const [dataType, entry] of Object.entries(previous.dataCollection ?? {})) {
      const current = scan.privacyReport.dataCollection[dataType];
      if (current && entry.confirmed !== null && entry.confirmed !== undefined) {
        current.confirmed = entry.confirmed;
      }
    }
  } catch {
    // no previous report — nothing to merge
  }
}

async function confirmFindings(scan: ScanResult, interactive: boolean): Promise<boolean> {
  const pending = Object.entries(scan.privacyReport.dataCollection).filter(
    ([, entry]) => entry.requiresConfirmation && entry.confirmed === null,
  );
  if (pending.length === 0) return true;

  if (!interactive) {
    console.log(
      pc.yellow('⚠') +
        ` ${pending.length} detection(s) need your confirmation (${pending
          .map(([t]) => t)
          .join(', ')}). Generated privacy docs will carry confirm markers.`,
    );
    return true;
  }

  for (const [dataType, entry] of pending) {
    console.log();
    console.log(pc.yellow('⚠') + ` ${dataType} collection detected. Evidence:`);
    for (const ev of entry.evidence) console.log(pc.dim(`  - ${ev}`));
    const answer = await p.confirm({
      message: `Does the app collect "${dataType}" as detected?`,
      initialValue: true,
    });
    if (p.isCancel(answer)) return false;
    entry.confirmed = answer;
  }
  return true;
}

export const generateCommand = new Command('generate')
  .description('Generate store metadata, privacy documents, and checklists into .appship/')
  .argument('[target]', 'ios | android (default: both)')
  .option('--locale <locale>', 'generate only for the given locale')
  .option('--dry-run', 'list what would be generated without calling AI or writing files')
  .option('--yes', 'overwrite existing generated files without asking')
  .action(
    async (
      targetArg: string | undefined,
      options: { locale?: string; dryRun?: boolean; yes?: boolean },
    ) => {
      const projectRoot = process.cwd();

      let target: GenerateTarget | undefined;
      if (targetArg === 'ios' || targetArg === 'android') target = targetArg;
      else if (targetArg !== undefined && targetArg !== 'metadata') {
        console.error(pc.red(`✗ Unknown target "${targetArg}". Use ios, android, or omit.`));
        process.exitCode = 1;
        return;
      }

      let config;
      try {
        config = await loadConfig(projectRoot);
      } catch (error) {
        if (error instanceof ConfigError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      if (config.project.description.startsWith('[CONFIRM:')) {
        console.error(
          pc.red('✗ project.description in appship.yml is still a placeholder. ') +
            'Fill it in (or re-run `appship init`) before generating.',
        );
        process.exitCode = 1;
        return;
      }

      const generateOptions = {
        ...(target ? { target } : {}),
        ...(options.locale ? { locales: [options.locale] } : {}),
      };

      if (options.dryRun) {
        console.log(pc.bold('Would generate (no AI calls, no writes):'));
        for (const path of planArtifacts(config, generateOptions)) {
          console.log(`  ${path}`);
        }
        return;
      }

      let scan: ScanResult;
      try {
        scan = await scanProject(projectRoot);
      } catch (error) {
        if (error instanceof UnsupportedProjectError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      await mergePreviousConfirmations(projectRoot, scan);

      const interactive = Boolean(process.stdout.isTTY);
      if (!(await confirmFindings(scan, interactive))) {
        console.log(pc.yellow('Cancelled — nothing was generated.'));
        process.exitCode = 1;
        return;
      }

      // Overwrite guard: protect manually edited outputs
      const existing = planArtifacts(config, generateOptions).filter((path) =>
        existsSync(join(projectRoot, path)),
      );
      if (existing.length > 0 && !options.yes && interactive) {
        const overwrite = await p.confirm({
          message: `${existing.length} generated file(s) already exist and will be overwritten. Continue?`,
          initialValue: true,
        });
        if (p.isCancel(overwrite) || !overwrite) {
          console.log(pc.yellow('Cancelled — nothing was generated.'));
          process.exitCode = 1;
          return;
        }
      }

      let provider;
      try {
        provider = createProvider(config);
      } catch (error) {
        if (error instanceof AIProviderError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      console.log(
        `Generating with ${pc.cyan(provider.name)} for locales: ${(generateOptions.locales ?? config.stores.locales).join(', ')} ...`,
      );

      let result;
      try {
        result = await runGenerate(projectRoot, config, scan, provider, generateOptions);
      } catch (error) {
        if (error instanceof AIProviderError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      // Persist confirmations gathered above
      await writeFile(
        join(projectRoot, PRIVACY_REPORT_PATH),
        JSON.stringify(scan.privacyReport, null, 2) + '\n',
        'utf8',
      );

      console.log();
      for (const file of result.files) {
        const marker =
          file.violations.length > 0 ? pc.yellow('⚠') : pc.green('✓');
        console.log(`${marker} ${file.path}`);
        for (const violation of file.violations) {
          console.log(pc.yellow(`    VALIDATION: ${violation.message}`));
        }
      }
      const violationCount = result.files.reduce((n, f) => n + f.violations.length, 0);
      console.log();
      if (violationCount > 0) {
        console.log(
          pc.yellow(`⚠ ${violationCount} constraint violation(s) remain after retries — fix manually.`),
        );
      }
      console.log(`Next: run ${pc.cyan('appship doctor')} to check submission readiness.`);
    },
  );
