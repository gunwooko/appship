import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appshipConfigSchema, type AppshipConfig } from '../config/schema.js';
import type {
  AIProvider,
  GenerateObjectRequest,
  GenerateTextRequest,
} from '../ai/provider.js';
import { planLocalize, runLocalize, LocalizeError } from './index.js';

const CONFIG: AppshipConfig = appshipConfigSchema.parse({
  project: { name: 'RN Voice App', description: 'A voice app.' },
  platforms: { ios: { bundle_id: 'com.example.app' } },
  stores: { default_locale: 'en-US', locales: ['en-US'] },
});

/** Fake translator: prefixes every field with the target locale from the prompt. */
class FakeTranslator implements AIProvider {
  readonly name = 'fake';
  calls: GenerateObjectRequest[] = [];
  private appStoreAttempts = 0;

  constructor(private violateNameFirst = false) {}

  async generateText(_request: GenerateTextRequest): Promise<string> {
    throw new Error('localize must not call generateText');
  }

  async generateObject(request: GenerateObjectRequest): Promise<unknown> {
    this.calls.push(request);
    const locale = /to locale "([^"]+)"/.exec(request.prompt)?.[1] ?? '??';
    const source = JSON.parse(
      request.prompt.slice(request.prompt.indexOf('{'), request.prompt.lastIndexOf('}') + 1),
    ) as Record<string, string>;
    const translated = Object.fromEntries(
      Object.entries(source).map(([field, value]) => [field, `[${locale}] ${value}`]),
    );
    if ('name' in translated) {
      this.appStoreAttempts += 1;
      if (this.violateNameFirst && this.appStoreAttempts === 1) {
        translated['name'] = 'X'.repeat(40);
      }
    }
    return translated;
  }
}

async function writeSourceListing(root: string): Promise<void> {
  const appStore = join(root, '.appship/app-store/en-US');
  const play = join(root, '.appship/google-play/en-US');
  await mkdir(appStore, { recursive: true });
  await mkdir(play, { recursive: true });
  const files: Array<[string, string]> = [
    [join(appStore, 'name.txt'), 'RN Voice App\n'],
    [join(appStore, 'subtitle.txt'), 'Practice speaking daily\n'],
    [join(appStore, 'description.txt'), 'A language learning app.\n'],
    [join(appStore, 'keywords.txt'), 'language,voice\n'],
    [join(appStore, 'promotional-text.txt'), 'Join live rooms.\n'],
    [join(appStore, 'release-notes.txt'), 'Initial release.\n'],
    [join(appStore, 'review-notes.txt'), 'Test account: demo/demo123\n'],
    [join(play, 'title.txt'), 'RN Voice App\n'],
    [join(play, 'short-description.txt'), 'Practice speaking.\n'],
    [join(play, 'full-description.txt'), 'A language learning app.\n'],
    [join(play, 'release-notes.txt'), 'Initial release.\n'],
  ];
  for (const [path, content] of files) await writeFile(path, content, 'utf8');
}

describe('runLocalize', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-localize-'));
    await writeSourceListing(tempRoot);
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('translates both stores into each target locale', async () => {
    const result = await runLocalize(tempRoot, CONFIG, new FakeTranslator(), {
      targetLocales: ['ko-KR', 'ja-JP'],
    });

    const koName = await readFile(join(tempRoot, '.appship/app-store/ko-KR/name.txt'), 'utf8');
    expect(koName.trim()).toBe('[ko-KR] RN Voice App');
    const jaTitle = await readFile(join(tempRoot, '.appship/google-play/ja-JP/title.txt'), 'utf8');
    expect(jaTitle.trim()).toBe('[ja-JP] RN Voice App');

    // matches the plan exactly
    const planned = planLocalize({ targetLocales: ['ko-KR', 'ja-JP'] }).sort();
    expect(result.files.map((f) => f.path).sort()).toEqual(planned);
  });

  it('copies review-notes unchanged (App Review reads the source language)', async () => {
    await runLocalize(tempRoot, CONFIG, new FakeTranslator(), { targetLocales: ['ko-KR'] });
    const reviewNotes = await readFile(
      join(tempRoot, '.appship/app-store/ko-KR/review-notes.txt'),
      'utf8',
    );
    expect(reviewNotes.trim()).toBe('Test account: demo/demo123');
  });

  it('re-prompts when a translation exceeds a store limit', async () => {
    const provider = new FakeTranslator(true);
    const result = await runLocalize(tempRoot, CONFIG, provider, { targetLocales: ['ko-KR'] });
    const nameFile = result.files.find((f) => f.path.endsWith('ko-KR/name.txt'))!;
    expect(nameFile.content.trim()).toBe('[ko-KR] RN Voice App');
    expect(nameFile.violations).toEqual([]);
    expect(provider.calls.some((c) => c.prompt.includes('violated these constraints'))).toBe(true);
  });

  it('excludes the source locale and respects the target filter', async () => {
    const result = await runLocalize(tempRoot, CONFIG, new FakeTranslator(), {
      targetLocales: ['en-US', 'ko-KR'],
      target: 'ios',
    });
    expect(result.files.every((f) => f.path.includes('/ko-KR/'))).toBe(true);
    expect(result.files.every((f) => f.path.includes('app-store'))).toBe(true);
  });

  it('fails clearly when the source listing has not been generated', async () => {
    await rm(join(tempRoot, '.appship/app-store'), { recursive: true });
    await expect(
      runLocalize(tempRoot, CONFIG, new FakeTranslator(), { targetLocales: ['ko-KR'] }),
    ).rejects.toThrow(LocalizeError);
  });

  it('does not write files in dry-run mode', async () => {
    await runLocalize(tempRoot, CONFIG, new FakeTranslator(), {
      targetLocales: ['ko-KR'],
      dryRun: true,
    });
    expect(existsSync(join(tempRoot, '.appship/app-store/ko-KR'))).toBe(false);
  });
});
