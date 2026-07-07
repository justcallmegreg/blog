import { describe, it, expect } from 'vitest';
import { estimateReadingMinutes } from '../../src/lib/reading-time';

describe('estimateReadingMinutes', () => {
  it('returns at least 1 minute for short or empty content', () => {
    expect(estimateReadingMinutes('')).toBe(1);
    expect(estimateReadingMinutes('a few words here')).toBe(1);
  });

  it('rounds words/200 to the nearest minute', () => {
    expect(estimateReadingMinutes('word '.repeat(200))).toBe(1); // 200 -> 1
    expect(estimateReadingMinutes('word '.repeat(300))).toBe(2); // 1.5 -> 2
    expect(estimateReadingMinutes('word '.repeat(900))).toBe(5); // 4.5 -> 5 (well, 4.5->5)
  });

  it('counts whitespace-separated words, ignoring extra spacing/newlines', () => {
    expect(estimateReadingMinutes('  one\n\ntwo   three\tfour ')).toBe(1);
  });
});
