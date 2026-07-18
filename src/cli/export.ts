import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { exportFastlane, FastlaneExportError } from '../core/fastlane/index.js';
import type { GenerateTarget } from '../core/generate/index.js';

export const exportCommand = new Command('export')
  .description('Export prepared materials for external tools')
  .argument('<format>', 'export format (currently: fastlane)')
  .option('--target <target>', 'ios | android (default: both)')
  .option('--force', 'overwrite existing fastlane/Appfile and Fastfile')
  .action(async (format: string, options: { target?: string; force?: boolean }) => {
    const projectRoot = process.cwd();

    if (format !== 'fastlane') {
      console.error(pc.red(`✗ Unknown export format "${format}". Supported: fastlane.`));
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
      result = await exportFastlane(projectRoot, config, {
        ...(target ? { target } : {}),
        ...(options.force ? { force: true } : {}),
      });
    } catch (error) {
      if (error instanceof FastlaneExportError) {
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
    if (config.platforms.ios && target !== 'android') {
      console.log(`  ${pc.cyan('bundle exec fastlane ios upload_metadata')}   # App Store Connect`);
    }
    if (config.platforms.android && target !== 'ios') {
      console.log(`  ${pc.cyan('bundle exec fastlane android upload_metadata')} # Play Console`);
    }
    console.log(pc.dim('  (requires fastlane auth: App Store Connect API key / Play service account)'));
  });
