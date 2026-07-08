import matter from 'gray-matter';
import { z } from 'zod';

const FrontmatterSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  date: z.string().optional(),
  // Optional schedule: when set and in the future, the engine hides the post
  // until this moment. See docs/superpowers/specs/2026-07-08-scheduled-publishing-design.md.
  publishAt: z.string().optional(),
});

export type PostFrontmatter = z.infer<typeof FrontmatterSchema>;

export function parseFrontmatter(raw: string): {
  data: PostFrontmatter;
  content: string;
} {
  const parsed = matter(raw);
  const result = FrontmatterSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid frontmatter: ${issues}`);
  }
  return { data: result.data, content: parsed.content };
}
