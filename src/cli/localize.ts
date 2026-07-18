import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { createProvider, AIProviderError } from '../core/ai/index.js';
import {
  planLocalize,
  runLocalize,
  LocalizeError,
} from '../core/localize/index.js';
import type { GenerateTarget } from '../core/generate/index.js';

export const localizeCommand = new Command('localize')
  .description('Translate generated store listings into additional locales')
  .argument('[locales...]', 'target locales, e.g. ko-KR ja-JP (default: appship.yml stores.locales)')
  .option('--source <locale>', 'source locale to translate from (default: stores.default_locale)')
  .option('--target <target>', 'ios | android (default: both stores)')
  .option('--dry-run', 'list what would be localized without calling AI or writing files')
  .action(
    async (
      localeArgs: string[],
      options: { source?: string; target?: string; dryRun?: boolean },
    ) => {
      const projectRoot = process.cwd();

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

      const sourceLocale = options.source ?? config.stores.default_locale;
      const targetLocales = (
        localeArgs.length > 0 ? localeArgs : config.stores.locales
      ).filter((locale) => locale !== sourceLocale);

      if (targetLocales.length === 0) {
        console.error(
          pc.red('✗ No target locales. Pass them as arguments (e.g. `appship localize ko-KR ja-JP`) ') +
            'or add them to stores.locales in appship.yml.',
        );
        process.exitCode = 1;
        return;
      }

      const localizeOptions = {
        targetLocales,
        sourceLocale,
        ...(target ? { target } : {}),
      };

      if (options.dryRun) {
        console.log(pc.bold(`Would localize ${sourceLocale} → ${targetLocales.join(', ')} (no AI calls, no writes):`));
        for (const path of planLocalize(localizeOptions)) {
          console.log(`  ${path}`);
        }
        return;
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
        `Localizing ${pc.cyan(sourceLocale)} → ${pc.cyan(targetLocales.join(', '))} with ${provider.name} ...`,
      );

      let result;
      try {
        result = await runLocalize(projectRoot, config, provider, localizeOptions);
      } catch (error) {
        if (error instanceof LocalizeError || error instanceof AIProviderError) {
          console.error(pc.red(`✗ ${error.message}`));
          process.exitCode = 1;
          return;
        }
        throw error;
      }

      console.log();
      for (const file of result.files) {
        const marker = file.violations.length > 0 ? pc.yellow('⚠') : pc.green('✓');
        console.log(`${marker} ${file.path}`);
        for (const violation of file.violations) {
          console.log(pc.yellow(`    VALIDATION: ${violation.message}`));
        }
      }

      const missingFromConfig = targetLocales.filter(
        (locale) => !config.stores.locales.includes(locale),
      );
      if (missingFromConfig.length > 0) {
        console.log();
        console.log(
          pc.yellow('⚠') +
            ` Add ${missingFromConfig.join(', ')} to stores.locales in appship.yml so ` +
            'generate and doctor include them.',
        );
      }
    },
  );
