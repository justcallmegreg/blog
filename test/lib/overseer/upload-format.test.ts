import { describe, it, expect } from 'vitest';
import { slugify, formatDuration, formatBytes, uploadStats } from '../../../src/lib/overseer/upload-format';

describe('slugify', () => {
  it('lowercases, hyphenates, and trims', () => {
    expect(slugify('  My First Vlog! ')).toBe('my-first-vlog');
    expect(slugify('a__b--c')).toBe('a-b-c');
    expect(slugify('!!!')).toBe('');
  });
});
describe('formatDuration', () => {
  it('formats seconds as mm:ss and floors', () => {
    expect(formatDuration(5)).toBe('0:05');
    expect(formatDuration(72.9)).toBe('1:12');
    expect(formatDuration(-3)).toBe('0:00');
  });
});
describe('formatBytes', () => {
  it('uses KB under 1MB and MB above', () => {
    expect(formatBytes(500)).toBe('1 KB'); // rounds
    expect(formatBytes(2_400_000)).toBe('2.4 MB');
  });
  it('uses GB at and above 1e9 bytes', () => {
    expect(formatBytes(2_500_000_000)).toBe('2.50 GB');
  });
});
describe('uploadStats', () => {
  it('computes speed (B/s) and ETA (s) from a delta', () => {
    const { speed, etaSeconds } = uploadStats(3_000_000, 9_000_000, 1_000_000, 1);
    expect(speed).toBe(2_000_000);
    expect(etaSeconds).toBe(3); // (9M-3M)/2M
  });
  it('returns Infinity ETA when speed is zero', () => {
    expect(uploadStats(0, 10, 0, 0).etaSeconds).toBe(Infinity);
  });
});
