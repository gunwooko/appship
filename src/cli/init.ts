import { Command } from 'commander';
import pc from 'picocolors';
import * as p from '@clack/prompts';
import { scanProject } from '../core/scanner/index.js';
import { UnsupportedProjectError } from '../core/project/detector.js';
import { loadConfig, ConfigError, CONFIG_FILENAME } from '../core/config/load.js';
import type { AppshipConfig } from '../core/config/schema.js';
import {
  defaultAnswers,
  runInit,
  DESCRIPTION_PLACEHOLDER,
  type InitAnswers,
} from '../core/init/init.js';
import type { ScanResult } from '../core/types.js';

const SENSITIVE_PERMISSION_NAMES: Record<string, string> = {
  NSMicrophoneUsageDescription: 'Microphone',
  NSCameraUsageDescription: 'Camera',
  NSLocationWhenInUseUsageDescription: 'Location',
  NSLocationAlwaysAndWhenInUseUsageDescription: 'Location (always)',
  NSContactsUsageDescription: 'Contacts',
  NSPhotoLibraryUsageDescription: 'Photo Library',
  'android.permission.RECORD_AUDIO': 'Microphone',
  'android.permission.CAMERA': 'Camera',
  'android.permission.ACCESS_FINE_LOCATION': 'Location',
  'android.permission.ACCESS_COARSE_LOCATION': 'Location',
  'android.permission.READ_CONTACTS': 'Contacts',
  'android.permission.POST_NOTIFICATIONS': 'Notifications',
};

function printDetectionSummary(scan: ScanResult): void {
  const check = (label: string) => console.log(`${pc.green('✓')} ${label}`);

  check('React Native project detected');
  if (scan.project.ios?.bundleId) check(`iOS bundle ID: ${scan.project.ios.bundleId}`);
  if (scan.project.android?.packageName)
    check(`Android package: ${scan.project.android.packageName}`);
  if (scan.project.appName) check(`App name: ${scan.project.appName}`);
  if (scan.project.version) check(`Version: ${scan.project.version}`);

  const permissionNames = [
    ...new Set(
      [...scan.permissions.ios, ...scan.permissions.android]
        .map((f) => SENSITIVE_PERMISSION_NAMES[f.key])
        .filter((name): name is string => name !== undefined),
    ),
  ];
  if (permissionNames.length > 0) {
    check(`Permissions detected: ${permissionNames.join(', ')}`);
  }
  for (const sdk of scan.sdkReport.sdks) {
    check(`${sdk.name} detected`);
  }
}

function parseList(value: string): string[] {
  return value
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

async function askQuestions(
  scan: ScanResult,
  existing: AppshipConfig | null,
): Promise<InitAnswers | null> {
  const defaults = defaultAnswers(scan);

  p.intro('A few questions the code cannot answer:');

  const existingDescription =
    existing && existing.project.description !== DESCRIPTION_PLACEHOLDER
      ? existing.project.description
      : undefined;

  const description = await p.text({
    message: 'What does your app do?',
    placeholder: 'e.g. A language learning app with real-time voice rooms',
    ...(existingDescription ? { initialValue: existingDescription } : {}),
    validate: (v) => (!v || v.trim().length === 0 ? 'A short description is required.' : undefined),
  });
  if (p.isCancel(description)) return null;

  const audience = await p.text({
    message: 'Who is the target audience? (comma-separated, optional)',
    placeholder: 'e.g. language learners, international students',
    ...(existing?.project.audience.length
      ? { initialValue: existing.project.audience.join(', ') }
      : {}),
    defaultValue: '',
  });
  if (p.isCancel(audience)) return null;

  const requiresLogin = await p.confirm({
    message: 'Does the app require login?',
    initialValue: existing?.project.requires_login ?? false,
  });
  if (p.isCancel(requiresLogin)) return null;

  const detectedCollection = Object.keys(scan.privacyReport.dataCollection);
  const collectsPersonalData = await p.confirm({
    message:
      detectedCollection.length > 0
        ? `Does the app collect personal data? (detected: ${detectedCollection.join(', ')})`
        : 'Does the app collect personal data?',
    initialValue:
      existing?.project.collects_personal_data ?? defaults.collectsPersonalData ?? false,
  });
  if (p.isCancel(collectsPersonalData)) return null;

  const countries = await p.text({
    message: 'Which countries will you release in? (comma-separated, optional)',
    placeholder: 'e.g. US, KR, JP — leave empty for worldwide',
    ...(existing?.stores.countries.length
      ? { initialValue: existing.stores.countries.join(', ') }
      : {}),
    defaultValue: '',
  });
  if (p.isCancel(countries)) return null;

  const locales = await p.text({
    message: 'Which store listing languages should be generated? (comma-separated)',
    initialValue: existing?.stores.locales.join(', ') ?? 'en-US',
  });
  if (p.isCancel(locales)) return null;

  p.outro('Thanks — writing your files now.');

  return {
    description: description.trim(),
    audience: parseList(audience),
    requiresLogin,
    collectsPersonalData,
    countries: parseList(countries),
    locales: parseList(locales).length > 0 ? parseList(locales) : ['en-US'],
  };
}

function answersFromExisting(scan: ScanResult, existing: AppshipConfig): InitAnswers {
  return {
    description: existing.project.description,
    audience: existing.project.audience,
    requiresLogin: existing.project.requires_login ?? null,
    collectsPersonalData: existing.project.collects_personal_data ?? null,
    countries: existing.stores.countries,
    locales: existing.stores.locales,
  };
}

export const initCommand = new Command('init')
  .description('Analyze the project and create appship.yml and the .appship/ folder')
  .option('--force', 'ignore existing appship.yml and re-initialize from scratch')
  .option('--non-interactive', 'skip interactive questions (unconfirmed findings are left for doctor)')
  .action(async (options: { force?: boolean; nonInteractive?: boolean }) => {
    const projectRoot = process.cwd();

    let scan: ScanResult;
    try {
      scan = await scanProject(projectRoot);
    } catch (error) {
      if (error instanceof UnsupportedProjectError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    printDetectionSummary(scan);
    console.log();

    let existing: AppshipConfig | null = null;
    if (!options.force) {
      try {
        existing = await loadConfig(projectRoot);
        console.log(pc.dim(`Existing ${CONFIG_FILENAME} found — using it as defaults.`));
      } catch (error) {
        if (!(error instanceof ConfigError)) throw error;
      }
    }

    const interactive = !options.nonInteractive && process.stdout.isTTY;
    let answers: InitAnswers;
    if (interactive) {
      const asked = await askQuestions(scan, existing);
      if (asked === null) {
        console.log(pc.yellow('Cancelled — no files were written.'));
        process.exitCode = 1;
        return;
      }
      answers = asked;
    } else {
      answers = existing ? answersFromExisting(scan, existing) : defaultAnswers(scan);
    }

    const result = await runInit(projectRoot, scan, answers);

    console.log();
    console.log(pc.green('✓') + ` ${CONFIG_FILENAME} written`);
    for (const path of result.analysisPaths) {
      console.log(pc.green('✓') + ` ${path.replace(projectRoot + '/', '')} written`);
    }
    if (result.config.project.description.startsWith('[CONFIRM:')) {
      console.log(
        pc.yellow('⚠') +
          ` project.description in ${CONFIG_FILENAME} still needs your input before generate.`,
      );
    }
    console.log();
    console.log(`Next: run ${pc.cyan('appship generate')} to create your store materials.`);
  });
