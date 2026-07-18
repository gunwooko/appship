import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { loadConfig, ConfigError } from '../core/config/load.js';
import {
  assertUploadLane,
  buildUploadPlan,
  findArtifact,
  resolveFastlaneCommand,
  runUpload,
  UploadError,
  type UploadPlatform,
} from '../core/upload/index.js';

const execFileAsync = promisify(execFile);

async function hasGlobalFastlane(): Promise<boolean> {
  try {
    await execFileAsync('fastlane', ['--version']);
    return true;
  } catch {
    return false;
  }
}

const BUILD_HINTS: Record<UploadPlatform, string> = {
  ios: 'Build an .ipa first (e.g. `eas build -p ios`, Xcode archive, or `fastlane gym`).',
  android:
    'Build an .aab first (e.g. `cd android && ./gradlew bundleRelease` or `eas build -p android`).',
};

export const uploadCommand = new Command('upload')
  .description('Upload a built binary to a test track via fastlane (TestFlight / Play internal)')
  .argument('<platform>', 'ios | android')
  .option('--ipa <path>', 'path to the .ipa (ios; default: newest found in the project)')
  .option('--aab <path>', 'path to the .aab (android; default: newest found in the project)')
  .option('--track <track>', 'Play track for android uploads', 'internal')
  .option('--testflight', 'upload iOS build to TestFlight (default and only destination)')
  .option('--yes', 'skip the confirmation prompt (required in CI)')
  .action(
    async (
      platformArg: string,
      options: { ipa?: string; aab?: string; track: string; testflight?: boolean; yes?: boolean },
    ) => {
      const projectRoot = process.cwd();

      if (platformArg !== 'ios' && platformArg !== 'android') {
        console.error(pc.red(`✗ Unknown platform "${platformArg}". Use ios or android.`));
        process.exitCode = 1;
        return;
      }
      const platform: UploadPlatform = platformArg;

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

      const platformConfigured =
        platform === 'ios' ? config.platforms.ios !== undefined : config.platforms.android !== undefined;
      if (!platformConfigured) {
        console.error(pc.red(`✗ No ${platform} platform configured in appship.yml.`));
        process.exitCode = 1;
        return;
      }

      // Artifact
      const explicit = platform === 'ios' ? options.ipa : options.aab;
      let artifact = explicit ?? (await findArtifact(projectRoot, platform));
      if (explicit && !existsSync(join(projectRoot, explicit)) && !existsSync(explicit)) {
        console.error(pc.red(`✗ Artifact not found: ${explicit}`));
        process.exitCode = 1;
        return;
      }
      if (!artifact) {
        console.error(
          pc.red(`✗ No ${platform === 'ios' ? '.ipa' : '.aab'} found in the project. `) +
            BUILD_HINTS[platform],
        );
        process.exitCode = 1;
        return;
      }

      // fastlane setup
      try {
        await assertUploadLane(projectRoot, platform);
      } catch (error) {
        if (error instanceof UploadError) {
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

      const plan = buildUploadPlan(platform, artifact, options.track);

      console.log(`App:         ${config.project.name}`);
      console.log(
        `Identifier:  ${platform === 'ios' ? config.platforms.ios!.bundle_id : config.platforms.android!.package_name}`,
      );
      console.log(`Artifact:    ${plan.artifact}`);
      console.log(`Destination: ${plan.destination}`);
      console.log(
        `Command:     ${fastlane.command} ${[...fastlane.prefixArgs, ...plan.fastlaneArgs].join(' ')}`,
      );
      console.log();

      if (!options.yes) {
        if (!process.stdout.isTTY) {
          console.error(pc.red('✗ Refusing to upload without confirmation. Pass --yes in CI.'));
          process.exitCode = 1;
          return;
        }
        const proceed = await p.confirm({ message: 'Proceed with the upload?', initialValue: false });
        if (p.isCancel(proceed) || !proceed) {
          console.log(pc.yellow('Cancelled — nothing was uploaded.'));
          process.exitCode = 1;
          return;
        }
      }

      const exitCode = await runUpload(projectRoot, fastlane, plan);
      if (exitCode === 0) {
        console.log(pc.green(`✓ Upload finished (${plan.destination}).`));
      } else {
        console.error(pc.red(`✗ fastlane exited with code ${exitCode}.`));
        process.exitCode = exitCode;
      }
    },
  );
