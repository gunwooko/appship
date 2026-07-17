// Store metadata limits and validation (TRD §7 length rules, shared with the
// AI retry loop in §5.3). AI output is never trusted to respect constraints —
// this validator is the enforcement point.

export interface FieldLimit {
  field: string;
  maxLength: number;
}

export const APP_STORE_LIMITS: FieldLimit[] = [
  { field: 'name', maxLength: 30 },
  { field: 'subtitle', maxLength: 30 },
  { field: 'description', maxLength: 4000 },
  { field: 'keywords', maxLength: 100 },
  { field: 'promotionalText', maxLength: 170 },
  { field: 'releaseNotes', maxLength: 4000 },
];

export const GOOGLE_PLAY_LIMITS: FieldLimit[] = [
  { field: 'title', maxLength: 30 },
  { field: 'shortDescription', maxLength: 80 },
  { field: 'fullDescription', maxLength: 4000 },
  { field: 'releaseNotes', maxLength: 500 },
];

export interface Violation {
  field: string;
  message: string;
}

const EMOJI_PATTERN = /\p{Extended_Pictographic}/u;

export function validateFields(
  values: Record<string, string>,
  limits: FieldLimit[],
): Violation[] {
  const violations: Violation[] = [];
  for (const { field, maxLength } of limits) {
    const value = values[field];
    if (value === undefined) continue;
    if (value.length > maxLength) {
      violations.push({
        field,
        message: `${field} is ${value.length} characters; the store limit is ${maxLength}.`,
      });
    }
  }
  return violations;
}

/** Google Play metadata policy: no emoji in title. */
export function validatePlayTitlePolicy(title: string): Violation[] {
  if (EMOJI_PATTERN.test(title)) {
    return [{ field: 'title', message: 'Title contains emoji, which Google Play metadata policy disallows.' }];
  }
  return [];
}
