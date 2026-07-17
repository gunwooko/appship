// Deterministic submission checklists (NO AI). doctor consumes the same
// facts to compute readiness; these files are the human-readable companion.

import type { AppshipConfig } from '../config/schema.js';
import type { ScanResult } from '../types.js';

function item(text: string): string {
  return `- [ ] ${text}`;
}

export function renderAppStoreChecklist(config: AppshipConfig, scan: ScanResult): string {
  const lines = [
    `# App Store submission checklist — ${config.project.name}`,
    '',
    '## Metadata',
    item('Review generated name/subtitle/description/keywords in .appship/app-store/'),
    item('Review review-notes.txt (test account, subscription details)'),
    item('Support URL configured in App Store Connect'),
    item('Marketing URL (optional) configured'),
    '',
    '## Privacy',
    item('Resolve every [CONFIRM] in .appship/legal/ and privacy-questionnaire.yml'),
    item('Answer App Privacy questionnaire in App Store Connect'),
    item('PrivacyInfo.xcprivacy present in the Xcode project'),
    ...(config.project.requires_login
      ? [item('Account deletion flow available in-app (Guideline 5.1.1) and documented')]
      : []),
    '',
    '## Permissions',
    ...scan.permissions.ios.map((p) =>
      item(
        `${p.key}: usage description reviewed` +
          (p.qualityAssessment !== 'ok' ? ' (⚠ current message needs improvement)' : ''),
      ),
    ),
    '',
    '## Assets',
    item('App icon (1024×1024) uploaded'),
    item('Screenshots for required device sizes (see screenshots/screenshot-plan.yml)'),
    '',
  ];
  return lines.join('\n');
}

export function renderGooglePlayChecklist(config: AppshipConfig, scan: ScanResult): string {
  const lines = [
    `# Google Play submission checklist — ${config.project.name}`,
    '',
    '## Metadata',
    item('Review generated title/short/full description in .appship/google-play/'),
    item('Category and tags set in Play Console'),
    '',
    '## Data Safety & Policy',
    item('Resolve confirm_before_submitting items in data-safety.yml, then fill the Data Safety form'),
    item('Complete the content rating questionnaire (see content-rating.yml)'),
    item('Privacy policy URL published and linked in Play Console'),
    ...(config.project.requires_login
      ? [item('Account deletion URL provided in Play Console (required when accounts exist)')]
      : []),
    item('App access instructions provided if login is required'),
    item('Ads declaration completed'),
    '',
    '## Permissions',
    ...scan.permissions.android.map((p) => item(`${p.key}: usage justified in the declaration`)),
    '',
    '## Assets',
    item('App icon (512×512) and feature graphic (1024×500) uploaded'),
    item('Screenshots uploaded (see screenshots plan)'),
    '',
  ];
  return lines.join('\n');
}
