import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

const AboutSchema = z.object({
  headline: z.string().default(''),
  bio: z.string().default(''),
  projects: z
    .array(
      z.object({
        start: z.number().int(),
        end: z.number().int(),
        description: z.string(),
        responsibilities: z.string().default(''),
        deliveries: z.string().default(''),
      })
    )
    .default([]),
});

export type AboutData = z.infer<typeof AboutSchema>;
export type AboutProject = AboutData['projects'][number];

/**
 * Parse and validate an about.yaml document. Throws on invalid input — callers
 * (the content store) catch and degrade to null so a bad file never 500s a page.
 */
export function parseAbout(raw: string): AboutData {
  const data = parseYaml(raw) ?? {};
  const result = AboutSchema.safeParse(data);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.')}: ${i.message}`)
      .join('; ');
    throw new Error(`Invalid about.yaml: ${issues}`);
  }
  return result.data;
}
