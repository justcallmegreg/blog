import { describe, it, expect } from 'vitest';
import { nextVersion, parseVersion } from '../../scripts/next-version.mjs';

describe('nextVersion', () => {
  it('patch uses the commit count on the current minor line', () => {
    expect(nextVersion('0.1.0', 'patch', 3)).toBe('0.1.3');
    expect(nextVersion('1.4.0', 'patch', 1)).toBe('1.4.1');
    expect(nextVersion('1.4.0', 'patch', 0)).toBe('1.4.0');
  });
  it('minor increments minor and resets patch', () => {
    expect(nextVersion('0.1.0', 'minor')).toBe('0.2.0');
    expect(nextVersion('1.4.2', 'minor')).toBe('1.5.0');
  });
  it('major increments major and resets minor+patch', () => {
    expect(nextVersion('0.1.0', 'major')).toBe('1.0.0');
    expect(nextVersion('1.4.2', 'major')).toBe('2.0.0');
  });
  it('patch-release increments the patch (X.Y.Z -> X.Y.Z+1)', () => {
    expect(nextVersion('0.4.0', 'patch-release')).toBe('0.4.1');
    expect(nextVersion('1.2.3', 'patch-release')).toBe('1.2.4');
  });
  it('rejects an unknown mode', () => {
    expect(() => nextVersion('1.0.0', 'bogus')).toThrow(/unknown mode/);
  });
  it('rejects a malformed current version', () => {
    expect(() => nextVersion('1.0', 'minor')).toThrow(/invalid version/);
  });
  it('rejects a negative patch count', () => {
    expect(() => nextVersion('1.0.0', 'patch', -1)).toThrow(/patchCount/);
  });
  it('parseVersion splits a version', () => {
    expect(parseVersion('2.3.4')).toEqual({ major: 2, minor: 3, patch: 4 });
  });
});
