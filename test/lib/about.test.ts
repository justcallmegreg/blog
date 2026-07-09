import { describe, it, expect } from 'vitest';
import { parseAbout } from '../../src/lib/about';

describe('parseAbout', () => {
  it('parses a full document', () => {
    const data = parseAbout(`
headline: "Greg — engineer"
bio: "Short bio."
projects:
  - start: 2021
    end: 2023
    description: "A project."
    responsibilities: "Led it."
    deliveries: "Shipped it."
`);
    expect(data.headline).toBe('Greg — engineer');
    expect(data.bio).toBe('Short bio.');
    expect(data.projects).toHaveLength(1);
    expect(data.projects[0]).toEqual({
      start: 2021,
      end: 2023,
      description: 'A project.',
      responsibilities: 'Led it.',
      deliveries: 'Shipped it.',
    });
  });

  it('applies defaults for missing optional fields', () => {
    const data = parseAbout(`
projects:
  - start: 2020
    end: 2021
    description: "Minimal."
`);
    expect(data.headline).toBe('');
    expect(data.bio).toBe('');
    expect(data.projects[0].responsibilities).toBe('');
    expect(data.projects[0].deliveries).toBe('');
  });

  it('defaults projects to an empty array when absent', () => {
    const data = parseAbout(`headline: "Only a headline"`);
    expect(data.projects).toEqual([]);
  });

  it('treats an empty document as all-defaults', () => {
    const data = parseAbout('');
    expect(data).toEqual({ headline: '', bio: '', projects: [] });
  });

  it('throws when a project is missing a required field', () => {
    expect(() =>
      parseAbout(`
projects:
  - start: 2020
    description: "No end year."
`)
    ).toThrow();
  });

  it('throws when start/end are not integers', () => {
    expect(() =>
      parseAbout(`
projects:
  - start: "twenty"
    end: 2021
    description: "Bad start."
`)
    ).toThrow();
  });
});
