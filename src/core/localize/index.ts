// appship localize (MVP 2): translate already-generated store listings from
// the default locale into additional locales. Translations go through the
// same character-limit validator + retry loop as generation — Apple/Google
// limits apply per locale, and translations routinely expand text.

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { z } from 'zod';
import type { AppshipConfig } from '../config/schema.js';
import type { AIProvider } from '../ai/provider.js';
import { generateWithRetry } from '../generate/listings.js';
import {
  APP_STORE_LIMITS,
  GOOGLE_PLAY_LIMITS,
  validateFields,
  validatePlayTitlePolicy,
  type Violation,
} from '../metadata/validator.js';
import type { GenerateTarget } from '../generate/index.js';

const TRANSLATE_SYSTEM_PROMPT = `You are AppShip, localizing app store listings.

Rules you must never break:
- Translate meaning, not words: write natural, market-appropriate store copy for the target locale.
- Do not add, remove, or invent product claims — the source text is the only source of truth.
- Keywords must be adapted for how users in the target market actually search, not translated literally.
- Respect every character limit stated in the field descriptions. Translations often expand; shorten rather than exceed limits.
- Keep placeholders of the form [CONFIRM: ...] exactly as-is, untranslated.`;

interface StoreSpec {
  store: 'app-store' | 'google-play';
  storeLabel: string;
  /** filename (without .txt) → schema field */
  files: Record<string, string>;
  jsonSchema: Record<string, unknown>;
  validate: (values: Record<string, string>) => Violation[];
  /** files copied unchanged (not locale-facing) */
  copyFiles: string[];
}

const APP_STORE_SPEC: StoreSpec = {
  store: 'app-store',
  storeLabel: 'Apple App Store',
  files: {
    name: 'name',
    subtitle: 'subtitle',
    description: 'description',
    keywords: 'keywords',
    'promotional-text': 'promotionalText',
    'release-notes': 'releaseNotes',
  },
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['name', 'subtitle', 'description', 'keywords', 'promotionalText', 'releaseNotes'],
    properties: {
      name: { type: 'string', description: 'App name, at most 30 characters' },
      subtitle: { type: 'string', description: 'Subtitle, at most 30 characters' },
      description: { type: 'string', description: 'Full description, at most 4000 characters' },
      keywords: {
        type: 'string',
        description: 'Comma-separated keywords adapted to the target market, at most 100 characters total',
      },
      promotionalText: { type: 'string', description: 'Promotional text, at most 170 characters' },
      releaseNotes: { type: 'string', description: 'Release notes, at most 4000 characters' },
    },
  },
  validate: (values) => validateFields(values, APP_STORE_LIMITS),
  // Review notes are for the App Review team — they stay in the source language.
  copyFiles: ['review-notes'],
};

const PLAY_SPEC: StoreSpec = {
  store: 'google-play',
  storeLabel: 'Google Play',
  files: {
    title: 'title',
    'short-description': 'shortDescription',
    'full-description': 'fullDescription',
    'release-notes': 'releaseNotes',
  },
  jsonSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['title', 'shortDescription', 'fullDescription', 'releaseNotes'],
    properties: {
      title: { type: 'string', description: 'App title, at most 30 characters, no emoji' },
      shortDescription: { type: 'string', description: 'Short description, at most 80 characters' },
      fullDescription: { type: 'string', description: 'Full description, at most 4000 characters' },
      releaseNotes: { type: 'string', description: 'Release notes, at most 500 characters' },
    },
  },
  validate: (values) => [
    ...validateFields(values, GOOGLE_PLAY_LIMITS),
    ...(values['title'] !== undefined ? validatePlayTitlePolicy(values['title']) : []),
  ],
  copyFiles: [],
};

export class LocalizeError extends Error {}

export interface LocalizeOptions {
  targetLocales: string[];
  sourceLocale?: string; // default: config.stores.default_locale
  target?: GenerateTarget;
  dryRun?: boolean;
}

export interface LocalizedFile {
  path: string;
  content: string;
  violations: Violation[];
}

export interface LocalizeResult {
  files: LocalizedFile[];
  sourceLocale: string;
}

function specsFor(target?: GenerateTarget): StoreSpec[] {
  return [
    ...(target !== 'android' ? [APP_STORE_SPEC] : []),
    ...(target !== 'ios' ? [PLAY_SPEC] : []),
  ];
}

async function readSourceListing(
  projectRoot: string,
  spec: StoreSpec,
  sourceLocale: string,
): Promise<Record<string, string>> {
  const dir = join(projectRoot, '.appship', spec.store, sourceLocale);
  if (!existsSync(dir)) {
    throw new LocalizeError(
      `No generated ${spec.storeLabel} listing for source locale ${sourceLocale} ` +
        `(${dir} not found). Run \`appship generate\` first.`,
    );
  }
  const values: Record<string, string> = {};
  for (const [filename, field] of Object.entries(spec.files)) {
    const path = join(dir, `${filename}.txt`);
    try {
      values[field] = (await readFile(path, 'utf8')).trimEnd();
    } catch {
      throw new LocalizeError(
        `Missing source file ${spec.store}/${sourceLocale}/${filename}.txt. Run \`appship generate\` first.`,
      );
    }
  }
  return values;
}

export function planLocalize(options: LocalizeOptions): string[] {
  const paths: string[] = [];
  for (const spec of specsFor(options.target)) {
    for (const locale of options.targetLocales) {
      for (const filename of [...Object.keys(spec.files), ...spec.copyFiles]) {
        paths.push(`.appship/${spec.store}/${locale}/${filename}.txt`);
      }
    }
  }
  return paths;
}

export async function runLocalize(
  projectRoot: string,
  config: AppshipConfig,
  provider: AIProvider,
  options: LocalizeOptions,
): Promise<LocalizeResult> {
  const sourceLocale = options.sourceLocale ?? config.stores.default_locale;
  const targets = options.targetLocales.filter((locale) => locale !== sourceLocale);
  if (targets.length === 0) {
    throw new LocalizeError('No target locales to localize (source locale excluded).');
  }

  const files: LocalizedFile[] = [];

  for (const spec of specsFor(options.target)) {
    const source = await readSourceListing(projectRoot, spec, sourceLocale);
    const fieldSchema = z.record(z.string(), z.string());

    for (const locale of targets) {
      const prompt =
        `Translate this ${spec.storeLabel} listing from locale "${sourceLocale}" to locale "${locale}".\n\n` +
        `Source listing (JSON):\n${JSON.stringify(source, null, 2)}`;

      const { listing, violations } = await generateWithRetry(
        provider,
        prompt,
        spec.jsonSchema,
        (raw) => fieldSchema.parse(raw),
        (values) => spec.validate(values),
        TRANSLATE_SYSTEM_PROMPT,
      );

      for (const [filename, field] of Object.entries(spec.files)) {
        files.push({
          path: join('.appship', spec.store, locale, `${filename}.txt`),
          content: (listing[field] ?? '') + '\n',
          violations: violations.filter((v) => v.field === field),
        });
      }
      for (const filename of spec.copyFiles) {
        const sourcePath = join(projectRoot, '.appship', spec.store, sourceLocale, `${filename}.txt`);
        if (existsSync(sourcePath)) {
          files.push({
            path: join('.appship', spec.store, locale, `${filename}.txt`),
            content: await readFile(sourcePath, 'utf8'),
            violations: [],
          });
        }
      }
    }
  }

  if (!options.dryRun) {
    for (const file of files) {
      const absolute = join(projectRoot, file.path);
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, file.content, 'utf8');
    }
  }
  return { files, sourceLocale };
}
