import { Command } from 'commander';
import pc from 'picocolors';

export const doctorCommand = new Command('doctor')
  .description('Check store submission readiness (runs fully offline, no AI calls)')
  .option('--store <store>', 'app-store | google-play (default: both)')
  .option('--json', 'output machine-readable JSON instead of the human report')
  .action(async () => {
    console.log(pc.yellow('appship doctor is not implemented yet.'));
    console.log('Planned: run rule engine over analysis + generated files → readiness report');
    process.exitCode = 1;
  });
