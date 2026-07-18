import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appshipConfigSchema, type AppshipConfig } from '../config/schema.js';
import { exportFastlane, FastlaneExportError } from './index.js';

const CONFIG: AppshipConfig = appshipConfigSchema.parse({
  project: {
    name: 'RN Voice App',
    description: 'A voice app.',
    support_url: 'https://example.com/support',
  },
  platforms: {
    ios: { bundle_id: 'com.example.app' },
    android: { package_name: 'com.example.app' },
  },
  stores: { default_locale: 'en-US', locales: ['en-US', 'ko-KR'] },
});

async function writeListings(root: string): Promise<void> {
  for (const locale of ['en-US', 'ko-KR']) {
    const appStore = join(root, '.appship/app-store', locale);
    const play = join(root, '.appship/google-play', locale);
    await mkdir(appStore, { recursive: true });
    await mkdir(play, { recursive: true });
    await writeFile(join(appStore, 'name.txt'), `Name ${locale}\n`);
    await writeFile(join(appStore, 'subtitle.txt'), `Subtitle ${locale}\n`);
    await writeFile(join(appStore, 'description.txt'), `Description ${locale}\n`);
    await writeFile(join(appStore, 'keywords.txt'), `keywords,${locale}\n`);
    await writeFile(join(appStore, 'promotional-text.txt'), `Promo ${locale}\n`);
    await writeFile(join(appStore, 'release-notes.txt'), `Notes ${locale}\n`);
    await writeFile(join(appStore, 'review-notes.txt'), `Review notes ${locale}\n`);
    await writeFile(join(play, 'title.txt'), `Title ${locale}\n`);
    await writeFile(join(play, 'short-description.txt'), `Short ${locale}\n`);
    await writeFile(join(play, 'full-description.txt'), `Full ${locale}\n`);
    await writeFile(join(play, 'release-notes.txt'), `Changelog ${locale}\n`);
  }
  // non-locale dirs must not be treated as locales
  await mkdir(join(root, '.appship/app-store/privacy'), { recursive: true });
  await mkdir(join(root, '.appship/app-store/screenshots'), { recursive: true });
}

describe('exportFastlane', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-fastlane-'));
    await writeListings(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('maps listings into deliver and supply layouts for every locale', async () => {
    await exportFastlane(tempRoot, CONFIG);

    expect(
      (await readFile(join(tempRoot, 'fastlane/metadata/ko-KR/promotional_text.txt'), 'utf8')).trim(),
    ).toBe('Promo ko-KR');
    expect(
      (await readFile(join(tempRoot, 'fastlane/metadata/en-US/support_url.txt'), 'utf8')).trim(),
    ).toBe('https://example.com/support');
    expect(
      (await readFile(join(tempRoot, 'fastlane/metadata/android/ko-KR/short_description.txt'), 'utf8')).trim(),
    ).toBe('Short ko-KR');
    expect(
      (await readFile(join(tempRoot, 'fastlane/metadata/android/en-US/changelogs/default.txt'), 'utf8')).trim(),
    ).toBe('Changelog en-US');
    // privacy/screenshots dirs are not locales
    expect(existsSync(join(tempRoot, 'fastlane/metadata/privacy'))).toBe(false);
  });

  it('writes review notes from the default locale into review_information', async () => {
    await exportFastlane(tempRoot, CONFIG);
    const notes = await readFile(
      join(tempRoot, 'fastlane/metadata/review_information/notes.txt'),
      'utf8',
    );
    expect(notes.trim()).toBe('Review notes en-US');
  });

  it('generates Appfile and Fastfile with both platforms', async () => {
    await exportFastlane(tempRoot, CONFIG);
    const appfile = await readFile(join(tempRoot, 'fastlane/Appfile'), 'utf8');
    expect(appfile).toContain('app_identifier "com.example.app"');
    expect(appfile).toContain('package_name "com.example.app"');
    const fastfile = await readFile(join(tempRoot, 'fastlane/Fastfile'), 'utf8');
    expect(fastfile).toContain('platform :ios');
    expect(fastfile).toContain('platform :android');
    expect(fastfile).toContain('skip_binary_upload: true');
  });

  it('never clobbers an existing Fastfile without force', async () => {
    await mkdir(join(tempRoot, 'fastlane'), { recursive: true });
    await writeFile(join(tempRoot, 'fastlane/Fastfile'), '# my custom lanes\n');

    const result = await exportFastlane(tempRoot, CONFIG);
    expect(result.skipped).toContain(join('fastlane', 'Fastfile'));
    expect(await readFile(join(tempRoot, 'fastlane/Fastfile'), 'utf8')).toBe('# my custom lanes\n');

    const forced = await exportFastlane(tempRoot, CONFIG, { force: true });
    expect(forced.skipped).toEqual([]);
    expect(await readFile(join(tempRoot, 'fastlane/Fastfile'), 'utf8')).toContain('platform :ios');
  });

  it('respects the target filter', async () => {
    await exportFastlane(tempRoot, CONFIG, { target: 'android' });
    expect(existsSync(join(tempRoot, 'fastlane/metadata/android/en-US/title.txt'))).toBe(true);
    expect(existsSync(join(tempRoot, 'fastlane/metadata/en-US'))).toBe(false);
  });

  it('fails clearly when nothing has been generated', async () => {
    await rm(join(tempRoot, '.appship'), { recursive: true });
    await expect(exportFastlane(tempRoot, CONFIG)).rejects.toThrow(FastlaneExportError);
  });
});
