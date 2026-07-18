// appship review analyze (MVP 3): turn a store rejection message into a
// concrete fix plan. The rejection text is provided explicitly by the user;
// project context goes through the same privacy-guarded summary payload as
// generation (no source code, no file paths).

import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AIProvider } from '../ai/provider.js';
import type { SummaryPayload } from '../ai/payload.js';

export class ReviewAnalyzeError extends Error {}

export const reviewStoreSchema = z.enum(['app-store', 'google-play']);
export type ReviewStore = z.infer<typeof reviewStoreSchema>;

export const reviewIssueSchema = z.object({
  guideline: z.string().nullable(),
  title: z.string(),
  summary: z.string(),
  category: z.enum([
    'metadata',
    'privacy',
    'permissions',
    'account',
    'content',
    'functionality',
    'payments',
    'legal',
    'design',
    'other',
  ]),
  severity: z.enum(['blocker', 'clarification']),
  fixSteps: z.array(z.string()),
  appshipCommands: z.array(z.string()),
  responseDraft: z.string().nullable(),
});
export type ReviewIssue = z.infer<typeof reviewIssueSchema>;

export const reviewAnalysisSchema = z.object({
  store: z.enum(['app-store', 'google-play', 'unknown']),
  issues: z.array(reviewIssueSchema).min(1),
  overallPlan: z.array(z.string()),
});
export type ReviewAnalysis = z.infer<typeof reviewAnalysisSchema>;

const ANALYSIS_JSON_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['store', 'issues', 'overallPlan'],
  properties: {
    store: {
      type: 'string',
      enum: ['app-store', 'google-play', 'unknown'],
      description: 'Which store the rejection message is from, judged from its wording',
    },
    issues: {
      type: 'array',
      description: 'One entry per distinct problem the reviewer raised',
      items: {
        type: 'object',
        additionalProperties: false,
        required: [
          'guideline',
          'title',
          'summary',
          'category',
          'severity',
          'fixSteps',
          'appshipCommands',
          'responseDraft',
        ],
        properties: {
          guideline: {
            type: ['string', 'null'],
            description:
              'Exact guideline/policy cited in the message (e.g. "Guideline 5.1.1", "User Data policy"), or null if none is cited. Never invent one.',
          },
          title: { type: 'string', description: 'Short label for the issue' },
          summary: {
            type: 'string',
            description: 'What the reviewer is objecting to, in plain language',
          },
          category: {
            type: 'string',
            enum: [
              'metadata',
              'privacy',
              'permissions',
              'account',
              'content',
              'functionality',
              'payments',
              'legal',
              'design',
              'other',
            ],
          },
          severity: {
            type: 'string',
            enum: ['blocker', 'clarification'],
            description:
              'blocker: the app/metadata must change. clarification: replying with information may resolve it.',
          },
          fixSteps: {
            type: 'array',
            items: { type: 'string' },
            description: 'Concrete ordered steps the developer should take',
          },
          appshipCommands: {
            type: 'array',
            items: { type: 'string' },
            description:
              'AppShip commands (from the provided list only) that help apply the fix; empty if none apply',
          },
          responseDraft: {
            type: ['string', 'null'],
            description:
              'For clarification issues: a draft reply to the review team. null for blockers.',
          },
        },
      },
    },
    overallPlan: {
      type: 'array',
      items: { type: 'string' },
      description: 'Recommended order of actions across all issues, ending with resubmission',
    },
  },
};

const APPSHIP_COMMANDS = [
  'appship generate',
  'appship localize',
  'appship export fastlane',
  'appship screenshots flows',
  'appship screenshots capture',
  'appship upload ios',
  'appship upload android',
  'appship doctor',
  'appship submit ios',
  'appship submit android',
];

const SYSTEM_PROMPT = `You are AppShip, an assistant that analyzes app store rejection messages and produces a concrete fix plan.

Rules you must never break:
- Ground every issue in the rejection message itself. Never invent problems the reviewer did not raise.
- Only cite a guideline or policy name if the message cites it, or if you are certain it is the standard reference for exactly what the message describes; otherwise set guideline to null.
- The project summary is the only source of truth about the app. Never assume features, permissions, or SDKs it does not list.
- appshipCommands may only contain commands from this list (with arguments where noted): ${APPSHIP_COMMANDS.join(', ')}. Use an empty array when none genuinely helps.
- Fix steps must be actions the developer can take, not restatements of the problem.
- Write responseDraft in a professional, factual tone; never promise changes the developer has not decided to make.`;

export interface AnalyzeOptions {
  /** User-provided hint when the message itself is ambiguous. */
  storeHint?: ReviewStore;
}

export function buildAnalyzePrompt(
  rejectionText: string,
  payload: SummaryPayload | null,
  options: AnalyzeOptions = {},
): string {
  const parts = [
    'Analyze this store rejection message and produce a fix plan.',
    options.storeHint ? `The developer says it came from: ${options.storeHint}.` : '',
    payload
      ? `Project summary (the only source of truth about the app):\n${JSON.stringify(payload, null, 2)}`
      : 'No project summary is available — do not assume anything about the app beyond the message.',
    `Rejection message:\n"""\n${rejectionText}\n"""`,
  ];
  return parts.filter(Boolean).join('\n\n');
}

export async function analyzeRejection(
  provider: AIProvider,
  rejectionText: string,
  payload: SummaryPayload | null,
  options: AnalyzeOptions = {},
): Promise<ReviewAnalysis> {
  const trimmed = rejectionText.trim();
  if (trimmed.length === 0) {
    throw new ReviewAnalyzeError('The rejection message is empty.');
  }
  const raw = await provider.generateObject({
    system: SYSTEM_PROMPT,
    prompt: buildAnalyzePrompt(trimmed, payload, options),
    jsonSchema: ANALYSIS_JSON_SCHEMA,
  });
  const parsed = reviewAnalysisSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ReviewAnalyzeError(
      `The model returned an invalid analysis: ${parsed.error.issues[0]?.message ?? 'unknown error'}`,
    );
  }
  if (options.storeHint && parsed.data.store === 'unknown') {
    return { ...parsed.data, store: options.storeHint };
  }
  return parsed.data;
}

const STORE_LABELS: Record<ReviewAnalysis['store'], string> = {
  'app-store': 'App Store',
  'google-play': 'Google Play',
  unknown: 'Unknown store',
};

export function renderAnalysisMarkdown(analysis: ReviewAnalysis, appName: string): string {
  const lines = [
    `# Rejection analysis — ${appName}`,
    '',
    `Store: ${STORE_LABELS[analysis.store]}`,
    '',
  ];
  analysis.issues.forEach((issue, index) => {
    const guideline = issue.guideline ? ` (${issue.guideline})` : '';
    lines.push(`## ${index + 1}. ${issue.title}${guideline}`);
    lines.push('');
    lines.push(`- Category: ${issue.category}`);
    lines.push(`- Severity: ${issue.severity}`);
    lines.push('');
    lines.push(issue.summary);
    lines.push('');
    if (issue.fixSteps.length > 0) {
      lines.push('### Fix');
      lines.push(...issue.fixSteps.map((step, i) => `${i + 1}. ${step}`));
      lines.push('');
    }
    if (issue.appshipCommands.length > 0) {
      lines.push('### Relevant appship commands');
      lines.push(...issue.appshipCommands.map((c) => `- \`${c}\``));
      lines.push('');
    }
    if (issue.responseDraft) {
      lines.push('### Draft reply to the review team');
      lines.push('');
      lines.push('> ' + issue.responseDraft.split('\n').join('\n> '));
      lines.push('');
    }
  });
  if (analysis.overallPlan.length > 0) {
    lines.push('## Recommended order');
    lines.push(...analysis.overallPlan.map((step, i) => `${i + 1}. ${step}`));
    lines.push('');
  }
  return lines.join('\n');
}

export interface WrittenAnalysis {
  markdownPath: string;
  jsonPath: string;
}

export async function writeAnalysis(
  projectRoot: string,
  analysis: ReviewAnalysis,
  appName: string,
): Promise<WrittenAnalysis> {
  const dir = join(projectRoot, '.appship', 'review');
  await mkdir(dir, { recursive: true });
  const markdownPath = join('.appship', 'review', 'rejection-analysis.md');
  const jsonPath = join('.appship', 'review', 'rejection-analysis.json');
  await writeFile(
    join(projectRoot, markdownPath),
    renderAnalysisMarkdown(analysis, appName),
    'utf8',
  );
  await writeFile(join(projectRoot, jsonPath), JSON.stringify(analysis, null, 2) + '\n', 'utf8');
  return { markdownPath, jsonPath };
}
