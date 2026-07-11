import { describe, it, expect } from 'vitest';
import { pickPublishedDate, relativeDay } from '../../src/lib/post-date';

describe('pickPublishedDate', () => {
  it('prefers the git merge date over an explicit frontmatter date', () => {
    expect(pickPublishedDate('2026-01-02', '2026-06-15')).toBe('2026-06-15');
  });
  it('falls back to a valid frontmatter date when git has none', () => {
    expect(pickPublishedDate('2026-01-02', null)).toBe('2026-01-02');
  });
  it('ignores a malformed frontmatter date', () => {
    expect(pickPublishedDate('janurary', null)).toBe('');
    expect(pickPublishedDate('2026/01/02', null)).toBe('');
  });
  it('returns empty when neither is available', () => {
    expect(pickPublishedDate(undefined, null)).toBe('');
  });
});

describe('relativeDay', () => {
  const now = new Date('2026-07-07T12:00:00Z');
  it('says "today" for the current day (and future dates)', () => {
    expect(relativeDay('2026-07-07', now)).toBe('today');
    expect(relativeDay('2026-07-10', now)).toBe('today');
  });
  it('says "yesterday" for one day ago', () => {
    expect(relativeDay('2026-07-06', now)).toBe('yesterday');
  });
  it('says "N days ago" for older dates', () => {
    expect(relativeDay('2026-07-04', now)).toBe('3 days ago');
    expect(relativeDay('2026-06-07', now)).toBe('30 days ago');
  });
  it('returns empty for missing or malformed dates', () => {
    expect(relativeDay('', now)).toBe('');
    expect(relativeDay('2026/07/04', now)).toBe('');
  });
});
