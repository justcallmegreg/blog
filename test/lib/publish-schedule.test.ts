import { describe, it, expect } from 'vitest';
import { parsePublishAt } from '../../src/lib/publish-schedule';

describe('parsePublishAt', () => {
  it('returns none for empty/absent input', () => {
    expect(parsePublishAt(undefined, 'Europe/Budapest')).toEqual({ kind: 'none' });
    expect(parsePublishAt('', 'Europe/Budapest')).toEqual({ kind: 'none' });
    expect(parsePublishAt('   ', 'Europe/Budapest')).toEqual({ kind: 'none' });
  });

  it('interprets a bare local time in the given timezone, DST-correct (summer/CEST)', () => {
    const r = parsePublishAt('2026-08-01T09:00', 'Europe/Budapest');
    // 09:00 Budapest in August is CEST (+02:00) → 07:00 UTC
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T07:00:00.000Z',
      day: '2026-08-01',
    });
  });

  it('interprets a bare local time DST-correct (winter/CET)', () => {
    const r = parsePublishAt('2026-01-15T09:00', 'Europe/Budapest');
    // 09:00 Budapest in January is CET (+01:00) → 08:00 UTC
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-01-15T08:00:00.000Z',
      day: '2026-01-15',
    });
  });

  it('accepts optional seconds and a space separator', () => {
    const r = parsePublishAt('2026-08-01 09:00:30', 'Europe/Budapest');
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T07:00:30.000Z',
      day: '2026-08-01',
    });
  });

  it('honours an explicit offset and ignores the config timezone', () => {
    const r = parsePublishAt('2026-08-01T09:00+00:00', 'Europe/Budapest');
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T09:00:00.000Z',
      day: '2026-08-01', // 09:00Z is still Aug 1 in Budapest (11:00 local)
    });
  });

  it('honours a trailing Z', () => {
    const r = parsePublishAt('2026-08-01T23:30Z', 'Europe/Budapest');
    // 23:30Z is 01:30 next day in Budapest (CEST) → day rolls to Aug 2
    expect(r).toEqual({
      kind: 'scheduled',
      instant: '2026-08-01T23:30:00.000Z',
      day: '2026-08-02',
    });
  });

  it('returns invalid for a malformed datetime', () => {
    expect(parsePublishAt('not-a-date', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
    expect(parsePublishAt('2026-13-40T09:00', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for an unknown timezone', () => {
    expect(parsePublishAt('2026-08-01T09:00', 'Mars/Olympus')).toEqual({ kind: 'invalid' });
  });

  it('returns invalid for out-of-range minutes or seconds (bare local time)', () => {
    expect(parsePublishAt('2026-08-01T09:70', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
    expect(parsePublishAt('2026-08-01T09:30:70', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
  });

  it('resolves a DST spring-forward gap time deterministically without error', () => {
    // 2026-03-29 02:30 does not exist in Europe/Budapest (clocks jump 02:00→03:00).
    const r = parsePublishAt('2026-03-29T02:30', 'Europe/Budapest');
    expect(r.kind).toBe('scheduled');
    if (r.kind === 'scheduled') expect(r.day).toBe('2026-03-29');
  });

  it('rejects an impossible day-of-month in both the offset and bare paths', () => {
    expect(parsePublishAt('2026-02-30T09:00:00+02:00', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
    expect(parsePublishAt('2026-04-31T09:00', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
    // 2026 is not a leap year → Feb 29 does not exist
    expect(parsePublishAt('2026-02-29T09:00', 'Europe/Budapest')).toEqual({ kind: 'invalid' });
  });

  it('accepts Feb 29 in a leap year', () => {
    const r = parsePublishAt('2028-02-29T09:00', 'Europe/Budapest');
    expect(r.kind).toBe('scheduled');
  });
});
