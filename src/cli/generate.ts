import { Command } from 'commander';
import pc from 'picocolors';

export const generateCommand = new Command('generate')
  .description('Generate store metadata, privacy documents, and checklists into .appship/')
  .argument('[target]', 'ios | android | metadata (default: all)')
  .option('--locale <locale>', 'generate only for the given locale')
  .option('--dry-run', 'preview generated content without writing files')
  .action(async () => {
    console.log(pc.yellow('appship generate is not implemented yet.'));
    console.log('Planned: load analysis → build AI payload (summary only) → generate → validate → write .appship/');
    process.exitCode = 1;
  });
