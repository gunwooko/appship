import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { exportFastlane, FastlaneExportError } from '../core/fastlane/index.js';
import { exportCI, CIExportError } from '../core/ci/index.js';
import { readExpoConfig } from '../core/project/expo.js';
import type { GenerateTarget } from '../core/generate/index.js';

export const exportCommand = new Command('export')
  .description('Export prepared materials for external tools')
  .argument('<format>', 'export format: fastlane | ci')
  .option('--target <target>', 'ios | android (default: both)')
  .option('--force', 'overwrite existing exported scaffolding files')
  .action(async (format: string, options: { target?: string; force?: boolean }) => {
    const projectRoot = process.cwd();

    if (format !== 'fastlane' && format !== 'ci') {
      console.error(pc.red(`✗ Unknown export format "${format}". Supported: fastlane, ci.`));
      process.exitCode = 1;
      return;
    }

    let target: GenerateTarget | undefined;
    if (options.target === 'ios' || options.target === 'android') target = options.target;
    else if (options.target !== undefined) {
      console.error(pc.red(`✗ Unknown target "${options.target}". Use ios or android.`));
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

    let result;
    try {
      if (format === 'fastlane') {
        result = await exportFastlane(projectRoot, config, {
          ...(target ? { target } : {}),
          ...(options.force ? { force: true } : {}),
        });
      } else {
        const isExpo = (await readExpoConfig(projectRoot)) !== null;
        result = await exportCI(projectRoot, config, {
          ...(target ? { target } : {}),
          ...(options.force ? { force: true } : {}),
          isExpo,
        });
      }
    } catch (error) {
      if (error instanceof FastlaneExportError || error instanceof CIExportError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    for (const path of result.written) {
      console.log(`${pc.green('✓')} ${path}`);
    }
    for (const path of result.skipped) {
      console.log(`${pc.dim('•')} ${path} ${pc.dim('(exists — kept; use --force to overwrite)')}`);
    }

    console.log();
    console.log('Next steps:');
    if (format === 'fastlane') {
      if (config.platforms.ios && target !== 'android') {
        console.log(`  ${pc.cyan('bundle exec fastlane ios upload_metadata')}   # App Store Connect`);
      }
      if (config.platforms.android && target !== 'ios') {
        console.log(`  ${pc.cyan('bundle exec fastlane android upload_metadata')} # Play Console`);
      }
      console.log(pc.dim('  (requires fastlane auth: App Store Connect API key / Play service account)'));
    } else {
      console.log('  1. Search the workflows for TODO(appship) and finish the build steps.');
      console.log(
        '  2. Add repository secrets: ' +
          [
            config.platforms.android && target !== 'ios' ? 'PLAY_SERVICE_ACCOUNT_JSON' : null,
            config.platforms.ios && target !== 'android' ? 'ASC_KEY_ID, ASC_ISSUER_ID, ASC_KEY_CONTENT' : null,
          ]
            .filter(Boolean)
            .join(' / '),
      );
      console.log('  3. Run the "Release" workflow from the Actions tab (workflow_dispatch).');
    }
  });
