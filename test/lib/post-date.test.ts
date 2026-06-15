import { describe, it, expect } from 'vitest';
import { pickPublishedDate } from '../../src/lib/post-date';

describe('pickPublishedDate', () => {
  it('prefers a valid frontmatter date', () => {
    expect(pickPublishedDate('2026-01-02', '2026-06-15')).toBe('2026-01-02');
  });
  it('ignores a malformed frontmatter date and uses git', () => {
    expect(pickPublishedDate('janurary', '2026-06-15')).toBe('2026-06-15');
    expect(pickPublishedDate('2026/01/02', '2026-06-15')).toBe('2026-06-15');
  });
  it('uses git when no frontmatter date', () => {
    expect(pickPublishedDate(undefined, '2026-06-15')).toBe('2026-06-15');
  });
  it('returns empty when neither is available', () => {
    expect(pickPublishedDate(undefined, null)).toBe('');
    expect(pickPublishedDate('nope', null)).toBe('');
  });
});
