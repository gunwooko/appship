import { Command } from 'commander';
import { initCommand } from './cli/init.js';
import { generateCommand } from './cli/generate.js';
import { doctorCommand } from './cli/doctor.js';
import { localizeCommand } from './cli/localize.js';
import { exportCommand } from './cli/export.js';
import { uploadCommand } from './cli/upload.js';
import { screenshotsCommand } from './cli/screenshots.js';
import { submitCommand } from './cli/submit.js';

const program = new Command();

program
  .name('appship')
  .description(
    'AI release assistant that analyzes your mobile app and prepares everything required for App Store and Google Play submission',
  )
  .version('0.1.0');

program.addCommand(initCommand);
program.addCommand(generateCommand);
program.addCommand(localizeCommand);
program.addCommand(exportCommand);
program.addCommand(uploadCommand);
program.addCommand(screenshotsCommand);
program.addCommand(submitCommand);
program.addCommand(doctorCommand);

program.parseAsync(process.argv);
