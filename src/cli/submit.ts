import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { scanProject } from '../core/scanner/index.js';
import { mergePreviousConfirmations } from '../core/scanner/confirmations.js';
import { UnsupportedProjectError } from '../core/project/detector.js';
import { loadRules, type Store } from '../core/doctor/rules.js';
import { runDoctor } from '../core/doctor/engine.js';
import { resolveFastlaneCommand } from '../core/upload/index.js';
import {
  assertSubmitLane,
  buildSubmitPlan,
  runSubmit,
  SubmitError,
  type SubmitPlatform,
} from '../core/submit/index.js';

const execFileAsync = promisify(execFile);

async function hasGlobalFastlane(): Promise<boolean> {
  try {
    await execFileAsync('fastlane', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const DOCTOR_STORE: Record<SubmitPlatform, Store> = {
  ios: 'app-store',
  android: 'google-play',
};

export const submitCommand = new Command('submit')
  .description('Submit the app for store review via fastlane (confirmation required)')
  .argument('<platform>', 'ios | android')
  .option('--build-number <n>', 'ios: build number to submit (default: latest uploaded)')
  .option('--from-track <track>', 'android: track holding the tested build', 'internal')
  .option('--track <track>', 'android: track to promote into', 'production')
  .option('--force', 'submit even when doctor reports blocking errors')
  .option('--yes', 'skip the confirmation prompt (required in CI)')
  .action(
    async (
      platformArg: string,
      options: {
        buildNumber?: string;
        fromTrack: string;
        track: string;
        force?: boolean;
        yes?: boolean;
      },
    ) => {
      const projectRoot = process.cwd();

      if (platformArg !== 'ios' && platformArg !== 'android') {
        console.error(pc.red(`✗ Unknown platform "${platformArg}". Use ios or android.`));
        process.exitCode = 1;
        return;
      }
      const platform: SubmitPlatform = platformArg;

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

      const platformConfigured =
        platform === 'ios' ? config.platforms.ios !== undefined : config.platforms.android !== undefined;
      if (!platformConfigured) {
        console.error(pc.red(`✗ No ${platform} platform configured in appship.yml.`));
        process.exitCode = 1;
        return;
      }

      // fastlane setup
      try {
        await assertSubmitLane(projectRoot, platform);
      } catch (error) {
        if (error instanceof SubmitError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }
      const fastlane = resolveFastlaneCommand(projectRoot, await hasGlobalFastlane());
      if (!fastlane) {
        console.error(
          pc.red('✗ fastlane not found. ') +
            'Install it (`brew install fastlane` or `gem install fastlane`), or add it to your Gemfile.',
        );
        process.exitCode = 1;
        return;
      }

      // Preflight: doctor for this store. Submission is the irreversible step,
      // so blocking errors stop it unless --force.
      await mergePreviousConfirmations(projectRoot, scan);
      const store = DOCTOR_STORE[platform];
      const [report] = await runDoctor({ projectRoot, config, scan }, await loadRules(), [store]);
      const blocking = report!.results.filter(
        (r) => r.status === 'fail' && r.severity === 'error',
      );
      const warnings = report!.results.filter(
        (r) => r.status === 'fail' && r.severity === 'warning',
      );
      console.log(
        `Doctor:      ${report!.score}% ready` +
          (warnings.length > 0 ? pc.yellow(` (${warnings.length} warning(s))`) : ''),
      );
      if (blocking.length > 0) {
        console.log();
        for (const result of blocking) {
          console.log(`${pc.red('✗')} ${result.message}`);
        }
        console.log();
        if (!options.force) {
          console.error(
            pc.red(`✗ ${blocking.length} blocking error(s). `) +
              'Fix them (see `appship doctor`) or pass --force to submit anyway.',
          );
          process.exitCode = 1;
          return;
        }
        console.log(pc.yellow('⚠ Continuing despite blocking errors (--force).'));
        console.log();
      }

      const plan = buildSubmitPlan(platform, options);

      console.log(`App:         ${config.project.name}`);
      console.log(
        `Identifier:  ${platform === 'ios' ? config.platforms.ios!.bundle_id : config.platforms.android!.package_name}`,
      );
      console.log(`Destination: ${plan.destination}`);
      for (const [label, value] of plan.details) {
        console.log(`${(label + ':').padEnd(13)}${value}`);
      }
      console.log(
        `Command:     ${fastlane.command} ${[...fastlane.prefixArgs, ...plan.fastlaneArgs].join(' ')}`,
      );
      console.log();

      if (!options.yes) {
        if (!process.stdout.isTTY) {
          console.error(pc.red('✗ Refusing to submit without confirmation. Pass --yes in CI.'));
          process.exitCode = 1;
          return;
        }
        const proceed = await p.confirm({
          message: `Submit ${config.project.name} for review? This starts a store review.`,
          initialValue: false,
        });
        if (p.isCancel(proceed) || !proceed) {
          console.log(pc.yellow('Cancelled — nothing was submitted.'));
          process.exitCode = 1;
          return;
        }
      }

      const exitCode = await runSubmit(projectRoot, fastlane, plan);
      if (exitCode === 0) {
        console.log(pc.green(`✓ Submitted (${plan.destination}).`));
      } else {
        console.error(pc.red(`✗ fastlane exited with code ${exitCode}.`));
        process.exitCode = exitCode;
      }
    },
  );
