import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import {
  generateFlows,
  loadScreenshotPlan,
  preflightCapture,
  runCapture,
  ScreenshotsError,
  FLOWS_DIR,
  RAW_OUTPUT_DIR,
} from '../core/screenshots/index.js';

const execFileAsync = promisify(execFile);

async function hasMaestro(): Promise<boolean> {
  try {
    await execFileAsync('maestro', ['--version']);
    return true;
  } catch {
    return false;
  }
}

function reportAndExit(error: unknown): boolean {
  if (error instanceof ScreenshotsError || error instanceof ConfigError) {
    console.error(pc.red(`✗ ${error.message}`));
    process.exitCode = 1;
    return true;
  }
  return false;
}

const flowsSubcommand = new Command('flows')
  .description('Generate Maestro flow files from the screenshot plan')
  .option('--force', 'overwrite existing flow files (discards your navigation edits)')
  .action(async (options: { force?: boolean }) => {
    const projectRoot = process.cwd();
    try {
      const config = await loadConfig(projectRoot);
      const plan = await loadScreenshotPlan(projectRoot);
      const result = await generateFlows(projectRoot, config, plan, {
        ...(options.force ? { force: true } : {}),
      });

      for (const path of result.written) console.log(`${pc.green('✓')} ${path}`);
      for (const path of result.skipped) {
        console.log(`${pc.dim('•')} ${path} ${pc.dim('(exists — kept; use --force to overwrite)')}`);
      }
      console.log();
      console.log(
        `Next: fill in the navigation TODO in each flow, then run ${pc.cyan('appship screenshots capture')}.`,
      );
    } catch (error) {
      if (!reportAndExit(error)) throw error;
    }
  });

const captureSubcommand = new Command('capture')
  .description('Run the Maestro flows and capture screenshots')
  .option('--device <id>', 'Maestro device id to run on')
  .action(async (options: { device?: string }) => {
    const projectRoot = process.cwd();
    try {
      await loadConfig(projectRoot); // fail early outside an appship project
      const preflight = await preflightCapture(projectRoot);

      if (preflight.pendingTodos.length > 0) {
        console.error(
          pc.red(`✗ ${preflight.pendingTodos.length} flow(s) still contain the navigation TODO:`),
        );
        for (const path of preflight.pendingTodos) console.error(pc.dim(`  - ${path}`));
        console.error('Fill in how to reach each screen, then re-run capture.');
        process.exitCode = 1;
        return;
      }
      if (!(await hasMaestro())) {
        console.error(
          pc.red('✗ maestro not found. ') +
            'Install it: `curl -fsSL "https://get.maestro.mobile.dev" | bash` (see maestro.dev).',
        );
        process.exitCode = 1;
        return;
      }

      console.log(
        `Running ${preflight.flowFiles.length} flow(s) from ${FLOWS_DIR} → ${RAW_OUTPUT_DIR}/ ...`,
      );
      const { spawnRunner } = await import('../core/upload/index.js');
      const exitCode = await runCapture(projectRoot, spawnRunner, {
        ...(options.device ? { device: options.device } : {}),
      });
      if (exitCode === 0) {
        console.log(pc.green(`✓ Screenshots captured into ${RAW_OUTPUT_DIR}/`));
      } else {
        console.error(pc.red(`✗ maestro exited with code ${exitCode}.`));
        process.exitCode = exitCode;
      }
    } catch (error) {
      if (!reportAndExit(error)) throw error;
    }
  });

export const screenshotsCommand = new Command('screenshots')
  .description('Generate Maestro flows and capture store screenshots')
  .addCommand(flowsSubcommand)
  .addCommand(captureSubcommand);
