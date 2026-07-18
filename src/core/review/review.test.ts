import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AIProvider, GenerateObjectRequest } from '../ai/provider.js';
import {
  analyzeRejection,
  buildAnalyzePrompt,
  renderAnalysisMarkdown,
  ReviewAnalyzeError,
  writeAnalysis,
  type ReviewAnalysis,
} from './index.js';

const VALID_ANALYSIS: ReviewAnalysis = {
  store: 'app-store',
  issues: [
    {
      guideline: 'Guideline 5.1.1',
      title: 'Account deletion missing',
      summary: 'Apps with account creation must let users delete the account in-app.',
      category: 'account',
      severity: 'blocker',
      fixSteps: ['Add an account deletion flow in settings.'],
      appshipCommands: ['appship doctor'],
      responseDraft: null,
    },
    {
      guideline: null,
      title: 'Demo account requested',
      summary: 'The reviewer could not log in and asks for a demo account.',
      category: 'functionality',
      severity: 'clarification',
      fixSteps: ['Provide a working demo account in App Review notes.'],
      appshipCommands: ['appship generate'],
      responseDraft: 'Hello, a demo account has been added to the review notes.',
    },
  ],
  overallPlan: ['Fix account deletion', 'Reply with demo account', 'Resubmit'],
};

function fakeProvider(response: unknown): AIProvider & { requests: GenerateObjectRequest[] } {
  const requests: GenerateObjectRequest[] = [];
  return {
    name: 'fake',
    requests,
    async generateText() {
      throw new Error('not used');
    },
    async generateObject(request) {
      requests.push(request);
      return response;
    },
  };
}

const PAYLOAD = {
  projectType: 'react-native',
  appName: 'Voice App',
  userDescription: 'A voice memo app.',
  audience: [],
  features: ['microphone'],
  permissions: ['microphone'],
  sdks: [],
  locales: ['en-US'],
};

describe('buildAnalyzePrompt', () => {
  it('includes the message, summary, and store hint', () => {
    const prompt = buildAnalyzePrompt('Your app was rejected.', PAYLOAD, {
      storeHint: 'app-store',
    });
    expect(prompt).toContain('Your app was rejected.');
    expect(prompt).toContain('"appName": "Voice App"');
    expect(prompt).toContain('app-store');
  });

  it('states when no project summary is available', () => {
    const prompt = buildAnalyzePrompt('msg', null);
    expect(prompt).toContain('No project summary is available');
  });
});

describe('analyzeRejection', () => {
  it('parses a valid model response', async () => {
    const provider = fakeProvider(VALID_ANALYSIS);
    const analysis = await analyzeRejection(provider, 'rejected', PAYLOAD);
    expect(analysis.issues).toHaveLength(2);
    expect(provider.requests[0]!.system).toContain('rejection');
  });

  it('rejects an empty message without calling the provider', async () => {
    const provider = fakeProvider(VALID_ANALYSIS);
    await expect(analyzeRejection(provider, '  \n ', PAYLOAD)).rejects.toThrow(ReviewAnalyzeError);
    expect(provider.requests).toHaveLength(0);
  });

  it('rejects an invalid model response', async () => {
    const provider = fakeProvider({ store: 'app-store', issues: [], overallPlan: [] });
    await expect(analyzeRejection(provider, 'rejected', PAYLOAD)).rejects.toThrow(
      ReviewAnalyzeError,
    );
  });

  it('falls back to the store hint when the model says unknown', async () => {
    const provider = fakeProvider({ ...VALID_ANALYSIS, store: 'unknown' });
    const analysis = await analyzeRejection(provider, 'rejected', null, {
      storeHint: 'google-play',
    });
    expect(analysis.store).toBe('google-play');
  });
});

describe('renderAnalysisMarkdown / writeAnalysis', () => {
  let tempRoot: string;

  beforeEach(async () => {
    tempRoot = await mkdtemp(join(tmpdir(), 'appship-review-'));
  });

  afterEach(async () => {
    await rm(tempRoot, { recursive: true, force: true });
  });

  it('renders issues, commands, and the reply draft', () => {
    const markdown = renderAnalysisMarkdown(VALID_ANALYSIS, 'Voice App');
    expect(markdown).toContain('# Rejection analysis — Voice App');
    expect(markdown).toContain('## 1. Account deletion missing (Guideline 5.1.1)');
    expect(markdown).toContain('- `appship doctor`');
    expect(markdown).toContain('> Hello, a demo account has been added');
    expect(markdown).toContain('## Recommended order');
  });

  it('writes markdown and json reports under .appship/review/', async () => {
    const written = await writeAnalysis(tempRoot, VALID_ANALYSIS, 'Voice App');
    const markdown = await readFile(join(tempRoot, written.markdownPath), 'utf8');
    expect(markdown).toContain('Rejection analysis');
    const json = JSON.parse(await readFile(join(tempRoot, written.jsonPath), 'utf8'));
    expect(json.issues).toHaveLength(2);
  });
});
