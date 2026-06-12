import { describe, it, expect } from 'vitest';
import { parseFrontmatter } from '../../src/lib/frontmatter';

describe('parseFrontmatter', () => {
  it('parses frontmatter and returns body', () => {
    const raw = `---\ntitle: "Hello"\ndescription: "A post"\ndraft: true\n---\n# Body\n`;
    const { data, content } = parseFrontmatter(raw);
    expect(data).toEqual({ title: 'Hello', description: 'A post', draft: true });
    expect(content.trim()).toBe('# Body');
  });

  it('defaults draft to false and allows missing title', () => {
    const { data } = parseFrontmatter(`---\ndescription: "x"\n---\nbody\n`);
    expect(data.draft).toBe(false);
    expect(data.title).toBeUndefined();
  });

  it('throws on wrong field types', () => {
    expect(() => parseFrontmatter(`---\ntitle: 5\n---\nbody`)).toThrow(/title/);
  });
});
