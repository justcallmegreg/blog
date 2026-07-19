import matter from 'gray-matter';
import { z } from 'zod';

// Transmissions need their own frontmatter schema because the post schema
// (src/lib/frontmatter.ts) strips unknown keys — it would drop `video`,
// `duration`, and `poster`.
const TransmissionSchema = z.object({
  title: z.string().optional(),
  description: z.string().optional(),
  draft: z.boolean().default(false),
  date: z.string().optional(),
  publishAt: z.string().optional(),
  video: z.string(), // required: path to the master playlist, relative to the media base
  duration: z.string().optional(),
  poster: z.string().default('poster.jpg'),
});

export type TransmissionFrontmatter = z.infer<typeof TransmissionSchema>;

export function parseTransmissionFrontmatter(raw: string): { data: TransmissionFrontmatter } {
  const parsed = matter(raw);
  const result = TransmissionSchema.safeParse(parsed.data);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid transmission frontmatter: ${issues}`);
  }
  return { data: result.data };
}

/** Absolute playback URL for a transmission's master playlist. */
export function transmissionMediaUrl(base: string, video: string): string {
  return `${base.replace(/\/$/, '')}/transmissions/${video.replace(/^\//, '')}`;
}
