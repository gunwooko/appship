import { describe, expect, it } from 'vitest';
import {
  APP_STORE_LIMITS,
  GOOGLE_PLAY_LIMITS,
  validateFields,
  validatePlayTitlePolicy,
} from './validator.js';

describe('validateFields', () => {
  it('passes values within limits', () => {
    expect(
      validateFields({ name: 'My App', subtitle: 'Short and sweet' }, APP_STORE_LIMITS),
    ).toEqual([]);
  });

  it('flags values over the limit with actual and allowed lengths', () => {
    const violations = validateFields({ name: 'A'.repeat(31) }, APP_STORE_LIMITS);
    expect(violations).toHaveLength(1);
    expect(violations[0]!.message).toContain('31');
    expect(violations[0]!.message).toContain('30');
  });

  it('ignores fields not present in the values', () => {
    expect(validateFields({}, GOOGLE_PLAY_LIMITS)).toEqual([]);
  });

  it('enforces the Play short description limit of 80', () => {
    const violations = validateFields({ shortDescription: 'x'.repeat(81) }, GOOGLE_PLAY_LIMITS);
    expect(violations).toHaveLength(1);
  });
});

describe('validatePlayTitlePolicy', () => {
  it('flags emoji in titles', () => {
    expect(validatePlayTitlePolicy('Best App 🚀')).toHaveLength(1);
    expect(validatePlayTitlePolicy('Best App')).toEqual([]);
  });
});
