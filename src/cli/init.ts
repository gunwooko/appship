import { Command } from 'commander';
import pc from 'picocolors';

export const initCommand = new Command('init')
  .description('Analyze the project and create appship.yml and the .appship/ folder')
  .option('--force', 'ignore existing appship.yml and re-initialize')
  .option('--non-interactive', 'skip interactive questions (unconfirmed findings are left for doctor)')
  .action(async () => {
    console.log(pc.yellow('appship init is not implemented yet.'));
    console.log('Planned: detect project → scan permissions/SDKs → ask questions → write appship.yml + .appship/analysis/');
    process.exitCode = 1;
  });
