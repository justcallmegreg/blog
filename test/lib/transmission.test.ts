import { describe, it, expect } from 'vitest';
import { parseTransmissionFrontmatter, transmissionMediaUrl } from '../../src/lib/transmission';

describe('parseTransmissionFrontmatter', () => {
  it('parses fields and defaults poster + draft', () => {
    const raw = [
      '---',
      'title: "First TX"',
      'date: "2026-06-02"',
      'description: "Channel zero."',
      'video: "first-tx/master.m3u8"',
      'duration: "05:52"',
      '---',
      'body ignored',
    ].join('\n');
    const { data } = parseTransmissionFrontmatter(raw);
    expect(data.title).toBe('First TX');
    expect(data.video).toBe('first-tx/master.m3u8');
    expect(data.duration).toBe('05:52');
    expect(data.poster).toBe('poster.jpg'); // default
    expect(data.draft).toBe(false);         // default
  });
  it('honors an explicit poster and draft', () => {
    const raw = '---\nvideo: "a/master.m3u8"\nposter: "cover.jpg"\ndraft: true\n---\n';
    const { data } = parseTransmissionFrontmatter(raw);
    expect(data.poster).toBe('cover.jpg');
    expect(data.draft).toBe(true);
  });
  it('throws when video is missing', () => {
    expect(() => parseTransmissionFrontmatter('---\ntitle: "No video"\n---\n')).toThrow(
      /Invalid transmission frontmatter/
    );
  });
});

describe('transmissionMediaUrl', () => {
  it('joins base + /transmissions/ + video', () => {
    expect(transmissionMediaUrl('https://media.example.com', 'a/master.m3u8')).toBe(
      'https://media.example.com/transmissions/a/master.m3u8'
    );
  });
  it('tolerates a trailing slash on base and a leading slash on video', () => {
    expect(transmissionMediaUrl('https://media.example.com/', '/a/master.m3u8')).toBe(
      'https://media.example.com/transmissions/a/master.m3u8'
    );
  });
});
