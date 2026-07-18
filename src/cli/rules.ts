import { Command } from 'commander';
import pc from 'picocolors';
import {
  dataCacheDir,
  readCacheMeta,
  resetRules,
  updateRules,
  RulesUpdateError,
} from '../core/rules-update/index.js';

const updateSubcommand = new Command('update')
  .description('Download the latest doctor rules and SDK signatures (no new CLI release needed)')
  .option('--source <url>', 'base URL to download the data/ files from')
  .action(async (options: { source?: string }) => {
    let result;
    try {
      result = await updateRules(options.source ? { source: options.source } : {});
    } catch (error) {
      if (error instanceof RulesUpdateError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    for (const file of result.files) {
      const marker = file.changed ? pc.green('✓') : pc.dim('•');
      const note = file.changed ? 'updated' : 'already up to date';
      console.log(`${marker} ${file.path} ${pc.dim(`(${file.entries} entries, ${note})`)}`);
    }
    console.log();
    console.log(
      pc.dim(`Cached in ${result.cacheDir} — doctor and the scanner now prefer these files.`),
    );
  });

const statusSubcommand = new Command('status')
  .description('Show whether bundled or updated rules are in use')
  .action(async () => {
    const meta = await readCacheMeta();
    if (!meta) {
      console.log('Using the rules and SDK signatures bundled with this appship version.');
      console.log(pc.dim('Run `appship rules update` to fetch the latest.'));
      return;
    }
    console.log(`Using updated rules from ${meta.source}`);
    console.log(`Fetched:  ${meta.updatedAt}`);
    console.log(`Cache:    ${dataCacheDir()}`);
    console.log(pc.dim('Run `appship rules reset` to go back to the bundled rules.'));
  });

const resetSubcommand = new Command('reset')
  .description('Delete the downloaded rules cache and return to the bundled rules')
  .action(async () => {
    const removed = await resetRules();
    if (removed) {
      console.log(pc.green('✓') + ' Cache removed — bundled rules are in use again.');
    } else {
      console.log('No rules cache to remove — bundled rules are already in use.');
    }
  });

export const rulesCommand = new Command('rules')
  .description('Manage the store policy rules and SDK signature database')
  .addCommand(updateSubcommand)
  .addCommand(statusSubcommand)
  .addCommand(resetSubcommand);
