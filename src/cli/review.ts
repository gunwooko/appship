import { readFile } from 'node:fs/promises';
import { Command } from 'commander';
import pc from 'picocolors';
import { loadConfig, ConfigError } from '../core/config/load.js';
import { scanProject } from '../core/scanner/index.js';
import { mergePreviousConfirmations } from '../core/scanner/confirmations.js';
import { UnsupportedProjectError } from '../core/project/detector.js';
import { createProvider, AIProviderError } from '../core/ai/index.js';
import { buildSummaryPayload, type SummaryPayload } from '../core/ai/payload.js';
import {
  analyzeRejection,
  reviewStoreSchema,
  writeAnalysis,
  ReviewAnalyzeError,
  type ReviewAnalysis,
} from '../core/review/index.js';

function renderIssues(analysis: ReviewAnalysis): void {
  analysis.issues.forEach((issue, index) => {
    const icon = issue.severity === 'blocker' ? pc.red('✗') : pc.yellow('◆');
    const guideline = issue.guideline ? pc.dim(` (${issue.guideline})`) : '';
    console.log(`${icon} ${pc.bold(issue.title)}${guideline}`);
    console.log(`  ${issue.summary}`);
    for (const step of issue.fixSteps) {
      console.log(pc.dim(`  → ${step}`));
    }
    for (const command of issue.appshipCommands) {
      console.log(pc.cyan(`  $ ${command}`));
    }
    if (issue.responseDraft) {
      console.log(pc.dim('  (a draft reply to the review team is in the report)'));
    }
    if (index < analysis.issues.length - 1) console.log();
  });
}

const analyzeSubcommand = new Command('analyze')
  .description('Analyze a store rejection message and produce a fix plan')
  .argument('<file>', 'text file containing the rejection message (copy it from the store console)')
  .option('--store <store>', 'app-store | google-play (hint when the message is ambiguous)')
  .action(async (file: string, options: { store?: string }) => {
    const projectRoot = process.cwd();

    let storeHint;
    if (options.store !== undefined) {
      const parsed = reviewStoreSchema.safeParse(options.store);
      if (!parsed.success) {
        console.error(pc.red(`✗ Unknown store "${options.store}". Use app-store or google-play.`));
        process.exitCode = 1;
        return;
      }
      storeHint = parsed.data;
    }

    let rejectionText: string;
    try {
      rejectionText = await readFile(file, 'utf8');
    } catch {
      console.error(pc.red(`✗ Could not read "${file}".`));
      process.exitCode = 1;
      return;
    }
    if (rejectionText.trim().length === 0) {
      console.error(pc.red(`✗ "${file}" is empty.`));
      process.exitCode = 1;
      return;
    }

    let config;
    try {
      config = await loadConfig(projectRoot);
    } catch (error) {
      if (error instanceof ConfigError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    // Project context sharpens the fix plan but is not required — a rejection
    // can be analyzed even where the scanner cannot run.
    let payload: SummaryPayload | null = null;
    try {
      const scan = await scanProject(projectRoot);
      await mergePreviousConfirmations(projectRoot, scan);
      payload = buildSummaryPayload(scan, config);
    } catch (error) {
      if (!(error instanceof UnsupportedProjectError)) throw error;
      console.log(pc.yellow('⚠ Project scan unavailable — analyzing the message without app context.'));
    }

    let provider;
    try {
      provider = createProvider(config);
    } catch (error) {
      if (error instanceof AIProviderError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    console.log(`Analyzing the rejection message with ${provider.name} ...`);
    console.log();

    let analysis: ReviewAnalysis;
    try {
      analysis = await analyzeRejection(
        provider,
        rejectionText,
        payload,
        storeHint ? { storeHint } : {},
      );
    } catch (error) {
      if (error instanceof ReviewAnalyzeError || error instanceof AIProviderError) {
        console.error(pc.red(`✗ ${error.message}`));
        process.exitCode = 1;
        return;
      }
      throw error;
    }

    renderIssues(analysis);
    if (analysis.overallPlan.length > 0) {
      console.log();
      console.log(pc.bold('Recommended order:'));
      analysis.overallPlan.forEach((step, i) => console.log(`  ${i + 1}. ${step}`));
    }

    const written = await writeAnalysis(projectRoot, analysis, config.project.name);
    console.log();
    console.log(pc.dim(`Full report written to ${written.markdownPath}`));
  });

export const reviewCommand = new Command('review')
  .description('Work with store review feedback')
  .addCommand(analyzeSubcommand);
