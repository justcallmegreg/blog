import { stringify as yamlStringify } from 'yaml';

// Namespace segment for overseer-authored transmissions, matching the Plane A
// content layout `transmissions/{owner}-{repo}/{slug}/`.
export const TRANSMISSIONS_NS = 'justcallmegreg-blog';

export const SLUG_RE = /^[a-z0-9][a-z0-9-]*$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function transmissionEntryPaths(slug: string): {
  dir: string;
  indexMd: string;
  posterAsset: string;
} {
  const dir = `transmissions/${TRANSMISSIONS_NS}/${slug}`;
  return { dir, indexMd: `${dir}/index.md`, posterAsset: `${dir}/assets/poster.jpg` };
}

export interface TransmissionFields {
  title: string;
  description?: string;
  date?: string;
  video: string;
  duration?: string;
  draft: boolean;
  publishAt?: string;
}

export function composeTransmissionMarkdown(fields: TransmissionFields): string {
  // Deterministic key order; omit empty optionals so the file stays clean.
  const fm: Record<string, unknown> = { title: fields.title, video: fields.video };
  if (fields.date) fm.date = fields.date;
  if (fields.description) fm.description = fields.description;
  if (fields.duration) fm.duration = fields.duration;
  if (fields.publishAt) fm.publishAt = fields.publishAt;
  fm.draft = fields.draft;
  // Double-quote every string scalar. Critical for `date`/`publishAt`: the
  // engine parses frontmatter via gray-matter (js-yaml), whose default schema
  // reads an UNQUOTED `2026-06-02` as a Date object — which would fail the
  // transmission schema's `date: z.string()` and silently drop the entry.
  // `lineWidth: 0` disables folding so a long description stays on one line.
  const body = yamlStringify(fm, { defaultStringType: 'QUOTE_DOUBLE', defaultKeyType: 'PLAIN', lineWidth: 0 });
  return `---\n${body}---\n`;
}

export interface CreateInput {
  slug: string;
  title: string;
  description?: string;
  date?: string;
  duration?: string;
  video?: string;
  posterType?: string;
  hasPoster: boolean;
  draft?: boolean;
}

export type ValidateResult =
  | { ok: true; slug: string; fields: TransmissionFields }
  | { ok: false; error: string };

export function validateCreateInput(i: CreateInput): ValidateResult {
  const slug = (i.slug ?? '').trim();
  if (!SLUG_RE.test(slug)) return { ok: false, error: 'slug must be lowercase letters, digits, and hyphens' };
  const title = (i.title ?? '').trim();
  if (!title) return { ok: false, error: 'title is required' };
  if (!i.hasPoster) return { ok: false, error: 'a poster image is required' };
  if (i.posterType && !/^image\/(png|jpeg|webp|gif)$/.test(i.posterType)) {
    return { ok: false, error: 'poster must be a png, jpeg, webp, or gif image' };
  }
  if (i.date && !YMD.test(i.date)) return { ok: false, error: 'date must be YYYY-MM-DD' };
  const video = (i.video ?? '').trim() || `${slug}/master.m3u8`;
  return {
    ok: true,
    slug,
    fields: {
      title,
      description: i.description?.trim() || undefined,
      date: i.date?.trim() || undefined,
      duration: i.duration?.trim() || undefined,
      video,
      draft: Boolean(i.draft),
    },
  };
}

export function deletePlan(slug: string): { gitPaths: string[]; r2Prefix: string } {
  const p = transmissionEntryPaths(slug);
  return { gitPaths: [p.indexMd, p.posterAsset], r2Prefix: `transmissions/${slug}/` };
}
