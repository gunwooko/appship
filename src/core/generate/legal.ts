import type { AIProvider } from '../ai/provider.js';
import type { SummaryPayload } from '../ai/payload.js';
import type { PrivacyReport } from '../types.js';

// Legal drafts are AI-written prose grounded ONLY in scanner findings.
// Unknowns become [CONFIRM: ...] placeholders that doctor later detects.
const LEGAL_SYSTEM_PROMPT = `You are AppShip, drafting legal/support documents for a mobile app's store submission.

Rules you must never break:
- Ground every statement in the provided project summary and data-collection findings. Never invent data practices.
- Never write definitive negative claims like "we do not share your data". Instead describe only what was detected, and add: "Please verify whether data is transferred to these providers." where relevant.
- For anything the developer must decide or confirm (company name, contact email, jurisdiction, retention periods), insert a placeholder in the exact form [CONFIRM: <question>].
- Start the document with a blockquote disclaimer: "> This is an AI-generated draft, not legal advice. Review it with a qualified professional before publishing."
- Output plain Markdown only.`;

export interface LegalDocSpec {
  filename: string;
  title: string;
  instructions: string;
}

export const LEGAL_DOCS: LegalDocSpec[] = [
  {
    filename: 'privacy-policy.md',
    title: 'Privacy Policy',
    instructions:
      'Cover: what data is collected (from the findings), purposes, third-party SDKs detected, user rights, contact. ',
  },
  {
    filename: 'terms-of-service.md',
    title: 'Terms of Service',
    instructions:
      'Cover: acceptance, license, user accounts (if login is a feature), acceptable use, subscriptions/purchases only if payments SDKs were detected, liability, governing law.',
  },
  {
    filename: 'account-deletion.md',
    title: 'Account Deletion Instructions',
    instructions:
      'Explain how a user deletes their account and data (Apple Guideline 5.1.1). If the summary does not include login, state that the app has no accounts and this page may not be required.',
  },
  {
    filename: 'support-page.md',
    title: 'Support',
    instructions:
      'A short support page: what the app does, FAQ stubs based on the features, and a contact placeholder.',
  },
];

export async function generateLegalDoc(
  provider: AIProvider,
  spec: LegalDocSpec,
  payload: SummaryPayload,
  privacyReport: PrivacyReport,
): Promise<string> {
  const prompt =
    `Write the "${spec.title}" document for this app. ${spec.instructions}\n\n` +
    `Project summary:\n${JSON.stringify(payload, null, 2)}\n\n` +
    `Detected data collection (scanner findings with evidence):\n` +
    JSON.stringify(privacyReport.dataCollection, null, 2);

  return provider.generateText({ system: LEGAL_SYSTEM_PROMPT, prompt });
}
