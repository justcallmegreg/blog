import { describe, it, expect } from 'vitest';
import {
  transmissionEntryPaths,
  composeTransmissionMarkdown,
  validateCreateInput,
  deletePlan,
} from '../../../src/lib/overseer/transmissions';
import { parseTransmissionFrontmatter } from '../../../src/lib/transmission';

describe('transmissionEntryPaths', () => {
  it('lays out the git paths under the transmissions namespace', () => {
    expect(transmissionEntryPaths('booting-the-vault')).toEqual({
      dir: 'transmissions/justcallmegreg-blog/booting-the-vault',
      indexMd: 'transmissions/justcallmegreg-blog/booting-the-vault/index.md',
      posterAsset: 'transmissions/justcallmegreg-blog/booting-the-vault/assets/poster.jpg',
    });
  });
});

describe('composeTransmissionMarkdown', () => {
  it('emits frontmatter with required fields and omits empty optionals', () => {
    const md = composeTransmissionMarkdown({ title: 'First', video: 'first/master.m3u8', draft: false });
    expect(md.startsWith('---\n')).toBe(true);
    expect(md).toContain('title: "First"');
    expect(md).toContain('video: "first/master.m3u8"');
    expect(md).toContain('draft: false');
    expect(md).not.toContain('description:');
    expect(md.trimEnd().endsWith('---')).toBe(true);
  });
  it('includes optionals when present', () => {
    const md = composeTransmissionMarkdown({
      title: 'F', video: 'f/master.m3u8', draft: true,
      description: 'desc', date: '2026-06-02', duration: '05:52', publishAt: '2026-06-02T09:00',
    });
    expect(md).toContain('description: "desc"');
    expect(md).toContain('duration:');
    expect(md).toContain('publishAt:');
    expect(md).toContain('draft: true');
  });
  it('quotes the date so the engine parses it as a string, not a Date', () => {
    const md = composeTransmissionMarkdown({ title: 'F', video: 'f/master.m3u8', draft: false, date: '2026-06-02' });
    expect(md).toContain('date: "2026-06-02"');
  });
  it('round-trips through the engine frontmatter parser with date intact', () => {
    // Guards the js-yaml date-coercion trap end-to-end using the real Plane A parser.
    const md = composeTransmissionMarkdown({ title: 'RT', video: 'rt/master.m3u8', draft: false, date: '2026-06-02', duration: '01:23' });
    const { data } = parseTransmissionFrontmatter(md);
    expect(typeof data.date).toBe('string');
    expect(data.date).toBe('2026-06-02');
    expect(data.video).toBe('rt/master.m3u8');
    expect(data.duration).toBe('01:23');
    expect(data.draft).toBe(false);
  });
});

describe('validateCreateInput', () => {
  const base = { slug: 'ok-slug', title: 'T', hasPoster: true, posterType: 'image/jpeg' };
  it('accepts valid input and defaults video from slug', () => {
    const r = validateCreateInput(base);
    expect(r.ok).toBe(true);
    if (r.ok) { expect(r.slug).toBe('ok-slug'); expect(r.fields.video).toBe('ok-slug/master.m3u8'); expect(r.fields.draft).toBe(false); }
  });
  it('rejects a bad slug', () => {
    expect(validateCreateInput({ ...base, slug: 'Bad Slug' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, slug: '-x' }).ok).toBe(false);
  });
  it('requires a title and a poster', () => {
    expect(validateCreateInput({ ...base, title: '  ' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, hasPoster: false }).ok).toBe(false);
  });
  it('rejects a non-image poster and a malformed date', () => {
    expect(validateCreateInput({ ...base, posterType: 'application/pdf' }).ok).toBe(false);
    expect(validateCreateInput({ ...base, date: '06/02/2026' }).ok).toBe(false);
  });
  it('honors an explicit video and draft', () => {
    const r = validateCreateInput({ ...base, video: 'custom/x.m3u8', draft: true });
    expect(r.ok && r.fields.video).toBe('custom/x.m3u8');
    expect(r.ok && r.fields.draft).toBe(true);
  });
});

describe('deletePlan', () => {
  it('returns the two git paths and the R2 prefix', () => {
    expect(deletePlan('vault')).toEqual({
      gitPaths: [
        'transmissions/justcallmegreg-blog/vault/index.md',
        'transmissions/justcallmegreg-blog/vault/assets/poster.jpg',
      ],
      r2Prefix: 'transmissions/vault/',
    });
  });
});
