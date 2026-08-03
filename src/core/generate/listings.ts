import { z } from 'zod';
import type { AIProvider } from '../ai/provider.js';
import type { SummaryPayload } from '../ai/payload.js';
import {
  APP_STORE_LIMITS,
  GOOGLE_PLAY_LIMITS,
  validateFields,
  validatePlayTitlePolicy,
  type Violation,
} from '../metadata/validator.js';

const MAX_RETRIES = 3;

export const appStoreListingSchema = z.object({
  name: z.string(),
  subtitle: z.string(),
  description: z.string(),
  keywords: z.string(),
  promotionalText: z.string(),
  releaseNotes: z.string(),
  reviewNotes: z.string(),
});
export type AppStoreListing = z.infer<typeof appStoreListingSchema>;

export const playListingSchema = z.object({
  title: z.string(),
  shortDescription: z.string(),
  fullDescription: z.string(),
  releaseNotes: z.string(),
  suggestedCategory: z.string(),
  suggestedTags: z.array(z.string()),
});
export type PlayListing = z.infer<typeof playListingSchema>;

// Structured-output JSON schemas (additionalProperties: false required;
// length constraints are NOT expressible here — enforced by the validator).
const APP_STORE_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'name',
    'subtitle',
    'description',
    'keywords',
    'promotionalText',
    'releaseNotes',
    'reviewNotes',
  ],
  properties: {
    name: { type: 'string', description: 'App name, at most 30 characters' },
    subtitle: { type: 'string', description: 'Subtitle, at most 30 characters' },
    description: { type: 'string', description: 'Full description, at most 4000 characters' },
    keywords: {
      type: 'string',
      description: 'Comma-separated keywords, at most 100 characters total',
    },
    promotionalText: { type: 'string', description: 'Promotional text, at most 170 characters' },
    releaseNotes: { type: 'string', description: 'Release notes for this version' },
    reviewNotes: {
      type: 'string',
      description:
        'Notes for the App Review team: how to test the app, login/test account needs, subscription details',
    },
  },
};

const PLAY_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'title',
    'shortDescription',
    'fullDescription',
    'releaseNotes',
    'suggestedCategory',
    'suggestedTags',
  ],
  properties: {
    title: { type: 'string', description: 'App title, at most 30 characters, no emoji' },
    shortDescription: { type: 'string', description: 'Short description, at most 80 characters' },
    fullDescription: { type: 'string', description: 'Full description, at most 4000 characters' },
    releaseNotes: { type: 'string', description: 'Release notes, at most 500 characters' },
    suggestedCategory: { type: 'string', description: 'Suggested Google Play category' },
    suggestedTags: { type: 'array', items: { type: 'string' }, description: 'Suggested tags' },
  },
};

// Principle 1 (TRD §5.4): the model writes prose from scanner facts only.
const SYSTEM_PROMPT = `You are AppShip, an assistant that writes app store submission materials.

Rules you must never break:
- Only describe features, permissions, and SDKs listed in the provided project summary. Never invent capabilities the summary does not mention.
- Never make definitive privacy claims like "does not share user data". If something is unknown, either omit it or mark it as [CONFIRM: <question for the developer>].
- Respect every character limit stated in the field descriptions.
- Avoid store-policy violations: no emoji or repeated special characters in titles, no ranking claims ("#1 app"), no price mentions in App Store metadata, no misleading claims.
- Write in the locale requested by the user.`;

export interface ListingResult<T> {
  listing: T;
  violations: Violation[]; // non-empty only if retries were exhausted
}

function buildPrompt(payload: SummaryPayload, locale: string, store: string): string {
  return (
    `Write ${store} listing metadata for this app, in locale "${locale}".\n\n` +
    `Project summary (the only source of truth about the app):\n` +
    JSON.stringify(payload, null, 2)
  );
}

/**
 * Generate a structured object and re-prompt with violation feedback until it
 * passes validation (or retries are exhausted). Shared by generate and localize.
 */
export async function generateWithRetry<T>(
  provider: AIProvider,
  basePrompt: string,
  jsonSchema: Record<string, unknown>,
  parse: (raw: unknown) => T,
  validate: (listing: T) => Violation[],
  system: string = SYSTEM_PROMPT,
): Promise<ListingResult<T>> {
  let prompt = basePrompt;
  let listing = parse(await provider.generateObject({ system, prompt, jsonSchema }));
  let violations = validate(listing);

  for (let attempt = 0; violations.length > 0 && attempt < MAX_RETRIES; attempt++) {
    prompt =
      basePrompt +
      '\n\nYour previous attempt violated these constraints — fix them and regenerate:\n' +
      violations.map((v) => `- ${v.message}`).join('\n') +
      '\n\nFor character-limit violations: character limits are hard store rules, not ' +
      'suggestions. Count the characters of your replacement before answering and make it ' +
      'comfortably shorter than the limit (aim for ~10% under) — cutting words is better ' +
      'than exceeding the limit.';
    listing = parse(await provider.generateObject({ system, prompt, jsonSchema }));
    violations = validate(listing);
  }
  return { listing, violations };
}

export async function generateAppStoreListing(
  provider: AIProvider,
  payload: SummaryPayload,
  locale: string,
): Promise<ListingResult<AppStoreListing>> {
  return generateWithRetry(
    provider,
    buildPrompt(payload, locale, 'Apple App Store'),
    APP_STORE_JSON_SCHEMA,
    (raw) => appStoreListingSchema.parse(raw),
    (l) => validateFields({ ...l }, APP_STORE_LIMITS),
  );
}

export async function generatePlayListing(
  provider: AIProvider,
  payload: SummaryPayload,
  locale: string,
): Promise<ListingResult<PlayListing>> {
  return generateWithRetry(
    provider,
    buildPrompt(payload, locale, 'Google Play'),
    PLAY_JSON_SCHEMA,
    (raw) => playListingSchema.parse(raw),
    (l) => [
      ...validateFields(
        {
          title: l.title,
          shortDescription: l.shortDescription,
          fullDescription: l.fullDescription,
          releaseNotes: l.releaseNotes,
        },
        GOOGLE_PLAY_LIMITS,
      ),
      ...validatePlayTitlePolicy(l.title),
    ],
  );
}
